/// hbLiteAuth.js (c) 2019 Enchanted Engineering -- MIT License

/*
Module for authenticating/authorizing users and API functions...
  - Assumes a small group of users cached in memory from a JSON database
    - Automatically updates database (on disk) when changed
  - Recovers credentials from request headers and maintains a session based on JWT data
    - Supports Basic and Bearer JWT modes
  - Performs user authorizion operations as based on group membership
  
USE...

  var auth = new (require('./hbLiteAuth'))(); // instaniate a single instance of module
  
  ...
  request.hb = {};  // assume hb (i.e. homebrew) instance exists for each request
  auth.authenticate(rqst.headers.authorization,function queryUserCB(u){...})
    .then(a => { request.hb.auth = a; next(); }).
    .catch(e=> console.log(e.toString()));
  ...
  
  request.hb.auth.authorize(allowed);  // checks auth.who against allowed groups for access

VARS and METHODS...
  who:                  Authentication return object
    header:             parsed authentication request (authorization header)
      method:           authentication method: basic or bearer
      b64:              base64 encoded authentication token
      token:            decoded authentication token
      username:         recovered login credential for 'basic' authentication
      pw:               recovered login credential for 'basic' authentication
      payload:          recovered JWT payload, header assumed, and signature verified
    authorized:         boolean indicating validated user
    user:               if defined, user database record associated with recovered "who"
    username:           recovered login/user id for convenience
    jwt:                generated return JSON web token data of user
    authorize(allowed): function to determine if user is authorized for resource.
    renewal():          function to validate certificate renewal request.
    
  users:                Users JSON DB holding user credentials.
    
*/


///***********************************************
/// General module and variables declarations...
///***********************************************
require('./Extensions2JS');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// helper functions
var d64 = (b64) => new Buffer.from(b64,'base64').toString();  // base64 decode to text
var e64 = (t) => new Buffer.from(t).toString('base64');       // text encode to base64
var b64u = (s) => s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); // convert b64 to base64url
var u64b = (s) => (s+'==='.slice(0,(4-s.length%4)%4)).replace(/\-/g, '+').replace(/_/g, '/'); // convert base64url to b64
var j64u = (obj) => b64u(e64(JSON.stringify(obj)));  // JSON to Base64URL
var u64j = (s) => { try { return JSON.parse(d64(u64b(s))) } catch(e) { return {}; } };
// JSON web token functions...
function createJWT(data,secret) {
  let encHeader = j64u({alg: 'HS256',typ: 'JWT'});  // only support for HS256
  let encPayload = j64u(Object.assign({iat: new Date().valueOf()/1000|0},data)); // add 'initiated at' field if not included
  let signature = b64u(crypto.createHmac('sha256',secret).update(encHeader+'.'+encPayload).digest('base64'));
  return [encHeader,encPayload,signature].join('.');
};
function extractJWT(jwt) {
  let fields = (jwt+"..").split('.',3);
  return { header: u64j(fields[0]), payload: u64j(fields[1]), signature: fields[2] };
};
function verifyJWT(jwt,secret) {
  let content = extractJWT(jwt);
  let check = createJWT(content.payload,secret);
  return jwt===check ? content.payload : null;
};
function expiredJWT(payload,expiration) {  // true if expired
  let exp = new Date(payload.exp ? payload.exp : payload.iat ? 1000*(payload.iat+expiration) : 0);
  let now = new Date();
  return exp<now;
};
// authorize access to user based on group membership and allowed permissions...
// allowed and memberOf are arrays or comma separated lists of group names, allowed access and user membership respectively
function authorize(allowed,memberOf) {
  if (allowed===undefined) return true;
  let granted = asList(allowed);
  return asList(memberOf).includes('admin') || asList(memberOf).some(m=>granted.includes(m));
};
// genCode: generates unique codes for authentication verification...
function genCode(size, base, expires) { return {code: uniqueID(size,base), iat: new Date().valueOf()/1000|0, exp: expires*60}; };

// authentication by generated code...
function checkCode(challengeCode,credentials) {
  if (!credentials) return false;
  let expires = new Date((credentials.iat+credentials.expiration)*1000);
  if (expires<new Date()) return false;
  return challengeCode===credentials.code;
};

// constructor ...
module.exports = Auth = function Auth(cfg={}) {
  this.secret = cfg.secret || uniqueID(64,16);  // 256-bit default
  this.jwt = ({expiration: 60*24}).mergekeys(cfg.jwt || {}); // value in minutes, default to 1-day
  this.code = {size: 7, base: 16, expiration: 10}.mergekeys(cfg.code || {});
  this.genCode = (size=this.code.size, base=this.code.base, expires=this.code.expiration) => genCode(size,base,expires);
  this.checkCode = checkCode;
};

// parses the basic/bearer authorization header to return login credentials
Auth.prototype.parseAuthHeader = function parseAuthHeader(header) {
  let hdr = {}
  if (!header) return hdr;
  try {
    hdr.fields = (header+" ").split(' ',2);
    [hdr.method, hdr.token] = [hdr.fields[0].toLowerCase(), hdr.fields[1]];
    if (hdr.method=='basic') {
      hdr.text = d64(hdr.token);
      [hdr.username,hdr.pw] = (hdr.text+':').split(':',2);
    } else if (hdr.method=='bearer') {
      // just parse payload and verify signature, no expiration check
      hdr.fields = extractJWT(hdr.token);
      hdr.payload = verifyJWT(hdr.token,this.secret); // empty payload on failure
    } else {
      hdr.error = "Authentication Method Not Supported!";
    };
  } catch(e) { hdr.error = e.toString(); };
  return hdr;
};

// validates user (who, parsed from authorization header) against database record (userCB)
Auth.prototype.authenticate = async function authenticate(header,userCB) {
  // who holds all authentication info
  let who = {user:{username:'',member:''}, authenticated: false, error: null};
  who.header = this.parseAuthHeader(header);
  if (verifyThat(who.header,'isNotEmpty') && !who.header.error) {
    if (who.header.method=='basic') {             // validate user against database
      let user = userCB(who.header.username);     // get user data
      if (verifyThat(user,'isNotEmpty') && user.credentials.hash && (!user.status||(user.status=='ACTIVE'))) { // check user status, if defined
        who.authenticated = checkCode(who.header.pw,user.credentials.code) || await bcrypt.compare(who.header.pw,user.credentials.hash);
        if (who.authenticated) {   // build JWT
          delete user.credentials; // remove sensitive user information
          who.user = user;
          who.username = user.username;
          who.jwt = createJWT(who.user,this.secret);
        };
      } else {
        who.error = "Authentication failed! Invalid or Inactive username or password.";
      };
    } else if (who.header.method=='bearer') {  // validate JWT
      if (who.header.payload) {  // already parsed
        if (!expiredJWT(who.header.payload,this.jwt.expiration*60)) {
          who.user = who.header.payload;
          who.username = who.user.username;
          who.authenticated = true;
          who.jwt = who.header.token; // restore JWT for reuse
        } else {
          who.error = "Authentication failed! JWT expired. Login again.";
        };
      } else {
        who.error = "Authentication failed! Invalid JWT. Login again."
      };
    };
  } else {
    who.error = who.header.error || null;
  };
  who.authorize = (allowed,member=who.user.member,auth=who.authenticated) => auth ? authorize (allowed,member) : false;
  return who
};
