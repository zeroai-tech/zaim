const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto=require('node:crypto');
const ts=require('typescript');
require.extensions['.ts'] = (module,filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zaim-offline-unit-'));
process.env.ZAIM_DESKTOP='1';process.env.ZAIM_ENC_KEY=crypto.randomBytes(32).toString('hex');process.env.ZAIM_DB_PATH=path.join(dir,'vault.db');
const store=require('../lib/offline-store.ts');
(async()=>{
  const account={imap:{host:'mail.example.test',port:993,user:'owner@example.test'}};
  const scope=store.cacheScope(account,'owner');
  const value={subject:'Private fixture subject',body:'Confidential offline mail'};
  assert.equal((await store.cachedRead(scope,'message',async()=>value)).cached,false);
  const failed=()=>Promise.reject(Object.assign(new Error('network unavailable'),{code:'ECONNREFUSED'}));
  assert.deepEqual((await store.cachedRead(scope,'message',failed)).value,value);
  assert.equal((await store.cachedRead(scope,'message',failed)).cached,true);
  await assert.rejects(()=>store.cachedRead(scope,'missing',failed));
  await assert.rejects(()=>store.cachedRead(scope,'message',()=>Promise.reject(Object.assign(new Error('Invalid password'),{authenticationFailed:true}))));
  assert.equal(store.readLocal(store.cacheScope({...account,imap:{...account.imap,user:'other@example.test'}},'owner'),'message'),null);
  assert.equal(store.readLocal(store.cacheScope(account,'other-owner'),'message'),null);
  const draft=store.saveLocalDraft(scope,{to:'review@example.test',subject:'Local only',html:'Draft body',attachments:[{filename:'note.txt',content:Buffer.from('attachment data').toString('base64')}]});
  store.saveLocalDraft(scope,{...draft,subject:'Updated draft'});
  assert.equal(store.localDrafts(scope).length,1);assert.equal(store.localDrafts(scope)[0].subject,'Updated draft');
  const files=fs.readdirSync(path.join(dir,'offline-mail'));for(const file of files){const data=fs.readFileSync(path.join(dir,'offline-mail',file),'utf8');assert(data.startsWith('enc:'));assert(!data.includes('Private fixture'));assert(!data.includes('Draft body'));if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'offline-mail',file)).mode&0o777,0o600);}
  const previous=store.mailCacheKey(scope,'INBOX','message:101');store.folderGeneration(scope,'INBOX','10');store.writeLocal(scope,previous(),value);store.folderGeneration(scope,'INBOX','11');assert.equal(store.readLocal(scope,previous()),null);
  store.deleteLocalDraft(scope,draft.id);assert.equal(store.localDrafts(scope).length,0);
  process.env.ZAIM_DESKTOP='0';assert.equal(store.readLocal(scope,'message'),null);
  console.log('PASS: encrypted durable cache, account/owner isolation, outage fallback, authentication rejection, UID validity changes, draft update/delete, desktop-only storage.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
