import { ImapFlow } from 'imapflow'
import type { MailAccount } from './config'
import { withImap, type SendAttachment } from './mail'

// ─────────────────────────────────────────────────────────────────────────────
//  Large attachments on the website.
//
//  Vercel refuses any function request over 4.5 MB before our code runs
//  (413 FUNCTION_PAYLOAD_TOO_LARGE), and attachments travel as base64 JSON, so
//  two phone photos were enough to make Send fail. The browser now uploads big
//  attachments in pieces well under that limit, and each piece is parked as a
//  small message in a "Zaim Uploads" folder in the person's own mailbox: the
//  mailbox stays the only store, as everywhere else in Zaim. Send and Save
//  draft then collect the pieces server-side (no size limit there), use them,
//  and delete them. Pieces older than a day are cleared on the next upload.
//
//  The folder is not in listFolders()' allow-list, so Zaim never shows it.
// ─────────────────────────────────────────────────────────────────────────────

export const UPLOAD_FOLDER = 'Zaim Uploads'
export const MAX_CHUNK_CHARS = 3_000_000 // base64 characters per request, ~3 MB
const MAX_CHUNKS = 12
const ID_RE = /^[A-Za-z0-9-]{16,64}$/
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export interface ChunkInput { id: string; index: number; total: number; filename: string; contentType: string; data: string }

const subjectFor = (id: string, index: number, total: number) => `zaim-upload ${id} ${index + 1}/${total}`

export function validateChunk(b: Record<string, unknown>): ChunkInput | string {
  const id = String(b.id || ''), data = String(b.data || '')
  const index = Number(b.index), total = Number(b.total)
  if (!ID_RE.test(id)) return 'Invalid upload id'
  if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) return `An attachment can be at most ${MAX_CHUNKS} pieces`
  if (!Number.isInteger(index) || index < 0 || index >= total) return 'Invalid piece number'
  if (!data || data.length > MAX_CHUNK_CHARS || data.length % 4 !== 0 || !B64_RE.test(data)) return 'Invalid attachment piece'
  const filename = String(b.filename || 'attachment').slice(0, 200)
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.contentType)) ? String(b.contentType) : 'application/octet-stream'
  return { id, index, total, filename, contentType, data }
}

async function ensureFolder(c: ImapFlow) {
  const boxes = await c.list()
  if (!boxes.some((b) => b.path === UPLOAD_FOLDER)) {
    try { await c.mailboxCreate(UPLOAD_FOLDER) } catch (e) { if (!/exist/i.test((e as Error).message + ((e as any).responseText || ''))) throw e }
  }
}

/** Parks one piece of an attachment in the person's mailbox. */
export async function stageChunk(account: MailAccount, chunk: ChunkInput): Promise<void> {
  const meta = Buffer.from(JSON.stringify({ filename: chunk.filename, contentType: chunk.contentType })).toString('base64')
  const raw = [
    `From: <${account.from.email}>`,
    `To: <${account.from.email}>`,
    `Subject: ${subjectFor(chunk.id, chunk.index, chunk.total)}`,
    `Date: ${new Date().toUTCString()}`,
    `X-Zaim-Upload: ${chunk.id};${chunk.index};${chunk.total};${meta}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=us-ascii',
    'Content-Transfer-Encoding: 7bit',
    '',
    chunk.data.replace(/.{1,76}/g, '$&\r\n'),
  ].join('\r\n')
  await withImap(account, async (c) => {
    await ensureFolder(c)
    await c.append(UPLOAD_FOLDER, Buffer.from(raw), ['\\Seen'])
    // Housekeeping: pieces from abandoned messages.
    const lock = await c.getMailboxLock(UPLOAD_FOLDER)
    try {
      const old = await c.search({ before: new Date(Date.now() - 24 * 3600_000) }, { uid: true })
      if (old && old.length) await c.messageDelete(old, { uid: true })
    } finally { lock.release() }
  })
}

type Staged = { filename: string; contentType: string; content: string; uids: number[] }

async function collect(c: ImapFlow, ids: string[]): Promise<Map<string, Staged>> {
  const found = new Map<string, { filename: string; contentType: string; total: number; parts: Map<number, string>; uids: number[] }>()
  const lock = await c.getMailboxLock(UPLOAD_FOLDER)
  try {
    for (const id of ids) {
      const uids = (await c.search({ subject: `zaim-upload ${id}` }, { uid: true })) || []
      if (!uids.length) continue
      for await (const m of c.fetch(uids, { source: true, uid: true }, { uid: true })) {
        const text = m.source?.toString('latin1') || ''
        const split = text.indexOf('\r\n\r\n')
        const head = text.slice(0, split), bodyText = text.slice(split + 4)
        const h = head.match(/^X-Zaim-Upload:\s*([^;\r\n]+);(\d+);(\d+);([A-Za-z0-9+/=]+)/im)
        if (!h || h[1] !== id) continue
        const meta = JSON.parse(Buffer.from(h[4], 'base64').toString('utf8'))
        const entry = found.get(id) || { filename: meta.filename, contentType: meta.contentType, total: Number(h[3]), parts: new Map<number, string>(), uids: [] as number[] }
        entry.parts.set(Number(h[2]), bodyText.replace(/\s+/g, ''))
        entry.uids.push(m.uid)
        found.set(id, entry)
      }
    }
  } finally { lock.release() }
  const out = new Map<string, Staged>()
  for (const [id, e] of found) {
    if (e.parts.size !== e.total) continue
    out.set(id, { filename: e.filename, contentType: e.contentType, content: Array.from({ length: e.total }, (_, i) => e.parts.get(i)).join(''), uids: e.uids })
  }
  return out
}

/**
 * Replaces { upload: id } entries with the staged content. Throws if a piece is
 * missing, so a message is never sent without an attachment the person added.
 */
export async function resolveAttachments(account: MailAccount, list: unknown): Promise<{ attachments?: SendAttachment[]; uploads: string[] }> {
  if (!Array.isArray(list)) return { uploads: [] }
  const ids = list.map((a) => (a && typeof a.upload === 'string' && ID_RE.test(a.upload) ? a.upload : null)).filter(Boolean) as string[]
  if (!ids.length) return { attachments: list as SendAttachment[], uploads: [] }
  const staged = await withImap(account, async (c) => {
    if (!(await c.list()).some((b) => b.path === UPLOAD_FOLDER)) return new Map<string, Staged>()
    return collect(c, ids)
  })
  const attachments = list.map((a) => {
    if (!a?.upload) return a as SendAttachment
    const s = staged.get(a.upload)
    if (!s) throw new Error(`The attachment "${a.filename || 'file'}" did not finish uploading. Remove it and attach it again.`)
    return { filename: a.filename || s.filename, contentType: a.contentType || s.contentType, content: s.content, encoding: 'base64' }
  })
  return { attachments, uploads: ids }
}

/** Deletes the pieces once the message has been sent or saved. */
export async function discardUploads(account: MailAccount, ids: string[]): Promise<void> {
  if (!ids.length) return
  await withImap(account, async (c) => {
    const lock = await c.getMailboxLock(UPLOAD_FOLDER)
    try {
      for (const id of ids) {
        const uids = await c.search({ subject: `zaim-upload ${id}` }, { uid: true })
        if (uids && uids.length) await c.messageDelete(uids, { uid: true })
      }
    } finally { lock.release() }
  })
}
