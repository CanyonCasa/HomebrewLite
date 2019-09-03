// Module for transcripting activity...
/*

example: 
  const Scribe = require('./Scribe');
  var scribe = new Scribe({tag:'MAIN', file: 'db.log'});
  scribe.warn("PROBLEM READING DATABASE...");
    // to console:        2001-06-01 12:00:00.000 warn  MAIN     PROBLEM READING DATABASE...
    // to transcript:     2001-06-01 12:00:00.000 warn  MAIN     :: PROBLEM READING DATABASE...\n

// a new Scribe instance can inherit a parent scribe to write to the same transcript file with a different tag
  var appScribe = new Scribe(tag: 'app', parent: scribe);
// a local scribe can simply reference and use the parent
  var mwScribe = appScribe; 

*/

const colors = require('colors');
const fs = require('fs');
const path = require('path');
const frmt = require('util').format;  // returns same result as console.log for arguments

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

// constructor for Scribe class...
module.exports = Scribe = function Scribe(cfg={}) {
  this.parent = cfg.parent;   // parent Scribe object
  this.tag = (cfg.tag || (cfg.parent||{}).tag || new Date().valueOf().toString(36));
  this.prompt = (this.tag.toUpperCase()+'        ').slice(0,8);
  this.mask = cfg.mask || cfg.parent.mask || 'log';
  // transcript object attributes include: file, level, bsize, and fsize; defaults below...
  // buffering (i.e. bsize>0) will reduce file I/O, but may lose data on exit.
  this.transcript = Object.assign({file: "../logs/"+this.tag+'.log', fsize: 200000, buffer:'', bsize: 10000, busy: false},cfg.transcript);
  this.log("Scribe initialized for %s [%s]",this.tag.toUpperCase(),this.parent?'-/-':this.transcript.fsize+'/'+this.transcript.bsize);
};

// function to write output to rolling transcript file
Scribe.prototype.saveTranscript = function saveTranscript(flag) {
  if (this.transcript.busy) return; // already in process of saving transcript
  if (flag==='ready') {  // transcript file overflow checked
    let tmp = this.transcript.buffer;
    this.transcript.buffer = '';
    fs.writeFile(this.transcript.file,tmp,{encoding:'utf8',flag:'a'},(e)=>{if (e) console.log('ERROR: can not write to transcript...');});
  } else {
    this.transcript.busy = true;
    fs.stat(this.transcript.file, (err, stats) => {     // stats undefined if file not found...
      if ((flag===true) || (stats && stats.size>this.transcript.fsize)) {  // roll transcript on flush or filesize...
        let dx = new Date().toISOString().split(':').join('');
        let parts = path.parse(this.transcript.file);
        let bak = path.normalize(parts.dir + '/' + parts.name +'-' + dx + parts.ext);
        fs.rename(this.transcript.file,bak,(e)=>{
          this.debug("Rolling log: %s [%s]",bak,stats.size);
          this.transcript.busy = false;
          this.saveTranscript('ready');
        });
      } else {
        this.transcript.busy = false;
        this.saveTranscript('ready'); // OK to append to transcript
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
  let mask = this.mask || (this.parent||{}).mask || 'log';
  if (level[style].rank>=level[mask].rank || style=='dump') {
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
