import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { chat } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Drafts a non-binding OUTLINE, never a finished contract — this is scaffolding
// for a lawyer to review, not legal advice. The disclaimer is enforced twice:
// once in the model's own output, once again in the UI (AIPanel), so it can't
// be dropped by an off-instruction completion.
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const { subject, from, text, instructions } = await req.json()
    if (!text) return json({ ok: false, error: 'text required' }, 400)
    const draft = await chat(
      [
        {
          role: 'system',
          content:
            'You draft a plain-language, NON-BINDING contract/agreement OUTLINE based on details discussed in this email thread. ' +
            'This is a starting point for a lawyer to review — not a finished legal document and not legal advice. ' +
            'Structure it with clear sections (e.g. Parties, Scope of Work, Payment Terms, Timeline, Termination) but ONLY the ones relevant to what is actually discussed. ' +
            'For any term not mentioned in the thread, write "[TO BE SPECIFIED]" instead of inventing details — never fabricate names, amounts, or dates that were not given. ' +
            'Never claim to be a lawyer or imply this is complete or legally binding. ' +
            'End with exactly this line on its own: "This is a draft outline only — have a qualified lawyer review before use."',
        },
        {
          role: 'user',
          content:
            `Email thread — Subject: ${subject || '(no subject)'}\nFrom: ${from || 'unknown'}\n\n${String(text).slice(0, 12000)}` +
            (instructions ? `\n\nAdditional instructions: ${instructions}` : ''),
        },
      ],
      { max_tokens: 700 }
    )
    return json({ ok: true, draft })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
