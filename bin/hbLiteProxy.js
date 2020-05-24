/*
proxy.js: reverse proxy server
(c)2019 Enchanted Engineering, Tijeras NM.

proxy.js script defines a reverse proxy server for a small multi-domain NodeJS 
homebrew web hosting service with custom routing logic that maps hostname to backend server.

For secure proxies (i.e. https), under proxy configuration key must define: 
  {secure: {key: <path_to_key_file>, cert: <path_to_cert_file>}}
  This module allows secrets to be updated (in the background) without stopping server (i.e. Let's Encrypt);

SYNTAX:
  var Proxy = require('./hbProxy');
  var proxy = new Proxy(<proxy-config>);
  proxy.start([<callback>]);
  ...
  proxy.loadSecrets();  // to load renewed certificate files 
*/ 

// load module dependencies...
var http = require('http');
var https = require('https');
var httpProxy = require('http-proxy');
const tls = require('tls');
const forge = require('node-forge');
var fsp = require('fs').promises;
var url = require('url');
var Scribe = require('./Scribe');

module.exports = Proxy = function Proxy(context) {
  this.cfg = context.cfg;
  this.tag = context.tag;
  this.emsg = context.emsg;
  this.scribe = new Scribe({tag:context.tag, parent: context.scribe}.mergekeys(context.cfg.scribe||{}));
  this.scribe.Stat.set(context.tag,undefined,{errors: 0, probes: 0, served: 0});
  this.proxy = httpProxy.createServer(context.cfg.options||{});
  this.initSecure(context.cfg.secure) // configure server security ...
    .then(x=>{this.start(context.router)})  // context.router undefined, defaults to internal proxy router
    .catch(e=>this.scribe.fatal("Proxy '%s' creation failed!", this.tag));
};

// asynchronously prepare the security context...
Proxy.prototype.initSecure = async function initSecure(cfg) {
  if (cfg===undefined) return;
  this.secure = {options: {SNICallback: this.SNICallback()}};
  return await this.loadSecrets(cfg.files);
};

// loads secure context files asynchronously; files passed only on initial load
Proxy.prototype.loadSecrets = async function (files) {
  if (this.secure===undefined) return;
  let secrets = {};
  this.secure.files = this.secure.files || files; // files only defined at startup
  if (this.secure.files===undefined) throw "Required proxy secrets files (key/cert) not defined!"
  try {
    for (var f in this.secure.files) {
      this.scribe.trace(`Loading TLS '${f}' file: ${this.secure.files[f]}`);
      secrets[f] = await fsp.readFile(this.secure.files[f], 'utf8');
    };
    this.secure.secrets = secrets;
    this.secure.changed = true;
    this.scribe.debug("Key/certificate files loaded...");
    let exp = forge.pki.certificateFromPem(secrets.cert).validity.notAfter;
    this.scribe.info("Certificate valid until",exp);
    return exp;
  } catch (e) { 
    this.scribe.error("Secure Proxy[%s] key/certificate file '%s' error!",this.tag,f);
    this.scribe.error(e.toString());
    throw e;
  };
};

// default SNI callback for secure proxies; how proxies updates security context
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
    self.scribe.Stat.inc(self.tag,'errors');
    try {
      rply.writeHead(500, "Oops!, Proxy Server Error!" ,{"Content-Type": "text/plain"});
      rply.write(JSON.stringify(self.emsg(500,'Oops!, Proxy Server Error!')));
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
      self.scribe.Stat.inc(self.tag,'served');
      self.scribe.debug("PROXY[%s]: %s -> (%s) %s %s (@%s:%s)", self.tag, ip, host, method, url, route.host, route.port);
      self.proxy.web(rqst, rply, {target: route});
    } else {
      let localIP = ip.match(/(?:192\.168|127\.\d+|10\.\d+|169\.254)\.\d+\.\d+$/);
      if (!localIP || self.cfg.verbose) { // ignore diagnostics for local addresses
        self.scribe.Stat.inc(self.tag,'probes');
        self.scribe.Stat.inc('blacklist',ip);
        self.scribe.dump("NO PROXY ROUTE[%d]: %s -> (%s) %s %s", self.scribe.Stat.get(self.tag,'probes'), host, ip, method, url);
      };
      rply.end(); // invalid routes close connection!
    };
  };
};

// launch proxy servers...
// dedicated http(s) server needed to intercept and route to multiple site targets.
Proxy.prototype.start = function start(router) {
  router = router || this.router(); // default to builtin
  this.server = (this.secure!==undefined) ? https.createServer(this.secure.options,router) : http.createServer(router);
  this.server.on('upgrade',(req,socket,head)=> { this.proxy.ws(req,socket,head); });
  this.server.listen(this.cfg.port);
};
