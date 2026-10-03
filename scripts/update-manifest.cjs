const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
async function main() {
  const version = require('../package.json').version
  const directory = path.resolve(__dirname, '../release')
  for (const name of fs.readdirSync(directory)) {
    const match = /^Zaim-.*-mac-(arm64|x64)\.zip$/.exec(name)
    if (!match) continue
    const file = path.join(directory, name), hash = crypto.createHash('sha512')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    const url = `https://github.com/zeroai-tech/zaim/releases/download/v${version}/${name}`
    const metadata = { version, arch: match[1], url, blockmap: url + '.blockmap', size: fs.statSync(file).size, sha512: hash.digest('base64') }
    fs.writeFileSync(path.join(directory, `update-mac-${match[1]}.json`), JSON.stringify(metadata, null, 2) + '\n')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
