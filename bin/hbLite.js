/*
hbLite.js: simple multi-domain homebrew web hosting server 
created: 20190417 by CanyonCasa, (c)2019 Enchanted Engineering, Tijeras NM.

Sets up a small multi-domain (<10 each) NodeJS homebrew web hosting service 
providing site-specific custom apps for webs, blogs, sockets, etc. Similar to
homebrew.js with fewer features and configuration requirements.

hbLite implements support for a site consisting of static pages customized 
client side by the retreival of site and configuration specific data
contained in JSON files or retrieved from a data service.
In addition to static file serving, hbLiteApp provides "recipe" based API 
services for retrieval of data ($<recipe>), actions (@<recipe>), and 
information (!<recipe>). (See HomebrewAPI for details.) For example
  https://example.net/$snowfall   Recipe driven database query
  https://example.net/@text       Fixed actions
  https://example.net/!ip         Server/Client (internal) information

HomebrewCMS provides a supporting content management system.

The hbLite Script ...
  1. Sets up some configuration info
  2. Creates/launches each defined site service
  3. Creates a reverse proxy to redirect requests to respective sites

SYNTAX:
  node hbLite.js [<configuration_file>]
  NODE_ENV=production node hbLite.js [<configuration_file>]
  
  where <configuration_file> defaults to ../restricted/config[.js or .json]
*/

// load external modules...
const fs = require('fs');
const EventEmitter = require('events');
require('./Extensions2JS');  // my additions to JS language
const Scribe = require('./Scribe');
const Cleanup = require('./Cleanup');
const Auth = require('./hbLiteAuth');
const LiteApp = require('./hbLiteApp');
const Proxy = require('./hbLiteProxy');
///var WrapSQ3 = require('./WrapSQ3');  // SQLite3 database wrapper

// read the server configuration from a [cmdline specified] JS or JSON file or use default...
var cfg = require(process.argv[2] || '../restricted/config');
cfg.VERSION = fs.statSync(__filename).mtime.toLocaleString();

// define environment (production vs development) based on configuration, default development ...
var env = {}.mergekeys(cfg.env||{});
env.NODE_ENV = process.env.NODE_ENV = process.env.NODE_ENV || env.NODE_ENV || 'development';

// start transcripting; object passed to other site apps in context...
var scribe = new Scribe(cfg.scribe);
scribe.info("HomebrewLite[%s] server setup in %s mode...", cfg.VERSION, process.env.NODE_ENV);

//ensure clean exit on Ctrl-C...; pass cleanup callback
Cleanup(()=>{scribe.flush('Transcript closed')}); // adds process event handlers

// dump the configuration for verbose debugging...
//scribe.trace("CONFIG: %s", JSON.stringify(cfg,null,2));

/*// setup (shared) databases...
// site apps can use these or open connections to dedicated databases
var db = {};
for (var d of cfg.databases||{}) {
  // definition can specify a defined JSON object or just a filename
  var dbDef = typeof cfg.databases[d]=='object' ? cfg.databases[d] : { file: cfg.databases[d] };
  db[d] = new WrapSQ3(dbDef,function (err,msg) { 
    if (err) { scribe.error(msg); throw err; } else { scribe.log(msg); };
    });
  };

// establish internal server and event handler
var internals = require('./hbInternals')({scribe: scribe, cfg:cfg.command});
internals.Stat.set('brew','VERSION',cfg.VERSION);
internals.Stat.set('brew','up',new Date().toLocaleString());

// shared services; passed db handles, scribe, and command emitter...
var services = {};
for (var s of (cfg.shared||{})) {
  if (cfg.shared[s].require) {
    scribe.debug("Loading shared service [%s]...",s);
    let context = {internals: internals, db: db, tag: cfg.shared[s].tag||s, scribe: scribe, cfg:cfg.shared[s].options||{}};
    services[s] = new (require(cfg.shared[s].require))(context);
    for (var c of cfg.shared[s].init) services[s][c](cfg.shared[s].init[c]);
    };
  };

*/

// Define shared site context...
var shared = {auth: new Auth(cfg.auth), msg: new EventEmitter(), scribe: scribe, stats: {}};  // shared global object
shared.msg.on('stats',(stat)=>scribe.debug('stats'+(stat?'.'+stat:'')+':',(stat?shared.stats[stat]:shared.stats).asString()));
shared.headers = {"x-powered-by": "Raspberry Pi Homebrew NodeJS Server "+cfg.VERSION}.mergekeys(cfg.headers);

// verify site configurations...
for (let p of cfg.proxies) for (let s of cfg.proxies[p].sites) if (!cfg.sites[s]) cfg.proxies[p].sites.splice(cfg.proxies[p].sites.indexOf(s),1);

// prep each site configuration...
// Start app for each proxied site that's defined...
scribe.log("HomebrewLite site setups...");
var sites = {};
for (let p of cfg.proxies) {
  for (let s of cfg.proxies[p].sites) {
    let scfg = cfg.sites[s];  // shorthand reference
    scfg.tag = s; // force a default tag
    scribe.debug("Creating site[%s] context...",s);
    scfg.headers = {}.mergekeys(shared.headers).mergekeys(scfg.headers); // default "x-powered-by" header with site override
    let context = { cfg: scfg, tag: scfg.tag }.mergekeys(shared); 
    sites[s] = new LiteApp(context);
    scribe.info("Site[%s]: initialized, hosting %s:%s",scfg.tag,scfg.host,scfg.port);
  };  
};

// define and start reverse proxy servers...
scribe.log("HomebrewLite proxy setup...");
var proxies = {};
for (var p of cfg.proxies) {
  let pcfg = cfg.proxies[p];  // shorthand reference
  pcfg.tag = pcfg.tag || p;   // default tag to index value.
  scribe.debug("Creating proxy[%s] context...",pcfg.tag);
  pcfg.routes = pcfg.routes || {};  // default routes
  // define site specific routes...
  for (var tag of pcfg.sites) {
    if (tag in cfg.sites) {
      var route = {host: cfg.sites[tag].host, port: cfg.sites[tag].port||80};
      for (var alias of cfg.sites[tag].aliases) { // add site alias routes
        pcfg.routes[alias] = route;
        scribe.debug("Proxy[%s] route added: %s --> %s:%s",p,alias,route.host,route.port);
      };
    };
  };
  let pcontext = ({cfg: pcfg, tag: pcfg.tag}).mergekeys(shared);
  proxies[p] = new Proxy(pcontext);
  scribe.info("%sProxy[%s]: initialized on port %s",(pcfg.secure)?'SECURE ':'',pcfg.tag,pcfg.port); 
  proxies[p].start();
  };

scribe.info("HomebrewLite setup complete...");
