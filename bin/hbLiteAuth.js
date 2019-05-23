/// hbLiteAuth.js (c) 2019 Enchanted Engineering -- MIT License

/*
Module for authenticating/authorizing users and API functions...
  - Assumes a small group of users cached in memory from a JSON database
    - Automatically updates database (on disk) when changed
  - Maintains a sessions per user in memory only
  - Recovers credentials from requests
  - Performs user account authentication/authorizion operations
*/

/*
  
USE...

  var auth = new (require('./hbLiteAuth'))(); // instaniate a single instance of module
  
  ...
  request.hb.auth = auth;                     // attach instance to each request before anything else
  ...  
  request.hb.auth.authenticate(request.headers.authorization).then(...).catch(...);
  or
  request.hb.auth.authorize(request.headers.authorization,'shopper').then(...).catch(...);
  
VARS and METHODS...
  sessions:         Sessions "cache" (i.e. in memory JSONDB) to hold active users login sessions
  users:            Users JSONDB holding user credentials.
  
  session           (stored by username reference)
    id:             Homebrew sessions ID associated with current session and valid user login,
                    recovered from request authorization header as password
    expires:        Timeout for the current session.
    renewal:        Maximum timeout for renewal of session expiration.
    
*/


///***********************************************
/// General module and variables declarations...
///***********************************************
require('./Extensions2JS');
const JSONDB = require('./JSONDB');
const bcrypt = require('bcryptjs');

module.exports = Auth = function Auth(cfg={}) {
  this.credentials = (cfg.db&&(cfg.db instanceof JSONDB)) ? cfg.db : new JSONDB(cfg.db);
  this.sessions = new JSONDB();         // memory DB for sessions
  cfg.session = Object.assign({expiration: 10*60*1000, renewal: 24*60*60*1000},cfg.session);
  this.cfg = cfg;
};

// parses the basic authorization header to return login credentials
Auth.prototype.basic = function basic(header) {
  let [method, b64] = header.split(' ');
  let [user,pw] = method.toLowerCase()=='basic' ? new Buffer(b64,'base64').toString().split(':') : ['',''];
  return {user:user, pw:pw}
};

// authenticate the login credentials (who = {user:'...',pw:'...'} or basic authentication header)...
Auth.prototype.authenticate = async function authenticate(who) {
  let login = (typeof who=='string') ? this.basic(who) : (typeof who=='object' ? who : {user:'',pw:''});
  let user = this.credentials.collection('users').get(login.user,{});
  let info = { user: login.user, groups: user.member||[], session: {} };
  if (user.status!=='ACTIVE') return Object.assign(info,{authenticated:false, msg:'Inactive User!'});
  ///this.defineSession(login.user);
  ///let now = new Date();
  let chk = this.checkSession(login.user);
  if (chk.valid) { // session exists
    if (!chk.expired) info.session = this.refreshSession(login.user);
    return Object.assign(info,{authenticated:!chk.expired, msg:(chk.expired)?'Session Expired!':'Session Valid'});
  };
  let cmp = await bcrypt.compare(login.pw,user.hash);
  if (cmp) info.session = this.defineSession(login.user);  // define and return user session
  return Object.assign(info,{authenticated:cmp, msg:(cmp)?'User Authenticated':'Authentication Failed!'});
};

// autheniticate the service for the login credentials (who = {user:'...',pw:'...'} or basic authentication header)...
Auth.prototype.authorize = async function authorize(who,service) {
  let check = await this.authenticate(who);
  Object.assign(check,{authorized:check.authenticated&&check.groups.includes(service)});
  if (check.authenticated&&!check.authorized) check.msg = 'Unauthorized!';
  return check;
};

Auth.prototype.defineSession = function defineSession(who,code) {
  let s = {
    id: code ? uniqueID(6,10) : uniqueID(12),
    expires: new Date(new Date().valueOf()+this.cfg.session.expiration),
    renewal: new Date(new Date().valueOf()+this.cfg.session.renewal),
    user: who
  };
  this.sessions.collection('byUsers').post(who,s);
  return s;
};

Auth.prototype.refreshSession = function refreshSession(who) {
  let s = this.sessions.collection('byUsers').get(who,null);
  if (s && (new Date(s.renewal)<new Date())) s.expires = new Date(new Date().valueOf()+this.cfg.session.expiration);
  this.sessions.collection('byUsers').post(who,s);
  return s;
};

Auth.prototype.checkSession = function checkSession(who,pw) {
  let s = this.sessions.collection('byUsers').get(who,{});
  return {valid: pw && s.id==pw, expired: !s.expires || (new Date(s.expires)<new Date())};  
};

Auth.prototype.getUser = function getUser(user) {
};

Auth.prototype.postUser = function postUser(user) {
};




/*
///***********************************************
/// Sessions cache object definition...
///***********************************************
// holds active users and API records
var Sessions = (()=>{
  var max = 0;                    // max users allowed, 0=unlimited 
  var expiration = 24*60*60*1000; // 24 hours (ms);
  var cache = {};                 // cached user data
  var index = {};                 // cache cross-reference by username 
  var full = () => (max && Object.keys(cache).length>=max);    // true if max users
  return {
    set: (options={}) => {                                  // set options
      max = options.maxusers ? options.maxusers : max;
      expiration = options.expiration ? options.expiration : expiration;
    },
    get: () => {return {max: max, expiration: expiration, cache: cache, index:index};},
    add: (user={}) => {                                     // add user to cache
      if (full() || typeof user!='object') return;
      if (user.username) {
        var id = index[user.username] || makeUID(); // replace existing user or define new user
        cache[id] = {
          uid: id,
          index: user.username,
          user: user,
          expires: (new Date()).valueOf()+expiration
          };
        index[user.username] = id;
        return id;
      } else if (user.key) {  // treat as API entry
        cache[user.key] = {
          api: user, 
          index:user.key
        };
        index[user.key] = user.key;
        return user.key;
      };
    },
    del: (u, v) => {                                        // remove user (u->username or uid) from cache
      if (v) {                                              // if v given, first verify user in cache matches uid 
        if (!((u in cache && cache[u].index==v) || (u in index && index[u]==v) )) return;
        };
      if (u in cache) { // uid given
        delete index[cache[u]['index']];
        delete cache[u];
        return u;
      }
      if (u in index) { // username given
        delete cache[index[u]];
        delete index[u];
        return u;
      }
      return;
    },
    exists: (idx)=> (idx && (idx in cache || idx in index)),
    full: full,
    list: (who,idx) => {                                    // returns a user record, or cache/index if no uid specified
      var uid = index[who] || who;       // 'who' could be a username or uid or undefined
      if (uid) return cache[uid]||{};    // return specified user record
      return idx ? index : cache;        // or return index or all cached users
    },
    refresh: () => {                                        // remove expired users from cache, returns size of cache
      for (var k in cache) {
        if (cache[k].expires<(new Date()).valueOf()) Sessions.del(k);
      }
      return Object.keys(cache).length;
    }
  }
})();


///***********************************************
/// User database management wrapper definition...
///***********************************************
// Performs user database actions; NOTE 'who' denotes a complete database entry
// only who.username considered public ask and chg (change) helpers act as get/set
var UsersDB = (()=>{
  var hDB;
  var recipes;
  var getUser = (username,cb) => {hDB.find(recipes.user,{username:username},cb);};
  var obj = (x,y,z)=> y ? ( z ? ((x||{})[y]||{})[z]||{} : (x||{})[y]||{}) : x||{};
  var objs ={hDB: hDB, recipes: recipes};
  return {
    get: (x,y,z) => obj(x=='hDB'?hDB:recipes,y,z),
    init: (db) => {
      hDB = db ? db : hDB;
      hDB.getDefinition({section:'RECIPE',key:'user'},(e,d)=>{
        if (e||d===undefined) throw (e) ? e.toString() : "NO USER RECIPE DEFINITION!"
        recipes=d.value; 
      });
    },
    askAuth: (who,service) => service ? obj(who,'authorizations')[service]||'' : obj(who,'authorizations'),
    askChallenge: (who) => obj(who,'credentials','challenge'),
    askCredentials: (who) => obj(who,'credentials'),
    askIdentification: (who) => obj(who,'identification'),
    askLocalPW: (who) => obj(who,'credentials')['local']||'',
    askPhone: (who) => obj(who,'identification','phone'),
    askStatus: (who,state) => state ? (obj(who).status===state) : obj(who).status,
    authUsers: (data,cb) => {hDB.store(recipes.auth,data,cb);},
    backup: () => {hDB.backup();},
    chgAccount: (who,account) => {who.account = account;},
    chgAuth: (who,auth) => {who.authorizations.mergekeys(auth||{});},
    chgChallenge: (who,chlg) => {who.credentials.challenge = chlg;},
    chgCredentials: (who,credentials) => {who.credentials.mergekeys(credentials||{});},
    chgIdentification: (who,identification) => {who.identification.mergekeys(identification||{});},
    chgLocalPW: (who,pw) => {who.credentials.local = pw[0]=='$' ? pw : bcrypt.hashSync(pw,8);},
    chgStatus: (who,status) => {who.status = status;},
    createUser: (who,cb) => {hDB.store(recipes.create,who,cb);},
    getAPI: (key,cb) => {hDB.getDefinition({section:'API',key:key,dflt:{}},(e,d)=>{cb(e,d.value)});}, 
    getUser: getUser,
    listUsers: (cb) => {hDB.find(recipes.list,{},cb);},
    updateUser: (who,cb) => {hDB.store(recipes.update,who,cb);}
  }
})();
*/

/*

///***********************************************
/// isAuth middleware callback...
///***********************************************
// authenticate user logins, validate API access, and authorize user permissions
// isAuth function used as a callback from Express requests context (i.e. this) 
var isAuth = function isAuth(auth={}){
  //console.log("isAuth:",this.hbSession,auth);
  var test = {};
  switch (auth.check) { // auth = {check:'...', ...} holds given login/api parameters to test
    case 'login':   // local login authentication for auth.user against session auth credentials
      return new Promise((resolve,reject)=>{
        if (!UsersDB.askStatus(auth.user,'ACTIVE')) return resolve(false);
        let query = (this.hbSession.auth||{}).hash||'';  // recovered credentials to query against account
        let chlg = UsersDB.askChallenge(auth.user);
        let onetime = chlg.expires>this.hbSession.now ? crypto.plus.hash(auth.user.username+chlg.code) : '';
        if (onetime && query && (query==onetime)) return resolve("once");
        let local = UsersDB.askLocalPW(auth.user); // get valid local login credentials
        if (local && query) return bcrypt.compare(query,local).then((ok)=>{resolve(ok)});
        return resolve(false);
        });
    case 'challenge':     // authenticate auth.code against auth.challenge
      return (auth.code===auth.challenge.code && auth.challenge.expires>this.hbSession.now);
    case 'api':     // authenticate API hash
      test = this.hbSession.api;  // session api should hold given api parameters to test
      if (Math.abs(test.epoch-(new Date().style().e)) < 60) { // timestamp valid, check hash
        var validHash = crypto.plus.hash((Sessions[test.key]||{}).secret+test.salt+test.epoch);
        return (test.hash===validHash);
        // note api not removed from cache as it's always treated as an available user
        };
      break;
    default:        // check authorization , i.e auth={service:requested_access}
      if (Object.keys(auth).length!==1) return false; // check involves only a single key!
      let service = Object.keys(auth)[0];
      let access = auth[service];
      // if service defined as user, check if value matches authenticated user or validated user
      if (service==='user' && access=='') return ('id' in this.hbSession);  // id validated when defined!
      if (service==='user') return ((this.hbSession.user||{}).username==access);
      // get user permission for this service; default to allow...
      let permission = UsersDB.askAuth(this.hbSession.user||{},service)||'';
      let rank = ['DENY','READ','WRITE','ADMIN'];   // DENY (index=-1), ALLOW (no check), READ only, WRITE permitted, ADMIN
      // check if granted permission 'equals or exceeds' required access; NOTE: access level of OPEN (index=-1) always returns true!
      return (rank.indexOf(permission)>=rank.indexOf(access));
    };
  };


///***********************************************
/// Middleware...
///***********************************************
module.exports = hbAuth = function hbAuth(options){
  // this function called by express app to initialize middleware...
  var site = this;          // local reference for context
  scribe = site.scribe;
  var opt = options||{};    // module options
  Sessions.set(opt.cache);
  var db;
  if (typeof opt.database=='string' && opt.database in site.db) { // defines reference to existing db connection
    db = site.db[opt.database]; 
    scribe.trace("Middleware 'hbAuth' using site.db connection: %s",opt.database);
    }
  else {
    // assume its a database filename or object defining database to open
    var dbo = (typeof opt.database=='string') ? {file:opt.database} : opt.database;
    if (dbo===undefined) throw "Middleware 'hbAuth': NO database specified";  // no definition is an error
    scribe.trace("Middleware 'hbAuth' connecting to db: %s",dbo.file);
    db = new WrapSQ3(dbo,function (err,msg) { 
      scribe.debug(msg); if (err) throw "ERROR: middleware 'hbAuth': " + err.toString();
      });
    };
  UsersDB.init(db);
  scribe.info("Middleware 'hbAuth' initialized...");

  // this function called by express app for each page request...
  return function hbAuthMiddleware(rqst, rply, next) {
    // attach request objects
    rqst.hbIsAuth = isAuth;  // isAuth function used as a callback from requests (i.e. this) 
    rqst.hbSession = {now: new Date()/1000|0};
    // recover authentication credentials (auth) from any of multiple sources; only if login attempt; default {}
    var auth = rqst.headers.auth||(rqst.body||{}).auth||rqst.query.auth||{};  
    rqst.hbSession.auth = (typeof auth=='string') ? auth.asJx() : auth;  // convert to object, add to session
    // recover hsid, only exists if user previously logged in and sent with this request...
    var hsid = rqst.headers.hsid||(rqst.body||{}).hsid||rqst.query.hsid;
    if (hsid) {
      if (!Sessions.exists(hsid)) return rply.json({err: 'Bad session ID!',hsid:''});
      var who = Sessions.list(hsid);
      if ((who.expires||0)<(new Date().valueOf())) return rply.json({err: 'Expired session!',hsid:''});
      rqst.hbSession.id = hsid;    // update session id, session, and user
      rqst.hbSession.user = who.user;
      };
    // recover api; exists only if API function request; prior login not necessary!
    var api = rqst.headers.api||(rqst.body||{}).api||rqst.query.api;
    if (api) {
      if (typeof api=='string') {
        // assume api field includes multiple auth data parts as '-' delimited fields
        var [key,salt,epoch,hash] = api.split('-');
        api = {raw: api, key:key, salt: salt, epoch: epoch, hash: hash};
        };
      if (!api.key) return rply.json({err:e.toString()||'NO API KEY!'});
      rqst.hbSession.api = api;  // assign api object to session
      // add API definition to cache if not already loaded
      if (!Sessions.exist(api.key)) {
        UsersDB.getAPI(api.key, (e,a)=>{
          if (e||a==undefined) return rply.json({err:e.toString()||'API KEY NOT DEFINED!'});
          Sessions.add(a);
          }); 
        };
      };
    // only executes if POST and /user/:action/:user/:arg? route match!
    if (rqst.method==='POST' && rqst.params.rqrd1) {     // user action request
      let [action,user,arg] = [rqst.params.rqrd1,rqst.params.rqrd2,rqst.params.opt1];
      UsersDB.getUser(user,(err,who)=>{
        if (err) next(500);
        switch (action) {
          case 'account': // create a user account or update identification
            let data = (rqst.body||{});
            if (arg=='new') { // restrict auth credentials
              if (who.username) return rply.json({err: "USER ALREADY EXISTS!"});
              // define a new user with given username, and info from body
              let newuser = UsersDB.get('recipes','defaults');  // status, authorizations,...
              newuser.mergekeys({username: user, account:data.account, identification:data.identification});
              // define local password only, default random if not provided
              UsersDB.chgLocalPW(newuser,(data.credentials||{}).local||makeUID());
              return UsersDB.createUser(newuser, (e,id)=>{
                if (e) return rply.json({err: e.toString()});
                scribe.debug('New account created for user: %s',user); 
                rply.json({msg: 'ACCOUNT CREATED!'});
                });
              };
            if (arg=='change') { // restrict to identification and local PW changes
              if (!who.username) return rply.json({err: "NO SUCH USER EXISTS!"});
              if (!rqst.hbIsAuth({user:who.username})) return rply.json({err: "NOT AUTHORIZED!"});
              UsersDB.chgIdentification(who,data.identification);
              // only allow user to re-define local password, default random if not provided
              UsersDB.chgLocalPW(who,data.credentials.local||makeUID());
              return UsersDB.updateUser(who, (e,id)=>{
                if (e) return rply.json({err: e.toString()});
                scribe.debug('Account updated for user: %s',who.username); 
                rply.json({msg: 'ACCOUNT UPDATED!'});
                });
              };
            scribe.warn("UNKNOWN ACCOUNT REQUEST!")
            rply.json({err: 'NEW/CHANGE ACCOUNT REQUEST REQUIRED'});
            break;
          case 'activate':  // activate a user
            if (!who.username) return rply.json({err: "NO SUCH USER EXISTS!"});
            switch (UsersDB.askStatus(who)) {
              case 'ACTIVE': return rply.json({msg:'ACCOUNT ACTIVATED!*'});
              case 'INACTIVE': return rply.json({msg:'ACCOUNT INACTIVE!'});
              case 'PENDING': // validate challenge
                if (!rqst.hbIsAuth({check:'challenge', code: arg, challenge: UsersDB.askChallenge(who)}))
                  return rply.json({msg: 'ACCOUNT ACTIVATION FAILED/EXPIRED!'}); 
                UsersDB.chgStatus(who,'ACTIVE');
                UsersDB.chgChallenge(who,{}); // remove challenge as one-time use!
                UsersDB.updateUser(who,(e,id)=>{
                  if (e) return rply.json({err: err.toString()});
                  scribe.debug('Account activated for user: %s',who.username); 
                  return rply.json({msg: 'ACCOUNT ACTIVATED!'});
                  });
                break;
              default:
                return {msg:'NO SUCH USER!'};
              };
            break;
          case 'admin': // update user data for a list of users
            if (!rqst.hbIsAuth({admin:'ADMIN'})) return next(401);
            if (arg=='list') 
              UsersDB.listUsers((e,u)=>{
                if (e) return rply.json({err: e.toString()});
                rply.json({users: u});
                });
            if (arg=='auth') {
              UsersDB.authUsers(rqst.body||[],(e,id)=>{
                if (e) return rply.json({err: e.toString()});
                rply.json({msg: 'Users authorizations updated!...'}); 
              });
            };
            break;
          case 'code': // generate a user challenge; argument determines form
            if (!who.username) return rply.json({err: "NO SUCH USER EXISTS!"});
            let chlg = {code: makeUID(arg), expires: rqst.hbSession.now+(opt.expires||10)*60};  // good for 10 minutes default
            UsersDB.chgChallenge(who,chlg);
            UsersDB.updateUser(who,(e,id)=>{
              if (e) return rply.json({err: err.toString()});
              let p = UsersDB.askPhone(who);
              let msg = {text: 'Challenge Code: '+chlg.code, time: true, provider: p.provider, to: p.number};
              site.services.notify.sendText(msg);
              scribe.debug('Challenge set for user[%s]: %s', who.username, chlg.code); 
              rply.json({msg: 'CHALLENGE CODE SENT TO: '+ p.number}); 
              });
            break;
          case 'login': // authenticate a user and return a unique session id
            if (Sessions.full()) return rply.json({err:'Max users exceeded, please try again later...'});
            rqst.hbIsAuth({check:'login', user:who}).then((ok)=>{
              scribe.trace("LOGIN OK: %s", ok);
              if (!ok) return rply.json({err:'Login failed...'});
              // success, remove challenge, add user to Sessions cache and return hsid and user identification result
              if (ok=='once'){
                UsersDB.chgChallenge(who,{}); // remove challenge as one-time use!
                UsersDB.updateUser(who,(e,id)=>{
                  if (e) scribe.error('Problem removing one-time challenge for user[%s]',who.username);
                  });
                }
              let hsid =  Sessions.add(who);
              scribe.debug("Successful login: %s (%s)", who.username,hsid);
              rply.json({hsid:hsid, account:who.account, username:who.username, identification:UsersDB.askIdentification(who), authorizations:hsid?UsersDB.askAuth(who,arg):''});
              }).catch((e)=>{console.log("caught:",e)});
            break;
          case 'logout':  // terminate a user's session if session ID (arg) matches username
            // must know user and hsid (arg) to prevent someone from logging out other cached users by username
            if (arg==Sessions.del(arg,user)) {  // successful logout if validates
              scribe.debug("User %s (%s) logged out",user,arg)
              rply.json({hsid:'', user:''});
              }
            else {
              scribe.debug("Bad hsid (%s) for specified user (%s) logout!",arg,user);
              rply.json({err: 'Bad Session ID for specified user!'});
              };
            break;
          case 'reset': // reset a user's login password if challenge (arg) matches
            if (!rqst.hbIsAuth({check:'challenge', code: arg, challenge: UsersDB.askChallenge(who)})) 
              return rply.json({err:'PASSWORD CHALLENGE FAILED!'});
            if (rqst.hbSession.auth && rqst.hbSession.auth.hash)
              return rply.json({err:'PASSWORD HASH NOT GIVEN!'});
            UsersDB.chgLocalPW(who,rqst.hbSession.auth.hash); // replace password
            UsersDB.chgChallenge(who,{}); // remove challenge as one-time use!
            UsersDB.updateUser(who,(e,id)=>{
              if (e) return rply.json({err: err.toString()});
              scribe.debug('Password reset for user[%s]',who.username); 
              rply.json({msg:'PASSWORD RESET'});
              });
            break;
          default:  // no such user action; return error
            next(404);
          };
        });
      }
///    else if (rqst.method==='GET' && rqst.params.rqrd1) { // user form request
///      let [what,name,extra] = [rqst.params.rqrd1,rqst.params.rqrd2,rqst.params.opt1];;
///      }
    else {
        return next();
      };
    };
  }
  ;
*/