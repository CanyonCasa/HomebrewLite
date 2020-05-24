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
const twilio = require('twilio');
var email = require('emailjs');

require('./Extensions2JS');
const Scribe = require('./Scribe');                 // transcripting
const Auth = require('./hbLiteAuth');               // authentication and authorization
var jxjDB = require('./jxjDB');                     // JSON database

// constructor for flexible site application based on user configuration...
module.exports = Site = function Site(context) {
  // homebrew server level items under context key server: db, emsg, headers, scribe (i.e. parent scribe)
  // site specific configuration under context.proxy, context.cfg, and context.tag, to override server
  // middleware added context keys include: xApp
  for (let key of context) this[key] = context[key];  // save server/site context (without introducing another level of hierarchy)
  this.scribe = new Scribe({tag: context.tag, parent: context.server.scribe});  // local scribe linked to server parent
  this.db = context.server.db;  // inherit default databases from server
  for (let d of (context.cfg.databases||{})) { // optionally override or add local databases
    this.scribe.trace(`Creating and loading '${d}' database (file: ${context.cfg.databases[d].file}) ...`);
    this.db[d] = new jxjDB(context.cfg.databases[d]);
    this.db[d].load()
      .then(x=>this.scribe.debug(`Site '${d}' database loaded successfully!`))
      .catch(e=>{this.scribe.fatal(`Site '${d}' database load error!`,e)});
  };
  if (!('users' in this.db)) throw "hbLiteApp: Required 'users' database not defined! ";
  var uDB = this.db['users']; // shorthand reference
  this.auth = new Auth(context.cfg.auth); // auth instance for backend

  // create Express app instance and add settings and locals...
  this.xApp = express();
  ((context.cfg.x||{}).settings||{}).mapByKey((v,k)=>this.xApp.set(k,v));
  ((context.cfg.x||{}).locals||{}).mapByKey((v,k)=>this.xApp.locals[k]=v);
  this.scribe.Stat.set(this.tag,undefined,{requests: 0, errors: 0});
  
  // get or assign user code...
  this.generateCode = function generateCode(code,user=null,expires=null) {
    let c;
    switch (code) {
      case undefined: c = undefined; break;
      case 'pin':     c = uniqueID(4,10); break;
      case 'code':    c = uniqueID(6,10); break;
      case 'login':   c = uniqueID(8,36); break;
      case 'secure': 
      default:        c = uniqueID(12,36).split('').map(c=>Math.random()>0.5?c.toUpperCase():c).join('');
    };
    let codex = { code: c, iat: new Date().valueOf()/1000|0, exp: expires, type: code }
    if (user===null) return codex;  // only generate, don't assign to user
    let u = uDB.query('userIndexByUsername',user,true);
    if (verifyThat(u,'isNotEmpty')) {
      u.record.credentials.code = codex;
      uDB.modify('changeUser',u.record,true,u.index);
      return u.record.credentials.code;
    };
    return undefined; // invalid user specified
  };
  
  // text messaging service included here to be available to all handlers
  var twilioCfg = context.cfg.twilio;
  // phone number formatting helper function...
  const prefix = (n)=>n && String(n).replace(/^\+{0,1}1{0,1}/,'+1'); // function to prefix numbers with +1
  // asynchronous text messaging worker...
  this.sendText = async function sendText(msg,recipients) {
    if (!twilioCfg) throw 501;
    try {
      let sms = {id: msg.id || twilioCfg.name || ''}; // format optional header with id and/or time
      sms.timestamp = msg.time ? '['+new Date().toISOString()+']' : '';
      sms.body = (msg.hdr || ((sms.id||sms.timestamp) ? sms.id+sms.timestamp+':\n' : '')) + msg.text;
      // map recipients, group ot to "users and/or numbers" to prefixed numbers...
      let list = ([recipients,msg.group,msg.to].filter(n=>n).toString()||twilioCfg.to).split(',');
      let phoneBook = uDB.query('phones',[],true);
      sms.numbers = list.map(n=>prefix(isNaN(n)?phoneBook[n]:n)).filter(n=>n).filter((v,i,a)=>a.indexOf(v)==i);
      sms.from = prefix(twilioCfg.number);
      // process sms requests...
      const client = twilio(twilioCfg.accountSID,twilioCfg.authToken);
      sms.numbers.forEach(n=>{
        client.messages.create({to: n, from: sms.from, body: sms.body})
          .then(m => this.scribe.debug(`Text message sent to: ${n}`))
          .catch(e=>{ throw e })
          .done();
      });
      sms.numStr = sms.numbers[0] + (sms.numbers.length>1 ? ', ...' : '');
      return {rpt: `Text messages queued for ${sms.numStr}`, sms: sms, msg: msg};
    } catch (ee) { throw ee };
  };
  
  // email server included here to be available to all handlers
  var emailCfg = context.cfg.mail;
  // sendMail worker...
  this.sendMail = async function sendMail(msg) {
    if (!(emailCfg && emailCfg.defaults)) throw 501;
    return new Promise((resolve,reject)=>{
      msg.id = msg.id || emailCfg.name || ''; // format optional header with id and/or time
      msg.timestamp = msg.time ? '['+new Date().toISOString()+']' : '';
      msg.body = (msg.hdr || ((msg.id||msg.timestamp) ? msg.id+msg.timestamp+':\n' : '')) + msg.text;
      let addressBook = uDB.query('emails',[],true);
      let mail = {};
      ['to','cc','bcc'].forEach(addr=>{  // resolve email addressing
         let tmp = msg[addr] instanceof Array ? msg[addr] : typeof msg[addr]=='string' ? msg[addr].split(',') : [];
         tmp = tmp.map(a=>a.includes('@')?a:addressBook[a]).filter(a=>a).filter((v,i,a)=>v && a.indexOf(v)===i).join(',');
         if (tmp) mail[addr] = tmp;
      });
      if (!(mail.to+mail.cc+mail.bcc)) mail.to = emailCfg.defaults.to;
      // resolve remaining mail parts
      mail.from = msg.from ? msg.from.includes('@')?msg.from:addressBook[msg.from] : emailCfg.defaults.from;
      mail.subject = msg.subject || emailCfg.defaults.subject;
      mail.text = msg.body || emailCfg.defaults.text;
      try {
        let server = email.server.connect(emailCfg.smtp);  // connect to server and send the message...
        server.send(mail,(e,rpt)=>{
          if (e) { reject(e) } else { resolve({rpt:rpt,mail:mail,msg:msg}); };
        });
      } catch(e) { reject(e); }; // report failure
    });
  };

  this.build(); // build site specific app
};

// builtin middleware to handle required initialization, request logging, authentication, login, and user operations
Site.prototype.builtin = function builtin(mwName) {
  var uDB = this.db['users'];
  var self = this;
  this.scribe.debug("Loading builtin middleware:",mwName);
  switch (mwName) {
    case 'init':    // initialize request, logging
      self.headers = {}.mergekeys(self.server.headers).mergekeys(self.cfg.headers); // merge just once
      return function initMiddleware(rqst,rply,next){
        self.scribe.log("RQST[%s]: %s", rqst.method, rqst.url);  // log request...
        self.scribe.Stat.inc(self.tag,'requests');
        self.headers.mapByKey((v,k)=>rply.set(k,v));  // apply any global and site specific headers ...
        rqst.hb = { scribe: self.scribe }; // pass site shared contexts as a namespace variable 'hb'...
        next();
      };
    case 'auth':    // authentication
      return function authMiddleware(rqst,rply,next){
        self.auth.authenticate(rqst.headers.authorization,(u)=>uDB.query('userByUsername',u,true))
          .then(a => {
            rqst.hb.auth = a; // assign authorization object to request
            if (a.authenticated) rply.header('Authorization',a.jwt);
            if (a.error) {
              rply.json(self.server.emsg(401,a.error));
            } else {
              next();
            };
          })
          .catch(e=>rqst.hb.scribe.error("builtin.auth: ",e.toString()));
      };
    case 'user':    // user management
      return function userMiddleware(rqst,rply,next){
        let admin = (rqst.hb.auth.user.member||[]).includes('admin');
        let selfAuth = rqst.params.user && (rqst.params.user==rqst.hb.auth.user.username); // user authenticated as self
        if (rqst.method=='GET') {
          if (rqst.params.code) { // GET /user/<username>/<code> --> assign user an activation code (no auth)
            let code = self.generateCode('code',rqst.params.user);
            if (verifyThat(code,'isNotEmpty')) {
              // text/mail code to user ...
              let text = `Challenge code:\n  user: ${rqst.params.user}\n  code: ${code.code}`;
              if (rqst.params.opt) { // anything, then by mail
                self.sendMail({time: true, text: text})
                  .then(data=>{
                    let note = `Challenge code sent to ${rqst.params.user} at ${data.mail.to}`;
                    self.scribe.info(note);
                    rply.json(admin ? data : note);
                  })
                  .catch(err=>{
                    self.scribe.error("Action[code] ERROR: %s", err); 
                    rply.json(err);
                  });
              } else { // by default sms
                self.sendText({time: true, text: text})
                  .then(data =>{
                    let note = `Challenge code sent to ${rqst.params.user} at ${data.sms.numbers}`;
                    self.scribe.info(note);
                    rply.json(admin ? data : note)})
                  .catch(err=>{
                    self.scribe.error("Action[code] ERROR: ", err.toString()); 
                    rply.json(err)});
              };
            } else {
              next(400);
            };
          } else {  // GET /user or /user/<username> --> return a user or all users...
            if (!admin || !selfAuth) return next(401);
            let pattern = rqst.params.user ? `[][username='${rqst.params.user}']` : ''; // logically only admin can list all
            let users = uDB.query('usersList',pattern,admin||selfAuth)||[];
            users.map(v=>delete v.credentials); // return "snaitized" user data only
            rply.json(users);
          };
        } else if (rqst.method=='POST') { // create,activate, or update 1 or more user records
          if (rqst.params.code) { // POST /user/<username>/<code> -> validate code, activate user, no auth since user not ACTIVE...
            let who = uDB.query('userIndexByUsername',rqst.params.user,true);
            if (verifyThat(who,'isNotEmpty') &&  self.auth.codeCheck(rqst.params.code,who.record.credentials.code)) {
              if (who.record.status=='PENDING') {
                who.record.status = 'ACTIVE';
                uDB.modify('changeUser',who.record,true,who.index);
              };
              rply.json({msg: `Status: ${who.record.status}`});
            } else {
              next(400);
            };
          } else {  // POST /user/<username> -> user change request...
            let data = [];
            let users = rqst.body;
            if (verifyThat(users,'isArrayOfObjects')) {
              const DEFAULTS = uDB.defaults('users');  // default user entry
              users.forEach(u=>{  // process each given user
                let entry = uDB.query('userIndexByUsername',u.username||'',true);
                if (admin || (entry===undefined) || (u.username && (u.username==rqst.hb.auth.user.username))) { // user authenticated (for each entry) as self or admin 
                  let newEntry = Object.assign({},DEFAULTS,entry?entry.record:{},u);
                  if (!admin) { // but only admin can change certain fields
                    newEntry.member = (entry ? entry.record.member : DEFAULTS.member).slice();
                    newEntry.status = entry ? entry.record.status : DEFAULTS.status;
                  };
                  let ref = uDB.modify('changeUser',newEntry,true,entry?entry.index:null);
                  data.push(ref);
                } else {
                  data.push(false);
                };
              });
            } else {
              next(400);
            };
            rply.json(data);
          };
        } else {
          next(501);
        };
      };
    case 'login':   // user login response
      return function loginMiddleware(rqst,rply,next){
        rply.json({jwt: rqst.hb.auth.jwt, error: rqst.hb.auth.error});
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
          let destination = url.format(parts).replace(...self.cfg.secureRedirect);
          self.scribe.debug("Secure redirect[%s]: %s ==> %s", rqst.method, rqst.url, destination);
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
  // basic site initialization middleware that includes authentication...
  this.xApp.use(this.builtin('init'));    // handler to initialize and log requests
  this.xApp.use(this.builtin('mapURL'));  // handler to redirect and rewrite requests
  this.xApp.use(this.builtin('auth'));    // handler to authenticate users
  this.xApp.use('/login',this.builtin('login'));  // handler to respond to user login request
  this.xApp.use('/user/:user?/:code?/:opt?',this.builtin('user'));  // handler for user management
  // static and custom middleware handlers...
  if (this.cfg.root) this.xApp.use(express.static(this.cfg.root));
  (this.cfg.handlers||[]).forEach(h=>h.tag=='static' ? this.xApp.use(express.static(h.root)) : this.xApp.use(h.route,require(h.code).call(this,h)));
  // request termination and error handling...
  this.xApp.use(this.builtin('terminate'));  // handler to redirect to secure site or throw default error since no handler replied; skipped if a real error occurs prior
  this.xApp.use(this.builtin('ErrorHandler')); // final error handler...
  this.xApp.listen(this.cfg.port);    // http site
  this.scribe.info("Site server started for %s at %s:%s", this.tag, this.cfg.host, this.cfg.port); 
};
