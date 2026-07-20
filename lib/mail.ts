import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
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
export interface MailAttachmentMeta { filename: string; contentType: string; size: number }
export interface MailFull extends MailSummary {
  html: string | null
  text: string | null
  cc: string
  attachments: MailAttachmentMeta[]
}

// imapflow's own defaults (90s connect, 5min socket) far outlast a serverless
// function's execution budget -- a stalled connection would hang until the
// platform kills the function from outside, producing an opaque 502 our own
// code never gets a chance to catch or explain. Fail fast instead -- but not
// TOO fast: 8s greeting turned out to be tighter than this account's real
// mail host needs under normal (non-stalled) conditions, so every call
// started failing outright instead of just the genuinely-stuck ones.
async function withImap<T>(account: MailAccount, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const { imap } = account
  const client = new ImapFlow({
    host: imap.host, port: imap.port, secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
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
        cc: addrText(parsed.cc),
        attachments: (parsed.attachments || []).map((a) => ({
          filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', size: a.size || (a.content?.length ?? 0),
        })),
      }
    } finally { lock.release() }
  })
}

// Fetch one attachment's bytes (by index) for download.
export async function getAttachment(account: MailAccount, uid: number, mailbox = "INBOX", index = 0): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  return withImap(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox)
    try {
      const msg = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      if (!msg || !msg.source) return null
      const parsed = await simpleParser(msg.source as Buffer)
      const a = (parsed.attachments || [])[index]
      if (!a) return null
      return { filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', content: a.content as Buffer }
    } finally { lock.release() }
  })
}

export interface SendAttachment { filename: string; content: string; encoding?: string; contentType?: string }
export interface SendInput { to: string; subject: string; html?: string; text?: string; cc?: string; bcc?: string; replyTo?: string; attachments?: SendAttachment[] }

// Build the full raw MIME once, so the exact same bytes we send can also be
// saved to the Sent folder.
function buildRaw(account: MailAccount, input: SendInput): Promise<Buffer> {
  const { from, replyTo } = account
  const mc = new MailComposer({
    from: `"${from.name}" <${from.email}>`,
    to: input.to, cc: input.cc, bcc: input.bcc,
    replyTo: input.replyTo || replyTo,
    subject: input.subject,
    html: input.html, text: input.text || (input.html ? undefined : ''),
    attachments: (input.attachments || []).map((a) => ({
      filename: a.filename, content: a.content, encoding: a.encoding || 'base64', contentType: a.contentType,
    })),
  })
  return new Promise((resolve, reject) => mc.compile().build((e: Error | null, msg: Buffer) => (e ? reject(e) : resolve(msg))))
}

// nodemailer's own default connectionTimeout is 2 minutes -- same problem as
// imapflow's defaults in withImap() above, same fix: fail fast rather than
// outlasting the serverless function that's waiting on it.
const smtpTimeouts = { connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000 }

export async function sendMail(account: MailAccount, input: SendInput): Promise<{ messageId: string; raw: Buffer }> {
  const { smtp, from } = account
  const raw = await buildRaw(account, input)
  const t = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass }, ...smtpTimeouts })
  const to = [input.to, input.cc, input.bcc].filter(Boolean).join(',')
  const info = await t.sendMail({ envelope: { from: from.email, to }, raw })
  return { messageId: info.messageId, raw }
}

// Save a copy of an outgoing message into the account's Sent folder.
export async function appendToSent(account: MailAccount, raw: Buffer): Promise<void> {
  return withImap(account, async (c) => {
    const boxes = await c.list()
    const sent = boxes.find((b) => b.specialUse === '\\Sent')?.path
      || boxes.find((b) => /(^|[./])sent/i.test(b.path) || /(^|[./])sent/i.test(b.name))?.path
    if (!sent) return
    await c.append(sent, raw, ['\\Seen'])
  })
}

// Compose a message and save it to the account's Drafts folder — never sent
// via SMTP, purely an IMAP APPEND, so it's safe to prepare outreach drafts
// for review without any risk of them going out unreviewed.
export async function saveDraft(account: MailAccount, input: SendInput): Promise<void> {
  const raw = await buildRaw(account, input)
  return withImap(account, async (c) => {
    const boxes = await c.list()
    const drafts = boxes.find((b) => b.specialUse === '\\Drafts')?.path
      || boxes.find((b) => /(^|[./])draft/i.test(b.path) || /(^|[./])draft/i.test(b.name))?.path
    if (!drafts) throw new Error('No Drafts folder found on this account')
    await c.append(drafts, raw, ['\\Draft'])
  })
}

// Delete a message (used to remove a draft once it's been sent).
export async function deleteMessage(account: MailAccount, mailbox: string, uid: number): Promise<void> {
  return withImap(account, async (c) => {
    const lock = await c.getMailboxLock(mailbox)
    try { await c.messageDelete(String(uid), { uid: true }) } finally { lock.release() }
  })
}

// Walk imapflow's MIME bodyStructure tree down to its leaf parts.
function flattenParts(node: any, out: any[] = []): any[] {
  if (!node) return out
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    for (const child of node.childNodes) flattenParts(child, out)
  } else {
    out.push(node)
  }
  return out
}
// A leaf part counts as an attachment if it carries a filename — covers both
// Content-Disposition: attachment and named inline parts (e.g. embedded images
// some clients mark inline). Plain text/html body parts have no filename.
function attachmentFilename(part: any): string | null {
  return part?.dispositionParameters?.filename || part?.parameters?.name || null
}

export interface AttachmentHit { mailbox: string; uid: number; subject: string; from: string; fromName: string; date: string; attachments: MailAttachmentMeta[] }

// Scans every folder for messages carrying attachments, optionally filtered by
// a case-insensitive filename match. Uses bodyStructure only (no attachment
// bytes fetched), and is bounded per-folder + total hits so a large mailbox
// can't hang a serverless request.
export async function searchAttachments(account: MailAccount, query: string, opts?: { perFolder?: number; limit?: number }): Promise<AttachmentHit[]> {
  const perFolder = opts?.perFolder ?? 150
  const limit = opts?.limit ?? 25
  const q = query.trim().toLowerCase()
  return withImap(account, async (c) => {
    const boxes = await c.list()
    const paths = [...new Set(boxes.map((b) => b.path))]
    const hits: AttachmentHit[] = []
    for (const path of paths) {
      if (hits.length >= limit) break
      let lock
      try { lock = await c.getMailboxLock(path) } catch { continue }
      try {
        const total = (c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0) || 0
        if (!total) continue
        const start = Math.max(1, total - perFolder + 1)
        for await (const m of c.fetch(`${start}:*`, { uid: true, envelope: true, bodyStructure: true })) {
          if (hits.length >= limit) break
          const atts = flattenParts(m.bodyStructure)
            .map((p) => ({ part: p, filename: attachmentFilename(p) }))
            .filter((p): p is { part: any; filename: string } => !!p.filename)
          if (!atts.length) continue
          const matched = q ? atts.filter((a) => a.filename.toLowerCase().includes(q)) : atts
          if (q && !matched.length) continue
          const env = m.envelope
          hits.push({
            mailbox: path, uid: m.uid,
            subject: env?.subject || '(no subject)',
            from: env?.from?.[0]?.address || '', fromName: env?.from?.[0]?.name || env?.from?.[0]?.address || '',
            date: (env?.date || new Date()).toString(),
            attachments: matched.map((a) => ({ filename: a.filename, contentType: a.part.type ? `${a.part.type}/${a.part.subtype || 'octet-stream'}` : 'application/octet-stream', size: a.part.size || 0 })),
          })
        }
      } finally { if (lock) lock.release() }
    }
    return hits.sort((a, b) => +new Date(b.date) - +new Date(a.date))
  })
}

export async function verify(account: MailAccount): Promise<{ imap: boolean; smtp: boolean; error?: string }> {
  const res = { imap: false, smtp: false as boolean, error: undefined as string | undefined }
  try { await withImap(account, async () => {}); res.imap = true } catch (e) { res.error = 'IMAP: ' + (e as Error).message }
  try {
    const { smtp } = account
    const t = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: { user: smtp.user, pass: smtp.pass }, ...smtpTimeouts })
    await t.verify(); res.smtp = true
  } catch (e) { res.error = (res.error ? res.error + ' | ' : '') + 'SMTP: ' + (e as Error).message }
  return res
}
