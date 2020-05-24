// example configuration file with explanation of fields.

// to convert to JSON, if desired, perform the following in a node shell...
// var cfg = require("./config");
// var fs = require('fs');
// fs.writeFileSync("config.json",JSON.stringify(cfg,null,2));

// this variable holds private data separate from cfg to make it easier to sanitize files posted to Github, etc
var secure = require('./private.js');

var cfg = {
  info: {       // info holds descriptive information for the server
    copyright: "(C)2016,2017,2018 by Enchanted Engineering, Tijeras NM.",
    description: "HomebrewLite multi-domain web hosting service.",
    contact: secure.contact
    },
/*  command: {   // internal server options
    port: 8081,
    tag: 'cmd'
    },
  env: {        // defines any system environment variables passed to server elements
    NODE_ENV: 'development' // default to 'development' mode or 'production'
    },*/
  headers: {    // defines global headers passed to all server backends
    // "x-powered-by" header defined internally, may be overridden here
    admin: secure.contact.admin
    },
  proxies: {    // reverse proxy services
    http: {
      active: true,
      port:8080,
      options: {
        ws: true,
        hostnameOnly: true,
        xfwd: true
        },
      report: {
        ignore:['192.168.0','127.0.0'],
        },
      sites:['acme'] // sites served by this proxy
      },
    https: {
      active: true,
      port:8443,
      options: {
        ws: true,
        hostnameOnly: true,
        xfwd: true
        },
      report: {
        ignore:['192.168.0','127.0.0'],
        },
      secure: { 
        files: {// secure sockets files
          key: '/home/js/restricted/privkey.pem',
          cert: '/home/js/restricted/fullchain.pem'
          }
        },
      sites:['shop','sc','talk','eyes','red']
      }
    },
/*  databases: {  // shared databases available to all backends
    users: {file: '../restricted/users.sq3',log:'../logs/users.log',verbose:true},
    site: {file: '../restricted/sites.sq3',log:'../logs/sites.log'}
    },*/
  scribe: {     // top level transcript parameters, inherited by apps
    tag: 'BREW',
    mask: 'trace',
    transcript: { 
      file: '../logs/hblite.log', 
      bsize: 10000,
      fsize: 100000
      }  
    },
/*  shared: {     // server level services passed to site apps
    notify: {
      require: './Notification',
      options: {
        email: {
          smtp: secure.smtp,
          defaults: {
            to: secure.contact.email,
            from: secure.contact.email,
            subject: 'Talking Coyotes Webserver Notification...',
            text: 'No info provided'
            }
          },
        esms: {
          gateways: {
            'AllTel': '%s@message.alltel.com',
            'ATT&T': '%s@txt.att.net',
            'Boost': '%s@myboostmobile.com',
            'Cricket': '%s@sms.mycricket.com',
            'Nextel': '%s@messaging.nextel.com',
            'Sprint': '%s@messaging.sprintpcs.com',
            'T-Mobile': '%s@tmomail.net',
            'Verizon': '%s@vtext.com',
            'Qwest': '%s@qwestmp.com',
            'Tracfone': '%s@mmst5.tracfone.com',
            'USCellular': '%s@email.uscc.net',
            'Virgin': '%s@vmobl.com'
            },
          defaults: {
            to: secure.contact.phone,
            provider: secure.contact.provider,
            text: '?'
            }
          },
        scribe: {
          tag: 'notify'
          }
        },
      init: {
        //sendText: {text: 'Homebrew Server initialization...',time: true}
        }
      }
    },*/
  sites: {      // sites served, each follows the same structure
    acme: {     // http://localhost:8079 Let's Encrypt / Certbot service and redirection
      active: true,
      app:  {
        require: './hbBaseApp', // passed full site + some server (top level) configuration 
        options: {  // used by hbBaseApp 
          compression: true,
          redirect: true  // redirect not found to secure host equivalent
          },
        init: {
          start: 'undefined',
          }
        },
      aliases: [
        'sedillocanyon.net','*.sedillocanyon.net',
        'talkingcoyotes.net','*.talkingcoyotes.net'
        ],
      handlers: [
        { tag: 'static',  // Let's encrypt file serving (without using hidden folder)
          root: '/home/js/sites/acme',   // place certbot files in site 'acme'
          route: ''  // only handles requests to this path
          }
        ],
      headers: {
        site: 'Acme Server'
        },
      host: 'http://localhost',
      name: 'Acme Challenge Server',
      port: 8079,
      root: '/home/js/sites/acme',
      x: { // options for Express app of hbBaseApp
        locals: {
          homebrew: {name: 'Acme Challenge Server'}
          },
        settings: {
          'trust proxy': true
          }
        }
      },
    shop: {
      active: true,
      app:  {
        require: './hbBaseApp.js',
        options: {
          'trust proxy': true,
          compression: true,
          json: true,
          url: {extended: true},
          auth: {database: 'users'}
          },
        init: {
          start: true,
          }
        },
      aliases: ['shop.sedillocanyon.net'],
      handlers: [
        { tag: 'data',
          route:'/([$]):recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?',
          require: './data',
          options: {
            database: {file:"../restricted/shop.sq3",log:"../logs/shop.log"}
            }
          },
        { tag: 'static',                // 'static' tag without "require" will load express.static
          root: '/home/js/sites/shop',  // defines static content folder; route '' will set to site root
          route: ''
          }
        ],
      headers: {
        site: 'Saranam Shopping Network'
        },
      host: 'http://localhost',
      name: 'Saranam Shopping Network',
      port: 8076,
      root: '/home/js/sites/shop',
      x: { // options for Express app of hbBaseApp
        locals: {
          homebrew: {name: 'Sedillo Canyon Server'}
          },
        settings: {
          'trust proxy': true
          }
        }
      },
    eyes: {     // http://192.168.0.9:80
      active: true,
      aliases: ['eyes.sedillocanyon.net'],
      headers: {site: 'Home Camera Network'},
      host: 'http://192.168.0.9',
      name: 'Home Canyon Camera Network',
      port: 80
      },
    red: {
      active: true,
      aliases: ['red.sedillocanyon.net'],
      headers: {site: 'Home Iot Node-red Network'},
      host: 'http://localhost',
      name: 'Home Iot Node-red Network',
      port: 1880,
      },
    sc: {       // http://localhost:8077
      active: true,
      app:  {
        require: './hbBaseApp', // passed full site + some server (top level) configuration 
        options: {  // used by hbBaseApp 
          compression: true,
          json: true,
          url: {extended: true},
          auth: {database: 'users'}
          },
        init: {
          start: true,
          //test: true
          }
        },
      aliases: ['sedillocanyon.net', 'www.sedillocanyon.net'],
      contact: secure.contact.admin,
      databases: {
        site: {file:'../restricted/sc.sq3', log:'../logs/sc.log'}
        },
      handlers: [
        { tag: 'utility', 
          method: 'use',
          route: '/:action(echo|info|iot|ip|msg)/:msg([\\w\\s%]+)?',
          require: './utility',
          options: {
            diagnostics: true,
            headers: {
              iot: true,
              ip: true
              }
            }
          },
        { tag: 'data',
          route:'/([$]):recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?',
          require: './data',
          options: {
            database: 'site'
            }
          },
        { tag: 'static',  // 'static' tag without "require" will load express.static
          root: '/home/js/sites/sc',  // defines static content folder; '' will set to site root
          route: ''
          }
        ],
      headers: {
        site: 'Sedillo Canyon Network'
        },
      host: 'http://localhost',
      name: 'Sedillo Canyon Network',
      port: 8077,
      root: '/home/js/sites/sc',
      x: { // options for Express app of hbBaseApp
        locals: {
          homebrew: {name: 'Sedillo Canyon Server'}
          },
        settings: {
          'trust proxy': true
          }
        }
      },
    talk: {     // http://localhost:8078
      active: true,
      app:  {
        require: './hbBaseApp', // passed full site + some server (top level) configuration 
        options: {  // used by hbBaseApp 
          'trust proxy': true,
          compression: true,
          cookies: true,
          json: true,
          url: {extended: true},
          auth: {database: 'users'}
          },
        init: {
          start: 'undefined',
          //test: true
          }
        },
      aliases: ['talk', 'talkingcoyotes.net', '*.talkingcoyotes.net'],
      contact: secure.contact.admin,
      databases: {
        site: {file:"../restricted/tc.sq3",log:'../logs/tc.log'}
        },
      handlers: [
        { tag: 'utility', 
          method: 'use',
          route: '/:action(echo|info|iot|ip|msg)/:msg([\\w\\s%]+)?',
          require: './utility',
          options: {
            diagnostics: true,
            headers: {
              iot: true,
              ip: true
              }
            }
          },
        { tag: 'data',
          route:'/([$]):recipe(\\w+)/:opt1?/:opt2?/:opt3?/:opt4?/:opt5?',
          require: './data',
          options: {
            database: 'site'
            }
          },
        { tag: 'static',  // 'static' tag without "require" will load express.static
          root: 'html'  // defines static content folder; '' will set to site root
          }
        ],
      headers: {
        site: 'Talking Coyotes Network'
        },
      host: 'http://localhost',
      name: 'Talking Coyotes Network',
      port: 8078,
      root: '/home/js/sites/tc',
      x: { // options for Express app of hbBaseApp
        locals: {
          homebrew: {name: 'Talking Coyotes Server'}
          },
        settings: {
          'trust proxy': true
          }
        }
      }
    }
  };

// export as a JSON object, same as if read from config.json
exports = module.exports = cfg;
