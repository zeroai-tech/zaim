import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { nndbResearch } from '@/lib/nndb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Several web searches and fetches, which is well past the platform default.
export const maxDuration = 300

// POST — find out who you are writing to, before you write to them.
//
// Every fact comes back with the URL it was read from, and anything the
// research could not source is discarded rather than kept at low confidence.
// Without this the model supplies recipient specifics from its own memory,
// which is how a plausible policy name with the wrong year ends up in an
// email to the ministry that wrote it.
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  if (!body.recipient) return json({ error: 'recipient is required' }, 400)

  try { return json(await nndbResearch(body.recipient, body.hint, Boolean(body.force))) }
  catch (e: any) { return json({ error: e?.message ?? String(e) }, 502) }
}
