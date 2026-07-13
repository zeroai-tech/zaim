import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { sendMail, appendToSent, deleteMessage } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { to, subject } = body
  if (!to || !subject) return json({ error: '`to` and `subject` are required' }, 400)
  try {
    const { messageId, raw } = await sendMail(r.ctx.account, {
      to, subject, html: body.html, text: body.text, cc: body.cc, bcc: body.bcc, replyTo: body.replyTo,
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
    })
    // Keep a copy in Sent (best-effort — never fail the send over this).
    if (body.saveToSent !== false) await appendToSent(r.ctx.account, raw).catch(() => {})
    // If this send came from a draft, remove that draft so it doesn't linger.
    if (body.draft?.uid && body.draft?.mailbox) await deleteMessage(r.ctx.account, String(body.draft.mailbox), Number(body.draft.uid)).catch(() => {})
    return json({ ok: true, messageId })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
