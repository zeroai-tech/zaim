import { json } from '@/lib/auth'
import { ensureUserId, withLink } from '@/lib/link-user'
import { createApiKey, listApiKeys } from '@/lib/store'
import { MAILBOX_ACCOUNT_ID } from '@/lib/mailbox-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → the user's agent keys (metadata only — the secret is never re-shown).
export async function GET(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  return withLink(json({ keys: await listApiKeys(uid) }), { uid, setCookie })
}

// POST → mint a new agent key. The raw secret is returned ONCE, here only.
export async function POST(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  let body: { label?: string; accountId?: string } = {}
  try { body = await req.json() } catch { /* label optional */ }
  // 'mailbox' is the signed-in mailbox, which has no accounts row to pin to —
  // the key then simply follows whatever that user's default mailbox is.
  const accountId = body.accountId && body.accountId !== MAILBOX_ACCOUNT_ID ? body.accountId : undefined
  const { row, secret } = await createApiKey(uid, body.label, accountId)
  return withLink(json({ ok: true, id: row.id, label: row.label, secret }), { uid, setCookie })
}
