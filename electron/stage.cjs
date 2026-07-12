// Copy .next/static + public INTO .next/standalone so the packaged standalone
// server can serve them (packaged resources are read-only at runtime).
const fs = require('node:fs'); const path = require('node:path')
const root = path.join(__dirname, '..'); const st = path.join(root, '.next', 'standalone')
for (const [src, dst] of [
  [path.join(root, '.next', 'static'), path.join(st, '.next', 'static')],
  [path.join(root, 'public'), path.join(st, 'public')],
]) { fs.rmSync(dst, { recursive: true, force: true }); if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true }) }

// Drop native modules from the standalone copy so `require` falls through to the
// app-root node_modules, which electron-builder rebuilds for Electron's ABI
// (the standalone copy carries the wrong-ABI / stripped binary).
for (const m of ['better-sqlite3']) fs.rmSync(path.join(st, 'node_modules', m), { recursive: true, force: true })
console.log('  staged static + public; dropped native modules from standalone (use app-root rebuild)')
