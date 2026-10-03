const { _electron } = require(process.argv[2] || 'playwright')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaim-packaged-'))
const control = path.join(temp, 'control.json')
fs.writeFileSync(control, JSON.stringify({ online: true, sent: 0, seen: [] }))
const executablePath = process.env.ZAIM_PACKAGED_EXECUTABLE || path.join(root, 'release/mac/Zaim.app/Contents/MacOS/Zaim')
const origin = 'http://127.0.0.1:4191'
const { spawn } = require('node:child_process'), crypto = require('node:crypto')
let seedServer
async function seedMailbox() {
  const profile = path.join(temp, 'profile'); fs.mkdirSync(profile)
  const secrets = Object.fromEntries(['ZAIM_ENC_KEY', 'ZAIM_SESSION_SECRET', 'ZAIM_API_KEY', 'NNDB_TOKEN'].map(k => [k, crypto.randomBytes(32).toString('hex')]))
  fs.writeFileSync(path.join(profile, 'zaim-secrets.json'), JSON.stringify(secrets), { mode: 0o600 })
  const base = 'http://127.0.0.1:4192'
  seedServer = spawn(require('electron'), [path.join(root, '.next/standalone/server.js')], { env: { ...process.env, ...secrets, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require ${path.join(__dirname, 'mail-fixture.cjs')}`, ZAIM_TEST_CONTROL: control, ZAIM_DESKTOP: '1', ZAIM_LOCAL_HTTP: '1', ZAIM_DB_PATH: path.join(profile, 'zaim.db'), PORT: '4192', HOSTNAME: '127.0.0.1', POSTGRES_URL: '', DATABASE_URL: '', VERCEL: '' }, stdio: 'ignore' })
  for (let i=0;i<100;i++) { try { if ((await fetch(base+'/api/desktop/health')).ok) break } catch {} await new Promise(r=>setTimeout(r,100)) }
  const login = await fetch(base+'/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email:'demo@example.test',password:'fixture-only-password',imapHost:'127.0.0.1',imapPort:993,smtpHost:'127.0.0.1',smtpPort:465}) })
  assert.equal(login.status,200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  for (const endpoint of ['/api/mail/folders?account=mailbox','/api/mail/list?account=mailbox','/api/mail/message/101?account=mailbox&download=1']) assert.equal((await fetch(base+endpoint,{headers:{cookie}})).status,200)
  seedServer.kill(); await new Promise(r=>seedServer.once('exit',r)); seedServer=null
  fs.writeFileSync(control,JSON.stringify({online:false,sent:0,seen:[]}))
  return cookie
}
let app
async function launch() {
  const env = { ...process.env, ZAIM_USER_DATA_DIR: path.join(temp, 'profile'), ZAIM_PORT: '4191', ZAIM_DISABLE_AI: '1', ZAIM_DISABLE_UPDATE_CHECKS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  app = await _electron.launch({ executablePath: path.resolve(executablePath), env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return page
}
;(async () => {
  try {
    const cookie = await seedMailbox()
    let page = await launch()
    await page.getByRole('heading', { name: 'Sign in to your mailbox' }).waitFor()
    const updateState = await page.evaluate(() => window.zaimUpdates.state())
    assert.equal(updateState.currentVersion, await app.evaluate(({app}) => app.getVersion()))
    assert.equal(updateState.status, 'idle')
    if (process.platform === 'darwin') await require('./verify-mac-delta.cjs')(app, temp)
    const split = cookie.indexOf('=')
    await app.context().addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Lax',expires:Date.now()/1000+86400}])
    await page.reload()
    await page.getByText('Working from downloaded mail.').waitFor()
    await page.getByRole('button', { name: 'Compose', exact: true }).click()
    await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Persist after app restart')
    await page.getByRole('textbox', { name: 'Message body' }).fill('Native app offline draft')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Offline · Saved on this device', { exact: true }).waitFor()
    await app.close(); app = null
    fs.writeFileSync(control, JSON.stringify({ online: false, sent: 0, seen: [] }))
    page = await launch()
    await page.getByText('Working from downloaded mail.').waitFor()
    await page.getByRole('button', { name: 'Alex Morgan' }).click()
    await page.frameLocator('iframe[title="Message content"]').getByText('Thanks for the discussion.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Local drafts' }).click()
    await page.locator('.conversation-open').filter({hasText:'Persist after app restart'}).click()
    await page.getByRole('button', { name: 'Edit draft', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Subject', exact: true }).inputValue(), 'Persist after app restart')
    assert.equal(JSON.parse(fs.readFileSync(control)).sent, 0)
    await page.screenshot({ path: path.join(root, 'output/packaged-offline.png') })
    if (process.platform === 'darwin') {
    // macOS closing the last window must keep the local server alive.
    await page.close()
    assert.equal((await fetch(origin + '/api/desktop/health')).status, 200)
    await app.evaluate(({ app }) => app.emit('activate'))
    page = await app.firstWindow()
    await page.getByText('Working from downloaded mail.').waitFor()
    }
    console.log('PASS: packaged desktop app startup from a seeded downloaded mailbox, SQLite native dependency, stable encrypted profile and cookies, offline mail/drafts after full restart, no automatic send, and reopening the last window.')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { if (seedServer) seedServer.kill(); if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }) }
})()
