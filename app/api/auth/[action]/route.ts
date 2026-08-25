import { json } from '@/lib/auth'
import { verifyPassword, makeSession, sessionCookie, clearCookie, userIdFromReq } from '@/lib/session'
import { findUserByEmail, findUserById, listAccounts } from '@/lib/store'
import { probeImap } from '@/lib/mail'
import { discover, type MailHosts } from '@/lib/discover'
import {
  seal, mailboxCookie, clearMailboxCookie, mailboxFromReq, toAccount, MAILBOX_ACCOUNT_ID,
} from '@/lib/mailbox-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30 // signing in opens a real IMAP connection

// ─────────────────────────────────────────────────────────────────────────────
//  Sign in with the mailbox, not with a Zaim account.
//
//  There is no registration step. The mail server already knows who exists and
//  what their password is, so sign-in just proves the credentials against it by
//  opening an IMAP session; a mailbox created in the panel five seconds ago can
//  sign in immediately. Nothing is written to any database to read mail — the
//  verified credentials come back sealed in an httpOnly cookie.
//
//  The older vault path (a users row + saved third-party mailboxes) is still
//  honoured underneath so nobody who could sign in yesterday is locked out.
// ─────────────────────────────────────────────────────────────────────────────

const res = (data: unknown, cookies: string[], status = 200) => {
  const h = new Headers({ 'content-type': 'application/json' })
  for (const c of cookies) h.append('set-cookie', c)
  return new Response(JSON.stringify(data), { status, headers: h })
}

// GET /api/auth/me → who is signed in, and which mailboxes they can act on.
export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action !== 'me') return json({ error: 'Not found' }, 404)

  const mb = mailboxFromReq(req)
  const uid = userIdFromReq(req)

  // Saved third-party mailboxes, if this person also has a vault account.
  const saved = uid
    ? (await listAccounts(uid)).map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: false }))
    : []

  if (mb) {
    const user = uid ? await findUserById(uid) : null
    // The signed-in mailbox is always first and always the default; saved
    // accounts (Gmail and friends) follow it in the switcher.
    const accounts = [
      { id: MAILBOX_ACCOUNT_ID, label: mb.label || 'ZeroAI Mail', email: mb.email, isDefault: true },
      ...saved.filter((a) => a.email.toLowerCase() !== mb.email.toLowerCase()),
    ]
    return json({ user: { id: uid || MAILBOX_ACCOUNT_ID, email: mb.email, avatar: user?.avatar ?? null }, accounts })
  }

  if (!uid) return json({ user: null })
  const u = await findUserById(uid)
  if (!u) return json({ user: null })
  const rows = await listAccounts(uid)
  return json({
    user: { id: u.id, email: u.email, avatar: u.avatar ?? null },
    accounts: rows.map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: !!a.is_default })),
  })
}

// POST /api/auth/login|register|logout
// `register` is kept as an alias of `login`: there is nothing to register any
// more, but older clients (and the desktop build) still call it.
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action === 'logout') return res({ ok: true }, [clearCookie(), clearMailboxCookie()])
  if (action !== 'login' && action !== 'register') return json({ error: 'Not found' }, 404)

  let body: { email?: string; password?: string; imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ error: 'Please enter a valid email address.' }, 400)
  if (!password) return json({ error: 'Please enter your password.' }, 400)

  // An explicitly supplied server wins — that's the escape hatch for a mailbox
  // we can't work out on our own.
  const manual = (body.imapHost || '').trim()
  const port = Number(body.imapPort) || 993
  const candidates: MailHosts[] = manual
    ? [{
        imapHost: manual, imapPort: port, imapSecure: port !== 143,
        smtpHost: (body.smtpHost || manual).trim(), smtpPort: Number(body.smtpPort) || 465, smtpSecure: (Number(body.smtpPort) || 465) === 465,
        hosted: false, label: manual,
      }]
    : await discover(email)

  // Only a domain whose DNS actually points at us counts as ours — the
  // last-resort attempt doesn't, or every failed Gmail login would be told to
  // "use your mailbox password" instead of being asked for its mail server.
  const weHostThem = candidates.some((c) => c.hosted && !c.fallback)
  let authFailed = false
  // Each miss costs a connection attempt, so try the few most likely hosts and
  // stop well before the function's own 30s budget rather than 504-ing.
  const deadline = Date.now() + 22_000

  for (const c of candidates.slice(0, 4)) {
    if (Date.now() > deadline) break
    const cred = {
      email, pass: password,
      imapHost: c.imapHost, imapPort: c.imapPort, imapSecure: c.imapSecure,
      smtpHost: c.smtpHost, smtpPort: c.smtpPort, smtpSecure: c.smtpSecure,
      name: email.split('@')[0], label: c.label,
    }
    const probe = await probeImap(toAccount({ ...cred, exp: 0 }))
    if (probe.ok) {
      const cookies = [mailboxCookie(seal(cred))]
      // Someone who already had a vault account keeps it — their saved
      // third-party mailboxes and agent keys stay reachable in the same session.
      const u = await findUserByEmail(email).catch(() => undefined)
      if (u) cookies.push(sessionCookie(makeSession(u.id)))
      return res({ ok: true, user: { id: u?.id || MAILBOX_ACCOUNT_ID, email } }, cookies)
    }
    // The password is definitively wrong — trying more hosts can't help, and it
    // would keep hammering the server with the same bad credentials.
    if (probe.authFailed) { authFailed = true; break }
  }

  // The mail server said no (or we never found one). Before failing, honour a
  // pre-existing vault account so a mailbox that has since moved hosts, or one
  // whose owner set a different Zaim password, can still get in.
  const u = await findUserByEmail(email).catch(() => undefined)
  if (u && verifyPassword(password, u.pw_hash)) {
    return res({ ok: true, user: { id: u.id, email } }, [sessionCookie(makeSession(u.id))])
  }

  if (!candidates.length) {
    return json({ error: "We couldn't find the mail server for that address — enter it below.", needsMailServer: true }, 400)
  }
  // Only a mailbox we know is ours can be told plainly that the password is
  // wrong. For anywhere else, a rejection may just mean we guessed the server.
  return json({
    error: weHostThem
      ? "That email and password didn't work. Use the same password you use for your mailbox."
      : manual
        ? "Couldn't sign in — check the email, password and mail-server details."
        : "Couldn't sign in to that mailbox. Check the password, or enter your mail server below.",
    needsMailServer: !weHostThem && !manual,
    authFailed,
  }, 401)
}
