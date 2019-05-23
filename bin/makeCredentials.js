// node script to create bcrpyt has from a username and password...

const bcrypt = require('bcryptjs');
const readline = require('readline');

const rd = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(prompt) {
  return new Promise((resolve,reject)=>{rd.question(prompt,(answer)=> resolve(answer))})
};

ask('Enter the username: ').then(user=> {
ask('Enter the password: ').then(pw=> {
var bhash = bcrypt.hashSync(pw, 11);
var check = bcrypt.compareSync(pw,bhash);
console.log({user: user, pw: pw, bhash:bhash});
rd.close();
}).catch(e=>console.log("error:",e))}).catch(e=>console.log("error:",e));
