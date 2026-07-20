import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { getMessage, deleteMessage, moveMessage } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const { uid } = await ctx.params
  const mailbox = new URL(req.url).searchParams.get('mailbox') || 'INBOX'
  try {
    const msg = await getMessage(r.ctx.account, parseInt(uid, 10), mailbox)
    if (!msg) return json({ ok: false, error: 'Message not found' }, 404)
    return json({ ok: true, message: msg })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}

// DELETE — remove a message. With `?to=<folder>` it MOVES the message there
// (used for a recoverable "delete" → Trash); without it, or when already in
// the destination, it permanently expunges. The client decides which, since
// it already knows the account's folder list and the active folder.
export async function DELETE(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const { uid } = await ctx.params
  const url = new URL(req.url)
  const mailbox = url.searchParams.get('mailbox') || 'INBOX'
  const to = url.searchParams.get('to') || ''
  try {
    if (to && to !== mailbox) await moveMessage(r.ctx.account, mailbox, parseInt(uid, 10), to)
    else await deleteMessage(r.ctx.account, mailbox, parseInt(uid, 10))
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
