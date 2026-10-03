const { chromium }=require(process.argv[2]||'playwright');
const { spawn }=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zaim-desktop-e2e-'));const control=path.join(tmp,'control.json');
const origin='http://127.0.0.1:4189';const electron=require('electron');
fs.writeFileSync(control,JSON.stringify({online:true,sent:0,seen:[]}));
const setControl=patch=>fs.writeFileSync(control,JSON.stringify({...JSON.parse(fs.readFileSync(control,'utf8')),...patch}));
const child=spawn(electron,[path.join(root,'.next/standalone/server.js')],{cwd:path.join(root,'.next/standalone'),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:`--require ${path.join(__dirname,'mail-fixture.cjs')}`,PORT:'4189',HOSTNAME:'127.0.0.1',NODE_ENV:'production',ZAIM_DESKTOP:'1',ZAIM_LOCAL_HTTP:'1',ZAIM_DB_PATH:path.join(tmp,'vault.db'),ZAIM_TEST_CONTROL:control,ZAIM_ENC_KEY:crypto.randomBytes(32).toString('hex'),ZAIM_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),ZAIM_API_KEY:crypto.randomBytes(32).toString('hex'),POSTGRES_URL:'',DATABASE_URL:'',CLOUDFLARE_ACCOUNT_ID:'',D1_DATABASE_ID:'',CLOUDFLARE_API_TOKEN:'',VERCEL:'',NNDB_URL:'http://127.0.0.1:9'}});
let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
(async()=>{
  let browser;
  try{
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Server exited: '+logs);try{if((await fetch(origin+'/api/desktop/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,200));}
    browser=await chromium.launch({...(process.env.CI ? {} : {executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),headless:true});
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
    const signedIn=await context.request.post(origin+'/api/auth/login',{data:{email:'demo@zeroaitech.tech',password:'fixture-only-password'}});assert.equal(signedIn.status(),200,await signedIn.text());
    await page.reload();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    assert.equal(await page.locator('[data-testid="conversation-card"]').count(),3);
    assert.equal(JSON.parse(fs.readFileSync(control)).connections[0].host,'mail.zeroaitech.tech','Company sign-in must choose its own server');
    const add=await context.request.post(origin+'/api/accounts',{data:{label:'Support',imapUser:'support@zeroaitech.tech',imapPass:'fixture-only-password',imapHost:'wrong.example.test'}});assert.equal(add.status(),200,await add.text());const second=await add.json();assert.equal(second.ok,true);assert.equal(second.server.imapHost,'mail.zeroaitech.tech');
    const duplicate=await context.request.post(origin+'/api/accounts',{data:{label:'Duplicate',imapUser:'support@zeroaitech.tech',imapPass:'fixture-only-password'}});assert.equal(duplicate.status(),409);
    await page.reload();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();
    const choice=page.getByRole('button',{name:'Switch to support@zeroaitech.tech',exact:true});assert((await choice.boundingBox()).width>150,'Mailbox label squeezed out by settings');await page.screenshot({path:path.join(root,'output/mailbox-switcher.png')});await choice.click();
    await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();await page.getByRole('button',{name:'Settings for support@zeroaitech.tech',exact:true}).click();await page.getByLabel('Mailbox email').waitFor();assert.equal(await page.getByPlaceholder('IMAP host').count(),0);assert.equal(await page.getByRole('button',{name:'Advanced server settings',exact:true}).count(),0);
    await page.getByLabel('Mailbox label').fill('Support team');await page.getByRole('button',{name:'Save & verify',exact:true}).click();await page.getByLabel('Mailbox label').waitFor({state:'hidden'});
    const edit=await context.request.put(origin+'/api/accounts/'+second.id,{data:{imapHost:'wrong.example.test',smtpHost:'wrong.example.test'}});assert.equal(edit.status(),200);const saved=await (await context.request.get(origin+'/api/accounts/'+second.id)).json();assert.equal(saved.managed,true);assert.equal(saved.account.imapHost,'mail.zeroaitech.tech');
    await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();await page.getByRole('button',{name:'Switch to demo@zeroaitech.tech',exact:true}).click();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();await page.getByRole('button',{name:'Settings for demo@zeroaitech.tech',exact:true}).click();await page.getByLabel('Mailbox email').waitFor();assert.equal(await page.getByRole('button',{name:'Save & verify',exact:true}).count(),0);await page.getByRole('button',{name:'Close mailbox settings',exact:true}).click();
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();const bounds=await page.locator('.account-menu').boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=390,'Mobile account menu overflow');await page.screenshot({path:path.join(root,'output/mailbox-switcher-mobile.png')});await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:950});
    await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();await page.getByRole('button',{name:'Add another mailbox',exact:true}).click();await page.getByLabel('Email address').fill('new@zeroaitech.tech');await page.getByLabel('Mailbox password').fill('wrong');setControl({authFailure:true});await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByText('Could not connect to that mailbox.',{exact:true}).waitFor();assert.equal(await page.getByPlaceholder('Incoming mail server (e.g. imap.gmail.com)').count(),0);assert.equal(await page.getByRole('button',{name:'Advanced server settings',exact:true}).count(),0);setControl({authFailure:false});
    await page.getByLabel('Email address').fill('external@example.test');await page.getByRole('button',{name:'Advanced server settings',exact:true}).click();await page.getByPlaceholder('Incoming mail server (e.g. imap.gmail.com)').waitFor();await page.getByRole('button',{name:'Close mailbox settings',exact:true}).click();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    const external=await context.request.post(origin+'/api/accounts',{data:{label:'External',imapUser:'external@example.test',imapPass:'fixture-only-password',imapHost:'imap.example.test'}});const externalBody=await external.json();assert.equal(externalBody.ok,true);await page.reload();await page.getByRole('button',{name:'Switch mailbox',exact:true}).click();await page.getByRole('button',{name:'Settings for external@example.test',exact:true}).click();await page.getByLabel('Mailbox email').waitFor();assert.equal(await page.getByPlaceholder('IMAP host').count(),0);await page.getByRole('button',{name:'Advanced server settings',exact:true}).click();await page.getByPlaceholder('IMAP host').waitFor();await page.getByRole('button',{name:'Close mailbox settings',exact:true}).click();
    const removed=await context.request.delete(origin+'/api/accounts/'+externalBody.id);assert.equal(removed.status(),200);await page.reload();await page.locator('[data-testid="conversation-card"]').first().waitFor();
    setControl({authFailure:true});const bad=await context.request.post(origin+'/api/accounts',{data:{label:'Wrong password',imapUser:'new@zeroaitech.tech',imapPass:'wrong'}});const badBody=await bad.json();assert.equal(badBody.ok,false);assert.equal(badBody.needsMailServer,false);setControl({authFailure:false});
    assert.equal(JSON.parse(fs.readFileSync(control)).sent,0,'Mailbox setup must never send email');
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
    console.log('PASS: company email/password login, readable multi-account switcher on desktop/mobile, managed settings protection, duplicate prevention, external advanced settings, removal, failed-password UI, actual standalone desktop server, encrypted mailbox login, download without marking read, cached inbox/body/attachments after outage and reload, offline draft/body/attachment persistence, no auto-send on reconnect, explicit mocked send, draft cleanup, mobile navigation, themes, and no rendering errors.');
  }catch(error){console.error(error);console.error(logs.slice(-2500));process.exitCode=1}
  finally{if(browser)await browser.close();if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(tmp,{recursive:true,force:true})}
})();
