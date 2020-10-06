/*

jxjDB.js: Simple JSON/XJSON (Extensible JSON) based database using JSONata query
(c) 2020 Enchanted Engineering, Tijeras NM.; created 20200512 by CanyonCasa

usage:
  const jxjDB = require('./jxjDB');
  var db = new jxjDB(cfg,data);

configuration object properties...
  file:         Database file name, default '_memory_'
  delay:        Cache delay time for saving changes to file, default 1000ms
  readonly:     Flag to prevent writing to database.
data...
  {...}       Optional object to populate database. 
                Primary keys represent collections (tables)
                Records (rows) consist of objects or arrays

NOTES:
  1.  Database is always an object.
  2.  When the configuration does not define a file, the database exists only in memory.
  3.  Supported file formats include JSON and XJSON.
  4.  Collections may be arrays of objects or arrays.

*/

require('./Extensions2JS');
const fs = require('fs');
const fsp = require('fs').promises;
const util = require('util');
var lineReader = require('line-reader');
var forEachLine = util.promisify(lineReader.eachLine);
const frmt = util.format;  // returns same result as console.log for arguments
const jsonata = require('jsonata');
const safeJSON = require('./SafeData').jsonSafe;

module.exports = jxjDB = function jxjDB(cfg={},data) {
  this.file = cfg.file || '_memory_';
  this.inMemory = this.file == '_memory_';
  this.logFile = resolvePath(cfg.log || this.file.replace(/.j.+/,'').concat('.log'));
  this.format = cfg.format; // pretty or undefined
  this.readOnly = !!cfg.readOnly;
  this.delay = cfg.delay || 1000;
  this.timex = null;  // delay timeout timer reference
  if (this.inMemory || data) this.db = data || {};
};

// error recording...
jxjDB.prototype.log = function log() {
  let msg = frmt.apply(this,arguments)+'\n';
  fsp.appendFile(this.logFile,msg,'utf8')
    .then()
    .catch(e=>console.log("jxjDB.log ERROR => %s : %s",msg,e.toString()));
};

// load database file into memory.
jxjDB.prototype.load = async function load() {
  try {    
    let source = await fsp.readFile(this.file);
    this.db = JSON.parse(source);
    ((this.db['_']||{}).cfg||{}).mapByKey((v,k)=>this[k]=v);
    this.log(`jxjDB.load[${this.file}]: successfully loaded asynchronously!`);
    return this.db;
  } catch (e) { this.log("jxjDB.load[%s] ERROR:",this.file,e); throw e; };
};

// save the database 
jxjDB.prototype.save = function save() {
  if (this.inMemory || this.readOnly) return;
  var data = JSON.stringify(this.db,null,this.format=='pretty'?2:undefined);
  fsp.writeFile(this.file,data)
    .then(x=>{})
    .catch(e=>this.log('jxjDB.save ERROR[%s]:',this.file,e));
};

// queue the database to be saved...
jxjDB.prototype.changed = function changed() {
  clearTimeout(this.timex);
  this.timex = setTimeout(()=>{this.save();},this.delay);
};

// set or return schema
jxjDB.prototype.schema = function schema(s) { if (s) this.db['_'] = s; return Object.assign({},this.db['_']); };

// returns a list of currently defined collection names...
jxjDB.prototype.collections = function collections() { return Object.keys(this.db).filter(k=>k!='_'); };

// lookup a collections default entry...
jxjDB.prototype.defaults = function defaults(collection) {
  return Object.assign({},jsonata(`_.defaults.${collection}`).evaluate(this.db));
};

// lookup a recipe by name
jxjDB.prototype.lookup = function lookup(recipeName) {
  return Object.assign({},jsonata(`_.recipes[name="${recipeName}"]`).evaluate(this.db)||{});
};

// reference function to check database request authorization...
// pass if allowed undefined; otherwise allowed defines a list (array or comma delimited string) of groups permitted access
// auth can be a boolean, array, or comma delimited list
jxjDB.prototype.authorizationCheck = function(allowed,auth) {
  if (allowed===undefined) return true;
  if (typeof auth=='boolean') return auth;
  let granted = asList(allowed);
  return asList(auth).some(a=>granted.includes(a));
};

// simple database query...
// recipeSpec defines recipe.name or actual recipe object
// bindings represent optional recipe expression substitutions or null
// auth is a boolean, group name (string), or group list (array)
// both recipe lookup and authorization can be done inside or outside query
// returns data or undefined (no recipe) or null, but never error condition...
jxjDB.prototype.query = function query(recipeSpec, bindings=null, auth=false) {
  let recipe = typeof recipeSpec=='string' ? this.lookup(recipeSpec) : recipeSpec; // pass recipe object or name
  if (recipe.name) {
    let authorized = this.authorizationCheck(recipe.auth,auth);
    if (authorized) { 
      try {
        let tmp = jsonata(recipe.expression).evaluate(this.db,bindings);
        if (verifyThat(tmp,'isDefined')) {
          tmp = JSON.parse(JSON.stringify(tmp || recipe.empty || {}));  // workaround -> returns by reference without this!
          if (tmp instanceof Array) {
            if (recipe.limit && (tmp.length>Math.abs(recipe.limt))) tmp = (recipe.limit<0) ? tmp.slice(recipe.limit) : tmp.slice(0,recipe.limit);
            if (recipe.header) tmp.unshift(recipe.header);
          };
        return tmp;
        };
      } catch (e) { this.log("jxjDB.query ERROR: ",typeof e=='object'?e.message:e.toString()); return undefined; };
    };
  };
  return recipe.empty || {};
};

// simple database edit...
// recipeSpec defines recipe.name or actual recipe object
// data defines an array of objects/arrays in form [{ref:<value>, record:<record_object>},...] or [[<value>,<record_object>],...]
//   ref refers to unique matching value for an existing entry based on recipe 'unique' lookup; null for new entry
//   record refers to data to be saved, undefined/null to delete record; note: full record replacement after merge with defaults and existing,
// auth is a boolean, group name (string), or group list (array)
// both recipe lookup and authorization can be done inside or outside query
// returns data or undefined (no recipe) or null, but never error condition...
jxjDB.prototype.modify = function modify(recipeSpec, data, auth=false) {
  let recipe = typeof recipeSpec=='string' ? this.lookup(recipeSpec) : recipeSpec; // pass recipe object or name
  if (recipe.name) {
    let authorized = this.authorizationCheck(recipe.auth,auth);
    if (authorized) {
      if (verifyThat(data,'isArrayOfAnyObjects')) {
        let results = [];
        let defaults = this.defaults(recipe.collection) || {};
        for (let d of data) {
          try {
            let ref = d.ref || d[0] || '';
            let record = safeJSON(d.record || d[1] || null,recipe.filter);
            let existing = (recipe.reference ? jsonata(recipe.reference).evaluate(this.db,{ref:ref}) : null) || {index:null,record:defaults};
            if (verifyThat(record,'isDefined')) {
              let newRecord = defaults instanceof Array ? record : ({}).mergekeys(existing.record).mergekeys(record);
              if (existing.index===null) {  // add new record
                this.db[recipe.collection].push(newRecord);
                results.push(["add",ref,this.db[recipe.collection].length-1]);
              } else {  // change existing record
                this.db[recipe.collection][existing.index] = newRecord;
                results.push(["change",ref,existing.index]);
              };
              this.changed(); // flag changes for save
            } else {
              if (existing.index!==null) this.db[recipe.collection].splice(existing.index,1); // delete record
              this.changed(); // flag changes for save
              results.push(["delete",ref,existing.index]);
            };
          } catch(e) {this.log("jxjDB.modify ERROR: ",typeof e=='object'?e.message:e.toString()); results.push(e.toString())};
        };
        return results; // array of pass/fail boolean for each data record.
      } else {
        this.log("jxjDB.modify bad request data format!"); 
        return null;
      };
    } else {
      return undefined;
    };
  };
  this.log("jxjDB.modify bad recipe!:",recipeSpec); 
  return null;
};

// database query with support for both JSON and Extensible JSON database queries...
// Calls query for JSON databases; queries data file line-by-line for Extensible JSON...
jxjDB.prototype.inquire = async function inquire(recipeSpec, bindings=[], auth=false) {
  let recipe = typeof recipeSpec=='string' ? this.lookup(recipeSpec) : recipeSpec; // pass recipe object or name
  if (recipe.name) {
    let authorized = this.authorizationCheck(recipe.auth,auth);
    if (authorized) {
      if (recipe.xjson) {
        try {
          let tmp = [];
          ///let expression = this.resolveExpression(recipe.expression,bindings);
          if (expression) {
            await forEachLine(recipe.xjson,(line)=>{  // read xjson file line by line
              let jObj = JSON.parse(line);            // parse into JS object
              let result = expression.evaluate(jObj); // test against expression
              if (result) {
                tmp.push(result); // append valid result and limit return data size?
                if (recipe.limit && (tmp.length>Math.abs(recipe.limit)))
                  if (recipe.limit<0) { tmp.shift(); } else { tmp.pop(); return false; };
              };
            });
          };
          if (recipe.header) tmp.unshift(recipe.header);  // optionally add header
          return tmp;  
        } catch (e) {
          this.log(`Error[${recipe.name}] XJSON failure: ${e}`);
          throw 500;
        };
      } else {
        return this.query(recipe,bindings,true)||recipe.empty||{};
      };
    } else {
      this.log(`Error[${recipe.name}]: User authorization failed.`);
      throw 401;
    };
  } else {
    let unknown = typeof recipeSpec=='string' ? recipeSpec : '';
    this.log(`Error[${unknown}]: Unknown recipe.`);
    throw 404;
  };
};

// database edit function with support for both JSON and Extensible JSON database queries...
// Calls modify for JSON databases; ONLY appends to data file for Extensible JSON...
jxjDB.prototype.cache = async function cache(recipeSpec, data, auth=false,flag=null) {
  let recipe = typeof recipeSpec=='string' ? this.lookup(recipeSpec) : recipeSpec; // pass recipe object or name
  if (recipe.name) {
    let authorized = this.authorizationCheck(recipe.auth,auth);
    if (authorized) {
      if (recipe.xjson) {
        if (verifyThat(data,recipe.xdata)) {
          try {
            // convert array of objects (or arrays) into a block of filtered lines.
            let blk = data.map(x=>JSON.stringify(safeJSON(x,recipe.filter))).join('\n')+'\n';
            let flag = ref ? 'w' : 'a'; 
            await fsp.writeFile(recipe.xjson,blk,{flag:flag?'w':'a'});// default append
            return {data: data, blk:blk, flag: flag};
          } catch (e) {
            this.log(`Error[${recipe.name}] XJSON Failure: ${e}`);
            throw 500;
          };
        } else {
          this.log(`Error[${recipe.name}]: Invalid data type. ${recipe.xdata} required`);
          throw 400;
        };
      } else {
        return this.modify(recipe,data,true)||[];
      };
    } else {
      this.log(`Error[${recipe.name}]: User authorization failed.`);
      throw 401;
    };
  } else {
    let unknown = typeof recipeSpec=='string' ? recipeSpec : '';
    this.log(`Error[${unknown}]: Unknown recipe.`);
    throw 404;
  };
};