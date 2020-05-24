// Module for logging statistics and transcripting activity...
/*

example: 
  const Scribe = require('./Scribe');
  var scribe = new Scribe({tag:'MAIN', file: 'db.log'});
  scribe.warn("PROBLEM READING DATABASE...");
    // to console:        2001-06-01 12:00:00.000 warn  MAIN     PROBLEM READING DATABASE...
    // to transcript:     2001-06-01 12:00:00.000 warn  MAIN     :: PROBLEM READING DATABASE...\n

// a new Scribe instance can inherit a parent scribe to write to the same transcript file with a different tag
  var appScribe = new Scribe(tag: 'app', parent: scribe);


*/

const colors = require('colors');
const fs = require('fs');
const path = require('path');
const frmt = require('util').format;  // returns same result as console.log for arguments
const EventEmitter = require('events');

// precedence order of transcript calls; level passes all messages equal to or greater in rank...
var level = {
  dump:  {txt: "DUMP ", rank: 0},  // transcript only
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

// singular scribe handler for logging internal server statistics data management...
var stats = {};
var Stat = {
  stats: stats,
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
    Stat.set(tag,key,(Stat.get(tag,key)) ? Stat.get(tag,key)+1 : 1);
    return Stat.get(tag,key);
  },
  tags: () => Object.keys(stats),
  keys: (tag) => Object.keys(stats[tag]),
  clear: (tag,key) => key ? (stats[tag][key]=undefined) : (stats[tag]=undefined)
};

// constructor for Scribe class...
module.exports = Scribe = function Scribe(cfg={}) {
  this.parent = cfg.parent;   // parent Scribe object if defined
  this.tag = (cfg.tag || (cfg.parent||{}).tag || new Date().valueOf().toString(36));
  this.prompt = (this.tag.toUpperCase()+'        ').slice(0,8);
  this.mask = cfg.mask; // local override or default to parent.mask (or defaults to 'log'), see function maskLevel 
  // transcript object attributes include: file, level, bsize, and fsize; defaults below...
  // buffering (i.e. bsize>0) will reduce file I/O, but may lose data on exit.
  this.transcript = {file: `../logs/${this.tag}.log`, fsize: 200000, buffer:'', bsize: 10000, busy: false}.mergekeys(cfg.transcript);
  let msg = `Scribe initialized for ${this.tag.toUpperCase()}`;
  if (this.parent) { this.debug(msg,'as child'); } else { this.info(msg,`[${this.transcript.fsize}/${this.transcript.bsize}]`); };
  // define internal messenger service passed from parent; should only define one even if separate Scribes
  this.Msgr = cfg.parent ? cfg.parent.Msgr : new EventEmitter();
  this.Stat = Stat;
};

// get or set mask level
Scribe.prototype.maskLevel = function maskLevel(lvl) {
  let mask = this.mask || (this.parent && this.parent.maskLevel()) || 'log';
  if (lvl && (lvl in level)) mask = this.parent ? this.parent.maskLevel(lvl) : this.mask=lvl;
  return mask;
};

// function to write output to rolling transcript file
Scribe.prototype.saveTranscript = function saveTranscript(flag) {
  if (this.transcript.busy) return; // already in process of saving transcript
  if (flag==='ready') {  // transcript file overflow checked
    let tmp = this.transcript.buffer;
    this.transcript.buffer = '';
    fs.writeFile(this.transcript.file,tmp,{encoding:'utf8',flag:'a'},(e)=>{if (e) console.log('ERROR: can not write to transcript...');});
  } else {
    var self = this;
    self.transcript.busy = true;
    fs.stat(self.transcript.file, (err, stats) => {     // stats undefined if file not found...
      if ((flag===true) || (stats && (stats.size>self.transcript.fsize))) {  // roll transcript on flush or filesize...
        let dx = new Date().toISOString().split(':').join('');
        let parts = path.parse(self.transcript.file);
        let bak = path.normalize(parts.dir + '/' + parts.name +'-' + dx + parts.ext);
        fs.rename(self.transcript.file,bak,(e)=>{
          self.debug("Rolling log: %s [%s]",bak,(stats||{}).size);
          self.transcript.busy = false;
          self.saveTranscript('ready');
        });
      } else {
        self.transcript.busy = false;
        self.saveTranscript('ready'); // OK to append to transcript
      };
    });
  };
};

// function for streaming transcript to a buffer and saving file on overflow...
Scribe.prototype.streamToTranscript =  function streamToTranscript(line,flush) {
  if (this.parent) {  // parent level transcripting takes precedence
    this.parent.streamToTranscript(line,flush);
    return;
  };
  if (this.transcript.file) { // instance level transcripting if its log file defined...
    this.transcript.buffer += line+((flush)?'\n':''); // extra linefeed if flushing to "paginate" log file.
    if ((this.transcript.buffer.length>this.transcript.bsize) || flush) this.saveTranscript(flush);
  };
  // otherwise scripting not saved to transcript file!
};

// output function...
Scribe.prototype.write = function write(style,msg) {
  // style and print msg to console...
  let stamp = new Date().toLocaleString();
  // only log or transcript to requested level of detail; mask may be dynamically assigned between calls
  if (level[style].rank>=level[this.maskLevel()].rank || style=='dump') {
    if (style!='dump') console.log(asStyle(style,[stamp,level[style].txt,this.prompt,msg].join(' ')));
    this.streamToTranscript([stamp,level[style].txt,this.tag,msg].join('|')+'\n',(style==='fatal'||style==='flush'));
  };
};

// message transcripting calls from lowest to highest priority...
Scribe.prototype.raw = console.log; // console pass through only
Scribe.prototype.dump = function () { this.write('dump',frmt.apply(this,arguments)); }; // only write to transcript
Scribe.prototype.trace = function () { this.write('trace',frmt.apply(this,arguments)); };
Scribe.prototype.debug = function () { this.write('debug',frmt.apply(this,arguments)); };
Scribe.prototype.log = function () { this.write('log',frmt.apply(this,arguments)); };
Scribe.prototype.info = function () { this.write('info',frmt.apply(this,arguments)); };
Scribe.prototype.warn = function () { this.write('warn',frmt.apply(this,arguments)); };
Scribe.prototype.error = function () { this.write('error',frmt.apply(this,arguments)); };
Scribe.prototype.fatal = function () { this.write('fatal',frmt.apply(this,arguments)); process.exit(100);};
Scribe.prototype.flush = function () { this.write('flush',frmt.apply(this,arguments)); }; // always write transcript
