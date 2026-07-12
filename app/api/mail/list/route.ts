import { requireAuth, json } from '@/lib/auth'
import { listMailbox } from '@/lib/mail'

export const runtime = 'nodejs'          // imapflow needs Node, not the edge runtime
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = requireAuth(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  const url = new URL(req.url)
  const mailbox = url.searchParams.get('mailbox') || 'INBOX'
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '40', 10))
  try {
    return json({ ok: true, mailbox, messages: await listMailbox(mailbox, limit) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
