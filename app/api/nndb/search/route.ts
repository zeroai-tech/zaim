import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { nndbAvailable, nndbSearch } from '@/lib/nndb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — search sent mail by meaning.
//
// IMAP search matches substrings, so looking for "how did I approach a
// ministry about routing" finds nothing unless those words were used. This
// scores against embeddings of what was actually written, which is the only
// way to answer "what have I said before that was like this".
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const query = String(body.query ?? '').trim()
  if (!query) return json({ error: 'query is required' }, 400)

  if (!(await nndbAvailable())) {
    return json({ error: 'The cognitive layer is not running, so semantic search is unavailable.' }, 503)
  }

  try {
    return json({ hits: await nndbSearch(query, Math.min(Number(body.limit) || 5, 20)) })
  } catch (e: any) {
    return json({ error: `search failed: ${e?.message ?? e}` }, 502)
  }
}
