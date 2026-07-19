import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { sendMail, appendToSent, deleteMessage } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The platform's default function budget is too tight for this route: SMTP
// send plus IMAP cleanup is real network work against a mail host we don't
// control, and getting cut off mid-flight produces an opaque 502 (Cloudflare's
// own error page, generated because the origin never responded in time) rather
// than a catchable error from our own code. Give it real headroom.
export const maxDuration = 60

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
    // Sent-copy and draft-cleanup are two independent IMAP connections — run
    // them side by side instead of one after another so the request's total
    // wall-clock time (which is what the platform's patience is measured
    // against) doesn't just keep stacking up, especially with a large
    // attachment already having eaten into the budget for the send itself.
    const [sentResult, draftResult] = await Promise.allSettled([
      body.saveToSent !== false ? appendToSent(r.ctx.account, raw) : Promise.resolve(),
      body.draft?.uid && body.draft?.mailbox ? deleteMessage(r.ctx.account, String(body.draft.mailbox), Number(body.draft.uid)) : Promise.resolve(),
    ])
    let sentWarning: string | undefined
    if (sentResult.status === 'rejected') {
      sentWarning = 'Sent, but could not save a copy to Sent.'
      console.error('[mail/send] appendToSent failed:', (sentResult.reason as Error)?.message)
    }
    let draftWarning: string | undefined
    if (draftResult.status === 'rejected') {
      draftWarning = 'Sent, but could not remove the original draft.'
      console.error('[mail/send] deleteMessage (draft cleanup) failed:', (draftResult.reason as Error)?.message)
    }
    return json({ ok: true, messageId, ...(sentWarning && { sentWarning }), ...(draftWarning && { draftWarning }) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
