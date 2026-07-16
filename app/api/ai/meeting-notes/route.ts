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
    const notes = await chat(
      [
        {
          role: 'system',
          content:
            'Pull out any meeting details mentioned in this email — date, time, location/link, attendees, agenda. Format as short labeled lines (e.g. "Date: ..."), one per line, only the details actually mentioned. If no meeting is discussed at all, reply with exactly: No meeting details found.',
        },
        { role: 'user', content: `Subject: ${subject || '(no subject)'}\nFrom: ${from || 'unknown'}\n\n${String(text).slice(0, 12000)}` },
      ],
      { max_tokens: 300 }
    )
    return json({ ok: true, notes })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
