import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { listMailbox } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const url = new URL(req.url)
  const mailbox = url.searchParams.get('mailbox') || 'INBOX'
  const flaggedOnly = url.searchParams.get('flagged') === '1'
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '40', 10))
  try {
    return json({ ok: true, mailbox, messages: await listMailbox(r.ctx.account, mailbox, limit, { flaggedOnly }) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
