import { json } from '@/lib/auth'
import { ensureUserId, withLink } from '@/lib/link-user'
import { addAccount, listAccounts, type AccountInput } from '@/lib/store'
import { verify } from '@/lib/mail'
import type { MailAccount } from '@/lib/config'
import { discover, hostedHost } from '@/lib/discover'
import { isZeroAIEmail } from '@/lib/managed-mail'
import { mailboxFromReq } from '@/lib/mailbox-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30 // adding a mailbox opens real IMAP and SMTP connections

// GET → the user's accounts (labels/emails only, never secrets)
export async function GET(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  return withLink(json({ accounts: (await listAccounts(uid)).map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: !!a.is_default })) }), { uid, setCookie })
}

interface ServerPair {
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  label: string; hosted?: boolean; fallback?: boolean
}

/**
 * Receiving and sending are two different servers.
 *
 * They used to be one: whatever host was typed became the IMAP host, and the
 * SMTP host fell back to the same string. For a provider that runs both on one
 * name (our own Stalwart) that is right, and for everyone else it is wrong —
 * `imap.gmail.com` does not accept mail for sending. Gmail also fails in the
 * other direction and far more confusingly: `smtp.gmail.com` on the IMAP side
 * answers with an SMTP banner, so the client waits for an IMAP greeting that
 * never comes and reports a timeout rather than the real mistake.
 *
 * So a host given as one half names the other half too.
 */
function pairFromHost(host: string, a: AccountInput): ServerPair {
  const h = host.trim().toLowerCase()
  const imapHost = /^smtp\./.test(h) ? h.replace(/^smtp\./, 'imap.') : h
  const smtpHost = (a.smtpHost || '').trim().toLowerCase()
    || (/^imap\./.test(h) ? h.replace(/^imap\./, 'smtp.') : h)
  const imapPort = Number(a.imapPort) || 993
  const smtpPort = Number(a.smtpPort) || 465
  return {
    imapHost, imapPort, imapSecure: a.imapSecure === false ? false : imapPort !== 143,
    smtpHost, smtpPort, smtpSecure: a.smtpSecure === false ? false : smtpPort === 465,
    label: imapHost, hosted: imapHost === hostedHost(),
  }
}

const toMailAccount = (p: ServerPair, user: string, pass: string): MailAccount => ({
  imap: { host: p.imapHost, port: p.imapPort, secure: p.imapSecure, user, pass },
  smtp: { host: p.smtpHost, port: p.smtpPort, secure: p.smtpSecure, user, pass },
  from: { name: user.split('@')[0], email: user },
  replyTo: user,
})

// POST → add + verify a mailbox. Credentials are AES-encrypted before storage.
export async function POST(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  let a: AccountInput
  try { a = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }

  const user = (a.imapUser || '').trim().toLowerCase()
  if (!a.label || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !a.imapPass) return json({ error: 'label, imapUser and imapPass are required' }, 400)

  if (mailboxFromReq(req)?.email.toLowerCase() === user || (await listAccounts(uid)).some(account => account.imap_user.toLowerCase() === user)) {
    return withLink(json({ error: 'This mailbox is already connected. Select it from the mailbox switcher, or update it in Mailbox settings.' }, 409), { uid, setCookie })
  }

  // The host is now optional. Most people know their address and their
  // password and nothing else, and the app already knows how to find Gmail,
  // Outlook, Zoho and our own server from the address alone — asking anyway
  // is how "smtp.gmail.com" ended up in a field that wanted an IMAP server.
  const pairs: ServerPair[] = a.imapHost?.trim() && !isZeroAIEmail(user)
    ? [pairFromHost(a.imapHost, a)]
    : (await discover(user)).map((c) => ({
        imapHost: c.imapHost, imapPort: c.imapPort, imapSecure: c.imapSecure,
        smtpHost: c.smtpHost, smtpPort: c.smtpPort, smtpSecure: c.smtpSecure,
        label: c.label, hosted: c.hosted, fallback: c.fallback,
      }))

  if (!pairs.length) {
    return withLink(json({ error: "We couldn't work out the mail server for that address — enter it below.", needsMailServer: true }, 400), { uid, setCookie })
  }

  const managed = pairs.some(p => p.hosted && !p.fallback)
  let lastError = ''
  for (const p of pairs.slice(0, 4)) {
    const v = await verify(toMailAccount(p, user, a.imapPass))
    if (!v.imap) { lastError = v.error || 'Could not connect'; continue }

    // Only now does it reach the database. It used to be inserted first and
    // verified second, so every failed attempt left a broken mailbox behind
    // that the account switcher would go on offering.
    const id = await addAccount(uid, {
      ...a,
      label: a.label,
      imapHost: p.imapHost, imapPort: p.imapPort, imapSecure: p.imapSecure,
      smtpHost: p.smtpHost, smtpPort: p.smtpPort, smtpSecure: p.smtpSecure,
      imapUser: user, smtpUser: a.smtpUser || user,
      fromEmail: a.fromEmail || user,
    })
    return withLink(json({
      ok: true, id,
      verified: { imap: true, smtp: v.smtp },
      server: { imapHost: p.imapHost, imapPort: p.imapPort, smtpHost: p.smtpHost, smtpPort: p.smtpPort },
      // Reading works, sending does not. Worth saying plainly rather than
      // reporting a clean success and failing on the first send.
      warning: v.smtp ? undefined : `Mail can be read, but sending failed: ${v.error || 'SMTP did not accept these details.'}`,
    }), { uid, setCookie })
  }

  console.error(`[accounts] could not connect ${user} — tried ${pairs.slice(0, 4).map((p) => `${p.imapHost}:${p.imapPort}`).join(', ')}: ${lastError}`)
  return withLink(json({
    ok: false, verified: false, needsMailServer: !managed && !/AUTHENTICATIONFAILED|invalid password|credentials/i.test(lastError),
    error: 'Could not connect to that mailbox.',
    detail: lastError || undefined,
    triedHosts: pairs.slice(0, 4).map((p) => `${p.imapHost}:${p.imapPort}`),
    hint: !managed && /2|app password|credentials|AUTHENTICATIONFAILED/i.test(lastError)
      ? 'With two-factor authentication on, use an app password rather than your normal one.'
      : undefined,
  }, 200), { uid, setCookie })
}
