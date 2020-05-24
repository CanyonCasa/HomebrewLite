/* 
LiteFile.js - Middleware for uploading and downloading file via a JSON interface
Copyright (c) 2020 Enchanted Engineering

Supports GET to download and POST to upload files by recipe 
Supports binary files by base64 encoding for passing contents as strings in JSON body
File handling depends on a recipe definition. See HomebrewAPI for recipe details

Assumes parameter based express routing: '/\\~:recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?'
  that defines a / followed by a '~' prefix character, followed by a required recipe key (word only), followed by up to 5 optional params.
  NOTE: different routings can differentiate different middleware databases or recipe lists as long as each defines a unique prefix
*/

// load dependencies...
require('./Extensions2JS');
const fsp = require('fs').promises;
const jxjDB = require('./jxjDB');

exports = module.exports = Data = function Data(options) {
  // this function called by express app to initialize middleware...
  var site = this;          // local reference for context
  var scribe = site.scribe; // local reference
  var db = options.db ? (typeof options.db=='string' ? site.db[options.db] : new jxjDB(options.db)) : site.db.site;
  if (!db) scribe.fatal("REQUIRED DATABASE NOT DEFINED for LiteFile Middleware!");
  if (typeof options.db=='object') {
    db.load()
      .then(x=>scribe.debug("LiteFile database loaded successfully!"))
      .catch(e=>{scribe.fatal("LiteFile database load error!",e)});
  };
  let dbName = options.db ? (typeof options.db=='string' ? options.db : 'local') : 'site';
  scribe.trace("Middleware '%s' connected to '%s' database (file: %s)", options.code, dbName, db.file);
  
  // directory listing or file downloading...
  async function download(recipe,spec) {
    try {
      let path = resolvePath(recipe.folder,spec.replace(/\.\./g,''));
      let stats = await fsp.stat(path);
      if (stats.isDirectory()) {
        if (!recipe.list) throw 403;
        let list = await fsp.readdir(path);
        let listing = [];
        for (let f in list) {
          let stat = await fsp.stat(resolvePath(path,list[f]));
          listing.push({name: list[f], size:stat.size, time: stat.mtime, type: stat.isDirectory()?'dir':'file'});
        };
        return {dir: listing};
      } else if (stats.isFile()) {
        if (recipe.send=='raw') {
          return {path: path};
        } else {
          let fx = await fsp.readFile(path);
          let contents = recipe.send=='base64' ? fx.toString('base64') : fx.toString();
          return {name: spec, contents:contents, encoding: recipe.send||'none'};
        };
      } else {
        throw 400;
      };
    } catch (e) { throw e.code=='ENOENT' ? 404 : 400; };
  };
  
  // file uploading...
  async function upload(recipe,data) {
    if (verifyThat(data,'isArrayOfObjects')) {
      let dx = [];
      for (let f in data) {
        let path = resolvePath(recipe.folder,data[f].name.replace(/\.\./g,''));
        let exists = false;
        try { await fsp.stat(path); exists=true; } catch (e) {}; // throws error if file doesn't exist - ignore
        try {
          if (data[f].backup && exists) {
            let backup = resolvePath(recipe.folder,data[f].backup.replace(/\.\./g,''));
            let cp = await fsp.copyFile(path,backup);
          };
          let fx = data[f].encoding=='base64' ? new Buffer.from(data[f].contents,'base64') : data[f].contents;
          await fsp.writeFile(path,fx);
          dx.push(true);
        } catch (e) { $(e); dx.push(false); };
      };
      return {data:dx}
    } else {
      throw 400;
    };
  };
  
  scribe.info("Middleware '%s' initialized with route: %s", options.code, options.route);


  // this function called by express app for each page request...
  return function fileMiddleware(rqst, rply, next) {
    scribe.info("DATA[%s]: %s -> %s",site.tag, rqst.originalUrl, JSON.stringify(rqst.params));
    let recipe = db.lookup(rqst.params.recipe);
    if (verifyThat(recipe,'isNotEmpty')) {
      if (recipe.auth && !db.authorizationCheck(recipe.auth,rqst.hb.auth.user.member)) return next(401);
      if (rqst.method==='GET'){
        download(recipe,rqst.query.spec||'')
          .then(d=>{ if ('path' in d) { rply.sendFile(d.path); } else { rply.json(d); }; })
          .catch(e=>{ e!==404 ? next(e) : next(); });
      } else if (rqst.method==='POST') {
        upload(recipe,rqst.body)
          .then(d=>{ rply.json(d); })
          .catch(e=>{ e!==404 ? next(e) : next(); });
      } else {
        next(501); // only process GET and POST requests
      };
    } else {
      next();
    };
  };  
};
