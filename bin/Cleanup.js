// Handles graceful application specific cleanup to avoid hung servers...

var cleanup = {
  callback: null, // define a default callback reference overridden by app...
  called: false,  // flag to prevent circular calls.
  delay: 400,     // wait time to call process exit...
  gracefulExit: function (code) {
    if (!this.called) {
      this.called = true;
      if (this.callback) this.callback();   // app specific cleanup
      code = (code!==undefined) ? code : 1; // assume non-zero (i.e. error)
      console.log("Graceful exit cleanup... code:",code);
      setTimeout(()=>{process.exit(code);},this.delay);  // no stopping!
    };
  }
};

// trap ctrl+c event and exit calls, then exit gracefully...
process.on('beforeExit',(code)=>{cleanup.gracefulExit(code)});
process.on('exit',(code)=>{cleanup.gracefulExit(code)});
process.on('SIGINT',()=>cleanup.gracefulExit(2));
process.on('uncaughtException',(e)=> {  //catch otherwise uncaught exceptions, provide traceback
  console.log('Uncaught Exception...');
  console.log(e.stack);
  cleanup.gracefulExit(99);
});

module.exports = init = function init(cb=null) {
  cleanup.callback = cb;
  return cleanup;
  };
