import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { listMailbox } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const r = resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const url = new URL(req.url)
  const mailbox = url.searchParams.get('mailbox') || 'INBOX'
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '40', 10))
  try {
    return json({ ok: true, mailbox, messages: await listMailbox(r.ctx.account, mailbox, limit) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
