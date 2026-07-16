import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { chat } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const { subject, from, text, instructions } = await req.json()
    if (!text) return json({ ok: false, error: 'text required' }, 400)
    const draft = await chat(
      [
        { role: 'system', content: 'You draft professional, concise email replies. Match a warm but efficient tone. Output only the reply body — no subject line, no "Here is a draft", no signature block unless asked.' },
        {
          role: 'user',
          content:
            `Original email — Subject: ${subject || '(no subject)'}\nFrom: ${from || 'unknown'}\n\n${String(text).slice(0, 12000)}` +
            (instructions ? `\n\nInstructions for the reply: ${instructions}` : ''),
        },
      ],
      { max_tokens: 500 }
    )
    return json({ ok: true, draft })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
