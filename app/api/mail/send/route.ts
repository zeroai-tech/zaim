import { requireAuth, json } from '@/lib/auth'
import { sendMail } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = requireAuth(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  let body: Record<string, string>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { to, subject } = body
  if (!to || !subject) return json({ error: '`to` and `subject` are required' }, 400)
  try {
    const r = await sendMail({
      to, subject, html: body.html, text: body.text, cc: body.cc, bcc: body.bcc, replyTo: body.replyTo,
    })
    return json({ ok: true, ...r })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
