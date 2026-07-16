import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { chat } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const { text, target } = await req.json()
    if (!text) return json({ ok: false, error: 'text required' }, 400)
    if (!target) return json({ ok: false, error: 'target language required' }, 400)
    const translation = await chat(
      [
        { role: 'system', content: `You translate text into ${target}. Output only the translation — no preamble, no explanation, no repeating the original.` },
        { role: 'user', content: String(text).slice(0, 12000) },
      ],
      { max_tokens: 800 }
    )
    return json({ ok: true, translation })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
