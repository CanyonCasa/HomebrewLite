// module for a basic configurable website...

// app and middleware dependencies
const path = require('path');
const express = require('express');
const fileUpload = require('express-fileupload');
const compression = require('compression');     // for compressing responses
///const cookies = require('cookie-parser');       // for cookies
const bodyParser = require('body-parser');      // for JSON and urlencoded bodies
const https = require('https');

require('./Extensions2JS');
const Scribe = require('./Scribe');             // transcripting
const Auth = require('./hbLiteAuth');

const errMsgs = {
  400: "Bad Request",
  401: "NOT authorized!",
  403: "Forbidden",
  404: "File NOT found!",
  500: "Internal Server Error"
};

// constructor for flexible site application based on user configuration...
module.exports = Site = function Site(context) {
  // homebrew server level items under context keys: auth (worker), cfg, headers, msg (service), (parent) scribe, (internal) stats, tag  
  // site specific configuration under context.cfg and context.tag;
  // middleware added context keys include: xApp, as well as changes to db and site, and a site specific scribe
  for (let key of context) this[key] = context[key];  // save site context (without introducing another level of hierarchy)
  this.scribe = new Scribe({tag: context.tag, parent: context.scribe});  // replace parent scribe ref with local scribe linked to parent
  if (context.cfg.auth) this.auth = new Auth(context.cfg.auth); // optionally override server authentication
  if (context.cfg.database) this.siteDB = new JSONDB(context.cfg.database); // optionally define site database
  // create Express app instance and add settings and locals...
  this.xApp = express();
  for (var key of (context.cfg.x||{}).settings||{}) this.xApp.set(key,context.cfg.x.settings[key]);
  for (let k in (context.cfg.x||{}).locals||{}) this.xApp.locals[k] = context.cfg.x.locals[k];
  this.stats[this.tag] = {requests: 0, errors: 0};
  this.start();
};
  
Site.prototype.start = function start() {
  var self = this;
  this.scribe.info("Initializing site app... %s",this.cfg.name);
  // optional base support for compressing responses, cookies, parsing body json and x-www-form-urlencoded data, and file upload
  this.xApp.use(compression()); 
  ///this.xApp.use(cookies());
  this.xApp.use(bodyParser.json()); 
  ///this.xApp.use(bodyParser.urlencoded(this.cfg.x.url));
  this.xApp.use(fileUpload(this.cfg.x.upload));
  // basic site initialization middleware...
  this.xApp.use(function init(rqst,rply,next){
    self.scribe.log("RQST[%s]: %s %s", rqst.headers.hbid, rqst.method, rqst.url);  // log request...
    self.stats[self.tag].requests++;
    // pass site shared contexts as a reserved variable 'hb'...
    rqst.hb = {auth: self.auth, msg: self.msg, stats: self.stats};
    // apply any (global and site specific) static headers passed to site...
    for (var h in self.headers) rply.set(h,self.headers[h]);
    next(); // proceed to next middleware
  });
  ///if (opts.notify) this.xApp.post('/@:send',this.services.notify.sendWare());
  // static and custom middleware handlers...
  this.cfg.handlers.forEach(h=>h.code=='static' ? this.xApp.use(express.static(h.root||h.route)) : this.xApp.use(h.route,require(h.code).call(this,h)));
  // handler to redirect or throw default error if this point reached since no handler replied; skipped if a real error occurs prior
  this.xApp.use(function(rqst,rply,next){  // catchall 
    if (rqst.protocol==='http' && self.cfg.redirect) { // try automatic secure redirect...
      let location = "https://"+rqst.hostname+rqst.originalUrl; 
      self.scribe.debug("Secure redirect[%s]: %s ==> %s", rqst.headers.hbid, rqst.url, location);
      rply.redirect(location);      
      }
    else {
      self.scribe.trace("Throw[%s]: default 404 (not found) error", rqst.headers.hbid);
      next(404);
      };
    });
  // add error handler...
  this.xApp.use(function defaultErrorHandler(err,rqst,rply,next) {
    if (!isNaN(err)) err = {code: Number(err), msg: errMsgs[Number(err)]||'UNKNOWN ERROR'};  // convert default errors to homebrew format
    if (err instanceof Object && 'code' in err) { // homebrew error {code: #, msg:'prompt'}...
      self.scribe.warn('OOPS[%s]: %s %s ==> (%s->%s) %s %s', rqst.headers.hbid, err.code, err.msg, rqst.ip, rqst.hostname, rqst.method,rqst.originalUrl);
      self.stats[self.tag][err.code] = self.stats[self.tag][err.code] ? self.stats[self.tag][err.code]+1 : 1;
      self.stats[self.tag].errors++;
      rply.status(err.code).json({error: err});
    } else {  // JavaScript/Node error...
      self.scribe.error('ERROR[%s]: %s %s (see transcript)', rqst.headers.hbid, err.toString()||'?', ((err.stack||'').split('\n')[1]||'').trim());
      self.scribe.flush(err.stack);
      self.stats[self.tag].errors++;
      rply.status(500).json({error:{code:500,msg:'INTERNAL SERVER ERROR'}});
    };
    rply.end();
  });
  this.xApp.listen(this.cfg.port);                           // http site
  this.scribe.debug("HTTP[%s]: server started for app service at %s:%s", this.tag, this.cfg.host, this.cfg.port); 
};
