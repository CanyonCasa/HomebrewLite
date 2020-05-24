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
  let exp = new Date(payload.exp ? payload.exp : payload.iat ? 1000*payload.iat+expiration : 0);
  let now = new Date();
  return exp<now;
};
// authorize access to user based on group membership and allowed permissions...
// memberOf is a list of groups user is a memberOf; allowed is a group name or list of groups
function authorize(allowed,memberOf) {
  return (typeof allowed=='string' ? [allowed] : (allowed||[])).some(a=>(memberOf||[]).includes(a));
};

// constructor ...
module.exports = Auth = function Auth(cfg={}) {
  this.secret = cfg.secret || uniqueID(64,16);  // 256-bit default
  this.expiration = (cfg.expiration || 60*24*7)*60000; // value in minutes, default to 7-days, convert to milliseconds
  this.activation = (cfg.activation || 10)*60000; // value in minutes, default to 10 minutes, convert to milliseconds

  // authentication by generated code...
  this.codeCheck = function codeCheck(codeToCheck,validCode,expiration=this.activation) {
    if (!validCode) return false;
    let expires = new Date(validCode.expires ? validCode.expires*1000 : validCode.iat*1000+expiration);
    if (expires<new Date()) return false;
    return codeToCheck===validCode.code;
  };

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
  let who = {user:{username:'',member:[]}, authenticated: false, error: null};
  who.header = this.parseAuthHeader(header);
  if (verifyThat(who.header,'isNotEmpty') && !who.header.error) {
    if (who.header.method=='basic') {              // validate user against database
      let user = userCB(who.header.username);       // get user data
      if (verifyThat(user,'isNotEmpty') && (user.status=='ACTIVE')) { // check user status if defined
        let creds = user.credentials||{};
        who.authenticated = this.codeCheck(who.header.pw,creds.code,this.activation) || await bcrypt.compare(who.header.pw,creds.hash);
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
        if (!expiredJWT(who.header.payload,this.expiration)) {
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
