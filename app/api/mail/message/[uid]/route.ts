import { requireAuth, json } from '@/lib/auth'
import { getMessage } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ uid: string }> }) {
  const auth = requireAuth(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  const { uid } = await ctx.params
  const mailbox = new URL(req.url).searchParams.get('mailbox') || 'INBOX'
  try {
    const msg = await getMessage(parseInt(uid, 10), mailbox)
    if (!msg) return json({ ok: false, error: 'Message not found' }, 404)
    return json({ ok: true, message: msg })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
