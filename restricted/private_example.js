// this variable holds private data separate from config.js to make it easier to sanitize files shared to Github, etc

// const secure = require('./private.js');

var secure = {
  contact: {                              // site contact information
    name: "**** ********", 
    email: "***@*************.***", 
    phone: '0000000000',
    provider: '*******',
    admin: "???-AT-?????????????-DOT-???" // obfuscated email address for open posting
    },
  smtp: {                                 // SMTP server credentials passed to emailjs
    host: '****.****.***',
    port: 465,
    ssl: true,
    user: '******@*************.***',
    password: '**********'
    }
  };

// export as a JavaScript object, to import with require in config.json
exports = module.exports = secure;
