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
    const tasks = await chat(
      [
        { role: 'system', content: 'Extract concrete action items / to-dos from this email as a short bullet list (each line starting with "- "). If there are none, reply with exactly: No action items found.' },
        { role: 'user', content: `Subject: ${subject || '(no subject)'}\nFrom: ${from || 'unknown'}\n\n${String(text).slice(0, 12000)}` },
      ],
      { max_tokens: 300 }
    )
    return json({ ok: true, tasks })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
