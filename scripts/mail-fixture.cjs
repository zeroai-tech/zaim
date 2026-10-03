// Test-only transport replacement. Loaded explicitly by the verification script.
const Module = require('node:module'); const fs = require('node:fs');
const original = Module._load;
const controlFile = process.env.ZAIM_TEST_CONTROL;
if (!controlFile) throw new Error('Mail fixture requires an isolated control file.');
const state = () => JSON.parse(fs.readFileSync(controlFile, 'utf8'));
const update = (fn) => { const next = state(); fn(next); fs.writeFileSync(controlFile, JSON.stringify(next)); };
const samples = [
  { uid: 101, subject: 'Project kickoff — next steps', from: 'alex@example.test', name: 'Alex Morgan', text: 'Thanks for the discussion. Here is the project brief for review.' },
  { uid: 102, subject: 'Your workspace is ready', from: 'team@example.test', name: 'Product team', text: 'Your workspace is ready. Sign in to begin.' },
  { uid: 103, subject: 'Design review / Friday', from: 'sam@example.test', name: 'Sam Chen', text: 'Can we review the updated designs on Friday?' },
];
const mime = message => Buffer.from(`From: ${message.name} <${message.from}>\r\nTo: demo@example.test\r\nSubject: ${message.subject}\r\nDate: Fri, 02 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="zaim-test"\r\n\r\n--zaim-test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}\r\n--zaim-test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="brief.txt"\r\n\r\nIsolated fixture attachment\r\n--zaim-test--`);
class FakeImap {
  constructor(options) { this.options=options; this.mailbox={exists:3,uidValidity:1n}; }
  on(){return this;}
  async connect(){ update(s => { s.connections = [...(s.connections || []), {host:this.options.host,user:this.options.auth.user}]; }); const s=state(); if(s.authFailure)throw Object.assign(new Error('Authentication failed'),{authenticationFailed:true});if(!s.online)throw Object.assign(new Error('connect ECONNREFUSED'),{code:'ECONNREFUSED'});this.mailbox.uidValidity=BigInt(s.generation||1); }
  async logout(){}
  async getMailboxLock(path){this.path=path;return{release(){}};}
  async list(){return[{path:'INBOX',name:'Inbox'},{path:'Sent',name:'Sent',specialUse:'\\Sent'},{path:'Drafts',name:'Drafts',specialUse:'\\Drafts'},{path:'Trash',name:'Trash',specialUse:'\\Trash'}];}
  async *fetch(){for(const message of samples)yield{uid:message.uid,envelope:{subject:message.subject,from:[{address:message.from,name:message.name}],to:[{address:'demo@example.test'}],date:new Date('2026-10-02T10:00:00Z')},flags:new Set(state().seen?.includes(message.uid)?['\\Seen']:[])};}
  async fetchOne(uid){const message=samples.find(m=>m.uid===Number(uid));return message?{uid:message.uid,source:mime(message)}:false;}
  async search(){return[101];}
  async messageFlagsAdd(input){update(s=>{s.seen=[...(s.seen||[]),Number(input.uid)]});}
  async append(){update(s=>s.appended=(s.appended||0)+1);}
  async messageMove(){}
  async messageDelete(){}
}
Module._load = function(request,parent,isMain){
  if(request==='imapflow')return{ImapFlow:FakeImap};
  if(request==='nodemailer'){const real=original.call(this,request,parent,isMain);return{...real,createTransport(){return{async verify(){if(!state().online)throw new Error('SMTP offline');return true;},async sendMail(input){if(!state().online)throw Object.assign(new Error('SMTP offline'),{code:'ECONNREFUSED'});update(s=>{s.sent=(s.sent||0)+1;s.lastTo=input.envelope.to;s.lastRaw=Buffer.from(input.raw).toString('base64')});return{messageId:'fixture-message-id'};}};}};}
  return original.call(this,request,parent,isMain);
};
