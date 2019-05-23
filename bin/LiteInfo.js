/* 
LiteInfo.js - Middleware for serving client/server information
Copyright (c) 2019 Enchanted Engineering, MIT License

assumes parameter based express routing: '/([!]):info(\\w+)'
  that defines a / followed by a '!' character, followed by a required recipe key (word only), followed by up to 5 optional params.

  For example: GET /!ip   ==> {"ip": "192.168.0.5"}
  Info fields
    ip:       Returns the client IP address           GET /!ip    =>  {"ip": "192.168.0.5"}
    time:     Returns a server time record            GET /!time  =>  {"epoch": 1556199804}
    date:     Returns a server date record            GET /!date  =>  {"date": "2019-04-25T13:43:23.882Z", "time": 1556199803.882, "zone": "MDT", "adj": -360}
    rqst:     Returns a record of request details...  GET /!rqst  =>  { ... }
    stats:    Returns internal stats                  GET /!stats =>  { ... }
    info:     Returns a record of all info            GET /!info  =>  { ... }
*/

// load dependencies...
require('./Extensions2JS');

exports = module.exports = Info = function Info(options) {
  // this function called by express app to initialize middleware...
  var site = this;          // local reference for context
  var scribe = site.scribe; // local reference
  scribe.info("Middleware '%s' initialized with route: %s", options.code, options.route);

  function getInfo(req) {
    let dx = new Date();
    dx = {date: dx.toISOString(), time: dx.valueOf()*0.001, fields: dx.style(), zone: dx.zone, adj: -dx.getTimezoneOffset()};
    let ip = {raw: req.headers['x-forwarded-for'] || req.connection.remoteAddress || "?"};
    if (ip.raw==='::1') ip.raw = '::127.0.0.1';
    ip.v4 = (ip.raw||'').replace(/:.*:/,'');
    ip.v6 = (ip.v4!=ip.raw) ? ip.raw : "0:0:0:0:0:0:0:0";
    ip.port = (req.socket.remotePort) ? req.socket.remotePort : null;
    let request = {
      hb: req.hb,
      headers: req.headers, 
      hostname: req.hostname, 
      http: req.httpVersion, 
      method: req.method, 
      original: req.originalUrl, 
      url: req.url, port: 
      req.port, 
      protocol: req.protocol, 
      params: req.params
    };
    return {datetime:dx, ip:ip, rqst:request};  
  };
  
  // this function called by express app for each page request...
  return function infoMiddleware(rqst, rply, next) {
    // first lookup recipe based on parameter provided
    scribe.trace("INFO[%s]: %s %s", rqst.headers.hbid, rqst.method, rqst.params.info);
    if (rqst.method!='GET') next();
    let ix = getInfo(rqst);
    let info = {};
    switch (rqst.params.info) {
      case 'ip': info.ip = ix.ip.v4; break;
      case 'time': info.epoch = parseInt(0.5+ix.datetime.time); break;
      case 'date': info = ix.datetime; break;
      case 'rqst': scribe.flush(); info.rqst = ix.rqst; break;
      case 'stats': info.stats = site.stats; break;
      default: scribe.flush(); ix.stats = site.stats; info = ix;
    };
    rply.json(info);
  }
};
