// Handles graceful application specific cleanup to avoid hung servers...

var cleanup = {
  callback: ()=>console.log("Graceful exit ..."), // default callback
  called: false,  // flag to prevent circular calls.
  delay: 400,  
  gracefulExit: function (code=1) { // graceful exit call...
    if (!this.called) {
      this.called = true;
      this.callback();  // do app specific cleaning once before exiting
      setTimeout(process.exit,this.delay,code);  // no stopping!
    };
  }
};

// catch clean exit ...
process.on('beforeExit', function () { cleanup.gracefulExit(0); });

// catch ctrl+c event and exit gracefully
process.on('SIGINT', function () { cleanup.gracefulExit(2); });

//catch uncaught exceptions, trace, then exit gracefully...
process.on('uncaughtException', 
  function(e) {
    console.log('Uncaught Exception...');
    console.log(e.stack);
    cleanup.gracefulExit(99);
  }
);

module.exports = init = (cb)=>{cleanup.callback=cb||null; return cleanup;};
