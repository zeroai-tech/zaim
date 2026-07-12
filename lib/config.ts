import crypto from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
//  Account + security config.
//
//  Phase 1: a single account is configured via environment variables (never
//  committed). Passwords may be stored AES-256-GCM encrypted (ZAIM_ENC_KEY) so
//  no plaintext credential ever sits at rest. Phase 2 swaps this single-account
//  resolver for a per-user encrypted vault (multi-tenant) without touching the
//  API/UI above it — that's why account access goes through getAccount().
// ─────────────────────────────────────────────────────────────────────────────

export interface MailAccount {
  imap: { host: string; port: number; secure: boolean; user: string; pass: string }
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string }
  from: { name: string; email: string }
  replyTo?: string
}

// AES-256-GCM. A secret at rest is `enc:<iv>:<tag>:<ciphertext>` (base64). Plain
// values (no `enc:` prefix) are accepted too, so setup is easy and hardening is
// opt-in.
function key(): Buffer | null {
  const k = process.env.ZAIM_ENC_KEY
  if (!k) return null
  return crypto.createHash('sha256').update(k).digest() // 32 bytes
}
export function encryptSecret(plain: string): string {
  const k = key()
  if (!k) return plain
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `enc:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}
export function decryptSecret(v: string | undefined): string {
  if (!v) return ''
  if (!v.startsWith('enc:')) return v
  const k = key()
  if (!k) throw new Error('ZAIM_ENC_KEY is required to read an encrypted secret')
  const [, iv, tag, ct] = v.split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

const num = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d)
const bool = (v: string | undefined, d: boolean) => (v == null ? d : v === 'true' || v === '1')

// The current account. Phase 2: look this up per authenticated user.
export function getAccount(): MailAccount {
  const e = process.env
  const imapUser = e.ZAIM_IMAP_USER || ''
  const smtpUser = e.ZAIM_SMTP_USER || e.ZAIM_IMAP_USER || ''
  return {
    imap: {
      host: e.ZAIM_IMAP_HOST || '',
      port: num(e.ZAIM_IMAP_PORT, 993),
      secure: bool(e.ZAIM_IMAP_SECURE, true),
      user: imapUser,
      pass: decryptSecret(e.ZAIM_IMAP_PASS),
    },
    smtp: {
      host: e.ZAIM_SMTP_HOST || '',
      port: num(e.ZAIM_SMTP_PORT, 465),
      secure: bool(e.ZAIM_SMTP_SECURE, true),
      user: smtpUser,
      pass: decryptSecret(e.ZAIM_SMTP_PASS || e.ZAIM_IMAP_PASS),
    },
    from: { name: e.ZAIM_FROM_NAME || 'Me', email: e.ZAIM_FROM_EMAIL || imapUser },
    replyTo: e.ZAIM_REPLY_TO || imapUser,
  }
}

export function isConfigured(): boolean {
  const a = getAccount()
  return !!(a.imap.host && a.imap.user && a.imap.pass && a.smtp.host)
}
