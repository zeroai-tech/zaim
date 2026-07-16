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
    // Keep a copy in Sent (best-effort — never fail the send over this, but never go silent either).
    let sentWarning: string | undefined
    if (body.saveToSent !== false) {
      try { await appendToSent(r.ctx.account, raw) }
      catch (e) { sentWarning = 'Sent, but could not save a copy to Sent.'; console.error('[mail/send] appendToSent failed:', (e as Error).message) }
    }
    // If this send came from a draft, remove that draft so it doesn't linger — same rule: never fail
    // the send over cleanup, but never swallow the error either, so a lingering draft is diagnosable.
    let draftWarning: string | undefined
    if (body.draft?.uid && body.draft?.mailbox) {
      try { await deleteMessage(r.ctx.account, String(body.draft.mailbox), Number(body.draft.uid)) }
      catch (e) { draftWarning = 'Sent, but could not remove the original draft.'; console.error('[mail/send] deleteMessage (draft cleanup) failed:', (e as Error).message) }
    }
    return json({ ok: true, messageId, ...(sentWarning && { sentWarning }), ...(draftWarning && { draftWarning }) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
