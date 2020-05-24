/* 
LiteData.js - Middleware for serving JSON No-SQL-like data from databases
Copyright (c) 2020 Enchanted Engineering

Supports GET and POST to recall and store/udpate/remove database records respectively:
Specific processing depends on a recipe definition object. See HomebrewAPI for recipe details

Assumes parameter based express routing: '/\\$:recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?'
  that defines a / followed by a '$' prefix character, followed by a required recipe key (word only), followed by up to 5 optional params.
  NOTE: different routings can differentiate different middleware databases or recipe lists as long as each defines a unique prefix
*/

// load dependencies...
require('./Extensions2JS');
const jxjDB = require('./jxjDB');

exports = module.exports = Data = function Data(options) {
  // this function called by express app to initialize middleware...
  var site = this;          // local reference for context
  var scribe = site.scribe; // local reference
  var db = options.db ? (typeof options.db=='string' ? site.db[options.db] : new jxjDB(options.db)) : site.db.site;
  if (!db) scribe.fatal("REQUIRED DATABASE NOT DEFINED for LiteData Middleware!");
  if (typeof options.db=='object') {
    db.load()
      .then(x=>scribe.debug("LiteData database loaded successfully!"))
      .catch(e=>{scribe.fatal("LiteData database load error!",e)});
  };
  let dbName = options.db ? (typeof options.db=='string' ? options.db : 'local') : 'site';
  scribe.trace("Middleware '%s' connected to '%s' database (file: %s)", options.code, dbName, db.file);
  scribe.info("Middleware '%s' initialized with route: %s", options.code, options.route);

  // this function called by express app for each page request...
  return function dataMiddleware(rqst, rply, next) {
    scribe.info("DATA[%s]: %s -> %s",site.tag, rqst.originalUrl, JSON.stringify(rqst.params));
    if (rqst.method==='GET'){
      let bindings = Object.keys(rqst.query).length>0 ? rqst.query : [rqst.params.opt1,rqst.params.opt2,rqst.params.opt3,rqst.params.opt4,rqst.params.opt5].filter(v=>v!==undefined);
      db.inquire(rqst.params.recipe,bindings,rqst.hb.auth.user.member)
        .then(d=>{ rply.json(d); })
        .catch(e=>{ scribe.error("Check %s for details...",db.logFile); e!==404 ? next(e) : next(); });  // 404 may resolve if chained databases
    } else if (rqst.method==='POST') {
      db.cache(rqst.params.recipe,rqst.body,rqst.hb.auth.user.member,rqst.params.opt1)
        .then(d=>{ rply.json(d); })
        .catch(e=>{ scribe.error("Check %s for details...",db.logFile); e!==404 ? next(e) : next(); });  // 404 may resolve if chained databases
    } else {
      return next(501); // only process GET and POST requests
    };
  };  
};
