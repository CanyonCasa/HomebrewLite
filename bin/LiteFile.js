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
const fs = require('fs');
const fsp = fs.promises;
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
  
  
  // directory listing...  recipe defines folders and constraints
  async function list(recipe) {
    async function recurse(root,node) {
      let path = resolvePath(root,node);
      try {
        let stats = await fsp.stat(path);
        let type = stats.isFile() ? 'file' : stats.isDirectory() ? 'dir' : 'unknown';
        let fso = { name: node, size:stats.size, time: stats.mtime, type: type };
        if (type == 'dir') {
          fso.listing = [];
          let dir = await fsp.readdir(path);
          for (let f in dir) fso.listing.push(await recurse(path,dir[f]));
        };
        return fso;
      } catch (e) { if (e.code=='ENOENT') return {name: node, listing:[], type:'unknown', notFound:true }; throw e; };
    }; 
    try {
      let folders = Object.keys(recipe.folders||{});
      return Object.fromEntries((await Promise.all(folders.map(f=>recurse(recipe.root,recipe.folders[f])))).map((x,i)=>[folders[i],x]));
    } catch (e) { throw e.code=='ENOENT' ? 404 : e; };
  };

  // recipe defines constraints; spec provides file spec relative to document root
  // can be used (for authorized) access to areas not openly served by static middleware
  async function download(recipe,spec) {
    try {
      let path = resolvePath(recipe.root,spec.replace(/\.\./g,'')); // prevent referencing external to document root
      let stats = await fsp.stat(path);
      if (stats.isFile()) {
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
    } catch (e) { throw e.code=='ENOENT' ? 404 : e; };
  };
  
  // file uploading...  recipe defines upload constraints; data specifies an array of "file objects" to process
  async function upload(recipe,data) {
    if (verifyThat(data,'isArrayOfTrueObjects')) {
      let dx = [];
      for (let f in data) {
        let folder = data[f].folder || '';
        if (folder && Object.keys(recipe.folders).includes(folder)) {
          let path = resolvePath(recipe.root,recipe.folders[folder],data[f].name.replace(/\.\./g,''));
          let exists = false;
          try { await fsp.stat(path); exists=true; } catch (e) {}; // throws error if file doesn't exist - ignore
          try {
            if (data[f].backup && exists) {
              let backup = resolvePath(recipe.root,recipe.folders[folder],data[f].backup.replace(/\.\./g,''));
              let cp = await fsp.copyFile(path,backup);
            };
            let fx = data[f].format=='base64' ? new Buffer.from(data[f].contents.split(',',2)[1],'base64') : data[f].contents;
            await fsp.writeFile(path,fx,{flag:data[f].append?'a':'w'});
            dx.push(true);
          } catch (e) { scribe.debug(e); dx.push(false); };
        } else {
          dx.push(false);
        };
      };
      return {data:dx}
    } else {
      throw 400;
    };
  };
  
  scribe.info("Middleware '%s' initialized with route: %s", options.code, options.route);


  // this function called by express app for each page request...
  return function fileMiddleware(rqst, rply, next) {
    scribe.info("FILE[%s]: %s -> %s",site.tag, rqst.originalUrl, JSON.stringify(rqst.params));
    let recipe = db.lookup(rqst.params.recipe);
    if (verifyThat(recipe,'isNotEmpty')) {
      if (!recipe.root) return next(500);
      if (recipe.auth && !db.authorizationCheck(recipe.auth,rqst.hb.auth.user.member)) return next(401);
      if (rqst.method==='GET') {
        let spec = rqst.params.opt||rqst.query.spec||'';
        if (spec) {
          download(recipe,spec)
            .then(file=>{ if ('path' in file) { rply.sendFile(file.path) } else { rply.json(file); }})
            .catch(e=>{ e!==404 ? next(e) : next(); });
        } else {
          list(recipe)
            .then(listing=>{ rply.json(listing); })
            .catch(e=>{ e!==404 ? next(e) : next(); });
        };
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
