#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  zaim — CLI for the Zaim mail API. Built so AI agents (Claude Code, Gemini,
//  Codex) can read and send professional email from a terminal or a tool call.
//
//  Config (env):  ZAIM_URL  (default http://localhost:3000)   ZAIM_API_KEY
//
//    zaim status
//    zaim list [--limit 40] [--mailbox INBOX] [--json]
//    zaim read <uid> [--json]
//    zaim send --to a@b.com --subject "Hi" --body "text" [--cc] [--bcc] [--html "<p>..</p>"]
//    zaim draft --to a@b.com --subject "Hi" --body "text" [--cc] [--bcc] [--html "<p>..</p>"]
//    zaim encrypt "<password>"     # local: needs ZAIM_ENC_KEY, prints enc:... for .env
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto'

const BASE = (process.env.ZAIM_URL || 'http://localhost:3000').replace(/\/$/, '')
const KEY = process.env.ZAIM_API_KEY || ''
const [cmd, ...rest] = process.argv.slice(2)

function flags(args) {
  const f = {}; const pos = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { const k = args[i].slice(2); const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; f[k] = v }
    else pos.push(args[i])
  }
  return { f, pos }
}
async function call(path, init) {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, ...(init?.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) { console.error(`✗ ${res.status}: ${body.error || res.statusText}`); process.exit(1) }
  return body
}
const die = (m) => { console.error('✗ ' + m); process.exit(1) }

const { f, pos } = flags(rest)
const asJson = !!f.json

switch (cmd) {
  case 'status': {
    const s = await call('/api/session')
    console.log(asJson ? JSON.stringify(s) : `authenticated: ${s.authed} · mail configured: ${s.configured} · ${BASE}`)
    break
  }
  case 'list': {
    const r = await call(`/api/mail/list?limit=${f.limit || 40}&mailbox=${encodeURIComponent(f.mailbox || 'INBOX')}`)
    if (asJson) { console.log(JSON.stringify(r.messages)); break }
    for (const m of r.messages) console.log(`${String(m.uid).padStart(6)}  ${m.seen ? ' ' : '●'} ${(m.fromName || m.from).slice(0, 24).padEnd(24)}  ${m.subject.slice(0, 60)}`)
    break
  }
  case 'read': {
    const uid = pos[0]; if (!uid) die('usage: zaim read <uid>')
    const r = await call(`/api/mail/message/${uid}`)
    if (asJson) { console.log(JSON.stringify(r.message)); break }
    const m = r.message
    console.log(`From: ${m.from}\nTo:   ${m.to}\nDate: ${m.date}\nSubj: ${m.subject}\n${'─'.repeat(60)}\n${m.text || m.html?.replace(/<[^>]+>/g, '') || '(no body)'}`)
    break
  }
  case 'send': {
    if (!f.to || !f.subject) die('usage: zaim send --to <addr> --subject <s> --body <text> [--html <h>]')
    const r = await call('/api/mail/send', { method: 'POST', body: JSON.stringify({ to: f.to, subject: f.subject, text: f.body, html: f.html, cc: f.cc, bcc: f.bcc }) })
    console.log(asJson ? JSON.stringify(r) : `✓ sent — ${r.messageId}`)
    break
  }
  case 'draft': {
    if (!f.to || !f.subject) die('usage: zaim draft --to <addr> --subject <s> --body <text> [--html <h>]')
    const r = await call('/api/mail/draft', { method: 'POST', body: JSON.stringify({ to: f.to, subject: f.subject, text: f.body, html: f.html, cc: f.cc, bcc: f.bcc }) })
    console.log(asJson ? JSON.stringify(r) : `✓ saved to Drafts — never sent`)
    break
  }
  case 'encrypt': {
    const plain = pos[0]; const k = process.env.ZAIM_ENC_KEY
    if (!plain) die('usage: zaim encrypt "<password>"')
    if (!k) die('set ZAIM_ENC_KEY first (openssl rand -hex 32)')
    const key = crypto.createHash('sha256').update(k).digest()
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    console.log(`enc:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`)
    break
  }
  default:
    console.log(`zaim — secure mail from your terminal & agents

  zaim status
  zaim list [--limit N] [--mailbox INBOX] [--json]
  zaim read <uid> [--json]
  zaim send --to <addr> --subject <s> --body <text> [--html <h>] [--cc] [--bcc]
  zaim draft --to <addr> --subject <s> --body <text> [--html <h>] [--cc] [--bcc]
  zaim encrypt "<password>"

env: ZAIM_URL (default http://localhost:3000), ZAIM_API_KEY`)
}
