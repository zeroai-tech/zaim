import { cachedRead, cacheScope } from '@/lib/offline-store'
import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { listFolders } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET → the named folders (Inbox/Sent/Drafts/…) this account actually has.
export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const result = await cachedRead(cacheScope(r.ctx.account, r.ctx.userId), 'folders', () => listFolders(r.ctx.account), new URL(req.url).searchParams.get('offline') === '1')
    return json({ ok: true, folders: result.value, cached: result.cached, savedAt: result.savedAt })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
