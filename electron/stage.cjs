// Copy .next/static + public INTO .next/standalone so the packaged standalone
// server can serve them (packaged resources are read-only at runtime).
const fs = require('node:fs'); const path = require('node:path')
const root = path.join(__dirname, '..')
// Next nests standalone under a package-named subdirectory when it infers a
// workspace root above the project (a stray lockfile in the parent does it).
// Staging to the wrong level leaves the server without its static assets.
const base = path.join(root, '.next', 'standalone')
function standaloneDir() {
  if (fs.existsSync(path.join(base, 'server.js'))) return base
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(base, e.name, 'server.js'))) return path.join(base, e.name)
  }
  return base
}
const st = standaloneDir()
for (const [src, dst] of [
  [path.join(root, '.next', 'static'), path.join(st, '.next', 'static')],
  [path.join(root, 'public'), path.join(st, 'public')],
]) { fs.rmSync(dst, { recursive: true, force: true }); if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true }) }

// Drop native modules from the standalone copy so `require` falls through to the
// app-root node_modules, which electron-builder rebuilds for Electron's ABI
// (the standalone copy carries the wrong-ABI / stripped binary).
for (const m of ['better-sqlite3']) fs.rmSync(path.join(st, 'node_modules', m), { recursive: true, force: true })
console.log(`  standalone at ${st}`)
console.log('  staged static + public; dropped native modules from standalone (use app-root rebuild)')

// Build-time env files must never become installer contents.
for (const folder of [base, st]) for (const name of fs.readdirSync(folder)) {
  if (/^\.env(?:\.|$)/.test(name)) fs.rmSync(path.join(folder, name), { force: true })
}
