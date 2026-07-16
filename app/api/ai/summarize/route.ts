import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { chat } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    const { subject, from, text } = await req.json()
    if (!text) return json({ ok: false, error: 'text required' }, 400)
    const summary = await chat(
      [
        { role: 'system', content: 'You summarise email threads in 2-4 short sentences, plain language, no preamble like "Here is a summary". Focus on what the reader actually needs to know or do.' },
        { role: 'user', content: `Subject: ${subject || '(no subject)'}\nFrom: ${from || 'unknown'}\n\n${String(text).slice(0, 12000)}` },
      ],
      { max_tokens: 300 }
    )
    return json({ ok: true, summary })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
