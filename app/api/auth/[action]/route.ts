import { json } from '@/lib/auth'
import { hashPassword, verifyPassword, makeSession, sessionCookie, clearCookie, userIdFromReq } from '@/lib/session'
import { createUser, findUserByEmail, findUserById, listAccounts, addAccount } from '@/lib/store'
import { verify } from '@/lib/mail'
import type { MailAccount } from '@/lib/config'
import { promises as dns } from 'node:dns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30 // verifying a mailbox on signup opens an IMAP connection

// A domain we host ourselves (its MX points at ZAIM_HOSTED_MAIL_HOST, e.g.
// mail.zeroaitech.tech) → signup connects to our server automatically, no config.
// Everyone else must supply + verify their own mail server. Either way, a mailbox
// that doesn't actually authenticate can never create an account.
const HOSTED_HOST = (process.env.ZAIM_HOSTED_MAIL_HOST || '').trim().toLowerCase()
async function isHostedDomain(email: string): Promise<boolean> {
  if (!HOSTED_HOST) return false
  const domain = (email.split('@')[1] || '').toLowerCase()
  if (!domain) return false
  if (domain === HOSTED_HOST || HOSTED_HOST.endsWith('.' + domain)) return true
  try {
    const mx = await dns.resolveMx(domain)
    return mx.some((r) => r.exchange.toLowerCase().replace(/\.$/, '') === HOSTED_HOST)
  } catch { return false }
}

const cookie = (setCookie: string, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'set-cookie': setCookie } })

// GET /api/auth/me → current user + their accounts (no secrets)
export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action !== 'me') return json({ error: 'Not found' }, 404)
  const uid = userIdFromReq(req)
  if (!uid) return json({ user: null })
  const u = await findUserById(uid)
  if (!u) return json({ user: null })
  const accounts = (await listAccounts(uid)).map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: !!a.is_default }))
  return json({ user: { id: u.id, email: u.email, avatar: u.avatar ?? null }, accounts })
}

// POST /api/auth/register|login|logout
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action === 'logout') return cookie(clearCookie(), { ok: true })

  let body: { email?: string; password?: string; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254

  if (action === 'register') {
    if (!emailValid) return json({ error: 'Please enter a valid email address.' }, 400)
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
    if (await findUserByEmail(email)) return json({ error: 'An account with that email already exists' }, 409)

    // Prove the mailbox is real by actually signing in to it before creating
    // anything — no fake / non-existent address can register. Our own hosted
    // domains connect automatically; everyone else supplies their mail server.
    const hosted = await isHostedDomain(email)
    const imapHost = hosted ? HOSTED_HOST : (body.imapHost || '').trim()
    if (!imapHost) return json({ error: 'Enter your mail server so we can verify this mailbox.', needsMailServer: true }, 400)
    const imapPort = hosted ? 993 : (Number(body.imapPort) || 993)
    const smtpHost = hosted ? HOSTED_HOST : ((body.smtpHost || body.imapHost || '').trim())
    const smtpPort = hosted ? 465 : (Number(body.smtpPort) || 465)
    const probe: MailAccount = {
      imap: { host: imapHost, port: imapPort, secure: imapPort !== 143, user: email, pass: password },
      smtp: { host: smtpHost, port: smtpPort, secure: smtpPort === 465, user: email, pass: password },
      from: { name: email.split('@')[0], email }, replyTo: email,
    }
    const v = await verify(probe)
    if (!v.imap) return json({ error: `Couldn't sign in to that mailbox — check the ${hosted ? 'email and password' : 'email, password and mail-server details'}.`, needsMailServer: !hosted }, 401)

    const u = await createUser(email, hashPassword(password))
    await addAccount(u.id, {
      label: hosted ? 'ZeroAI Mail' : imapHost,
      imapHost, imapPort, imapSecure: probe.imap.secure, imapUser: email, imapPass: password,
      smtpHost, smtpPort, smtpSecure: probe.smtp.secure, smtpUser: email, smtpPass: password,
      fromEmail: email, fromName: email.split('@')[0],
    })
    return cookie(sessionCookie(makeSession(u.id)), { ok: true, user: { id: u.id, email } })
  }
  if (action === 'login') {
    const u = await findUserByEmail(email)
    if (!u || !verifyPassword(password, u.pw_hash)) return json({ error: 'Wrong email or password' }, 401)
    return cookie(sessionCookie(makeSession(u.id)), { ok: true, user: { id: u.id, email } })
  }
  return json({ error: 'Not found' }, 404)
}
