import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { stageChunk, validateChunk } from '@/lib/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — one piece of a large attachment, parked in the mailbox until Send or
// Save draft collects it (see lib/uploads.ts for why).
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const chunk = validateChunk(body)
  if (typeof chunk === 'string') return json({ ok: false, error: chunk }, 400)
  try {
    await stageChunk(r.ctx.account, chunk)
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
