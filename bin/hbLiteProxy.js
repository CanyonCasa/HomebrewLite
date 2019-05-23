/*
proxy.js: reverse proxy server for multi-domain homebrew web server 
(c)2019 Enchanted Engineering, Tijeras NM.

proxy.js script defines a reverse proxy server for a small multi-domain NodeJS 
homebrew web hosting service with custom routing logic that maps hostname to backend server.

For secure proxies (i.e. https), under proxy configuration define key: 
  {secure: {key: <path_to_key_file>, cert: <path_to_cert_file>}}
  This module allows secrets to be updated (in the background) without stopping server (i.e. Let's Encrypt);
  for now, assumes all hosts on same certificate!

SYNTAX:
  var Proxy = require('./hbProxy');
  var proxy = new Proxy(<proxy-config>);
  proxy.start([<callback>]);
*/ 

// load module dependencies...
var http = require('http');
var https = require('https');
var httpProxy = require('http-proxy');
const tls = require('tls');
var fs = require('fs');                 // file system
var url = require('url');
var Scribe = require('./Scribe');

module.exports = Proxy = function Proxy(context) {
  this.cfg = context.cfg;
  this.tag = context.tag;
  context.stats[this.tag] = {errors: 0, probes: 0, served: 0, wpad: 0};
  this.context = context;
  this.scribe = new Scribe({tag:context.tag, parent: context.scribe}.mergekeys(context.cfg.scribe||{}));
  // if secure server, configure it...
  if ('secure' in context.cfg) this.initSecure(context.cfg.secure);
  this.proxy = httpProxy.createServer(context.cfg.options||{});
};

Proxy.prototype.initSecure = function initSecure(cfg) {
  this.secure = {};
  this.loadSecrets(cfg.files); // occurs synchronously since files specified 
  this.secure.options = {SNICallback: this.SNICallback()};
  this.context.msg.on(this.tag,(renew)=>{if (this.cfg.sites.includes(renew)) this.loadSecrets();});
  return this.secure;
};

// loads secure context files synchronously (when files provided initially) or asynchronously when refreshed
Proxy.prototype.loadSecrets = function (files) {
  let secrets = {};
  if (files!==undefined) {  // sync load
    this.secure.files = files;
    try {
      for (var f in files) secrets[f] = fs.readFileSync(files[f], 'utf8');
    } catch (e) {
      this.scribe.error("Key/certificate file '%s' not found for secure proxy[%s]!",f, this.tag); 
      this.scribe.fatal("Proxy '%s' creation failed!", this.tag);
    };
    this.secure.secrets = secrets;
    this.secure.changed = true;
    this.scribe.trace("Key/certificate files loaded..."); 
  } else if (this.secure.files!==undefined) {  // async load
    let list = Object.keys(this.secure.files);
    var self = this;
    function series(f) {
      if (f) {
        fs.readFile(self.secure.files[f],'utf8',(e,d)=> {
          if (e) return self.scribe.error("Key/certificate file[%s] load error: %s",f,e); 
          secrets[f] = d;
          self.scribe.trace("Loaded Key/certificate file %s",f); 
          series(list.shift());
          });
      } else {    // finalize async
        self.secure.secrets = secrets;
        self.secure.changed = true;
        self.scribe.info("Key/certificate files reloaded..."); 
      };
    };
    series(list.shift());
  } else {
    throw "Required proxy secrets files (key/cert) not defined!"
  };
};

// default SNI callback for secure proxies
Proxy.prototype.SNICallback = function SNICallback() {
  var self = this;
  return function SNICB(host,cb) {
    if (self.secure.changed) {
      self.secure.changed = false;
      self.secure.context = tls.createSecureContext(self.secure.secrets);
      self.scribe.debug("Secure Context updated...");
    };
    cb(null,self.secure.context);
  };
};

// default generic reverse proxy callback...
Proxy.prototype.router = function router() {
  var self = this;
  this.proxy.on('error', (err,rqst,rply) => {
    self.scribe.error("Trapped internal proxy exception!:", err.toString());
    self.context.stats[self.tag].errors++;
    try {
      rply.writeHead(500, "Oops!, Proxy Server Error!" ,{"Content-Type": "text/plain"});
      rply.write(JSON.stringify({error:{code:500, msg:'Oops!, Proxy Server Error!'}}));
      rply.end();
    } catch (e) {
      self.scribe.error("Exception handling Proxy Exception!: %s", e.toString());
    };
  });

  return function proxyRouter(rqst, rply) {
    let [host, method, url] = [rqst.headers.host.split(':')[0]||'', rqst.method, rqst.url];
    let route = self.cfg.routes[host] || self.cfg.routes['*.' + host.substr(host.indexOf('.')+1)];
    let ip = rqst.headers['x-forwarded-for']||rqst.connection.remoteAddress||'?';
    if (route) {
      rqst.headers.hbid = uniqueID();
      self.context.stats[self.tag].served++;
      self.scribe.debug("PROXY[%s]: %s -> (%s) %s %s (@%s:%s)", rqst.headers.hbid, ip, host, method, url, route.host,route.port);
      self.proxy.web(rqst, rply, {target: route});
    } else {
      if (![/192\.168\.\d+\.\d+$/,/127\.\d+\.\d+\.\d+$/,/10\.\d+\.\d+\.\d+$/,/169\.254\.\d+\.\d+$/].some(x => ip.match(x))) {  
        // ignore diagnostics for local addresses
        self.context.stats[self.tag].probes++;
        self.scribe.dump("NO PROXY ROUTE[%d]: %s -> (%s) %s %s", self.context.stats[self.tag].probes, host, ip, method, url);
      };
      if (url.match('wpad')) self.context.stats[self.tag].wpad++;
      rply.writeHead(410, "Gone" ,{"Content-Type": "text/plain"});
      rply.write(JSON.stringify({error:{code: 410, msg: "NO Proxy Route!"}}));
      rply.end();
    };
  };
};

// launch proxy servers...
// dedicated http(s) server needed to intercept and route to multiple targets.
Proxy.prototype.start = function start(callback) {
  callback = callback || this.router();
  this.server = (this.secure!==undefined) ? https.createServer(this.secure.options,callback) : http.createServer(callback);
  this.server.on('upgrade',(req,socket,head)=> { this.proxy.ws(req,socket,head); });
  this.server.listen(this.cfg.port);
};
