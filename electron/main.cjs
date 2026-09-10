// Zaim desktop shell. Boots the Next.js standalone server locally (so the full
// secure mail app — IMAP/SMTP, encrypted vault — runs on the device), then opens
// it in a native window. Secrets + the SQLite vault live in the OS app-data dir.
const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const http = require('node:http')

// main.cjs lives at <root>/electron/main.cjs in both dev and the packaged app
// (electron-builder places app files under Resources/app/), so root is one up.
const ROOT = path.join(__dirname, '..')
const STANDALONE = path.join(ROOT, '.next', 'standalone')
const SERVER = path.join(STANDALONE, 'server.js')
const NNDB_SERVER = path.join(ROOT, 'nndb', 'src', 'serve.mjs')
const NNDB_INIT = path.join(ROOT, 'nndb', 'bin', 'init-db.mjs')
const PORT = 34117
// Loopback only, and a different port from the mail server so a stale process
// from either half cannot be mistaken for the other.
const NNDB_PORT = 34118
let child = null
let nndbChild = null

// Next standalone doesn't bundle static/public — place them next to server.js.
function stageAssets() {
  const pairs = [
    [path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static')],
    [path.join(ROOT, 'public'), path.join(STANDALONE, 'public')],
  ]
  for (const [src, dst] of pairs) {
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true })
  }
}

// Per-machine secrets (vault key, session secret, agent API key) + vault path.
function machineEnv() {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'zaim-secrets.json')
  let s = {}
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* first run */ }
  let changed = false
  for (const k of ['ZAIM_ENC_KEY', 'ZAIM_SESSION_SECRET', 'ZAIM_API_KEY', 'NNDB_TOKEN']) {
    if (!s[k]) { s[k] = crypto.randomBytes(32).toString('hex'); changed = true }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 })
  return {
    ...s,
    ZAIM_DB_PATH: path.join(dir, 'zaim.db'),
    // The cognitive layer stores to SQLite beside the mail vault, so an
    // install needs no Cloudflare credentials and nothing about how the owner
    // writes ever leaves the machine. Setting the D1 variables instead makes
    // the same cognition follow them across machines.
    NNDB_DB_PATH: path.join(dir, 'nndb.sqlite'),
  }
}

/**
 * Start the cognitive layer.
 *
 * This is the reason the desktop build exists. The Claude subscription bridge
 * shells out to the CLI, which needs a real process, and a serverless host has
 * none: on Vercel the drafting route can only ever fall back to the metered
 * relay. Here it runs on the owner's own machine against their own
 * subscription.
 *
 * Failure is not fatal. Zaim is a mail client first, and it opens and works
 * whether or not this comes up.
 */
function startNndb(env) {
  try {
    // Schema first. Cheap, idempotent, and creates the database on first run.
    const init = spawn(process.execPath, [NNDB_INIT], { env, cwd: ROOT })
    init.on('close', () => {
      nndbChild = spawn(process.execPath, [NNDB_SERVER], { env, cwd: ROOT })
      nndbChild.stdout.on('data', (d) => process.stdout.write('[nndb] ' + d))
      nndbChild.stderr.on('data', (d) => process.stderr.write('[nndb] ' + d))
      nndbChild.on('error', (e) => console.error('[nndb] failed to start:', e.message))
    })
    init.stderr.on('data', (d) => process.stderr.write('[nndb:init] ' + d))
  } catch (e) {
    console.error('[nndb] not started:', e.message)
  }
}

function startServer() {
  // ZAIM_LOCAL_HTTP=1 → session cookie is not marked Secure (we serve over
  // http://127.0.0.1 locally, where a Secure cookie would be dropped → login fails).
  const m = machineEnv()
  const env = {
    ...process.env, ...m,
    PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
    ZAIM_LOCAL_HTTP: '1', ELECTRON_RUN_AS_NODE: '1',
    // Where the Next server reaches the cognitive layer.
    NNDB_URL: `http://127.0.0.1:${NNDB_PORT}`,
  }
  startNndb({ ...env, NNDB_PORT: String(NNDB_PORT) })
  child = spawn(process.execPath, [SERVER], { env, cwd: STANDALONE })
  child.stdout.on('data', (d) => process.stdout.write('[zaim] ' + d))
  child.stderr.on('data', (d) => process.stderr.write('[zaim] ' + d))
}

function whenReady(cb, tries = 0) {
  http.get(`http://127.0.0.1:${PORT}/`, () => cb()).on('error', () => (tries < 80 ? setTimeout(() => whenReady(cb, tries + 1), 250) : cb()))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#08090d', title: 'Zaim', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  })
  win.loadURL(`http://127.0.0.1:${PORT}`)
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

app.whenReady().then(() => {
  stageAssets()
  startServer()
  whenReady(createWindow)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
function stopChildren() {
  for (const c of [child, nndbChild]) { try { c && c.kill() } catch { /* already gone */ } }
}
app.on('window-all-closed', () => { stopChildren(); if (process.platform !== 'darwin') app.quit() })
app.on('quit', stopChildren)
