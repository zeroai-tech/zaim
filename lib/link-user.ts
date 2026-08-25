import crypto from 'node:crypto'
import { userIdFromReq, makeSession, sessionCookie, hashPassword } from './session'
import { mailboxFromReq } from './mailbox-session'
import { createUser, findUserByEmail } from './store'

// ─────────────────────────────────────────────────────────────────────────────
//  Reading mail needs no database. A few extras do: agent API keys, a profile
//  picture, and additional third-party mailboxes all have to survive past the
//  cookie, so they need a row to hang off.
//
//  Rather than make everyone register up front for features most never touch,
//  that row is created the first time one of them is actually used. The mail
//  server stays the authority on who exists and what the password is — the row
//  holds no usable password, and sign-in never consults it for a mailbox we host.
// ─────────────────────────────────────────────────────────────────────────────

export interface Linked { uid: string | null; setCookie?: string }

export async function ensureUserId(req: Request): Promise<Linked> {
  const uid = userIdFromReq(req)
  if (uid) return { uid }

  const mb = mailboxFromReq(req)
  if (!mb) return { uid: null }

  const existing = await findUserByEmail(mb.email)
  // Unguessable filler: this account is reached by proving the mailbox over
  // IMAP, so there is deliberately no password anyone could type here.
  const u = existing ?? (await createUser(mb.email, hashPassword(crypto.randomBytes(32).toString('hex'))))
  return { uid: u.id, setCookie: sessionCookie(makeSession(u.id)) }
}

// Attach the session cookie minted by a just-created link, if there was one.
export function withLink(r: Response, link: Linked): Response {
  if (!link.setCookie) return r
  const h = new Headers(r.headers)
  h.append('set-cookie', link.setCookie)
  return new Response(r.body, { status: r.status, headers: h })
}
