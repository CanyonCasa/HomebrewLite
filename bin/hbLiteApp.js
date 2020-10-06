/*
hbLiteApp.js: lightweight configurable website
issued: 20200514 by CanyonCasa, (c)2020 Enchanted Engineering, Tijeras NM.

A flexible easily configured general purpose web app for hbLite backends
Assumes use of a JSON REST API and includes most needed functions as builtins,
including logging requests, authentication/authorization, compression, 
JSON body parsing, user management, login, error handling, and static page serving.
*/

// app and middleware dependencies
const path = require('path');
const express = require('express');
const compression = require('compression');         // for compressing responses
const https = require('https');
var qs = require('qs');
var url = require('url');
const bcrypt = require('bcryptjs');

require('./Extensions2JS');
const Auth = require('./hbLiteAuth');               // authentication and authorization
var jxjDB = require('./jxjDB');                     // JSON database

// NOTE: use of any of the default handlers requires the user of a users database for the specific site
const HANDLERS = {  // default handlers and routes...
  LiteData: {   // database API support
    tag: 'data',          // transcript tag
    code: './LiteData',   // code loaded for handler
    route: '/\\$:recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?', // traffic route
    db: 'site'            // required database, referencing site database defined above.
  },
  LiteFile: {   // file upload/download API support
    tag: 'file',          // transcript tag
    code: './LiteFile',   // code loaded for handler
    route: '/\\~:recipe(\\w+)/:opt?', // traffic route
    db: 'site'
  },
  LiteAction: {   // action API support
    tag: 'action',        // transcripting tag
    code: './LiteAction', // code loaded for handler
    route: '/\\@:action(\\w+)/:opt1?/:opt2?/:opt3?' // traffic route
  },
  LiteInfo: {   // info API support
    tag: 'info',          // transcripting tag
    code: './LiteInfo',   // code loaded for handler
    route: '/\\!:info(\\w+)' // traffic route
  }
};

// constructor for flexible site application based on user configuration...
module.exports = Site = function Site(context) {
  // homebrew server level items under context key server: db, emsg, headers, mail, scribe, sms
  // site specific configuration under context.cfg, context.proxy, context.secure, and context.tag, (overrides server)
  // middleware added context keys include: xApp
  for (let key in context) this[key] = context[key];  // save server/site context (without introducing another level of hierarchy)
  this.scribe = context.server.scribe(context.tag);
  this.db = context.server.db;  // inherit default databases from server
  for (let d in (context.cfg.databases||{})) { // optionally override or add local databases
    this.scribe.trace(`Creating and loading '${d}' database (file: ${context.cfg.databases[d].file}) ...`);
    this.db[d] = new jxjDB(context.cfg.databases[d]);
    this.db[d].load()
      .then(x=>this.scribe.debug(`Site '${d}' database loaded successfully!`))
      .catch(e=>{this.scribe.fatal(`Site '${d}' database load error!`,e)});
  };
  if (this.secure) {  //  behind secure https proxy
    if (!('users' in this.db)) this.scribe.fatal("hbLiteApp: NO 'users' database defined!");
    this.auth = new Auth(context.cfg.auth); // auth instance for backend
  } else {
    this.scribe.warn(`Site ${context.tag.toUpperCase()} configured as insecure (i.e. http only) site\n`+
      "  hbLite handlers, SMS, email, Login, Authentication, and User Management DISABLED! ");
  };

  // create Express app instance and add settings and locals...
  this.xApp = express();
  ((context.cfg.x||{}).settings||{}).mapByKey((v,k)=>this.xApp.set(k,v));
  ((context.cfg.x||{}).locals||{}).mapByKey((v,k)=>this.xApp.locals[k]=v);
  this.scribe.Stat.set(this.tag,undefined,{requests: 0, errors: 0});

  // text messaging service and mail wrappers included here to be available to all handlers; uses server level clients
  // phone number formatting helper function...
  const prefix = (n)=>n && String(n).replace(/^\+{0,1}1{0,1}/,'+1'); // function to prefix numbers with +1
  // asynchronous text messaging worker...
  this.sendText = async function sendText(msg,recipients) {
    if (!('users' in this.db)) throw 501;
    let phoneBook = this.db.users.query('contacts',{ref:'.+'},true).mapByKey(v=>v.phone);
    let sms = {id: msg.id || ''}; // format optional header with id and/or time
    sms.timestamp = msg.time ? '['+new Date().toISOString()+']' : '';
    sms.body = (msg.hdr || ((sms.id||sms.timestamp) ? sms.id+sms.timestamp+':\n' : '')) + msg.text;
    // map recipients, group ot to "users and/or numbers" to prefixed numbers...
    let list = [recipients,msg.group,msg.to].filter(n=>n).toString().split(',');
    sms.numbers = list.map(n=>prefix(isNaN(n)?phoneBook[n]:n)).filter(n=>n).filter((v,i,a)=>a.indexOf(v)==i);
    return await this.server.sms({numbers: sms.numbers, body: sms.body, callback:msg.callback})
      .then(t=>({raw:t, sms:sms, msg:msg}))
      .catch(e=>{ throw e; });
  };
  // sendMail worker...
  this.sendMail = async function sendMail(msg) {
    if (!('users' in this.db)) throw 501;
    let addressBook = this.db.users.query('contacts',{ref:'.+'},true).mapByKey(v=>v.email);
    let mail = {id: msg.id, time: msg.time, subject: msg.subject, hdr: msg.hdr, body: msg.text||msg.body};
    ['to','cc','bcc'].forEach(addr=>{  // resolve email addressing
       let tmp = msg[addr] instanceof Array ? msg[addr] : typeof msg[addr]=='string' ? msg[addr].split(',') : [];
       tmp = tmp.map(a=>a.includes('@')?a:addressBook[a]).filter(a=>a).filter((v,i,a)=>v && a.indexOf(v)===i).join(',');
       if (tmp) mail[addr] = tmp;
    });
    if (msg.from) mail.from = msg.from.includes('@')?msg.from:addressBook[msg.from];
    return await this.server.mail(mail)
      .then(m=>({raw:m, mail:mail, msg:msg}))
      .catch(e=>{ throw e; });
  };
  
  this.build(); // build site specific app
};

// builtin middleware to handle required initialization, request logging, authentication, login, and user operations
Site.prototype.builtin = function builtin(mwName) {
  var self = this;
  this.scribe.debug("Loading builtin middleware:",mwName);
  switch (mwName) {
    case 'init':    // initialize request, logging
      self.headers = {}.mergekeys(self.server.headers).mergekeys(self.cfg.headers); // merge just once
      return function initMiddleware(rqst,rply,next){
        self.scribe.log("RQST[%s]: %s", rqst.method, rqst.url);  // log request...
        self.scribe.Stat.inc(self.tag,'requests');
        self.headers.mapByKey((v,k)=>rply.set(k,v));  // apply any global and site specific headers ...
        rqst.hb = { scribe: self.scribe,  // pass site shared contexts as a namespace variable 'hb'...
          auth: { user: {member: ''}, authenticated: false, error: null, header: {}, username: '', jwt: '', authorize: ()=>false } }; 
        next();
      };
    case 'cors':    // handle CORS headers, only included if self.cfg.cors is defined
      return function corsMiddleware(rqst,rply,next){
        let origin = rqst.headers['origin'];
        if (!origin) return next(); // does not apply to non-origin based requests
        let allow = (self.cfg.cors.allow || []).includes(origin);
        if (allow) {
          rply.set('Access-Control-Allow-Origin', origin);
          rply.set('Access-Control-Expose-Headers','*');
          if (rqst.method=='OPTIONS') {
            rply.set('Access-Control-Allow-Methods','POST, GET, OPTIONS');
            rply.set('Access-Control-Allow-Headers','Authorization, Content-type');
            rply.end();
          } else {
            next();
          };
        } else {
          next(emsg({code: 403, msg: 'Unauthorized cross-site request'}));
        };
      };
    case 'noauth':    // defaults for no authentication
      return function noauthMiddleware(rqst,rply,next){
        rqst.hb.auth = {user: {member: '', username: ''}, authorize: ()=>false};
        next();
      };
    case 'auth':    // authentication
      return function authMiddleware(rqst,rply,next){
        self.auth.authenticate(rqst.headers.authorization,(u)=>self.db.users.query('userByUsername',{username: u},true))
          .then(a => {
            rqst.hb.auth = a; // assign authorization object to request
            if (a.authenticated) rply.header('authorization',"Bearer "+a.jwt);
            if (a.error) {
              rply.json(self.server.emsg(401,a.error));
            } else {
              next();
            };
          })
          .catch(e=>rqst.hb.scribe.error("builtin.auth: ",e.toString()));
      };
    case 'user':    // user management
      var uDB = this.db['users']; // shorthand reference
      return function userMiddleware(rqst,rply,next){
        let admin = rqst.hb.auth.authorize('admin,manager');
        let selfAuth = !!(rqst.params.user && (rqst.params.user===rqst.hb.auth.user.username)); // user authenticated as self
        if (rqst.method=='GET') {
          if (rqst.params.action==='code') {  // GET /user/code/<username>
            if (!rqst.params.user) return next(400);
            let usr = uDB.query('userByUsername',{username: rqst.params.user},true);
            console.log("usr:", usr,self.auth.genCode(),self.auth);
            if (verifyThat(usr,'isNotEmpty')) {
              usr.credentials.code = self.auth.genCode(); // assign code to user
              uDB.modify('changeUser',[{ref: usr.username, record: usr}],true);
              let text = `Challenge code: ${usr.credentials.code.code} user: ${usr.username}`;
              if (rqst.params.opt) { // anything, then by mail
                self.sendMail({time: true, text: text})
                  .then(data=>{
                    self.scribe.info(`Challenge code[${code.code}] sent to ${rqst.params.user} at ${data.mail.to}`);
                    rply.json({data:admin?data:null, msg:`Challenge code sent to ${rqst.params.user} at ${data.mail.to}`}) })
                  .catch(err=>{
                    self.scribe.error("Action[code] ERROR: %s", err); 
                    rply.json({error:err});
                  });
              } else { // by default sms
                self.sendText({time: true, text: text})
                  .then(data =>{
                    self.scribe.info(`Challenge code[${code.code}] sent to ${rqst.params.user} at ${data.sms.numbers}`);
                    rply.json({data:admin?data:null, msg:`Challenge code sent to ${rqst.params.user} at ${data.sms.numbers}`}) })
                  .catch(err=>{
                    self.scribe.error("Action[code] ERROR: ", err); 
                    rply.json({error:err})});
              };
            } else {
              next(400);
            };
          } else {  // GET /user/contants|groups|users/[<username>]
            let auth = selfAuth || rqst.hb.auth.user.member;
            let bindings = {ref: rqst.params.user||'.+'}; // logically, will always be 'user' when selfAuth==true 
            let uData = uDB.query(rqst.params.action,bindings,auth);
            if (uData) { rply.json(uData); } else { next(400); };
          };
        } else if (rqst.method=='POST') { // create,activate, or update 1 or more user records
          if (rqst.params.action==='code') { // POST /user/code/<username>/<code> -> validate code, activate user
            let who = uDB.query('userByUsername',{username: rqst.params.user||''},true);  // no auth since user not ACTIVE...
            if (verifyThat(who,'isNotEmpty') &&  self.auth.checkCode(rqst.params.opt,who.credentials.code)) {
              if (who.status=='PENDING') {
                who.status = 'ACTIVE';
                uDB.modify('changeUser',[[who.username,who]],true);
              };
              rply.json({msg: `Status: ${who.status}`});
            } else {
              next(400);
            };
          } else if (rqst.params.action==='change') { // POST /user/change
            if (!verifyThat(rqst.body,'isArrayOfAnyObjects')) return next(400);
            let data = rqst.body;
            let changes = [];
            const DEFAULTS = uDB.defaults('users');  // default user entry
            data.forEach(usr=>{
              let record = usr.record || usr[1]; // usr.ref||usr[0] not trusted as it may be different than record.username
              if (verifyThat(record,'isTrueObject') && record.username) {
                // if user exists change action, else create action...
                let existing = uDB.query('userByUsername',{username: record.username},true) || {};
                let exists = verifyThat(existing,'isNotEmpty');
                self.scribe.trace("existing[%s] ==> %s", record.username, JSON.stringify(existing));
                if (!exists || (record.username==rqst.hb.auth.user.username) || admin) { // authorized to make changes: new account, self, or admin
                  // build a safe record...
                  delete record.credentials;
                  record.credentials = { hash: record.password ? bcrypt.hashSync(record.password,11) : '', code: {} };
                  delete record.password;
                  self.scribe.trace("user record[%s] ==> %s", record.username, JSON.stringify(record));
                  let entry = ({}).mergekeys(DEFAULTS).mergekeys(existing).mergekeys(record);
                  if (!admin) {
                    entry.member = exists ? existing.member : DEFAULTS.member;  // can't change one's own membership
                    entry.status = exists ? existing.status : DEFAULTS.status;  // can't change one's own status
                  };
                  self.scribe.trace("user entry[%s] ==> %s", record.username, JSON.stringify(entry));
                  changes.push(uDB.modify('changeUser',[{ref:record.username,record:entry}],true)[0]||[]);
                } else {
                  changes.push(['error',record.username,self.server.emsg(401)]);  // not authorized
                };
              } else {
                changes.push(['error',record.username,self.server.emsg(400)]);  // malformed request
              };
            });
            self.scribe.trace("user changes...", changes);
            rply.json(changes);
          } else if (rqst.params.action==='groups') { // POST /user/groups
            rply.json(uDB.modify('groups',rqst.body,rqst.hb.auth.user.member)||'');
          } else {
            next(400);
          };
        } else {
          next(501);
        };
      };
    case 'login':   // user login response
      return function loginMiddleware(rqst,rply,next){
        if (rqst.hb.auth.error) return next(emsg(401,rqst.hb.auth.error));
        rply.json({jwt: rqst.hb.auth.jwt});
      };
    case 'mapURL':  // URL redirects and rewrites
      return function mapURLMiddleware(rqst,rply,next){
        if (self.cfg.redirect) {  // handle redirect: reports new file back to client...
          let origin = url.parse(rqst.originalUrl);
          if (self.cfg.redirect[origin.pathname]) {
            let destination = url.format(origen.mergekeys({pathname: self.cfg.redirect[origin.pathname]}));
            self.scribe.debug("URL[redirect]: %s ==> %s", rqst.originalUrl, destination);
            return rply.redirect(destination);
          };
        };
        if (self.cfg.rewrite) {  // handle URL rewriting: reports new file back to client...
          let newURL = rqst.originalUrl;
          for (let rule in self.cfg.rewrite) {
            if (newURL.match(pattern)) {
              let [pattern,substitution,last] = self.cfg.rewrite[rule];
              newURL = newURL.replace(pattern,substitution);
              if (last) break;
            };
          };
          self.scribe.debug("URL[rewrite]: %s ==> %s", rqst.originalUrl, newURL);
          rqst.originalUrl = newURL;
          rqst.query = qs.parse(url.parse(rqst.originalUrl).query); // reparse in case changed
        };
        next(); // proceed to next middleware
      };
    case 'terminate':  
      // middleware function to catcch all requests and terminate request or throw error.
      return function terminateMiddleware(rqst,rply,next){
        if (rqst.protocol==='http' && self.cfg.secureRedirect) { // try automatic secure redirect...
          let parts = { protocol: rqst.protocol, host:rqst.get('host'), pathname:url.parse(rqst.originalUrl).pathname, query:rqst.query };
          let source = url.format(parts);
          let destination = url.format(parts).replace(...self.cfg.secureRedirect);
          self.scribe.debug("Secure redirect[%s]: %s ==> %s", rqst.method, source, destination);
          rply.redirect(destination);  
        } else {
          self.scribe.trace("Throw: default 404 (not found) error");
          next(404);
        };
      };
    case 'errorHandler':
    default:
      // default error handler. Intercept with a separate handler...
      return function defaultErrorHandlerMiddleware(err,rqst,rply,next) {
        let ex = !isNaN(err) ? self.server.emsg(err) : err;  // convert default errors to homebrew format
        if (ex instanceof Object && 'code' in ex) { // homebrew error {code: #, msg:'prompt'}...
          self.scribe.warn('OOPS[%s]: %s ==> (%s->%s) %s %s', ex.code, ex.msg, rqst.ip, rqst.hostname, rqst.method,rqst.originalUrl);
          self.scribe.Stat.inc(self.cfg.tag,ex.code);
          self.scribe.Stat.inc(self.cfg.tag,'errors');
          self.scribe.Stat.inc(self.cfg.tag+'-blacklist-'+ex.code,rqst.ip);
          rply.status(ex.code).json(ex);
        } else {  // JavaScript/Node error...
          self.scribe.error('ERROR: %s %s (see transcript)', err.toString()||'?', ((err.stack||'').split('\n')[1]||'').trim());
          self.scribe.flush(err.stack);
          self.scribe.Stat.inc(self.cfg.tag,500);
          self.scribe.Stat.inc(self.cfg.tag,'errors');
          rply.status(500).json(self.server.emsg(500));
        };
        rply.end();
      };
  };
};

Site.prototype.build = function build() {
  this.scribe.info("Initializing site '%s' app...",this.tag);
  // base support for compressing responses, parsing body json and file upload
  this.xApp.use(compression()); 
  this.xApp.use(express.json());
  this.xApp.use(express.urlencoded({ extended: true }));
  // basic site initialization middleware that includes authentication...
  this.xApp.use(this.builtin('init'));    // handler to initialize and log requests
  this.xApp.use(this.builtin('mapURL'));  // handler to redirect and rewrite requests
  if (this.secure) {
    if (this.cfg.cors) this.xApp.use(this.builtin('cors'));    // handler for CORS requests
    this.xApp.use(this.builtin('auth'));    // handler to authenticate users
    this.xApp.use('/login',this.builtin('login'));  // handler to respond to user login request
    this.xApp.use('/user/:action/:user?/:opt?',this.builtin('user'));  // handler for user management
  } else {
    this.xApp.use(this.builtin('noauth'));    // handler to bypass authenticating users
  };
  // static and custom middleware handlers...
  if (this.cfg.root) this.xApp.use(express.static(this.cfg.root));
  (this.cfg.handlers||[]).forEach(h=>{
    var hx = h in HANDLERS ? HANDLERS[h] : typeof h=='object' ? ({}).mergekeys(h) : undefined;
    if (hx) { (h.tag=='static') ? this.xApp.use(express.static(h.root)) : this.xApp.use(hx.route,require(hx.code).call(this,hx)) }; });
  // request termination and error handling...
  this.xApp.use(this.builtin('terminate'));    // redirects to secure site or throws default error; skipped if a real error occurs prior
  this.xApp.use(this.builtin('ErrorHandler')); // final error handler...
  this.xApp.listen(this.cfg.port);    // http site
  this.scribe.info("Site server started for %s at %s:%s", this.tag, this.cfg.host, this.cfg.port);
};
