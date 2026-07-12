import { json } from '@/lib/auth'
import { userIdFromReq } from '@/lib/session'
import { createApiKey, listApiKeys } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → the user's agent keys (metadata only — the secret is never re-shown).
export async function GET(req: Request) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  return json({ keys: listApiKeys(uid) })
}

// POST → mint a new agent key. The raw secret is returned ONCE, here only.
export async function POST(req: Request) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  let body: { label?: string; accountId?: string } = {}
  try { body = await req.json() } catch { /* label optional */ }
  const { row, secret } = createApiKey(uid, body.label, body.accountId)
  return json({ ok: true, id: row.id, label: row.label, secret })
}
