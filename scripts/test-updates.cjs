const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { MacUpdater, checksum, validateManifest } = require('../electron/mac-updater.cjs')
const { setupUpdates } = require('../electron/updates.cjs')
const { buildVersion } = require('./version-build.cjs')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
process.env.ZAIM_DISABLE_UPDATE_CHECKS = '1'
function manifest(data, arch = process.arch) {
  const url = `https://github.com/zeroai-tech/zaim/releases/download/v0.3.2/Zaim-0.3.2-mac-${arch}.zip`
  return { version: '0.3.2', arch, url, blockmap: url + '.blockmap', size: data.length, sha512: crypto.createHash('sha512').update(data).digest('base64') }
}
async function waitFor(fn) { for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timed out') }
async function testHelper(root, rollback) {
  const dir = path.join(root, rollback ? 'rollback' : 'replace'); await fs.mkdir(dir)
  const profile = path.join(dir, 'updates'); await fs.mkdir(profile)
  const health = path.join(dir, 'health.cjs'), pidFile = path.join(dir, 'pid')
  await fs.writeFile(health, `const http=require('node:http'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));const s=http.createServer((q,r)=>r.end(JSON.stringify({version:process.argv[2]}))).listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(path.join(dir,'port'))},String(s.address().port)));process.on('SIGTERM',()=>s.close(()=>process.exit()));`)
  // A fixture uses a fixed chosen free port during replacement.
  const http = require('node:http'), socket = http.createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening'); const port=socket.address().port; await new Promise(r=>socket.close(r))
  await fs.writeFile(health,(await fs.readFile(health,'utf8')).replace("listen(0,'127.0.0.1'",`listen(${port},'127.0.0.1'`))
  const app = path.join(dir, 'Zaim.app'), stage=path.join(dir,'stage'), replacement=path.join(stage,'Zaim.app'), backup=path.join(dir,'Zaim.previous')
  for(const [location,version] of [[app,'0.3.1'],[replacement,'0.3.2']]){
    await fs.mkdir(path.join(location,'Contents','MacOS'),{recursive:true})
    const command=rollback && version==='0.3.2' ? '#!/bin/sh\nexit 42\n' : `#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${health.replaceAll("'","'\\''")}' '${version}'\n`
    await fs.writeFile(path.join(location,'Contents','MacOS','Zaim'),command,{mode:0o755})
    await fs.writeFile(path.join(location,'version'),version)
  }
  const privateData = path.join(dir,'mail-and-draft.fixture');await fs.writeFile(privateData,'private data must survive')
  await fs.writeFile(path.join(profile,'pending.zip'),'verified update fixture');await fs.writeFile(path.join(profile,'pending.json'),'{}')
  const old=spawn(path.join(app,'Contents','MacOS','Zaim'),[],{stdio:'ignore'})
  let helper
  try{
    await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${port}`)).ok}catch{return false}})
    helper=spawn('/bin/sh',[path.resolve(__dirname,'../electron/apply-mac-update.sh'),String(old.pid),app,replacement,backup,profile,'0.3.2',String(port),path.join(dir,'install.log'),stage],{env:{...process.env,ZAIM_UPDATE_WAIT_LIMIT:'8'},stdio:'ignore'})
    const exit=once(helper,'exit');old.kill();await once(old,'exit');const [code]=await exit;assert.equal(code,rollback?1:0)
    assert.equal(await fs.readFile(path.join(app,'version'),'utf8'),rollback?'0.3.1':'0.3.2')
    assert.equal(await fs.readFile(privateData,'utf8'),'private data must survive')
    await assert.rejects(fs.stat(backup))
    if(!rollback){assert.equal(await fs.readFile(path.join(profile,'installed.zip'),'utf8'),'verified update fixture');await assert.rejects(fs.stat(path.join(profile,'pending.json')))}
  } finally {
    if(old.exitCode===null)old.kill()
    if(helper && helper.exitCode===null)helper.kill()
    try{const pid=Number(await fs.readFile(pidFile,'utf8'));if(pid)process.kill(pid,'SIGTERM')}catch{}
  }
}
;(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zaim-update-tests-'))
  try{
    assert.equal(buildVersion('0.3.0','8'),'0.3.8');assert.equal(buildVersion('0.3.0','9'),'0.3.9');assert.throws(()=>buildVersion('0.3.0','oops'))
    const data=Buffer.from('isolated update payload'), metadata=manifest(data)
    assert.equal(validateManifest(metadata,process.arch).version,'0.3.2')
    assert.throws(()=>validateManifest({...metadata,url:'https://evil.test/app.zip'},process.arch));assert.throws(()=>validateManifest({...metadata,arch:'other'},process.arch));assert.throws(()=>validateManifest({...metadata,size:-1},process.arch))
    let requests=0, errors=[]
    const updater=new MacUpdater({version:'0.3.1',arch:process.arch,directory:path.join(root,'download'),fetcher:async url=>{requests++;return url.includes('.json')?new Response(JSON.stringify(metadata)):url.endsWith('.blockmap')?new Response('',{status:404}):new Response(data)}})
    updater.on('error',error=>errors.push(error));let available=0,ready=0;updater.on('update-available',()=>available++);updater.on('update-downloaded',()=>ready++)
    await updater.checkForUpdates();assert.equal(available,1);assert.equal(requests,1,'Checking should not download');await updater.downloadUpdate();assert.equal(ready,1);assert.equal(await checksum(path.join(root,'download','pending.zip')),metadata.sha512);assert.deepEqual(errors,[])
    const restarted=new MacUpdater({version:'0.3.1',arch:process.arch,directory:path.join(root,'download'),fetcher:async()=>new Response(JSON.stringify(metadata))});restarted.on('error',error=>{throw error});let recovered=false;restarted.on('update-downloaded',()=>recovered=true);await restarted.checkForUpdates();assert.equal(recovered,true,'Downloaded update should survive app restart')
    const corrupt=new MacUpdater({version:'0.3.1',arch:process.arch,directory:path.join(root,'corrupt'),fetcher:async url=>url.includes('.json')?new Response(JSON.stringify(metadata)):new Response(Buffer.from('wrong payload'))});let rejected=false;corrupt.on('error',()=>rejected=true);await corrupt.checkForUpdates();await corrupt.downloadUpdate();assert.equal(rejected,true);await assert.rejects(fs.stat(path.join(root,'corrupt','pending.zip')))
    const downgrade=new MacUpdater({version:'0.3.3',arch:process.arch,directory:path.join(root,'downgrade'),fetcher:async()=>new Response(JSON.stringify(metadata))});downgrade.on('error',error=>{throw error});let current=false;downgrade.on('update-not-available',()=>current=true);await downgrade.checkForUpdates();assert.equal(current,true)
    const handlers={}, frame={url:'http://127.0.0.1:4199/'}, sent=[];let installed=0, stopped=0, quitting=0
    const transport=new EventEmitter();transport.checkForUpdates=async()=>{transport.emit('checking-for-update');transport.emit('update-available',{version:'0.3.2'})};transport.downloadUpdate=async()=>{transport.emit('download-progress',{percent:50});transport.emit('update-downloaded',{version:'0.3.2'})};transport.quitAndInstall=(silent,relaunch)=>{assert.equal(silent,true);assert.equal(relaunch,true);installed++};transport.prepareInstall=async()=>({});transport.install=async()=>installed++
    const app=new EventEmitter();Object.assign(app,{isPackaged:true,getVersion:()=> '0.3.1',quit:()=>quitting++})
    setupUpdates({app,ipcMain:{handle:(key,handler)=>handlers[key]=handler},BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(_key,state)=>sent.push(state)}}]},net:{},port:4199,stopChildren:()=>stopped++,updaterFactory:()=>transport})
    const event={senderFrame:frame,sender:{mainFrame:frame}}
    assert.throws(()=>handlers['zaim:update-download']({senderFrame:{url:'https://evil.test'},sender:{mainFrame:frame}}))
    await handlers['zaim:update-install'](event);assert.equal(installed,0,'Cannot install before verified download')
    await handlers['zaim:update-check'](event);assert.equal(sent.at(-1).status,'available');assert.equal(installed,0)
    await handlers['zaim:update-download'](event);assert.equal(sent.at(-1).status,'ready');await handlers['zaim:update-install'](event);assert.equal(installed,1);assert.equal(stopped,process.platform==='darwin'?1:0)
    if(process.platform!=='win32'){await testHelper(root,false);await testHelper(root,true)}
    console.log('PASS: monotonic build versions, trusted update source, architecture and hash verification, no automatic download/install, durable pending updates, downgrade rejection, IPC origin/frame restrictions, in-place replacement and rollback with user data preserved.')
  }finally{await fs.rm(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1})
