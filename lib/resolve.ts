import crypto from 'node:crypto'
import { getAccount, isConfigured, type MailAccount } from './config'
import { apiKey } from './auth'
import { userIdFromReq } from './session'
import { resolveAccount } from './store'

// Resolve which mail account a request acts on:
//   · a logged-in web user → their chosen/default vault account (multi-tenant)
//   · an agent/CLI with the API key → the server's env single-account
// This is the one place account selection lives, so the mail routes stay simple.
export type Resolved = { account: MailAccount; userId: string | null }

export function resolveForRequest(req: Request): { ok: true; ctx: Resolved } | { ok: false; status: number; error: string } {
  const uid = userIdFromReq(req)
  if (uid) {
    const accountId = new URL(req.url).searchParams.get('account') || undefined
    const account = resolveAccount(uid, accountId)
    if (!account) return { ok: false, status: 409, error: 'No mail account yet — add one first.' }
    return { ok: true, ctx: { account, userId: uid } }
  }
  // Agent / CLI: shared API key → env single-account
  const key = apiKey()
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const cookieKey = (req.headers.get('cookie') || '').match(/(?:^|;\s*)zaim_key=([^;]+)/)?.[1]
  const provided = bearer || (cookieKey ? decodeURIComponent(cookieKey) : '')
  if (key && provided && provided.length === key.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
    if (!isConfigured()) return { ok: false, status: 503, error: 'Server single-account not configured.' }
    return { ok: true, ctx: { account: getAccount(), userId: null } }
  }
  return { ok: false, status: 401, error: 'Unauthorized' }
}
