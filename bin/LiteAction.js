/* 
LiteAction.js - Middleware for performing specific internal and request actions
Copyright (c) 2020 Enchanted Engineering, MIT License

This module supports "complex" actions that require dedicated code, vs stanardized data retrieval methods.
Assumes parameter based express routing: '/([@]):action(\\w+)/:opt1?/:opt2?/:opt3?'
  that defines a "/" followed by a "@" (action) character, followed by a required  "action" (recipe)keyword, 
  and may include additional optional params.

  Action fields
    grant:    Sends login credentials to user           GET /@grant?user=user1,user2,...&exp=1440&mail=true
    scribe:   Dynamically get/set scribe mask level     GET /@scribe?level=<mask>&parent=<true|false>
    stats:    Returns server statistics as JSON object  GET /@stats/<tag>/<key>
    mail:     Sends an email to 1 or more users         POST /@mail, body contains message, recipients, ...
    reload:   Reload a specific database                POST /@reload/<db>
    renew:    Requests reload of security certificates  POST /@renew
    text:     Sends text message to 1 or more users     POST /@text, body contains text, recipients, ...
*/

// load dependencies...
require('./Extensions2JS');
crypto = require('crypto');

exports = module.exports = LiteAction = function LiteAction(options) {
  // this function called by express app to initialize middleware...
  var cfg = options;
  var site = this;          // local reference for context
  var scribe = site.scribe; // local reference
  scribe.info("Middleware '%s' initialized with route: %s", options.code, options.route);

  // this function called by express app for each page request...
  return function actionMiddleware(rqst, rply, next) {
    // first lookup recipe based on parameter provided
    let action = (rqst.params.action||'').toLowerCase();
    let args = ({}).mergekeys(rqst.query).mergekeys(rqst.params);
    let admin = rqst.hb.auth.authorize(['admin']);
    scribe.trace("ACTION[%s]: %s", rqst.method, action);
    if (rqst.method=='GET') {
      switch (action) {
        case 'grant':
          if (!rqst.hb.auth.authorize(['admin','grant'])) return next(401);
          let user = (args.user || args.opt1 || '').split(',');
          let exp = ((e)=>e>10080 ? 10080 : e)(args.exp || args.opt2 || 10); // limited expiration in min
          let byMail = args.mail || args.opt2;
          let ft = (t,u)=>{return u=='d' ? (t>7?7:t)+' days' : u=='h' ? (t>24?ft(t/24,'d'):t+' hrs') : t>60? ft(t/60,'h') : t+' mins'};
          let expStr = ft(exp);
          Promise.all(user.map(u=>{
            let code = site.generateCode('login',u,exp*60);
            if (!code) return u;
            let msg =`${rqst.hb.auth.username} has granted access to...\n  user: ${u}\n  password: ${code.code}\n  valid: ${expStr}`;
            return byMail ? site.sendMail({time:true,text:msg}) : site.sendText({time:true,text:msg});
            }))
            .then(x=>{
              let good = x.map((p,i)=>typeof p=='object'?user[i]:undefined).filter(v=>v).join(',');
              scribe.info(`Action[grant]: Login code sent by ${byMail?'mail':'text'} to ${good}`);
              rply.json({msg:`Login code sent by ${byMail?'mail':'text'} to ${good}`});
            })
            .catch(e=>{
              scribe.error('Action[grant]: Granting permission failed =>',e.toString());
              next(500); });
          break;
        case 'scribe':
            if (!rqst.hb.auth.authorize(['admin','scribe'])) return next(401);
            let mask = scribe.maskLevel(args.level||args.opt1);
            rply.json({msg: `Scribe mask: ${mask}`});
          break;
        case 'stats':     // return server statistics
          if (!rqst.hb.auth.authorize(['admin','stats'])) return next(401);
            rply.json(scribe.Stat.get(args.opt1,args.opt2));
          break;
        default:
          rply.json(site.server.emsg(400,`Unknown action[${rqst.method}]: ${action}!`));
      };
    } else if (rqst.method=='POST') {
      switch (action) {
        case 'mail':      // send email from server
          if (!rqst.hb.auth.authorize(['admin','email'])) return next(401);
          site.sendMail(rqst.body||{})
            .then(data =>{
              let note = `Action[mail]: ${data.mail.subject} => ${data.mail.to.replace(/,.*/,', ...')}`;
              self.scribe.info(note);
              rply.json(admin ? data : note); })
            .catch(err=>{
              scribe.error("Action[mail]: ERROR: %s", JSON.stringify(err)); 
              rply.json(err)});
          break;
        case 'reload':     // this function reloads a specified database.
          if (!rqst.hb.auth.authorize(['admin','reload'])) return next(401);
          let db = args.opt1 || ''
          if (db in site.db) {
            site.db[db].load()
              .then(x=>rply.json({msg: `Reload ${db} successful!`}))
              .catch(e=>rply.json(site.server.emsg(500,e.toString())));
          } else {
            rply.json(site.server.emsg(400,'No such database'));
          };
          break;
        case 'renew':     // this function tells the proxy to reload local security files per an renewal request.
          if (!rqst.hb.auth.authorize(['admin','renew'])) return next(401);
          site.proxy().loadSecrets()  // proxy callback to reload certificate and key files
            .then(exp=>rply.json({msg: "Certificate renewal request made.", expires: exp}))
            .catch(e=>rply.json(site.server.emsg(500,e.toString())));
          break;
        case 'text':      // send a text message from server
          if (!rqst.hb.auth.authorize(['admin','text'])) return next(401);
          site.sendText(rqst.body)
            .then(data =>{
              scribe.debug(data.rpt);
              rply.json(admin ? data : data.rpt); })
            .catch(err=>{
              scribe.error("Action[text] ERROR: %s", JSON.stringify(err)); 
              rply.json(err)});
          break;
        default:
          rply.json(site.server.emsg(400,`Unknown action[${rqst.method}]: ${action}!`));
      };
    } else {
      next(501);
    };
  };

};
