// OAuth device flow against the mail server itself.
//
// Agent access used to mean a `zaim_…` key looked up in Postgres — a second,
// parallel answer to "who is this?" that the mail server knew nothing about, and
// that could not be revoked from the place that actually owns the mailbox.
//
// Stalwart is a full OAuth 2.0 authorization server, and its IMAP advertises
// OAUTHBEARER/XOAUTH2, so a token it issues authenticates directly against the
// mailbox. That makes the database unnecessary: `zaim login` runs the device
// flow, the token is stored on this machine, and revoking it in Stalwart kills
// it everywhere at once.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CONF_DIR = process.env.ZAIM_CONFIG_DIR || path.join(os.homedir(), '.zaim')
const CONF = path.join(CONF_DIR, 'credentials.json')
const CLIENT_ID = 'zaim'

export function mailHost() {
  // Derived from the address unless told otherwise, so `zaim login you@acme.com`
  // works without asking anyone to look up a hostname.
  return (process.env.ZAIM_MAIL_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
}

async function discover(host) {
  const r = await fetch(`https://${host}/.well-known/oauth-authorization-server`)
  if (!r.ok) throw new Error(`${host} does not look like a Stalwart mail server (HTTP ${r.status})`)
  return r.json()
}

const form = (o) => new URLSearchParams(o).toString()

export async function startDeviceFlow(host, scope = 'urn:ietf:params:oauth:scope:mail offline_access') {
  const meta = await discover(host)
  if (!meta.device_authorization_endpoint) throw new Error('This mail server does not support device login.')
  const r = await fetch(meta.device_authorization_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: CLIENT_ID, scope }),
  })
  if (!r.ok) throw new Error(`Could not start login (HTTP ${r.status})`)
  return { meta, ...(await r.json()) }
}

// Poll until the person approves. `authorization_pending` and `slow_down` are
// the normal path, not errors — anything else genuinely ends the attempt.
export async function pollForToken(meta, deviceCode, intervalSec = 5, expiresIn = 1800) {
  const deadline = Date.now() + expiresIn * 1000
  let wait = intervalSec * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    const r = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: CLIENT_ID, device_code: deviceCode,
                   grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok && d.access_token) return d
    if (d.error === 'authorization_pending') continue
    if (d.error === 'slow_down') { wait += 5000; continue }
    throw new Error(d.error_description || d.error || `Login failed (HTTP ${r.status})`)
  }
  throw new Error('Login timed out — run it again.')
}

export async function refresh(meta, refreshToken) {
  const r = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: CLIENT_ID, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Could not refresh — run `zaim login` again.')
  return d
}

// ── stored credentials ──────────────────────────────────────────────────────
export function load() {
  try { return JSON.parse(fs.readFileSync(CONF, 'utf8')) } catch { return null }
}

export function save(c) {
  fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(CONF, JSON.stringify(c, null, 2), { mode: 0o600 })
  return CONF
}

export function forget() {
  try { fs.unlinkSync(CONF); return true } catch { return false }
}

export const configPath = () => CONF

// A token good for at least another minute, refreshing it if not. The expiry
// comes from the server's own `expires_in` rather than a hardcoded lifetime, so
// this keeps working whatever the server is configured to hand out.
export async function accessToken() {
  const c = load()
  if (!c) return null
  if (c.expires_at && Date.now() < c.expires_at - 60_000) return c
  if (!c.refresh_token) return c
  const meta = await discover(c.host)
  const d = await refresh(meta, c.refresh_token)
  const next = {
    ...c,
    access_token: d.access_token,
    refresh_token: d.refresh_token || c.refresh_token,
    expires_at: Date.now() + (d.expires_in || 3600) * 1000,
  }
  save(next)
  return next
}
