#!/usr/bin/env node
// `zaim login` — sign an agent in against the mail server, no database involved.
import * as oauth from './lib/oauth.mjs'

const args = process.argv.slice(2)
const cmd = args[0] || 'login'

if (cmd === 'logout') {
  console.log(oauth.forget() ? 'Signed out.' : 'Not signed in.')
  process.exit(0)
}

if (cmd === 'status') {
  const c = oauth.load()
  if (!c) { console.log('Not signed in. Run: zaim login you@yourdomain.com'); process.exit(1) }
  const mins = Math.round((c.expires_at - Date.now()) / 60000)
  console.log(`Signed in as ${c.email} on ${c.host}`)
  console.log(`Access token ${mins > 0 ? `valid ${mins} more minute(s)` : 'expired — will refresh on next use'}`)
  console.log(`Refresh token ${c.refresh_token ? 'stored' : 'MISSING (you will have to log in again)'}`)
  console.log(`Stored at ${oauth.configPath()}`)
  process.exit(0)
}

const email = args[1] || args[0]
if (!email || !email.includes('@')) {
  console.error('Usage: zaim login you@yourdomain.com   |   zaim login status   |   zaim login logout')
  process.exit(1)
}
const host = oauth.mailHost() || 'mail.' + email.split('@')[1]

const d = await oauth.startDeviceFlow(host)
console.log(`\n  Open:  ${d.verification_uri_complete || d.verification_uri}`)
console.log(`  Code:  ${d.user_code}\n`)
console.log(`  Sign in as ${email} and approve. Waiting…`)

const tok = await oauth.pollForToken(d.meta, d.device_code, d.interval, d.expires_in)
const saved = oauth.save({
  email, host,
  access_token: tok.access_token,
  refresh_token: tok.refresh_token || null,
  expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
  scope: tok.scope || null,
})
console.log(`\n  Signed in as ${email}. Credentials stored at ${saved}`)
console.log(`  Revoke any time from the mail server — no key to delete here.`)
