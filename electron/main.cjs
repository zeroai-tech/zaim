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
const PORT = 34117
let child = null

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
  for (const k of ['ZAIM_ENC_KEY', 'ZAIM_SESSION_SECRET', 'ZAIM_API_KEY']) {
    if (!s[k]) { s[k] = crypto.randomBytes(32).toString('hex'); changed = true }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(s), { mode: 0o600 })
  return { ...s, ZAIM_DB_PATH: path.join(dir, 'zaim.db') }
}

function startServer() {
  const env = { ...process.env, ...machineEnv(), PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' }
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
app.on('window-all-closed', () => { if (child) child.kill(); if (process.platform !== 'darwin') app.quit() })
app.on('quit', () => { if (child) child.kill() })
