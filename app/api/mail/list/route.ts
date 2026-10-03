import { cachedRead, cacheScope, mailCacheKey, folderGeneration } from '@/lib/offline-store'
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
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(page)) return json({ ok: false, error: 'Invalid pagination.' }, 400)
  try {
    const scope = cacheScope(r.ctx.account, r.ctx.userId)
    const result = await cachedRead(scope, mailCacheKey(scope, mailbox, `list:${mailbox}:${flaggedOnly}:${limit}:${page}`), () => listMailbox(r.ctx.account, mailbox, limit, { flaggedOnly, page, onGeneration: value => folderGeneration(scope, mailbox, value) }), url.searchParams.get('offline') === '1')
    return json({ ok: true, mailbox, messages: result.value, cached: result.cached, savedAt: result.savedAt })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
