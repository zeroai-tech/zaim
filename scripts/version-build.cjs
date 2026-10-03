const fs = require('node:fs'), path = require('node:path')
function buildVersion(base, run) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^\d+$/.test(String(run)) || Number(run) < 1 || !Number.isSafeInteger(Number(run))) throw new Error('Invalid release version or build number')
  return base.split('.').slice(0, 2).join('.') + '.' + Number(run)
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const version = buildVersion(pkg.version, process.env.GITHUB_RUN_NUMBER)
  pkg.version = version; fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')))
  lock.version = version; lock.packages[''].version = version
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  console.log(`Release version: ${version}`)
}
module.exports = { buildVersion }
