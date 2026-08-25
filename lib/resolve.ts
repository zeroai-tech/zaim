import crypto from 'node:crypto'
import { getAccount, isConfigured, type MailAccount } from './config'
import { apiKey } from './auth'
import { userIdFromReq } from './session'
import { resolveAccount, findByApiKey } from './store'
import { mailboxFromReq, toAccount, MAILBOX_ACCOUNT_ID } from './mailbox-session'

// Resolve which mail account a request acts on:
//   · a signed-in mailbox → its credentials straight out of the sealed cookie
//     (no database read at all — see lib/mailbox-session.ts)
//   · that person's saved third-party mailboxes → the vault, when one is picked
//   · an agent/CLI with an API key → the key's mailbox, or the env single-account
// This is the one place account selection lives, so the mail routes stay simple.
export type Resolved = { account: MailAccount; userId: string | null }

export async function resolveForRequest(req: Request): Promise<{ ok: true; ctx: Resolved } | { ok: false; status: number; error: string }> {
  const uid = userIdFromReq(req)
  const wanted = new URL(req.url).searchParams.get('account') || undefined
  const mb = mailboxFromReq(req)

  // The signed-in mailbox, unless the request explicitly asked for a different
  // saved account (the switcher passes its id).
  if (mb && (!wanted || wanted === MAILBOX_ACCOUNT_ID)) {
    return { ok: true, ctx: { account: toAccount(mb), userId: uid } }
  }

  if (uid) {
    const account = await resolveAccount(uid, wanted === MAILBOX_ACCOUNT_ID ? undefined : wanted)
    if (account) return { ok: true, ctx: { account, userId: uid } }
    // A stale account id shouldn't strand someone who is otherwise signed in.
    if (mb) return { ok: true, ctx: { account: toAccount(mb), userId: uid } }
    return { ok: false, status: 409, error: 'No mail account yet — add one first.' }
  }
  if (mb) return { ok: true, ctx: { account: toAccount(mb), userId: null } }

  // Agent / CLI: an API key in the Bearer header (or zaim_key cookie).
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const cookieKey = (req.headers.get('cookie') || '').match(/(?:^|;\s*)zaim_key=([^;]+)/)?.[1]
  const provided = bearer || (cookieKey ? decodeURIComponent(cookieKey) : '')
  if (!provided) return { ok: false, status: 401, error: 'Unauthorized' }

  // 1) Per-user key from the vault (front-end generated) → that user's mailbox.
  const owner = await findByApiKey(provided)
  if (owner) {
    const account = await resolveAccount(owner.userId, owner.accountId || undefined)
    if (!account) return { ok: false, status: 409, error: 'API key has no mailbox — connect one in Zaim.' }
    return { ok: true, ctx: { account, userId: owner.userId } }
  }

  // 2) Legacy shared env key → env single-account (single-deployment / fallback).
  const key = apiKey()
  if (key && provided.length === key.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
    if (!isConfigured()) return { ok: false, status: 503, error: 'Server single-account not configured.' }
    return { ok: true, ctx: { account: getAccount(), userId: null } }
  }
  return { ok: false, status: 401, error: 'Unauthorized' }
}
