import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { simpleParser } from 'mailparser'
import type { MailAccount } from './config'

// ─────────────────────────────────────────────────────────────────────────────
//  The mail engine — the same proven imapflow + nodemailer + mailparser core the
//  ZeroAI mailer runs. Serverless-friendly: every call opens a connection, does
//  its work, and closes, so it runs fine in Vercel functions.
// ─────────────────────────────────────────────────────────────────────────────

export interface MailSummary {
  uid: number
  subject: string
  from: string
  fromName: string
  to: string
  date: string
  seen: boolean
  flagged: boolean
  snippet?: string
}
export interface MailFull extends MailSummary {
  html: string | null
  text: string | null
}

async function withImap<T>(account: MailAccount, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const { imap } = account
  const client = new ImapFlow({
    host: imap.host, port: imap.port, secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  })
  await client.connect()
  try { return await fn(client) } finally { await client.logout().catch(() => {}) }
}

const addrText = (a: any): string => (a?.text || a?.value?.[0]?.address || '')
const addrName = (a: any): string => (a?.value?.[0]?.name || a?.value?.[0]?.address || a?.text || '')

// The named folders a mailbox exposes. Providers disagree on paths (Namecheap:
// "INBOX.Sent"; Gmail: "[Gmail]/Sent Mail"), so we resolve by IMAP special-use
// flags first, then by name, and only return folders that actually exist.
export interface FolderInfo { key: string; label: string; icon: string; path: string }
export async function listFolders(account: MailAccount): Promise<FolderInfo[]> {
  return withImap(account, async (c) => {
    const boxes = await c.list()
    const find = (special: string, re: RegExp) =>
      boxes.find((b) => b.specialUse === special)?.path ||
      boxes.find((b) => re.test(b.path) || re.test(b.name))?.path || ''
    const all: FolderInfo[] = [
      { key: 'INBOX', label: 'Inbox', icon: '📥', path: 'INBOX' },
      { key: 'starred', label: 'Starred', icon: '⭐', path: 'INBOX' }, // flagged view over inbox
      { key: 'sent', label: 'Sent', icon: '📤', path: find('\\Sent', /(^|[./])sent/i) },
      { key: 'drafts', label: 'Drafts', icon: '📝', path: find('\\Drafts', /(^|[./])draft/i) },
      { key: 'archive', label: 'Archive', icon: '🗄️', path: find('\\Archive', /(^|[./])archive/i) },
      { key: 'junk', label: 'Spam', icon: '⚠️', path: find('\\Junk', /(^|[./])(junk|spam)/i) },
      { key: 'trash', label: 'Trash', icon: '🗑️', path: find('\\Trash', /(^|[./])(trash|deleted)/i) },
    ]
    return all.filter((f) => f.path)
  })
}

export async function listMailbox(account: MailAccount, mailbox = "INBOX", limit = 40, opts?: { flaggedOnly?: boolean }): Promise<MailSummary[]> {
  return withImap(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox)
    try {
      const total = (c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0) || 0
      if (!total) return []
      const out: MailSummary[] = []
      // Starred: search this mailbox for flagged messages, newest `limit`.
      if (opts?.flaggedOnly) {
        const uids = (await c.search({ flagged: true }, { uid: true })) || []
        if (!uids.length) return []
        const pick = uids.slice(-limit)
        for await (const m of c.fetch(pick, { uid: true, envelope: true, flags: true }, { uid: true })) {
          const env = m.envelope
          out.push({
            uid: m.uid, subject: env?.subject || '(no subject)',
            from: env?.from?.[0]?.address ?? '', fromName: env?.from?.[0]?.name || env?.from?.[0]?.address || '',
            to: env?.to?.[0]?.address || '', date: (env?.date || new Date()).toString(),
            seen: m.flags?.has('\\Seen') ?? false, flagged: true,
          })
        }
        return out.reverse()
      }
      const start = Math.max(1, total - limit + 1)
      for await (const m of c.fetch(`${start}:*`, { uid: true, envelope: true, flags: true })) {
        const env = m.envelope
        out.push({
          uid: m.uid,
          subject: env?.subject || '(no subject)',
          from: env?.from?.[0]?.address ?? '',
          fromName: env?.from?.[0]?.name || env?.from?.[0]?.address || '',
          to: env?.to?.[0]?.address || '',
          date: (env?.date || new Date()).toString(),
          seen: m.flags?.has('\\Seen') ?? false,
          flagged: m.flags?.has('\\Flagged') ?? false,
        })
      }
      return out.reverse() // newest first
    } finally { lock.release() }
  })
}

export async function getMessage(account: MailAccount, uid: number, mailbox = "INBOX"): Promise<MailFull | null> {
  return withImap(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox)
    try {
      const msg = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      if (!msg || !msg.source) return null
      const parsed = await simpleParser(msg.source as Buffer)
      // Mark read
      await c.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true }).catch(() => {})
      return {
        uid,
        subject: parsed.subject || '(no subject)',
        from: addrText(parsed.from),
        fromName: addrName(parsed.from),
        to: addrText(parsed.to),
        date: (parsed.date || new Date()).toISOString(),
        seen: true,
        flagged: false,
        html: parsed.html || null,
        text: parsed.text || null,
      }
    } finally { lock.release() }
  })
}

export interface SendInput { to: string; subject: string; html?: string; text?: string; cc?: string; bcc?: string; replyTo?: string }
export async function sendMail(account: MailAccount, input: SendInput): Promise<{ messageId: string }> {
  const { smtp, from, replyTo } = account
  const t = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  const info = await t.sendMail({
    from: `"${from.name}" <${from.email}>`,
    to: input.to, cc: input.cc, bcc: input.bcc,
    replyTo: input.replyTo || replyTo,
    subject: input.subject,
    html: input.html, text: input.text || (input.html ? undefined : ''),
  })
  return { messageId: info.messageId }
}

export async function verify(account: MailAccount): Promise<{ imap: boolean; smtp: boolean; error?: string }> {
  const res = { imap: false, smtp: false as boolean, error: undefined as string | undefined }
  try { await withImap(account, async () => {}); res.imap = true } catch (e) { res.error = 'IMAP: ' + (e as Error).message }
  try {
    const { smtp } = account
    const t = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass } })
    await t.verify(); res.smtp = true
  } catch (e) { res.error = (res.error ? res.error + ' | ' : '') + 'SMTP: ' + (e as Error).message }
  return res
}
