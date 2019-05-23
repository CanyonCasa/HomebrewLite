/*

JSONDB.js: Simple JavaScript (JSON) based database
(c) 2019 Enchanted Engineering, Tijeras NM.; created 20190419 by CanyonCasa

usage:
  const JSONDB = require('./JSONDB.js');
  var db = new JSONDB(cfg,data);

configuration object properties...
  collections:  Collections (tables) definitions
    dlfts:      Default field entries
    type:       "keyed":  entries stored as key:{value} pairs; duplicates not possible
                "array":  entries stored as arrays of objects
                "packed": entries stored as arrays of arrays
  file:         Database file name, default '_memory_'
  format:       Database file format, default (by file extension) json, gz
  delay:        Cache delay time for saving changes to file, default 1000ms
  readonly:     Flag to prevent writing to database.
  stream:       Name of optional external XJV file to stream data from/to
data...
  {...}       Optional object to populate database. Primary keys represent collections

NOTES:
  1.  Database is always an object.
  2.  When the configuration does not define a file, the database exists only in memory.
  3.  Supported file formats include JSON, pretty [JSON], jgz [gzip JSON] (TBD: CSV and XJV).
  3.  Collections may be objects, or arrays of objects or arrays.
    a.  'ref' refers to the index of an array collection or key of object collections.
    b. Object collections entries can be access by key.
    c. Array collections entries can be accessed by their index.

*/

require('./Extensions2JS');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

module.exports = JSONDB = function jsondb(cfg={},data) {
  cfg.file = cfg.file || '_memory_';
  cfg.readOnly = cfg.readOnly===undefined ? cfg.file=='_memory_' : cfg.readOnly;
  cfg.format = cfg.format || path.parse(cfg.file).ext.substring(1) || 'json';
  cfg.delay = cfg.delay || 1000;
  cfg.collections = cfg.collections || {};
  this.cfg = cfg;
  this.timex = null;
  this.active = {};  // active data results for chaining operations.
  this.db = data || this.loadSync(cfg.file);
};

// load database file into memory asynchronously.
JSONDB.prototype.load = async function load(file) {
  file = file || this.cfg.file;
  if (file==='_memory_') return this.db;
  fs.readFile(file,(e,d)=>{
    if (e) { 
      console.error("FILE LOAD ERROR[%s]: %s",file,e); 
    } else {
      try {
        if (this.cfg.format==='jgz') d = zlib.gunzipSync(d,'utf8').toString('utf8');
        d = JSON.parse(d);
      } catch (e) { console.error("JSONDB.load ERROR:",e); };
      this.cfg = d.cfg;
      this.db = d.db;
    };
  });
};

// load database file into memory.
JSONDB.prototype.loadSync = function loadSync(file) {
  file = file || this.cfg.file;
  if (file==='_memory_') return this.db;
  try {
    let ds = fs.readFileSync(file);
    if (this.cfg.format==='jgz') ds = zlib.gunzipSync(ds,'utf8').toString('utf8');
    let d = JSON.parse(ds);
    this.cfg = d.cfg.mergekeys({file:file});  // preserve file name
    this.db = d.db;
  } catch (e) { console.error("JSONDB.load ERROR:",e); };
  return this.db || {};
};

// save the database to a file in specified format or to default file and format
JSONDB.prototype.save = function save(file,format) {
  file = file || this.cfg.file;
  if (file==='_memory_' || (this.cfg.readOnly&&(file==this.cfg.file))) return;
  format = format || this.cfg.format;
  var data = JSON.stringify({cfg:this.cfg,db:this.db},null,format=='pretty'?2:undefined);
  if (format==='jgz') data = zlib.gzipSync(new Buffer(data,'utf8'));
  fs.writeFile(file,data,(e)=>{
    if (e) { console.error('FILE SAVE ERROR[%s]: %s',format,file); } else { console.log("SAVED[%s]: %s",format,file); };
  });
};

// queue the database to be saved...
JSONDB.prototype.cache = function cache() {
  clearTimeout(this.timex);
  this.timex = setTimeout(()=>{this.save();},this.cfg.delay);
};

// returns a list of currently defined collections...
JSONDB.prototype.schema = function schema(collection) {
  return collection ? this.cfg.collections[collection] : this.cfg.collections;
};

// returns a list of currently defined collection names...
JSONDB.prototype.collections = function collections() {
  return Object.keys(this.db);
};

// set active data to a collection by name; creates collection if it does not exist...
JSONDB.prototype.collection = function collection(name,def={},data=null) {
  if (!(name in this.db)) {  // create collection if it doesn't exist
    this.cfg.collections[name] = Object.assign({dflts:{}, type: "array"},def);
    this.db[name] = data || (this.cfg.collections[name].type=="keyed" ? {} : []);
  };
  this.active.type = this.cfg.collections[name].type;
  this.active.byKey = this.active.type=="keyed";
  this.active.collection = name;
  this.active.data = this.active.byKey ? Object.assign({},this.db[name]) : Object.assign([],this.db[name]);
  this.active.refs = this.active.byKey ? Object.keys(this.db[name]) : Array.makeArrayOf(this.active.data.length,(v,i,a)=>i);
  return this;
};

// check obj (or array) for match against criteria object
JSONDB.prototype.match = function match(obj,criteria) {
  return Object.keys(criteria).every(c=>
    (typeof obj[c]=='object') ? this.match(obj[c],criteria[c]) : String(obj[c]).match(criteria[c])
  );
};

// selects one or more entries from a collection and assigns result to active.data. (chainable)
JSONDB.prototype.filter = function filter(criteria=null) {
  if (criteria===null || this.active.data===null) return this; // no filter or nothing to filter
  if (this.active.byKey) {
    if ((typeof criteria=='string')&&('collection' in this.active)) {
      this.active.data = this.active.data ? JSON.parse(JSON.stringify(this.active.data[criteria])) : undefined;
      this.active.refs = this.active.data!==undefined ? [criteria] : [];
    };
  } else if (typeof criteria=='object') {  // array type database
    let ref = [];
    let filtered = (this.active.data||[]).filter((record,index)=>{
      let test = this.match(record,criteria);
      if (test) ref.push(this.active.refs[index]);
      return test;
    });
    this.active.data = filtered.length ? filtered : null; // no matching records returns null so 'get' dflt will apply
    this.active.refs = ref;
  };
  return this;
};      

// returns current selected values...
JSONDB.prototype.get = function get(criteria,dflt) {
  return this.filter(criteria).active.data || dflt; 
};

// returns current references for selected values...
JSONDB.prototype.getRefs = function getRefs() {
  return this.active.refs || []; 
};

// adds or updates a collection entry...
JSONDB.prototype.post = function post(ref,data) {
  if (!this.active.collection) return null; // selected collection required
  if (this.active.byKey) {  // key=ref
    let old = this.get(ref,{});
    this.active.data = (this.cfg.collections[this.active.collection].dflts||{}).mergekeys(old).mergekeys(data||{});
    this.db[this.active.collection][key] = this.active.data;
    return this.active.data;
  } else {
    /// how do i know what ref points to
  };

/*)  
  if (this.active.isArray) {
    // if collection is array, treat ref as index to array
    ref = (ref===null)||(ref===undefined) ? this.active.data.length : Number(ref);
    let tmp = (typeof this.active.data[ref]==='object') ? (this.active.data[ref]||{}).mergekeys(data) : data;
    console.log("post:",ref,tmp,this.active.data[ref],this.active);
    this.active.data[ref] = tmp;
    this.active.refss = Array.makeArrayOf(this.active.data.length,(v,i,a)=>i);
  } else {
    // if collection is object, treat ref as key in collection; merge data with any existing data
    this.active.data[ref] = (this.active.data[ref]||{}).mergekeys(data);
    this.active.refss = Object.keys(this.active.data);
  };
  // if ref in collection, first retrieve any existing value, merge new data, and save
  if (!this.cfg.readOnly) this.cache();*/
};

// removes an entry or entries from a collection; default to current active selections...
JSONDB.prototype.remove = function remove(refs) {
  refs = (refs===undefined) ? this.active.refs : (refs instanceof Array ? refs : [refs]);
  if (this.active.byKey) {
    refs.forEach(k=>delete this.active.data[k]);
  } else {
    refs.sort().reverse();  // remove multiple indecies from end backward.
    refs.forEach(i=>this.active.data.splice(i,1));
  };
  return this;
};

// terminal operations...
// return a count of filtered items
JSONDB.prototype.count = function count() {
  return !this.active.data ? 0 : this.active.byKey ? 1 : this.active.data.length;
};

// filter duplicates from a set of filtered items based on a scalar value of key-value of an object...
JSONDB.prototype.unique = function unique(value) {
  
};

// streams data from XJV file to internal database object filtered by worker function...
JSONDB.prototype.streamIn = function streamIn(worker) {
  
};

// streams data to XJV file (appended) by iterator worker function...
JSONDB.prototype.streamOut = function streamOut(worker) {
  
};

JSONDB.prototype.test = function test(obj,criteria) {
  
};
