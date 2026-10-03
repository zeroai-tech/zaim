const { chromium }=require(process.argv[2]||'playwright');
const { spawn }=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zaim-desktop-e2e-'));const control=path.join(tmp,'control.json');
const origin='http://127.0.0.1:4189';const electron=path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
fs.writeFileSync(control,JSON.stringify({online:true,sent:0,seen:[]}));
const setControl=patch=>fs.writeFileSync(control,JSON.stringify({...JSON.parse(fs.readFileSync(control,'utf8')),...patch}));
const child=spawn(electron,[path.join(root,'.next/standalone/server.js')],{cwd:path.join(root,'.next/standalone'),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:`--require ${path.join(__dirname,'mail-fixture.cjs')}`,PORT:'4189',HOSTNAME:'127.0.0.1',NODE_ENV:'production',ZAIM_DESKTOP:'1',ZAIM_LOCAL_HTTP:'1',ZAIM_DB_PATH:path.join(tmp,'vault.db'),ZAIM_TEST_CONTROL:control,ZAIM_ENC_KEY:crypto.randomBytes(32).toString('hex'),ZAIM_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),ZAIM_API_KEY:crypto.randomBytes(32).toString('hex'),POSTGRES_URL:'',DATABASE_URL:'',CLOUDFLARE_ACCOUNT_ID:'',D1_DATABASE_ID:'',CLOUDFLARE_API_TOKEN:'',VERCEL:'',NNDB_URL:'http://127.0.0.1:9'}});
let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
(async()=>{
  let browser;
  try{
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Server exited: '+logs);try{if((await fetch(origin+'/api/desktop/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,200));}
    browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:950}});const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort()); // No remote services or real accounts in the test.
    fs.mkdirSync(path.join(root,'output'),{recursive:true});
    await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null,desktop:false}}));
    await page.goto(origin);await page.getByRole('heading',{name:'Welcome to Zaim.'}).waitFor();
    await page.screenshot({path:path.join(root,'output/landing-desktop.png')});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Landing mobile overflow');
    await page.screenshot({path:path.join(root,'output/landing-mobile.png')});
    await page.unroute('**/api/auth/me');await page.setViewportSize({width:1440,height:950});
    await page.reload();await page.getByRole('heading',{name:'Sign in to your mailbox'}).waitFor();
    const unauthorized=await context.request.get(origin+'/api/local/drafts');assert.equal(unauthorized.status(),401);
    const signedIn=await context.request.post(origin+'/api/auth/login',{data:{email:'demo@example.test',password:'fixture-only-password',imapHost:'127.0.0.1',imapPort:993,smtpHost:'127.0.0.1',smtpPort:465}});assert.equal(signedIn.status(),200,await signedIn.text());
    await page.reload();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    assert.equal(await page.locator('[data-testid="conversation-card"]').count(),3);
    fs.mkdirSync(path.join(root,'output'),{recursive:true});await page.screenshot({path:path.join(root,'output/inbox-desktop.png')});
    await page.getByRole('button',{name:'Download for offline'}).click();await page.getByText('3 messages and their available attachments saved on this device.').waitFor();
    assert.deepEqual(JSON.parse(fs.readFileSync(control)).seen,[],'Background downloads changed unread flags');
    await page.getByRole('button',{name:'Alex Morgan'}).click();await page.frameLocator('iframe[title="Message content"]').getByText('Thanks for the discussion.',{exact:false}).waitFor();
    await page.screenshot({path:path.join(root,'output/message-desktop.png')});
    setControl({online:false});await page.getByRole('button',{name:'Refresh mailbox'}).click();await page.getByText('Working from downloaded mail.').waitFor();
    await page.reload();await page.getByText('Working from downloaded mail.').waitFor();assert.equal(await page.locator('[data-testid="conversation-card"]').count(),3);
    await page.getByRole('button',{name:'Alex Morgan'}).click();await page.frameLocator('iframe[title="Message content"]').getByText('Thanks for the discussion.',{exact:false}).waitFor();
    const attachment=await context.request.get(origin+'/api/mail/attachment?uid=101&mailbox=INBOX&index=0&account=mailbox&offline=1');assert.equal(attachment.status(),200);assert.equal(attachment.headers()['x-zaim-cached'],'true');assert((await attachment.text()).includes('Isolated fixture attachment'));
    await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'To',exact:true}).fill('review@example.test');await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Offline project draft');await page.getByRole('textbox',{name:'Message body'}).fill('Written while offline. Must not auto-send.');
    await page.getByRole('button',{name:'Attach files'}).click({trial:true});await page.locator('input[type=file]').setInputFiles({name:'local-note.txt',mimeType:'text/plain',buffer:Buffer.from('Offline attachment payload')});
    await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Offline · Saved on this device',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled());
    assert.equal(JSON.parse(fs.readFileSync(control)).sent,0);
    await page.reload();await page.getByRole('button',{name:'Local drafts'}).click();await page.getByRole('button',{name:/To: review@example.test/}).click();await page.getByRole('button',{name:'Edit draft',exact:true}).click();await page.getByText('local-note.txt ·',{exact:false}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Subject',exact:true}).inputValue(),'Offline project draft');assert((await page.getByRole('textbox',{name:'Message body'}).innerText()).includes('Must not auto-send'));
    await page.screenshot({path:path.join(root,'output/compose-offline.png')});
    setControl({online:true});await page.getByRole('button',{name:'Reconnect & refresh'}).click();
    // Refresh a server folder to verify transport before sending a local draft.
    await page.getByRole('button',{name:'Send message',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.connection-banner')?.textContent.includes('Working from downloaded'));
    assert.equal(JSON.parse(fs.readFileSync(control)).sent,0,'Reconnect sent email without a click');
    await page.getByRole('button',{name:'Send message',exact:true}).click();await page.locator('[data-testid="compose-inline"]').waitFor({state:'detached'});assert.equal(JSON.parse(fs.readFileSync(control)).sent,1);
    const remaining=await context.request.get(origin+'/api/local/drafts?account=mailbox');assert.equal((await remaining.json()).drafts.length,0,'Sent local draft was not cleaned up');
    await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow at ${width}`)}
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'output/inbox-mobile.png')});await page.getByRole('button',{name:'Alex Morgan'}).click();await page.frameLocator('iframe[title="Message content"]').getByText('Thanks for the discussion.',{exact:false}).waitFor();await page.screenshot({path:path.join(root,'output/message-mobile.png')});await page.getByRole('button',{name:'Back to mailbox'}).click();
    await page.getByRole('button',{name:'Use dark theme'}).click();await page.screenshot({path:path.join(root,'output/inbox-dark.png')});
    setControl({authFailure:true});const denied=await context.request.get(origin+'/api/mail/list?account=mailbox');assert.equal(denied.status(),502);assert.equal((await denied.json()).ok,false,'Authentication failure returned cached mail');setControl({authFailure:false});
    assert.deepEqual(errors,[]);
    console.log('PASS: actual standalone desktop server, encrypted mailbox login, download without marking read, cached inbox/body/attachments after outage and reload, offline draft/body/attachment persistence, no auto-send on reconnect, explicit mocked send, draft cleanup, mobile navigation, themes, and no rendering errors.');
  }catch(error){console.error(error);console.error(logs.slice(-2500));process.exitCode=1}
  finally{if(browser)await browser.close();if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(tmp,{recursive:true,force:true})}
})();
