/*
hbLite.js: simple multi-domain homebrew web hosting server 
issued: 20200331 by CanyonCasa, (c)2020 Enchanted Engineering, Tijeras NM.

Sets up a small multi-domain (~1-6 each) NodeJS based homebrew web hosting service 
providing site-specific custom apps for webs, blogs, sockets, etc. Similar to
homebrew.js with simpler configuration requirements.

hbLite implements support for a site consisting of static pages customized 
client side by the retreival of site and configuration specific data
contained in JSON files or retrieved from a data service.

In addition to static file serving, hbLiteApp provides "recipe" based API 
services for retrieval of data ($<recipe>), actions (@<action>), and 
information (!<info>). (See HomebrewAPI for details.) For example,
  https://example.net/$snowfall   Recipe driven database query/modify
                                  including Extensible JSON format
  https://example.net/@text       Specific actions such as sending text
  https://example.net/!ip         Server/Client (internal) information

HomebrewCMS provides a supporting content management system.

This hbLite Script ...
  1. Configures global (server) shared context and services such as transcripting
  2. Configures and starts individual "site" apps/services
  3. Configures and starts reverse proxies to redirect requests to respective sites

SYNTAX:
  node hbLite.js [<configuration_file>]
  NODE_ENV=production node hbLite.js [<configuration_file>]
  NODE_ENV=production forever node hbLite.js [<configuration_file>]
  
  where <configuration_file> defaults to ../restricted/config[.js or .json]
*/

// load external modules...
require('./Extensions2JS');             // personal library of additions to JS language
const fs = require('fs');               // file system module
const Scribe = require('./Scribe');     // Activity and stats transcripting
const Cleanup = require('./Cleanup');   // Graceful shutdown support
const LiteApp = require('./hbLiteApp'); // Baseline general purpose lightweight application
const Proxy = require('./hbLiteProxy'); // Reverse proxy wrapper
var jxjDB = require('./jxjDB');         // JSON database with Extensible JSON support

// unified error message formating
const errs = {
  400: "Bad Request",
  401: "NOT authorized!",
  403: "Forbidden",
  404: "File NOT found!",
  500: "Internal Server Error",
  501: "Not supported"
};
var emsg = (c,m)=>({code: Number(c), msg: m||errs[Number(c)]||'UNKNOWN ERROR'});

// read the server configuration from (cmdline specified or default) JS or JSON file ...
let cfg = require(process.argv[2] || '../restricted/config');
cfg.VERSION = cfg.VERSION || fs.statSync(__filename).mtime.toLocaleString(); // default to filestamp as version identifier

// start transcripting; scribe object passed to other site apps in "context"...
let scribe = new Scribe(cfg.scribe);
scribe.info("HomebrewLite[%s] server setup in %s mode...", cfg.VERSION, process.env.NODE_ENV||'development');
// dump the configuration for verbose debugging...
scribe.trace("CONFIG: %s", JSON.stringify(cfg,null,2));

//ensure clean exit on Ctrl-C...; pass cleanup callback
Cleanup(()=>{scribe.flush('Transcript closed')}); // adds process event handlers

// define global (server level) context provided to each app; local app specific configuration overrides...
let server = {
  db: {},
  emsg: emsg, // standard error message object formatting used by proxies and servers
  headers: {"x-powered-by": "Raspberry Pi HomebrewLite NodeJS Server "+cfg.VERSION}.mergekeys(cfg.headers),
  scribe: scribe
};
for (let d in cfg.databases) { // add any global (server) databases...
  scribe.trace(`Creating and loading '${d}' database (file: ${cfg.databases[d].file}) ...`);
  server.db[d] = new jxjDB(cfg.databases[d]);
  server.db[d].load()
    .then(x=>scribe.debug(`Server '${d}' database loaded successfully!`))
    .catch(e=>{scribe.fatal(`Server '${d}' database load error!`,e)});
};

// filter any proxy sites from cfg that lack a site specific configuration
cfg.proxies.mapByKey((v,k,o)=>o[k].sites=v.sites.filter(s=>cfg.sites[s]));

// backends need to start before proxies...
// prep each site configuration and start app for each proxied site that's defined...
scribe.info("HomebrewLite site setups...");
let sites = {};
for (let p in cfg.proxies) {
  function proxy() { return proxies[p]; }; // serving proxy callback since not yet defined
  for (let s of cfg.proxies[p].sites) {
    let scfg = cfg.sites[s];  // site configuration shorthand reference
    scfg.tag = scfg.tag || s; // force site configuration key as a default tag (i.e. transcript reference)
    scribe.debug("Creating site[%s] context...",s);
    let context = { server: server, proxy: proxy, cfg: scfg, tag: scfg.tag };
    let App = scfg.app ? require(scfg.app) : LiteApp; // default LiteApp with cfg override
    sites[s] = new App(context); // start app with context scope
    scribe.info("Site[%s]: initialized, hosting %s:%s",scfg.tag,scfg.host,scfg.port);
    };
  };  

// define and start reverse proxy servers...
scribe.info("HomebrewLite proxy setup...");
let proxies = {};
for (let p in cfg.proxies) {
  let pcfg = cfg.proxies[p];  // shorthand reference
  pcfg.tag = pcfg.tag || p;   // default tag to index value.
  scribe.debug("Creating proxy[%s] context...",pcfg.tag);
  pcfg.routes = pcfg.routes || {};  // default routes
  // auto define site specific routes...
  for (let s of pcfg.sites) {
    if (s in cfg.sites) {
      let route = {host: cfg.sites[s].host, port: cfg.sites[s].port||80};
      pcfg.routes[s] = route;
      for (let alias of (cfg.sites[s].aliases||[])) { // add site alias routes
        pcfg.routes[alias] = route;
        scribe.debug("Proxy[%s] route added: %s --> %s:%s",p,alias,route.host,route.port);
      };
    };
  };
  let pcontext = ({}).mergekeys(server).mergekeys({cfg: pcfg, tag: pcfg.tag});
  proxies[p] = new Proxy(pcontext);
  scribe.info("%sProxy[%s]: initialized on port %s",(pcfg.secure)?'SECURE ':'',pcfg.tag,pcfg.port); 
  };

scribe.info("HomebrewLite setup complete...");
