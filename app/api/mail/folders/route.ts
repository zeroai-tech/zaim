import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { listFolders } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → the named folders (Inbox/Sent/Drafts/…) this account actually has.
export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try {
    return json({ ok: true, folders: await listFolders(r.ctx.account) })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
