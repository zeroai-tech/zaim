const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const crypto = require('node:crypto'), zlib = require('node:zlib'), assert = require('node:assert/strict')
module.exports = async function verifyMacDelta(app, temp) {
  const directory = path.join(temp, 'delta'); fs.mkdirSync(directory)
  const size = 65536
  const old = Buffer.concat([Buffer.alloc(size, 1), Buffer.alloc(size, 2)])
  const next = Buffer.concat([Buffer.alloc(size, 1), Buffer.alloc(size, 3)])
  const map = last => ({ version: '2', files: [{ name: 'file', offset: 0, checksums: ['same-block', last], sizes: [size, size] }] })
  fs.writeFileSync(path.join(directory, 'installed.zip'), old)
  fs.writeFileSync(path.join(directory, 'installed.blockmap.json'), JSON.stringify(map('old-block')))
  let transferred = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/new.blockmap') { res.end(zlib.gzipSync(JSON.stringify(map('new-block')))); return }
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '')
    if (range) {
      const start = Number(range[1]), end = Number(range[2]), data = next.subarray(start, end + 1)
      transferred += data.length
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${next.length}`, 'content-length': data.length }); res.end(data)
    } else { transferred += next.length; res.end(next) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await app.evaluate(async ({ app, net }, { directory, digest, length, origin }) => {
      const nativeRequire = process.mainModule.require.bind(process.mainModule)
      const { MacUpdater } = nativeRequire(app.getAppPath() + '/electron/mac-updater.cjs')
      const updater = new MacUpdater({ directory, fetcher: (...args) => net.fetch(...args) })
      await updater.differential({ url: origin + '/new', blockmap: origin + '/new.blockmap', size: length, sha512: digest }, directory + '/new.zip')
    }, { directory, digest: crypto.createHash('sha512').update(next).digest('base64'), length: next.length, origin: `http://127.0.0.1:${server.address().port}` })
    assert.deepEqual(fs.readFileSync(path.join(directory, 'new.zip')), next)
    assert.equal(transferred, size, 'Only the changed block should transfer')
    console.log('PASS: packaged Mac differential updater reused cached blocks and verified the exact new archive.')
  } finally { await new Promise(resolve => server.close(resolve)) }
}
