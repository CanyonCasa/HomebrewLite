/*
hbLite.js: simple multi-domain (i.e. hostnames) homebrew web hosting server 
issued: 20201005 by CanyonCasa, (c)2020 Enchanted Engineering, Tijeras NM.

Sets up a small multi-domain (~1-6 each) NodeJS based homebrew web hosting service 
providing site-specific custom apps for webs, blogs, sockets, etc. Similar to
homebrew.js with simpler configuration requirements.

hbLite implements support for a site consisting of static pages customized 
client side by the retreival of site and configuration specific data
contained in JSON files or retrieved from a data server.

In addition to static file serving, hbLiteApp provides "recipe" based API 
services for retrieval of data ($<recipe>), actions (@<action>), and 
information (!<info>). (See HomebrewLiteAPI for details.) For example,
  https://example.net/$snowfall   Recipe driven database query/modify
                                  including Extensible JSON format
  https://example.net/@text       Specific actions such as sending text
  https://example.net/!ip         Server/Client (internal) information

HomebrewLite CMS provides a supporting content management system.

This hbLite Script ...
  1. Configures server (global or top level) shared context and services such as transcripting
  2. Configures and starts individual "site" apps/services
  3. Configures and starts reverse proxies to redirect requests to respective sites

SYNTAX:
  node hbLite.js [<configuration_file>]
  NODE_ENV=production node hbLite.js [<configuration_file>]
  NODE_ENV=production forever node hbLite.js [<configuration_file>]
  
  where <configuration_file> defaults to ../restricted/config[.js or .json]
*/

// load external modules...
require('./Extensions2JS');                 // personal library of additions to JS language
const os = require('os');                   // operating system module
const fs = require('fs');                   // file system module
const p = require('process');               // system process interface
const LiteScribe = require('./LiteScribe'); // Activity and stats transcripting
const Cleanup = require('./Cleanup');       // Graceful shutdown support
const LiteApp = require('./hbLiteApp');     // Baseline general purpose lightweight application
const Proxy = require('./hbLiteProxy');     // Reverse proxy wrapper
var jxjDB = require('./jxjDB');             // JSON database with Extensible JSON support
const twilio = require('twilio');           // Twilio SMS API
var email = require('emailjs');             // email server

// unified error message formating
const errs = {
  400: "Bad Request",
  401: "NOT authorized!",
  403: "Forbidden",
  404: "File NOT found!",
  500: "Internal Server Error",
  501: "Not supported"
};
var emsg = (c,m)=>({error: true, code: Number(c), msg: m||errs[Number(c)]||'UNKNOWN ERROR'});

// read the server configuration from (cmdline specified or default) JS or JSON file ...
let cfg = require(process.argv[2] || '../restricted/config');
cfg.$VERSION = cfg.$VERSION || fs.statSync(__filename).mtime.toLocaleString(); // default to filestamp as version identifier
cfg.$HOST = cfg.$HOST || os.hostname(); // identifier for messages

// start transcripting...
const Scribe = LiteScribe(cfg.scribe);  // Scribe object passed to other site apps in "context"
const scribe = Scribe();  // server level reference
scribe.info("HomebrewLite[%s] server setup in %s mode...", cfg.$VERSION, process.env.NODE_ENV||'development');
// dump the configuration for verbose debugging...
if (cfg.$DUMP) scribe[cfg.$DUMP]("CONFIG: %s", JSON.stringify(cfg,null,2));

//ensure clean exit on Ctrl-C...; pass cleanup callback
Cleanup(()=>{scribe.flush('Transcript closed')}); // adds process event handlers

// define global (server level) context provided to each app; local app specific configuration overrides...
// sms twilio wrapper assumes msg provides valid 'numbers' (array or comma delimited string, or use defaults) and a 'body/text' 
async function sms(msg) {
    if (!cfg.$twilio) throw 501;
    try {
      let numbers = msg.numbers || cfg.$twilio.admin;
      if (typeof numbers=='string') numbers = numbers.split(',');
      const client = new twilio(cfg.$twilio.accountSID,cfg.$twilio.authToken);
      const cb = msg.callback || cfg.$twilio.callback || null;
      let queue = await Promise.all(numbers.map(n=>
        client.messages.create({to: n, from: cfg.$twilio.number, body: msg.body||msg.text, statusCallback:cb})
          .then(m =>{ m.transcript = `Text message queued to: ${n}`; scribe.debug(m.transcript); return m; })
          .catch(e=>{ throw e }) ));
      let transcript = queue.map(q=>q.transcript);
      return {report: {summary: `Text message queued for ${numbers.length} ${numbers.length==1?'number':'numbers'}`, transcript: transcript}, queue: queue};
    } catch (ee) { throw ee };
  };

// mail client wrapper...
async function mail(msg) {
  if (!cfg.$email) throw 501;
  msg.id = msg.id || cfg.$email.name || ''; // format optional header with id and/or time and other defaults
  msg.timestamp = msg.time ? '['+new Date().toISOString()+']' : '';
  msg.body = (msg.hdr || ((msg.id||msg.timestamp) ? msg.id+msg.timestamp+':\n' : '')) + msg.body;
  if (!(msg.to+msg.cc+msg.bcc)) msg.to = cfg.$email.defaults.to;
  msg.from = msg.from || cfg.$email.defaults.from;
  // resolve remaining msg parts
  msg.subject = msg.subject || cfg.$email.defaults.subject;
  msg.text = msg.body || cfg.$email.defaults.text;
  return new Promise((resolve,reject)=>{
    try {
      let server = email.server.connect(cfg.$email.smtp);  // connect to server and send the message...
      server.send(msg,(e,rpt)=>{ if (e) { reject(e) } else { resolve({report:rpt,msg:msg}); }; });
    } catch(e) { reject(e); }; // report failure
  });
};

// load server level databases...
let db = {};
for (let d in cfg.databases) { // add any global (server) databases...
  scribe.trace(`Creating and loading '${d}' database (file: ${cfg.databases[d].file}) ...`);
  db[d] = new jxjDB(cfg.databases[d]);
  db[d].load()
    .then(x=>scribe.debug(`Server '${d}' database loaded successfully!`))
    .catch(e=>{scribe.fatal(`Server '${d}' database load error!`,e)});
};

// default headers; configured {"x-powered-by" header overrides builtin...
let headers = {"x-powered-by": "Raspberry Pi HomebrewLite NodeJS Server "+cfg.VERSION}.mergekeys(cfg.headers)

// configured server context passed to sites...
let server = {
  db: db,           // database(s)
  emsg: emsg,       // standard error message object formatting used by proxies and sites
  headers: headers, // default headers
  mail: mail,       // email client
  scribe: Scribe,   // scribe instance for proxies and sites
  sms: sms          // Twilio service client
};


// filter any sites listed as served by proxy from cfg that lack a site specific configuration
cfg.proxies.mapByKey((v,k,o)=>o[k].sites=v.sites.filter(s=>cfg.sites[s]));

// backends need to start before proxies...
// prep each site configuration and start app for each proxied site that's defined...
scribe.info("HomebrewLite site setups...");
let sites = {};
for (let p in cfg.proxies) {
  function proxy() { return proxies[p]; }; // serving proxy callback, since not yet defined
  for (let s of cfg.proxies[p].sites) {
    let scfg = cfg.sites[s];  // site configuration shorthand reference
    scfg.tag = scfg.tag || s; // force site configuration key as a default tag (i.e. transcript reference)
    let context = { cfg: scfg, proxy: proxy, secure: !!cfg.proxies[p].secure, server: server, tag: scfg.tag };
    scribe.debug(`Creating ${context.secure?'':'in'}secure site ${s} ...`);
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

// server status 
scribe.Stat.set('$server','host',cfg.$HOST);
scribe.Stat.set('$server','start',new Date().toISOString());
scribe.Stat.set('$server','node_env',p.env.NODE_ENV);
if (p.env.NODE_ENV=='production') sms({text:`HomebrewLite Server started on host ${cfg.$HOST}`}).catch(e=>{console.log('sms failure!:',e); });
scribe.info("HomebrewLite setup complete...");
