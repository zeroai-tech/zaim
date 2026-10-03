import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { cacheScope, desktopStorageEnabled, localDrafts, saveLocalDraft, deleteLocalDraft } from '@/lib/offline-store'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
async function scopeFor(req: Request) {
  if (!desktopStorageEnabled()) return { error: json({ ok: false, error: 'Local drafts are available in the desktop app.' }, 404) }
  const r = await resolveForRequest(req)
  if (!r.ok) return { error: json({ ok: false, error: r.error }, r.status) }
  return { scope: cacheScope(r.ctx.account, r.ctx.userId) }
}
export async function GET(req: Request) {
  const result = await scopeFor(req)
  if (result.error) return result.error
  const drafts = localDrafts(result.scope!)
  return json({ ok: true, drafts, messages: drafts.map(d => ({ uid: d.id, subject: d.subject || '(no subject)', from: '', fromName: 'Local draft', to: d.to, date: d.updatedAt, seen: true, flagged: false })) })
}
export async function POST(req: Request) {
  const result = await scopeFor(req)
  if (result.error) return result.error
  try {
    const body = await req.json()
    if (body.id != null && (!Number.isSafeInteger(body.id) || body.id >= 0)) return json({ ok: false, error: 'Invalid draft id.' }, 400)
    if (![body.to ?? '', body.subject ?? '', body.html ?? ''].every(v => typeof v === 'string')) return json({ ok: false, error: 'Invalid draft content.' }, 400)
    if (JSON.stringify(body).length > 25 * 1024 * 1024) return json({ ok: false, error: 'Draft exceeds the 25 MB local limit.' }, 413)
    const draft = saveLocalDraft(result.scope!, { id: body.id, to: body.to || '', subject: body.subject || '', html: body.html || '', cc: body.cc, bcc: body.bcc, attachments: body.attachments })
    return json({ ok: true, draft })
  } catch { return json({ ok: false, error: 'Could not save this draft on the device. Check available storage.' }, 500) }
}
export async function DELETE(req: Request) {
  const result = await scopeFor(req)
  if (result.error) return result.error
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isSafeInteger(id) || id >= 0) return json({ ok: false, error: 'Invalid draft id.' }, 400)
  try { deleteLocalDraft(result.scope!, id); return json({ ok: true }) }
  catch { return json({ ok: false, error: 'Could not remove local draft.' }, 500) }
}
