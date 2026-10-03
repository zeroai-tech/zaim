const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { promisify } = require('node:util')
const { execFile, spawn } = require('node:child_process')
const run = promisify(execFile)
const semver = require('semver')
const gunzip = promisify(require('node:zlib').gunzip)
const RELEASES = 'https://github.com/zeroai-tech/zaim/releases'
async function checksum(file) {
  const hash = crypto.createHash('sha512')
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}
function validateManifest(m, arch) {
  if (!semver.valid(m.version) || semver.prerelease(m.version) !== null || m.arch !== arch || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > 2e9 || typeof m.sha512 !== 'string' || Buffer.from(m.sha512, 'base64').length !== 64) throw new Error('Invalid update metadata.')
  const prefix = `${RELEASES}/download/v${m.version}/`
  if (!m.url.startsWith(prefix) || !m.url.endsWith(`-mac-${arch}.zip`) || m.blockmap !== m.url + '.blockmap') throw new Error('Invalid update source.')
  return m
}
class MacUpdater extends EventEmitter {
  constructor({ version, arch, directory, appPath, port, fetcher, feed }) {
    super(); Object.assign(this, { version, arch, directory, appPath, port, fetcher })
    this.feed = feed || `${RELEASES}/latest/download/update-mac-${arch}.json`
    this.pending = null; this.available = null; this.busy = false
  }
  async readJson(url) {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('The update service is unavailable. Try again later.')
    const text = await response.text()
    if (text.length > 16384) throw new Error('Invalid update metadata.')
    return JSON.parse(text)
  }
  async checkForUpdates() {
    if (this.busy) return
    this.busy = true; this.emit('checking-for-update')
    try {
      const metadata = validateManifest(await this.readJson(this.feed), this.arch)
      if (!semver.gt(metadata.version, this.version)) { this.emit('update-not-available', metadata); return }
      this.available = metadata
      try {
        const saved = JSON.parse(await fs.readFile(path.join(this.directory, 'pending.json'), 'utf8'))
        if (saved.version === metadata.version && saved.sha512 === metadata.sha512 && await checksum(path.join(this.directory, 'pending.zip')) === metadata.sha512) {
          this.pending = metadata; this.emit('update-downloaded', metadata); return
        }
      } catch { /* no complete cached update */ }
      this.emit('update-available', metadata)
    } catch (error) { this.emit('error', error) }
    finally { this.busy = false }
  }
  async differential(metadata, destination) {
    const { GenericDifferentialDownloader } = require('electron-updater/out/differentialDownloader/GenericDifferentialDownloader')
    const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
    const { CancellationToken } = require('builder-util-runtime')
    const oldFile = path.join(this.directory, 'installed.zip')
    await fs.access(oldFile)
    const oldMap = JSON.parse(await fs.readFile(path.join(this.directory, 'installed.blockmap.json'), 'utf8'))
    const response = await this.fetcher(metadata.blockmap, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('No block map available')
    const newMap = JSON.parse((await gunzip(Buffer.from(await response.arrayBuffer()))).toString())
    const downloader = new GenericDifferentialDownloader(metadata, new ElectronHttpExecutor(() => null), {
      oldFile, newFile: destination, newUrl: new URL(metadata.url), logger: console,
      requestHeaders: null, isUseMultipleRangeRequest: false, cancellationToken: new CancellationToken(),
      onProgress: progress => this.emit('download-progress', progress),
    })
    await downloader.download(oldMap, newMap)
    return newMap
  }
  async downloadUpdate() {
    if (!this.available || this.busy || this.pending) return
    this.busy = true
    const metadata = this.available, destination = path.join(this.directory, 'pending.zip.part')
    let map
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
      try { map = await this.differential(metadata, destination) }
      catch {
        await fs.rm(destination, { force: true })
        const response = await this.fetcher(metadata.url, { signal: AbortSignal.timeout(600000) })
        if (!response.ok || !response.body) throw new Error('Could not download the update. Try again.')
        const file = await fs.open(destination, 'w', 0o600)
        let transferred = 0
        try {
          for await (const chunk of response.body) {
            transferred += chunk.length
            if (transferred > metadata.size) throw new Error('Update size did not match.')
            await file.writeFile(chunk)
            this.emit('download-progress', { percent: transferred / metadata.size * 100 })
          }
        } finally { await file.close() }
        try {
          const r = await this.fetcher(metadata.blockmap, { signal: AbortSignal.timeout(15000) })
          if (r.ok) map = JSON.parse((await gunzip(Buffer.from(await r.arrayBuffer()))).toString())
        } catch { /* a complete verified archive still works without a block map */ }
      }
      if ((await fs.stat(destination)).size !== metadata.size || await checksum(destination) !== metadata.sha512) throw new Error('The downloaded update failed verification. Please retry.')
      await fs.rename(destination, path.join(this.directory, 'pending.zip'))
      await fs.writeFile(path.join(this.directory, 'pending.json'), JSON.stringify(metadata), { mode: 0o600 })
      if (map) await fs.writeFile(path.join(this.directory, 'pending.blockmap.json'), JSON.stringify(map), { mode: 0o600 })
      else await fs.rm(path.join(this.directory, 'pending.blockmap.json'), { force: true })
      this.pending = metadata; this.emit('update-downloaded', metadata)
    } catch (error) { await fs.rm(destination, { force: true }); this.emit('error', error) }
    finally { this.busy = false }
  }
  async prepareInstall() {
    if (!this.pending) throw new Error('Download the update first.')
    const archive = path.join(this.directory, 'pending.zip')
    if (await checksum(archive) !== this.pending.sha512) throw new Error('Update verification failed. Download it again.')
    const parent = path.dirname(this.appPath)
    try { await fs.access(parent, require('node:fs').constants.W_OK) }
    catch { throw new Error('Move Zaim to an Applications folder you can write to, then try updating again.') }
    const stage = path.join(parent, `.Zaim-update-${crypto.randomUUID()}`)
    await fs.mkdir(stage, { mode: 0o700 })
    try {
      await run('/usr/bin/ditto', ['-x', '-k', archive, stage])
      const replacement = path.join(stage, 'Zaim.app')
      if ((await fs.lstat(replacement)).isSymbolicLink()) throw new Error('Invalid update application.')
      const plist = path.join(replacement, 'Contents', 'Info.plist')
      const id = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])).stdout.trim()
      const version = (await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist])).stdout.trim()
      if (id !== 'tech.zeroai.zaim' || version !== this.pending.version) throw new Error('The update does not match Zaim.')
      return { stage, replacement, version }
    } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error }
  }
  async install(prepared) {
    const helper = path.join(this.directory, 'apply-update.sh')
    await fs.copyFile(path.join(__dirname, 'apply-mac-update.sh'), helper)
    const backup = this.appPath + '.previous-' + crypto.randomUUID()
    const log = path.join(this.directory, 'install.log')
    const child = spawn('/bin/sh', [helper, String(process.pid), this.appPath, prepared.replacement, backup, this.directory, prepared.version, String(this.port), log, prepared.stage], { detached: true, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  }
}
module.exports = { MacUpdater, checksum, validateManifest }
