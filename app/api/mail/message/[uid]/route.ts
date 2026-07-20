import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { getMessage, deleteMessage } from '@/lib/mail'

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

// DELETE — remove a message (e.g. a draft superseded by a corrected version).
export async function DELETE(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const { uid } = await ctx.params
  const mailbox = new URL(req.url).searchParams.get('mailbox') || 'INBOX'
  try {
    await deleteMessage(r.ctx.account, mailbox, parseInt(uid, 10))
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
