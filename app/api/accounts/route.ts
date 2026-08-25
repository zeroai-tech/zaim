import { json } from '@/lib/auth'
import { ensureUserId, withLink } from '@/lib/link-user'
import { addAccount, listAccounts, resolveAccount, type AccountInput } from '@/lib/store'
import { verify } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → the user's accounts (labels/emails only, never secrets)
export async function GET(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  return withLink(json({ accounts: (await listAccounts(uid)).map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: !!a.is_default })) }), { uid, setCookie })
}

// POST → add + verify a mailbox. Credentials are AES-encrypted before storage.
export async function POST(req: Request) {
  const { uid, setCookie } = await ensureUserId(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  let a: AccountInput
  try { a = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  if (!a.label || !a.imapHost || !a.imapUser || !a.imapPass) return json({ error: 'label, imapHost, imapUser, imapPass are required' }, 400)

  const id = await addAccount(uid, a)
  // Verify the freshly-stored (decrypted) account really connects.
  const account = (await resolveAccount(uid, id))!
  const v = await verify(account)
  if (!v.imap) return withLink(json({ ok: false, error: v.error || 'Could not connect', id, verified: false }, 200), { uid, setCookie })
  return withLink(json({ ok: true, id, verified: { imap: v.imap, smtp: v.smtp } }), { uid, setCookie })
}
