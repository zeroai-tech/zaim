import crypto from 'node:crypto'
import type { MailAccount } from './config'

// ─────────────────────────────────────────────────────────────────────────────
//  Mailbox sessions — sign in with the mailbox itself, no database.
//
//  The mail server IS the account system. There is no "Zaim account" to create
//  and no users table to consult: you type the address and password your mail
//  server already knows, we prove them by opening a real IMAP session, and on
//  success we hand back a sealed cookie carrying those same credentials.
//
//  The cookie is AES-256-GCM sealed with a server-only key, so the browser
//  holds an opaque blob it cannot read or forge, and the server needs no
//  storage to turn it back into a working mailbox on the next request. Add a
//  mailbox on the mail server → that person can sign in to Zaim immediately.
//
//  (The older vault path — a users table plus encrypted IMAP creds — still
//  works for third-party mailboxes people added before this; see lib/store.ts.)
// ─────────────────────────────────────────────────────────────────────────────

export const MAILBOX_COOKIE = 'zaim_mb'
const TTL_DAYS = 30

export interface MailboxCred {
  email: string
  pass: string
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  name?: string
  label?: string   // how the mailbox is named in the account switcher
  exp: number
}

// The sealing key. ZAIM_SESSION_SECRET is the deployment's session secret and is
// already required for the vault login path, so nothing new needs provisioning.
function key(): Buffer | null {
  const k = process.env.ZAIM_SESSION_SECRET || process.env.ZAIM_ENC_KEY || process.env.ZAIM_API_KEY
  if (!k) return null
  return crypto.createHash('sha256').update(`zaim-mailbox-session:${k}`).digest()
}

export function seal(cred: Omit<MailboxCred, 'exp'>, days = TTL_DAYS): string {
  const k = key()
  if (!k) throw new Error('ZAIM_SESSION_SECRET is required to sign in')
  const payload: MailboxCred = { ...cred, exp: Date.now() + days * 864e5 }
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.')
}

export function open(token: string | undefined): MailboxCred | null {
  const k = key()
  if (!token || !k) return null
  const [iv, tag, ct] = token.split('.')
  if (!iv || !tag || !ct) return null
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    const json = Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
    const cred = JSON.parse(json) as MailboxCred
    // A tampered or expired cookie is simply "not signed in" — never an error.
    return cred?.email && cred.exp > Date.now() ? cred : null
  } catch { return null }
}

// Serverless (Vercel) is HTTPS, so the cookie is Secure there. The desktop shell
// serves over http://127.0.0.1 with NODE_ENV=production, where a Secure cookie is
// silently dropped — hence the same local-HTTP escape hatch the vault path uses.
export function mailboxCookie(token: string, days = TTL_DAYS): string {
  const secure = process.env.NODE_ENV === 'production' && process.env.ZAIM_LOCAL_HTTP !== '1'
  return `${MAILBOX_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${days * 86400}${secure ? '; Secure' : ''}`
}
export const clearMailboxCookie = () => `${MAILBOX_COOKIE}=; HttpOnly; Path=/; Max-Age=0`

export const mailboxFromReq = (req: Request): MailboxCred | null =>
  open((req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${MAILBOX_COOKIE}=([^;]+)`))?.[1])

// A sealed credential is already a complete mail account — this is the whole
// reason no database row is needed to read mail.
export function toAccount(c: MailboxCred): MailAccount {
  return {
    imap: { host: c.imapHost, port: c.imapPort, secure: c.imapSecure, user: c.email, pass: c.pass },
    smtp: { host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, user: c.email, pass: c.pass },
    from: { name: c.name || c.email.split('@')[0], email: c.email },
    replyTo: c.email,
  }
}

// The synthetic account id a mailbox session exposes to the UI, so the client's
// existing account-switcher shape keeps working without a real accounts row.
export const MAILBOX_ACCOUNT_ID = 'mailbox'
