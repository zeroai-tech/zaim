import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { nndbAvailable, nndbDraft } from '@/lib/nndb'
import { chat } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Drafting through the cognitive layer is two model turns plus a validation
// pass, and the local bridge is not fast. The platform default would cut it
// off mid-draft and report a gateway error instead of ours.
export const maxDuration = 300

// POST — draft an email in Lottie's own voice.
//
// The cognitive layer holds the style rules derived from real sent mail, the
// claims that must never be repeated, and the precedent retrieved by meaning
// rather than keyword. When it is unreachable this still answers, using the
// existing Groq relay, but it says so in `source` so the caller can show that
// the draft has not been through the style rules and should be read harder.
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const brief = String(body.brief ?? '').trim()
  if (!brief) return json({ error: 'brief is required' }, 400)

  const health = await nndbAvailable()

  if (health) {
    try {
      const d = await nndbDraft({
        brief,
        recipient: body.to ?? null,
        subject: body.subject ?? null,
      })
      return json({
        source: 'nndb',
        provider: health.provider,
        subject: d.subject,
        body: d.body,
        // A draft that failed a hard rule is still returned, flagged. Silently
        // dropping it would leave the composer empty with no explanation.
        valid: d.valid,
        problems: d.problems,
        context: d.context,
      })
    } catch (e: any) {
      return json({ error: `NNDB draft failed: ${e?.message ?? e}` }, 502)
    }
  }

  // Fallback: no style rules, no precedent, no prohibitions.
  try {
    const text = await chat([
      { role: 'system', content: 'You draft professional outreach email. Return "Subject: ..." then a blank line then the body. No markdown.' },
      { role: 'user', content: brief },
    ], { max_tokens: 1500 })
    const m = text.match(/^\s*Subject:\s*(.+?)\s*\n([\s\S]*)$/)
    return json({
      source: 'relay',
      degraded: true,
      note: 'The cognitive layer is not reachable, so this draft has not been through the style rules or checked against forbidden claims. Read it before sending.',
      subject: m ? m[1].trim() : (body.subject ?? null),
      body: m ? m[2].trim() : text.trim(),
      valid: false,
      problems: [],
    })
  } catch (e: any) {
    return json({ error: `no drafting backend available: ${e?.message ?? e}` }, 503)
  }
}
