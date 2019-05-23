/*
 Personal JavaScript language extensions...
 (c) 2019 Enchanted Engineering, MIT license
*/


///************************************************************
/// Array Object Extensions...
///************************************************************
// function to create and populate an array of given size and values, note value can even be a function
if (!Array.makeArrayOf) Array.makeArrayOf = (size,value) => Array.apply(null, Array(size)).map((v,i,a)=>(typeof value=='function') ? value(v,i,a) : value);

///************************************************************
/// Date Object Extensions...
///************************************************************
// number of days per month...
const daysByMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
// milliseconds per interval...
const msPer = {
  'Y': 31556952000,   // 1000*60*60*24*365.2425
  'M': 2629746000,    // 1000*60*60*24*365.2425/12
  'W': 604800000,     // 1000*60*60*24*7
  'D': 86400000,      // 1000*60*60*24
  'h': 3600000,       // 1000*60*60
  'm': 60000,         // 1000*60
  's': 1000           // 1000 ms per second
  };

// Calculate the ISO week of the year...
if (!Date.prototype.getWeek) Date.prototype.getWeek = function () {
  var firstThu = new Date(this.getFullYear(),0,[5,4,3,2,1,7,6][new Date(this.getFullYear(),0,1).getDay()]);
  var nearestThu = new Date(this.getFullYear(),this.getMonth(),this.getDate()-((this.getDay()+6)% 7)+3);
  return (nearestThu.getFullYear()>firstThu.getFullYear()) ? 1 : 
    1 + Math.ceil((nearestThu.valueOf()-firstThu.valueOf())/msPer['W']);
}
if (!Date.prototype.getUTCWeek) Date.prototype.getUTCWeek = function () {
  var firstThu = new Date(this.getUTCFullYear(),0,[5,4,3,2,1,7,6][new Date(this.getUTCFullYear(),0,1).getUTCDay()]);
  var nearestThu = new Date(this.getUTCFullYear(),this.getUTCMonth(),this.getUTCDate()-((this.getUTCDay()+6)% 7)+3);
  return (nearestThu.getUTCFullYear()>firstThu.getUTCFullYear()) ? 1 : 
    1 + Math.ceil((nearestThu.valueOf()-firstThu.valueOf())/msPer['W']);
}

// Test if date or given year is a leapyear...
if (!Date.prototype.isLeapYear) Date.prototype.isLeapYear = function (year) {
  year = year || this.getFullYear();
  return year%4==0&&(year%100==year%400);
}

// Calculate the day of the year...
if (!Date.prototype.getDayOfYear) Date.prototype.getDayOfYear = function () {
  var leapDay = (this.getMonth()>1 && Date.prototype.isLeapYear(this.getFullYear())) ? 1 : 0;
  return (this.getMonth() ? daysByMonth.slice(0,this.getMonth()) : [0]).reduce((t,m)=>t+=m) + this.getDate() + leapDay;
}
if (!Date.prototype.getUTCDayOfYear) Date.prototype.getUTCDayOfYear = function () {
  var leapDay = (this.getUTCMonth()>1 && Date.prototype.isLeapYear(this.getUTCFullYear())) ? 1 : 0;
  return (this.getUTCMonth() ? daysByMonth.slice(0,this.getUTCMonth()) : [0]).reduce((t,m)=>t+=m) + this.getUTCDate();
}

// Adjust a date by specified grammar...
// expects an input string in the form 'quantity units, ...'
// e.g. '+1 yr -4 days'
// can translate just about any nomenclature for units, i.e. y, yr, yrs, year, years, Y, ...
// ms (milliseconds), minutes, and months require at least 2 characters to differentiate
// assumes milliseconds by default. 
var chgPattern = /^(?:(ms)|(y)|(mo)|(w)|(d)|(h)|(mi?)|(s))|(~)/;
if (!Date.prototype.change) Date.prototype.change = function (adjStr) {
  var adjustments = adjStr.split(/[\s,]+/);
  while (adjustments.length) {
    var quan = Number(adjustments.shift());
    quan = isNaN(quan) ? 0 : quan; 
    // add dummy pattern to always force a match, and check against patterns
    var units = (adjustments.shift()+'~').toLowerCase().match(chgPattern)[0];
    switch (units) {
      case 'y': this.setUTCFullYear(this.getUTCFullYear()+quan); break;
      case 'mo': this.setUTCMonth(this.getUTCMonth()+quan); break;
      case 'w': this.setUTCDate(this.getUTCDate()+7*quan); break;
      case 'd': this.setUTCDate(this.getUTCDate()+quan); break;
      case 'h': this.setUTCHours(this.getUTCHours()+quan); break;
      case 'mi': this.setUTCMinutes(this.getUTCMinutes()+quan); break;
      case 's': this.setUTCSeconds(this.getUTCSeconds()+quan); break;
      case '~': // dummy pattern and ms default to milliseconds
      case 'ms':
      default: this.setUTCSeconds(this.getUTCSeconds()+quan/1000); break;
    };
  };
  return this;
}

// Difference two dates. Returns an object with several terms
// byUnit returns the absolute difference for each unit
// bySet return the running series of years, months, days, hours, minutes, and seconds.
if (!Date.prototype.diff) Date.prototype.diff = function (date) {
  var differBy = (first,last,delta)=> (a.valueOf()+delta<b.valueOf());
  var dx = {value: date.valueOf()-this.valueOf(), byUnit: {}, bySet: {} };
  dx.sign = (dx.value>0) ? 1 : (dx.value<0) ? -1 : 0;
  var newSet = date.style();
  var oldSet = this.style();
  for (var key of msPer) dx.byUnit[key] = dx.value/msPer[key];
  // create new ordered instances that can be changed ...
  var first = new Date(dx.value>0 ? this:date);
  var last = new Date(dx.value>0 ? date:this);
  dx.bySet.Y = Math.floor((last.valueOf()-first.valueOf())/msPer['Y']);
  first.change(dx.bySet.Y+' years');
  dx.bySet.M = Math.floor((last.valueOf()-first.valueOf())/msPer['M']);
  first.change(dx.bySet.M+' months');
  dx.bySet.D = Math.floor((last.valueOf()-first.valueOf())/msPer['D']);
  first.change(dx.bySet.D+' days');
  dx.bySet.h = Math.floor((last.valueOf()-first.valueOf())/msPer['h']);
  first.change(dx.bySet.h+' hrs');
  dx.bySet.m = Math.floor((last.valueOf()-first.valueOf())/msPer['m']);
  first.change(dx.bySet.m+' min');
  dx.bySet.s = (last.valueOf()-first.valueOf())/msPer['s'];
  return dx;
}

// declare strings for days of the week, months of the year, and timezones...
if (!Date.prototype.days) Date.prototype.days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
if (!Date.prototype.months) Date.prototype.months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
if (!Date.prototype.zones) Date.prototype.zones = {P:'Pacific', M:'Mountain', C:'Central', E:'Eastern', A:'Atlantic'};
if (!Date.prototype.times) Date.prototype.times = {S:'Standard', D:'Daylight', P:'Prevailing'};
if (!Date.prototype.zone) Date.prototype.zone = new Date().toString().split('(')[1].replace(/[a-z) ]/g,'').toString();
if (!Date.prototype.zoneString) Date.prototype.zoneString = [Date.prototype.zones[Date.prototype.zone[0]],Date.prototype.times[Date.prototype.zone[1]],'Time'].join(' ');

// define a function for creating formated date strings
// Date.prototype.style(<format_string>|'iso'|'form')
//  formats a date according to specified string defined by ...
//    'text':   quoted text preserved, as well as non-meta characters such as spaces
//    Y:        4 digit year, i.e. 2016
//    M:        month, i.e. 2
//    D:        day of month, i.e. 4
//    N:        day of the week, i.e. 0-6
//    SM:       long month name string, i.e. February
//    SD:       long day name string, i.e. Sunday
//    h:        hour of the day, 12 hour format, unpadded, i.e. 9
//    hh:       hour of the day, 24 hour format, padded, i.e. 09
//    m:        minutes part hour, i.e. 7
//    s:        seconds past minute, i.e. 5
//    x:        milliseconds, i.e. 234
//    a:        short meridiem flag, i.e. A or P
//    z:        short time zone, i.e. MST
//    e:        Unix epoch, seconds past midnight Jan 1, 1970
//    LY:       leap year flag, true/false (not usable in format)
//    dst:      Daylight Savings Time flag, true/false (not usable in format)
//    ofs:      Local time offset (not usable in format)
//    default - returns an object representing fields noted above
//  defined format keywords ...
//    form:               ["YYYY-MM-DD","hh:mm:ss"], needed by form inputs for date and time (always local)
//    iso:                "YYYY-MM-DD'T'hh:mm:ssZ", JavaScript standard
//  notes:
//    1. Add a leading 0 or duplicate field character to pad result as 2 character field [MDNhms], i.e. 0M or MM
//    2. Use Y or YYYY for 4 year or YY for 2 year
//    3. Second parameter (boolean) used to specify local vs UTC time (undefined).
//  examples...
//    d = new Date();      // 2016-12-07T21:22:11.262Z
//    d.style();           // { Y: 2016, M: 12, D: 7, h: 21, m: 22, s: 11, x: 262, SM: 'December', SD: 'Wednesday', a: 'PM', e: 1481145731.262, z: 'MST', N: 3, LY: true, dst: false }
//    d.style().e;         // 1481145731.262
//    d.style("MM/DD/YY"); // '12/07/16'

if (!Date.prototype.style)
  Date.prototype.style = function(frmt,local) {
    var dx = (local||frmt=='form') ? new Date(this-this.getTimezoneOffset()*60*1000) : this;
    base = dx.toISOString();
    switch (frmt||'') {
      case 'form': return base.split(/[TZ\.]/i).slice(0,2); break;  // values for form inputs, always local
      case 'iso': return (local) ? base.replace(/z/i,dx.zone) : base; break; // ISO Zulu time or localtime
      case '':  // object of date field values
        var [Y,M,D,h,m,s,ms] = base.split(/[\-:\.TZ]/);
        return {Y:+Y,M:+M,D:+D,h:+h,m:+m,s:+s,x:+ms,z:dx.zone,
          SM: this.months[M-1], SD: dx.days[dx.getDay()],a:h<12 ?"AM":"PM",
          e:this.valueOf()*0.001,z:dx.zone,N:dx.getDay(),LY: Y%4==0&&(Y%100==Y%400),
          dst: !!(new Date(1970,1,1).getTimezoneOffset()-dx.getTimezoneOffset()),
          ofs: -dx.getTimezoneOffset()}; break;
      default:
        var flags = dx.style(); flags['YYYY'] = flags.Y; flags['hh'] = flags['h']; if (flags['h']>12) flags['h'] %= 12;
        var token = /Y(?:YYY|Y)?|S[MD]|0?([MDNhms])\1?|[aexz]|"[^"]*"|'[^']*'/g;
        var pad = function(s) { return ('0'+s).slice(-2) };
        return (frmt).replace(token, function($0) { return $0 in flags ? flags[$0] : ($0.slice(1) in flags ? pad(flags[$0.slice(1)]) : $0.slice(1,$0.length-1)); });
    };
  };

  
  ///************************************************************
/// Number Object Extensions...
///************************************************************
if (Number.isOdd===undefined) Number.isOdd = (n) => n % 2 ? true : false;
if (Number.isEven===undefined) Number.isEven = (n) => !Number.isOdd(n);

///************************************************************
/// Object Extensions...
///************************************************************
// following done as non-enumerable definitions to not break "for in" loops
// make object keys iterable to work in for-of-loops like arrays
Object.prototype[Symbol.iterator] = function () {
  var keys = Object.keys(this); var index = 0;
  return { next: () => index<keys.length ? {value: keys[index++], done: false} : {done: true} };
}
if (!Object.isObj) Object.defineProperty(Object,'isObj', {
  value: (obj) => (typeof obj==='object' && !(obj instanceof Array)),
  enumerable: false
  })

// recursively mergekeys the keys of an object into an existing objects with mergekeysd object having precedence
if (!Object.mergekeys) Object.defineProperty(Object.prototype,'mergekeys', {
  value: 
    function(merged={}) {
      for (let key in merged) { 
        if (Object.isObj(merged[key]) && Object.isObj(this[key])) {
          this[key].mergekeys(merged[key]); // both objects so recursively merge keys
        }
        else {
          this[key] = merged[key];  // just replace with or insert merged keys
        };
      };
      return this; 
    },
  enumerable: false
})

// recursively serialize simple object into string of max length...
if (!Object.asString) Object.defineProperty(Object.prototype,'asString', {
  value: 
    function (max) {
      let str = this instanceof Array ? '[ ' : '{ ';
      let qs = (s) => "'" + s.replace(/'/g,"\\'") + "'";
      let qk = (k) => k.includes(' ') ? "'" + k + "'" : k;
      let is = (v,t) => typeof v==t;
      let asStr = (v) => v===null||v===undefined||is(v,'number')||is(v,'boolean') ? String(v) : (is(v,'object') ? v.asString() : (is(v,'string') ? qs(v) : '?'));
      for (let key in this) str += (this instanceof Array ? '' : qk(key) + ': ') + asStr(this[key]) + ', ';
      str = (str.endsWith(', ') ? str.slice(0,-2)+' ' : str) + (this instanceof Array ? ']' : '}');
      return (max&&str.length>max) ? str.slice(0,max-3)+'...' : str;
    },
  enumerable: false
});

// order the values of an object as defined by list or alphabetically into an array 
if (!Object.orderBy) Object.defineProperty(Object.prototype,'orderBy', {
  value: function(list) {
    var ordered = [];
    list = list || Object.keys(this).sort();
    for (let i in list) ordered.push(this[list[i]]);
    return ordered; 
  },
  enumerable: false
})

// return resolved object by following sub keys without undefined warnings
if (!Object.retrieve) Object.defineProperty(Object.prototype,'retrieve', {
  value: function (...args){ // (optional object, keys array, optional default)
    let obj = (args[0] instanceof Array) ? this : args[0];
    let keys = (args[0] instanceof Array) ? args[0] : args[1];
    let dflt = args[2] || (args[1]!==keys ? (args[1]||{}) : {});
    while (keys.length) {
      if (obj===undefined) break;
      obj = obj[keys.shift()];
      };
    return (obj===undefined) ? dflt : obj;
  },
  enumerable: false
})


///************************************************************
/// String Object Extensions...
///************************************************************
// pads a string, right or left, with a character to specified length...
// examples: 
//   'Sunday'.pad(' ',10); // returns 'Sunday    '
//   'Sunday'.pad(' ',10,true); // returns '    Sunday'
//   'Sunday'.pad(' ',3); // returns 'Sun'
if (!String.prototype.pad) 
  Object.defineProperty(String.prototype,'pad', {
    value: function(ch,len,left=false){
      let str = (left) ? this.slice(-len) : this.slice(0,len);
      let x = len - str.length;
      return x>0 ? (left ? (new Array(x).join(ch))+str : str+(new Array(x).join(ch))) : str;
    }
  })
// clone of lastIndexOf
if (!String.prototype.last)
  Object.defineProperty(String.prototype,'last', {
    value: String.prototype.lastIndexOf,
    enumerable: false
  })  
// shortcut for test of character existence
if (!String.prototype.has)
  Object.defineProperty(String.prototype,'has', {
    value: function(ch){
      return this.indexOf(ch)!==-1;
    },
    enumerable: false
  })  
// convert string to regular expression...
if (!String.prototype.toRegExp)
  Object.defineProperty(String.prototype,'toRegExp', {
    value: function(){
      let pat = this.indexOf('/')==0 ? this.slice(1,str.lastIndexOf('/')) : str;
      let flags = this.indexOf('/')==0 ? this.slice(str.lastIndexOf('/')+1) : '';
      return new RegExp(pat,flags);
    },
    enumerable: false
  })  

///*************************************************************
/// General Extensions...
///*************************************************************
// function to correctly join an array of path parts into a valid path...
if (!makePath) function makePath() { return Array.from(arguments).join('/').replace(/\/{2,}/g,'/').replace(/:\//,'://'); };

// generates an n(=8) character unique ID of base (b=36, alphanumeric) ...
if (!global.uniqueID) global.uniqueID = (n=8,b=36) => {let u=''; while(u.length<n) u+=Math.random().toString(b).substr(2,8); return u.slice(-n); };

// bounds a value between min and max or returns dflt or 0...
if (!bound) var bound = function(min,val,max,dflt) {
  val = Number(isNaN(val) ? (isNaN(dflt) ? 0 : dflt ) : val);
  if (min!==null&&!isNaN(min)) val = (val<min) ? Number(min) : val;
  if (max!==null&&!isNaN(max)) val = (val>max) ? Number(max) : val;
  return val;
};

// shortcuts for converting to/from JSON...
if (!Object.asJx) {
  Object.defineProperty(Object.prototype,'asJx', {
    value: (pretty) => JSON.stringify(this,null,pretty?2:0),
    enumerable: false
  });
  Object.defineProperty(String.prototype,'asJx', {
    value: (reviver) => {
      let str = this.slice();
      let temp = {};
      try {temp=JSON.parse(str,reviver)} catch(e) { return {err:e.toString(),code:'JX_PARSE', str:str}; };
    return temp; },
    enumerable: false
  });
};
