/*
 Personal JavaScript language extensions...
 (c) 2020 Enchanted Engineering, MIT license
*/


///*************************************************************
/// Array Object Extensions...
///*************************************************************
// function to create and populate an array of given size and values, note value can even be a function
if (!Array.makeArrayOf) Array.makeArrayOf = (size,value) => Array(size).fill().map((v,i,a)=>(typeof value=='function') ? value(v,i,a) : value);

///*************************************************************
/// Date Object Extensions...
///*************************************************************
// define a function for creating formated date strings
// Date.prototype.style(<format_string>|'iso'|'form'[,'local'|'utc'])
// formats a date according to specified string defined by ...
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
// local flag signifies a conversion from UTC to local OR local to UTC; 
//  'local':    treats input as UTC time and adjusts to local time before styling (default)
//  'utc':      treats input as local time and adjusts to UTC before styling
if (!Date.prototype.style) Date.prototype.style = function(frmt,local) {
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let sign = String(local).toLowerCase()=='utc' ? -1 : 1;
  let dx = local ? new Date(this-sign*this.getTimezoneOffset()*60*1000) : this;
  let zone = dx.toString().split('(')[1].replace(')','');
  let zx = zone.replace(/[a-z ]/g,'');
  base = dx.toISOString();
  switch (frmt||'') {
    case 'form': return this.style('YYYY-MM-DD hh:mm','local').split(' '); break;  // values for form inputs, always local [YYYY-MM-DD, hh:mm]
    case 'iso': return (local && sign==1) ? base.replace(/z/i,zx) : base; break; // ISO Zulu time or localtime
    case '':  // object of date field values
      let [Y,M,D,h,m,s,ms] = base.split(/[\-:\.TZ]/);
      return {Y:+Y, M:+M, D:+D, h:+h, m:+m, s:+s, x:+ms, z:zx,
        SZ:zone, SM: months[M-1], SD: days[dx.getDay()], a:h<12 ?"AM":"PM",
        e:dx.valueOf()*0.001, N:dx.getDay(), LY: Y%4==0&&(Y%100==Y%400),
        dst: !!(new Date(1970,1,1).getTimezoneOffset()-dx.getTimezoneOffset()),
        ofs: -dx.getTimezoneOffset()}; break;
    default:
      const token = /Y(?:YYY|Y)?|S[MDZ]|0?([MDNhms])\1?|[aexz]|"[^"]*"|'[^']*'/g;
      const pad = function(s) { return ('0'+s).slice(-2) };
      let flags = dx.style(); flags['YYYY'] = flags.Y; flags['hh'] = ('0'+flags['h']).substr(-2); if (flags['h']>12) flags['h'] %= 12;
      return (frmt).replace(token, function($0) { return $0 in flags ? flags[$0] : ($0.slice(1) in flags ? pad(flags[$0.slice(1)]) : $0.slice(1,$0.length-1)); });
  };
};

  
///*************************************************************
/// Number Object Extensions...
///*************************************************************
if (Number.isOdd===undefined) Number.isOdd = (n) => n % 2 ? true : false;
if (Number.isEven===undefined) Number.isEven = (n) => !Number.isOdd(n);


///*************************************************************
/// Object Extensions...
///*************************************************************
// object equivalent of Array.prototype.map - calls user function with value, key, and source object
if (!Object.mapByKey) Object.defineProperty(Object.prototype,'mapByKey', {
  value: 
    function(f) {
      let obj = this;
      let tmp = {};
      for (let key in obj) tmp[key] = f(obj[key],key,obj);
      return tmp;
    },
  enumerable: false
})

// recursively merge keys of an object into an existing object with merged object having precedence
if (!Object.mergekeys) Object.defineProperty(Object.prototype,'mergekeys', {
  value: 
    function(merged={}) {
      const isObj = (obj) => (obj!==null) && (typeof obj==='object');
      if (isObj(merged)) {
        for (let key in merged) {
          if (isObj(merged[key])) {
            this[key] = this.key || (merged[key] instanceof Array ? [] : {}); // initialize object to prevent referencing
            this[key].mergekeys(merged[key]); // object so recursively merge keys
          } else {
            this[key] = merged[key];          // just replace with or insert merged key, even if null
          };
        };
      };
      return this; 
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
if (!String.prototype.pad) Object.defineProperty(String.prototype,'pad', {
  value: function(ch,len,left){ return left ? (Array(len).join(ch)+this.slice()).slice(-len) : (this.slice()+Array(len).join(ch)).substr(0,len); }
})

// string to regular expression...
if (!String.prototype.toRegExp) Object.defineProperty(String.prototype,'toRegExp', {
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
let path = require('path');
if (!global.resolveURL) global.resolveURL =  (...args)=>args.join('/').replace(/\/{2,}/g,'/').replace(/:\//,'://');
if (!global.resolvePath) global.resolvePath = (...args)=>path.resolve(args.join('/'));

// generates an n(=8) character unique ID of base (b=36, alphanumeric) ...
if (!global.uniqueID) global.uniqueID = (n=8,b=36) => {let u=''; while(u.length<n) u+=Math.random().toString(b).substr(2,8); return u.slice(-n); };

// function to determine a number of complex variable types...
if (!global.verifyThat) global.verifyThat = (variable,isType) => {
  switch (isType) {
    case 'isTrueObject': return (typeof variable=='object') && (variable!==null)  && !(variable instanceof Array);
    case 'isArray': return (variable instanceof Array);
    case 'isArrayOfTrueObjects': return (variable instanceof Array) && verifyThat(variable[0],'isTrueObject');
    case 'isArrayOfAnyObjects': return (variable instanceof Array) && (typeof variable[0]==='object');
    case 'isArrayOfArrays': return (variable instanceof Array) && (variable[0] instanceof Array);
    case 'isEmptyObject': return Object.keys(variable).length==0;
    case 'isScalar': return (typeof variable=='string') || (typeof variable=='number');
    case 'isNotEmpty': return (typeof variable=='object') && (variable!==null) && (Object.keys(variable).length>0);
    case 'isDefined' : return (variable!==undefined) && (variable!==null);
    case 'isNotDefined' : return (variable===undefined) || (variable===null);
    default: throw `verifyThat: Unknown type '${isType}' specified`;
  };
};

// shortcuts for converting to/from JSON...
if (!Object.asJx) {
  Object.defineProperty(Object.prototype,'asJx', {
    value: (pretty) => JSON.stringify(this,null,pretty?2:0),
    enumerable: false
  });
  Object.defineProperty(String.prototype,'asJx', {
    value: (dflt, reviver) => { try { return JSON.parse(this.slice(),reviver); } catch(e) { return dflt } },
    enumerable: false
  });
};

// convert undefined, comma delimited string or array to an array...
if (!global.asList) global.asList = x => x instanceof Array ? x : (x||'').split(',');

// shortcut for debug output...
if (!global.$) global.$ = (...args) => console.log.apply(this,args);
// function for timing tasks... no arg: return start; start argument: return difference in seconds.
if (!global.markTime) global.markTime = (since) => since ? (new Date().valueOf()-since)/1000 : new Date().valueOf();
