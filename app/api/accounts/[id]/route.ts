import { json } from '@/lib/auth'
import { userIdFromReq } from '@/lib/session'
import { mailboxFromReq, MAILBOX_ACCOUNT_ID } from '@/lib/mailbox-session'
import { setDefault, deleteAccount, getAccount, updateAccount, resolveAccount } from '@/lib/store'
import { verify } from '@/lib/mail'
import type { MailAccount } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30 // PUT verifies IMAP+SMTP before saving

// Current settings to pre-fill the edit form (no passwords ever returned).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  // The signed-in mailbox isn't a stored row — its settings come from the mail
  // server itself, so they're shown but not editable here.
  const mb = mailboxFromReq(req)
  if (id === MAILBOX_ACCOUNT_ID && mb) {
    return json({ ok: true, managed: true, account: {
      id: MAILBOX_ACCOUNT_ID, label: mb.label || 'ZeroAI Mail',
      imapHost: mb.imapHost, imapPort: mb.imapPort, imapSecure: mb.imapSecure, imapUser: mb.email,
      smtpHost: mb.smtpHost, smtpPort: mb.smtpPort, smtpSecure: mb.smtpSecure, smtpUser: mb.email,
      fromEmail: mb.email, replyTo: mb.email,
    } })
  }
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  const account = await getAccount(uid, id)
  if (!account) return json({ error: 'Not found' }, 404)
  return json({ ok: true, account })
}

// Edit the mailbox's server settings — the fix for a mailbox still pointing at
// an old server (mail sends but nothing arrives). We VERIFY the new settings
// against the live server before saving, so a bad edit can't lock the box.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (id === MAILBOX_ACCOUNT_ID) return json({ error: 'This mailbox lives on your mail server — change it there, or sign in as a different mailbox.' }, 400)
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  const cur = await resolveAccount(uid, id)
  if (!cur) return json({ error: 'Not found' }, 404)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  const num = (v: unknown, d: number) => (Number(v) || d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const newImapPass = typeof b.imapPass === 'string' ? b.imapPass : ''
  const newSmtpPass = typeof b.smtpPass === 'string' ? b.smtpPass : ''

  // Merge the edits over the current (decrypted) account and prove it works.
  const probe: MailAccount = {
    imap: { host: str(b.imapHost, cur.imap.host), port: num(b.imapPort, cur.imap.port), secure: bool(b.imapSecure, cur.imap.secure), user: str(b.imapUser, cur.imap.user), pass: newImapPass || cur.imap.pass },
    smtp: { host: str(b.smtpHost, cur.smtp.host), port: num(b.smtpPort, cur.smtp.port), secure: bool(b.smtpSecure, cur.smtp.secure), user: str(b.smtpUser, cur.smtp.user), pass: newSmtpPass || cur.smtp.pass },
    from: cur.from, replyTo: cur.replyTo,
  }
  const v = await verify(probe)
  if (!v.imap) return json({ error: v.error || 'Could not connect to the incoming (IMAP) server with these settings.', verified: false }, 400)

  await updateAccount(uid, id, {
    label: typeof b.label === 'string' && b.label.trim() ? b.label.trim() : undefined,
    imapHost: probe.imap.host, imapPort: probe.imap.port, imapSecure: probe.imap.secure, imapUser: probe.imap.user,
    imapPass: newImapPass || undefined,
    smtpHost: probe.smtp.host, smtpPort: probe.smtp.port, smtpSecure: probe.smtp.secure, smtpUser: probe.smtp.user,
    smtpPass: newSmtpPass || undefined,
  })
  return json({ ok: true, smtpOk: v.smtp, warning: v.smtp ? undefined : 'Incoming mail is fixed and saved, but sending (SMTP) could not be verified — check the outgoing settings.' })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (id === MAILBOX_ACCOUNT_ID) return json({ error: 'This mailbox lives on your mail server — change it there, or sign in as a different mailbox.' }, 400)
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  await setDefault(uid, id)
  return json({ ok: true })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (id === MAILBOX_ACCOUNT_ID) return json({ error: 'This mailbox lives on your mail server — change it there, or sign in as a different mailbox.' }, 400)
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  await deleteAccount(uid, id)
  return json({ ok: true })
}
