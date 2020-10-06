// Singleton Module for logging server activity and statistics ...
/*

example: 
  // declare a singular instance passed configuration, see below for details...
  const Scribe = require('./LiteScribe')(<configuration>);
  var scribe = Scribe('SITE'); // create a local wrapper instance
  scribe.warn("PROBLEM READING DATABASE...");
    // to console:        10/5/2020, 2:51:19 PM SITE    PROBLEM READING DATABASE... (in green text)
    // to transcript:     10/5/2020, 2:51:19 PM|WARN |SITE    |PROBLEM READING DATABASE...\n

configuration:  tag <string> | <object>
  tag:          transcript reference, max 8 characters
  mask:         transcript level
  transcript:
    file:       filespec for transcript (default ../logs/${this.tag}.log
    fsize:      transcript file size for rollover (default 250K)
    bsize:      write buffer size (default 25K, >0 reduces writes but may result in lost data on crash
*/

require('./Extensions2JS');
const colors = require('colors');
const fs = require('fs');
const path = require('path');
const frmt = require('util').format;  // returns same result as console.log for arguments

// holds configuration...
var cfg;

// precedence order of transcript calls; level passes all messages equal to or greater in rank...
var level = {
  dump:  {txt: "DUMP ", rank: 0},  // transcript only, no styling
  trace: {txt: "TRACE", rank: 1, style: ['magenta','bold']},
  debug: {txt: "DEBUG", rank: 2, style: ['cyan','bold']},
  log:   {txt: "LOG  ", rank: 3, style: ['white']},
  info:  {txt: "INFO ", rank: 4, style: ['green']},
  warn:  {txt: "WARN ", rank: 5, style: ['yellow','bold']},
  error: {txt: "ERROR", rank: 6, style: ['red','bold']},
  fatal: {txt: "FATAL", rank: 7, style: ['redBG','white','bold']},
  flush: {txt: "FLUSH", rank: 8, style: ['cyanBG','black']}, // 'flush' always writes transcript
};

// color styling function (applys only to console)...
var asStyle = (lvl='log', txt='') => { level[lvl].style.forEach(function(s) { txt = colors[s](txt); }); return txt; };

// object for internal server statistics management...
var stats = {};
var Statistics = {
  set: (tag,key,value) => {
    stats[tag] = (tag in stats) ? stats[tag] : {};  // verify existance of tag object or create
    if (key===undefined) { stats[tag] = value; return stats[tag]; };  // value may be an object
    stats[tag][key] = value;
    return stats[tag][key];
  },
  get: (tag,key) => {
    if (tag===undefined) return stats;
    if (tag in stats) {
      if (key===undefined) return stats[tag];
      if (key in stats[tag]) return stats[tag][key];
    };
    return undefined;
  },  
  inc: (tag,key) => {
    Statistics.set(tag,key,(Statistics.get(tag,key)) ? Statistics.get(tag,key)+1 : 1);
    return Statistics.get(tag,key);
  },
  tags: () => Object.keys(stats),
  keys: (tag) => Object.keys(stats[tag]),
  clear: (tag,key) => key ? (stats[tag][key]=undefined) : (stats[tag]=undefined)
};


// private functions...

// get or set mask level
var maskLevel = (lvl) => { if (lvl && (lvl in level)) cfg.mask=lvl; return cfg.mask; };

// function to write output to rolling transcript file
var busy = false;
var buffer = '';
function saveTranscript(flag) {
  if (busy) return; // already in process of saving transcript
  if (flag==='ready') {  // transcript file overflow checked
    let tmp = buffer;
    buffer = '';
    fs.writeFile(cfg.transcript.file,tmp,{encoding:'utf8',flag:'a'},(e)=>{if (e) console.log('ERROR: can not write to transcript...');});
  } else {
    busy = true;
    fs.stat(cfg.transcript.file, (err, stats) => {     // stats undefined if file not found...
      if ((flag===true) || (stats && (stats.size>cfg.transcript.fsize))) {  // roll transcript on flush or filesize...
        let dx = new Date().toISOString().split(':').join('');
        let parts = path.parse(cfg.transcript.file);
        let bak = path.normalize(parts.dir + '/' + parts.name +'-' + dx + parts.ext);
        fs.rename(cfg.transcript.file,bak,(e)=>{
          write('debug',`Rolling log: ${bak} [${(stats||{}).size}]`,cfg.tag);
          busy = false;
          saveTranscript('ready');
        });
      } else {
        busy = false;
        saveTranscript('ready'); // OK to append to transcript
      };
    });
  };
};

// function for streaming transcript to a buffer and saving file on overflow...
function streamToTranscript(line,flush) {
  buffer += line+((flush)?'\n':''); // extra linefeed if flushing to "paginate" log file.
  if ((buffer.length>cfg.transcript.bsize) || flush) saveTranscript(flush); // otherwise buffer not saved to transcript file!
};

// output function...
function write(style,msg,tag) {
  // style and print msg to console...
  let stamp = new Date().toLocaleString();
  // only log or transcript to requested level of detail; mask may be dynamically assigned between calls
  if (level[style].rank>=level[cfg.mask].rank || style=='dump') {
    if (style!='dump') {
      let prefix = [stamp,level[style].txt,tag].join(' ') + ' ';      // transcript metadata
      let lines = msg.replace(/\n/g,'\n'+' '.repeat(prefix.length));  // break msg lines and add blank prefix
      console.log(asStyle(style,prefix + lines));
    };
    streamToTranscript([stamp,level[style].txt,tag,msg].join('|')+'\n',(style==='fatal'||style==='flush'));
  };
};

// Singleton object...
var Scribe = (tag) => {
  let TAG = ((tag||cfg.tag).toUpperCase()+'        ').slice(0,8);
  return {
    TAG: TAG,
    Stat: Statistics,
    maskLevel: maskLevel,
    raw: console.log, // never write to transcript
    dump: (...args)=> write('dump',frmt.apply(this,args),TAG),
    trace: (...args) => write('trace',frmt.apply(this,args),TAG),
    debug: (...args) => write('debug',frmt.apply(this,args),TAG),
    log: (...args) => write('log',frmt.apply(this,args),TAG),
    info: (...args) => write('info',frmt.apply(this,args),TAG),
    warn: (...args) => write('warn',frmt.apply(this,args),TAG),
    error: (...args) => write('error',frmt.apply(this,args),TAG),
    fatal: (...args) => { write('fatal',frmt.apply(this,args),TAG); process.exit(100);},
    flush: (...args) => write('flush',frmt.apply(this,args),TAG)   // always write transcript
  };
};

// object initialization...
function init(configuration) {
  cfg = typeof configuration=='string' ? {tag: configuration} : configuration;
  cfg.tag = cfg.tag || 'server';
  cfg.mask = cfg.mask || 'log'; // mask level (defaults to 'log'), see function maskLevel
  cfg.transcript = {file: `../logs/${this.tag}.log`, fsize: 250000, bsize: 25000}.mergekeys(cfg.transcript);
  write('info',`Scribe initialized for ${cfg.tag.toUpperCase()}`,cfg.tag);
  return Scribe;
};

module.exports = init;
