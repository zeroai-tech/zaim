import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { saveDraft } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST — compose a message and save it to the Drafts folder. Never sends via
// SMTP; purely an IMAP APPEND, so it's safe for preparing outreach that needs
// review before it goes out.
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { to, subject } = body
  if (!to || !subject) return json({ error: '`to` and `subject` are required' }, 400)
  try {
    await saveDraft(r.ctx.account, {
      to, subject, html: body.html, text: body.text, cc: body.cc, bcc: body.bcc, replyTo: body.replyTo,
    })
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
