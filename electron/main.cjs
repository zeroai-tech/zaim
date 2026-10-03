// Zaim desktop shell. Boots the Next.js standalone server locally (so the full
// secure mail app — IMAP/SMTP, encrypted vault — runs on the device), then opens
// it in a native window. Secrets + the SQLite vault live in the OS app-data dir.
const { app, BrowserWindow, Menu, screen, shell, dialog } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const http = require('node:http')

// Optional isolated/portable profile; defaults to the normal OS application data.
if (process.env.ZAIM_USER_DATA_DIR) {
  const profile = path.resolve(process.env.ZAIM_USER_DATA_DIR)
  fs.mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}

// main.cjs lives at <root>/electron/main.cjs in both dev and the packaged app
// (electron-builder places app files under Resources/app/), so root is one up.
const ROOT = path.join(__dirname, '..')
/**
 * Find the standalone server rather than assuming where Next put it.
 *
 * Next nests the standalone output under a subdirectory named after the
 * package when it infers a workspace root above the project, which it does
 * here because there is a stray package-lock.json in the parent directory.
 * The result is .next/standalone/zaim/server.js, and hardcoding
 * .next/standalone/server.js means the mail server never starts and the
 * window opens on nothing.
 */
const STANDALONE_BASE = path.join(ROOT, '.next', 'standalone')
function findStandalone() {
  const direct = path.join(STANDALONE_BASE, 'server.js')
  if (fs.existsSync(direct)) return { dir: STANDALONE_BASE, server: direct }
  try {
    for (const entry of fs.readdirSync(STANDALONE_BASE, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const nested = path.join(STANDALONE_BASE, entry.name, 'server.js')
      if (fs.existsSync(nested)) return { dir: path.join(STANDALONE_BASE, entry.name), server: nested }
    }
  } catch { /* base missing entirely; reported below */ }
  return { dir: STANDALONE_BASE, server: direct }
}
const { dir: STANDALONE, server: SERVER } = findStandalone()
const NNDB_SERVER = path.join(ROOT, 'nndb', 'src', 'serve.mjs')
const NNDB_INIT = path.join(ROOT, 'nndb', 'bin', 'init-db.mjs')
const configuredPort = Number(process.env.ZAIM_PORT || 34117)
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort < 65535 ? configuredPort : 34117
// Loopback only, and a different port from the mail server so a stale process
// from either half cannot be mistaken for the other.
const NNDB_PORT = PORT + 1
const launchId = crypto.randomUUID()
let child = null
let nndbChild = null
let nndbInitChild = null
let closing = false

// Next standalone doesn't bundle static/public — place them next to server.js.
function stageAssets() {
  const pairs = [
    [path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static')],
    [path.join(ROOT, 'public'), path.join(STANDALONE, 'public')],
    // STANDALONE is resolved above, so these land beside the real server even
    // when Next nested it a directory deeper.
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
    ZAIM_DESKTOP: '1',
    // Desktop must not inherit cloud database configuration from a development shell.
    POSTGRES_URL: '', DATABASE_URL: '', CLOUDFLARE_ACCOUNT_ID: '', D1_DATABASE_ID: '', CLOUDFLARE_API_TOKEN: '', VERCEL: '',
    ZAIM_DB_PATH: path.join(dir, 'zaim.db'),
    // Which mail server is ours.
    //
    // This lives in .env.local, which the build deliberately does not package,
    // so in the installed app it was simply undefined — and the whole "this
    // address is one of ours" branch of discovery became dead code. A
    // zeroaitech.tech mailbox was therefore treated as somebody else's, which
    // is why signing in asked for IMAP and SMTP details it already knew, and
    // why a refusal was reported as "check your mail-server details" instead
    // of naming the real cause.
    ZAIM_HOSTED_MAIL_HOST: process.env.ZAIM_HOSTED_MAIL_HOST || 'mail.zeroaitech.tech',
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
    if (!fs.existsSync(NNDB_INIT) || !fs.existsSync(NNDB_SERVER)) return
    const init = nndbInitChild = spawn(process.execPath, [NNDB_INIT], { env, cwd: ROOT })
    init.on('error', e => console.error('[nndb:init]', e.message))
    init.on('close', code => {
      nndbInitChild = null
      if (closing || code !== 0) return
      nndbChild = spawn(process.execPath, [NNDB_SERVER], { env, cwd: ROOT })
      nndbChild.stdout.on('data', (d) => process.stdout.write('[nndb] ' + d))
      nndbChild.stderr.on('data', (d) => process.stderr.write('[nndb] ' + d))
      nndbChild.on('error', (e) => console.error('[nndb] failed to start:', e.message))
      // The mail server's pid was recorded when it spawned; this one only
      // exists now, and an unrecorded child is exactly the one that orphans.
      recordChildren([child?.pid, nndbChild.pid])
    })
    init.stderr.on('data', (d) => process.stderr.write('[nndb:init] ' + d))
  } catch (e) {
    console.error('[nndb] not started:', e.message)
  }
}

/**
 * Children that outlived a previous run.
 *
 * Killing or crashing the app leaves the mail server and the cognitive layer
 * alive, still holding their ports. The next launch then finds 34117 already
 * answering and quietly loads *that* server: an older build, with an older
 * session, and no error anywhere. The window looks right and is wrong, which
 * is the worst way for this to fail.
 *
 * So record what we spawn, and reap it before spawning again.
 */
function pidFile() {
  return path.join(app.getPath('userData'), 'children.json')
}

function recordChildren(pids) {
  try { fs.writeFileSync(pidFile(), JSON.stringify(pids.filter(Boolean))) } catch { /* best effort */ }
}

function portBusy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 700 }, () => { req.destroy(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

/**
 * Is this pid still the child we recorded, or has the number been reused?
 *
 * Process ids get recycled, so a stale file could name something else entirely
 * by now — a browser, a build, someone's editor. Signalling that would be ours
 * to answer for, so check what the pid is actually running first and only act
 * on a command line that is one of ours.
 */
function looksLikeOurChild(pid) {
  if (process.platform === 'win32') return false // no cheap equivalent; leave it alone rather than guess
  let out
  try {
    out = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,command='], { encoding: 'utf8' }).trim()
  } catch {
    return false // no such process
  }
  if (!out) return false
  const ppid = Number(out.split(/\s+/)[0])
  // We are a new process, so any recorded child still alive has outlived the
  // shell that spawned it and has been reparented to init. A process with a
  // real parent is somebody else's, whatever its command line says.
  if (ppid !== 1) return false
  // Next renames its own process title, so the recorded pid does not show the
  // path we spawned — it reads "next-server (v15.5.20)". Matching only on the
  // path we passed to spawn silently skips the one child that holds the port.
  return out.includes(SERVER) || out.includes(NNDB_SERVER)
}

async function reapOrphans() {
  let pids = []
  try { pids = JSON.parse(fs.readFileSync(pidFile(), 'utf8')) } catch { /* nothing recorded */ }
  if (!pids.length) return

  // Nothing is holding the ports, so there is nothing to reap and no reason to
  // signal anyone.
  if (!(await portBusy(PORT)) && !(await portBusy(NNDB_PORT))) { recordChildren([]); return }

  let signalled = false
  for (const pid of pids) {
    if (!looksLikeOurChild(pid)) continue
    try { process.kill(pid, 'SIGTERM'); signalled = true } catch { /* already gone */ }
  }
  recordChildren([])
  if (!signalled) return

  for (let i = 0; i < 20; i++) {
    if (!(await portBusy(PORT))) return
    await new Promise((r) => setTimeout(r, 250))
  }
  console.error(`[zaim] port ${PORT} is still held after asking the previous server to stop.`)
}

function startServer() {
  // ZAIM_LOCAL_HTTP=1 → session cookie is not marked Secure (we serve over
  // http://127.0.0.1 locally, where a Secure cookie would be dropped → login fails).
  const m = machineEnv()
  const env = {
    ...process.env, ...m,
    PORT: String(PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
    ZAIM_LOCAL_HTTP: '1', ZAIM_INSTANCE: launchId, ELECTRON_RUN_AS_NODE: '1',
    // Where the Next server reaches the cognitive layer.
    NNDB_URL: `http://127.0.0.1:${NNDB_PORT}`,
  }
  if (process.env.ZAIM_DISABLE_AI !== '1') startNndb({ ...env, NNDB_PORT: String(NNDB_PORT) })
  child = spawn(process.execPath, [SERVER], { env, cwd: STANDALONE })
  child.on('error', e => { dialog.showErrorBox('Zaim could not start', e.message); app.quit() })
  child.stdout.on('data', (d) => process.stdout.write('[zaim] ' + d))
  child.stderr.on('data', (d) => process.stderr.write('[zaim] ' + d))
  recordChildren([child.pid, nndbChild?.pid, nndbInitChild?.pid])
}

function whenReady(cb, tries = 0) {
  const retry = () => {
    if (tries >= 120 || (child && child.exitCode !== null)) {
      dialog.showErrorBox('Zaim could not start', 'The local mail server did not become ready. Quit and reopen Zaim. Your saved mail and drafts have not been removed.'); app.quit(); return
    }
    setTimeout(() => whenReady(cb, tries + 1), 250)
  }
  const req = http.get(`http://127.0.0.1:${PORT}/api/desktop/health`, response => {
    let data = ''; response.on('data', chunk => data += chunk)
    response.on('end', () => {
      try { if (response.statusCode === 200 && JSON.parse(data).instance === launchId) return cb() } catch {}
      retry()
    })
  })
  req.setTimeout(1500, () => req.destroy())
  req.on('error', retry)
}

/**
 * Where the window was last time.
 *
 * A website opens wherever the browser puts it; an application comes back the
 * size and place its owner left it. Stored beside the vault, and validated
 * against the displays actually attached, because a window restored onto a
 * monitor that has since been unplugged opens off-screen and looks like a
 * launch that did nothing.
 */
function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  const fallback = { width: 1320, height: 860 }
  let s
  try { s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) } catch { return fallback }
  if (!Number.isFinite(s.width) || !Number.isFinite(s.height)) return fallback
  const size = { width: Math.max(900, s.width), height: Math.max(600, s.height) }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return { ...size, maximised: !!s.maximised }
  // Keep it only if the saved corner still lands inside some display's work area.
  const onScreen = screen.getAllDisplays().some(({ workArea: w }) =>
    s.x >= w.x - 40 && s.y >= w.y - 40 &&
    s.x + 80 <= w.x + w.width && s.y + 40 <= w.y + w.height)
  return onScreen ? { ...size, x: s.x, y: s.y, maximised: !!s.maximised } : { ...size, maximised: !!s.maximised }
}

function trackWindowState(win) {
  const save = () => {
    // getNormalBounds is the un-maximised geometry, so un-maximising later
    // restores a real window rather than a full-screen-sized one.
    const b = win.getNormalBounds()
    try {
      fs.writeFileSync(windowStateFile(), JSON.stringify({ ...b, maximised: win.isMaximized() }))
    } catch { /* losing the geometry is not worth interrupting a quit */ }
  }
  let t = null
  const debounced = () => { clearTimeout(t); t = setTimeout(save, 400) }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, debounced)
  win.on('close', () => { clearTimeout(t); save() })
}

/** Run a command in the page. Menu items drive the app, not the browser. */
function toRenderer(action) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return
  win.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('zaim:menu', { detail: ${JSON.stringify(action)} }))`,
  ).catch(() => { /* page still loading */ })
}

/**
 * The application menu.
 *
 * Electron's default menu is a browser's: its Help item opens electronjs.org
 * and its View menu offers Reload and Force Reload, which is the giveaway that
 * a window is really a web page. This one names things this app does. The Edit
 * roles are not decoration — without them Cmd+C and Cmd+V do nothing at all on
 * macOS.
 */
function buildMenu() {
  const mac = process.platform === 'darwin'
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => toRenderer(action) })

  const template = [
    ...(mac ? [{
      label: 'Zaim',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        item('Settings…', 'CmdOrCtrl+,', 'profile'),
        { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        item('New Message', 'CmdOrCtrl+N', 'compose'),
        { type: 'separator' },
        item('Connect an Agent…', undefined, 'keys'),
        ...(mac ? [] : [{ type: 'separator' }, item('Settings…', 'CmdOrCtrl+,', 'profile')]),
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(mac ? [{ role: 'pasteAndMatchStyle' }] : []),
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find in Mailbox', 'CmdOrCtrl+F', 'search'),
      ],
    },
    {
      label: 'Mailbox',
      submenu: [
        item('Refresh', 'CmdOrCtrl+R', 'refresh'),
        { type: 'separator' },
        item('Show Folders', 'CmdOrCtrl+1', 'panel:spaces'),
        item('Show Details', 'CmdOrCtrl+2', 'panel:context'),
        item('Show Assistant', 'CmdOrCtrl+3', 'panel:ai'),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        // Kept, but out of the way: Cmd+R belongs to the mailbox here, and
        // these are for when the window itself is wedged.
        { label: 'Reload Window', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Developer Tools', accelerator: mac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: mac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width, height: state.height,
    ...(Number.isFinite(state.x) ? { x: state.x, y: state.y } : {}),
    minWidth: 900, minHeight: 600,
    backgroundColor: '#f5f7fa', title: 'Zaim',
    // Do not paint an empty window while the local server is still starting.
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  if (state.maximised) win.maximize()
  win.once('ready-to-show', () => win.show())
  trackWindowState(win)

  // The page's <title> is the website's, tagline and all. In a window with a
  // real title bar that reads as a browser tab, so the app keeps its own name.
  win.on('page-title-updated', (e) => e.preventDefault())

  win.loadURL(`http://127.0.0.1:${PORT}`)

  // Anything outside the local server opens in the real browser. Without this
  // a stray link navigates the whole application to a web page, and there is
  // no back button in a window with no browser chrome.
  const isLocal = (url) => { try { return new URL(url).host === `127.0.0.1:${PORT}` } catch { return false } }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isLocal(url)) return
    e.preventDefault()
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
}

// One copy of a desktop application, not one per launch. A second launch
// raises the window that is already open, the way every other app on the
// machine behaves — and it cannot fight the first one for port 34117.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    if (!fs.existsSync(SERVER)) {
      dialog.showErrorBox('Zaim could not start', 'The installed app is missing its mail server. Reinstall the complete desktop package.'); app.quit(); return
    }
    stageAssets()
    buildMenu()
    await reapOrphans()
    if (await portBusy(PORT)) { dialog.showErrorBox('Zaim could not start', 'Another process is using the local mail port. Close the other Zaim instance or restart your computer.'); app.quit(); return }
    startServer()
    whenReady(createWindow)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}
function stopChildren() {
  closing = true
  for (const c of [child, nndbChild, nndbInitChild]) { try { c && c.kill() } catch { /* already gone */ } }
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') { stopChildren(); app.quit() } })
app.on('quit', stopChildren)
// A terminal Ctrl+C or a `kill` reaches the shell but not its children, and the
// pair left behind is what holds the ports next time.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => { stopChildren(); app.quit() })
}
