const path = require('node:path')
function setupUpdates({ app, ipcMain, BrowserWindow, net, port, stopChildren, updaterFactory }) {
  const currentVersion = app.getVersion()
  let state = { status: app.isPackaged ? 'idle' : 'disabled', currentVersion }
  let updater, operation = null, downloaded = false
  const notify = patch => {
    state = { ...state, ...patch }
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('zaim:update-state', state)
  }
  if (app.isPackaged) {
    if (updaterFactory) updater = updaterFactory()
    else if (process.platform === 'darwin') {
      const { MacUpdater } = require('./mac-updater.cjs')
      const appPath = path.resolve(process.execPath, '../../..')
      updater = new MacUpdater({ version: currentVersion, arch: process.arch, appPath, port,
        directory: path.join(app.getPath('userData'), 'updates'), fetcher: (...args) => net.fetch(...args) })
    } else {
      updater = require('electron-updater').autoUpdater
      updater.autoDownload = false; updater.autoInstallOnAppQuit = false
      updater.allowPrerelease = false; updater.allowDowngrade = false
    }
    updater.on('checking-for-update', () => notify({ status: 'checking', error: undefined }))
    updater.on('update-available', info => notify({ status: 'available', version: info.version, error: undefined }))
    updater.on('update-not-available', () => notify({ status: 'current', error: undefined }))
    updater.on('download-progress', progress => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
      if (state.status !== 'downloading' || state.progress !== percent) notify({ status: 'downloading', progress: percent })
    })
    updater.on('update-downloaded', info => { downloaded = true; notify({ status: 'ready', version: info.version, progress: 100, error: undefined }) })
    updater.on('error', error => notify({ status: downloaded ? 'ready' : 'error', error: 'The update could not be completed. Please try again.', detail: error.message }))
  }
  const allowed = event => {
    try { const url = new URL(event.senderFrame.url); return url.origin === `http://127.0.0.1:${port}` && event.senderFrame === event.sender.mainFrame }
    catch { return false }
  }
  async function check() {
    if (!updater || operation || downloaded) return state
    operation = Promise.resolve().then(() => updater.checkForUpdates()).catch(() => {}).finally(() => { operation = null })
    await operation; return state
  }
  async function download() {
    if (!updater || operation || downloaded || state.status !== 'available') return state
    notify({ status: 'downloading', progress: 0, error: undefined })
    operation = Promise.resolve().then(() => updater.downloadUpdate()).catch(() => {}).finally(() => { operation = null })
    await operation; return state
  }
  async function install() {
    if (!updater || !downloaded || operation || state.status === 'installing') return state
    try {
      notify({ status: 'installing', error: undefined })
      if (process.platform === 'darwin') {
        const prepared = await updater.prepareInstall()
        await updater.install(prepared)
        stopChildren(); app.quit()
      } else { updater.quitAndInstall(false, true) }
    } catch (error) { notify({ status: 'ready', error: error.message }) }
    return state
  }
  for (const [action, handler] of Object.entries({ state: () => state, check, download, install })) {
    ipcMain.handle(`zaim:update-${action}`, event => { if (!allowed(event)) throw new Error('Update access denied'); return handler() })
  }
  if (updater && process.env.ZAIM_DISABLE_UPDATE_CHECKS !== '1') {
    const first = setTimeout(() => void check(), 8000); first.unref()
    const repeat = setInterval(() => void check(), 6 * 60 * 60 * 1000); repeat.unref()
    app.once('before-quit', () => { clearTimeout(first); clearInterval(repeat) })
  }
  return { check }
}
module.exports = { setupUpdates }
