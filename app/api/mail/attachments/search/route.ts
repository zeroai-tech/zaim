import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { searchAttachments } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 45

// GET → attachments across every folder in this account, optionally filtered
// by filename. Metadata only (no bytes) — download still goes through the
// existing /api/mail/attachment route once a hit is opened.
export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const q = new URL(req.url).searchParams.get('q') || ''
    const hits = await searchAttachments(r.ctx.account, q)
    return json({ ok: true, hits })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
