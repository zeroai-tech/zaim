import { json } from '@/lib/auth'
import { hashPassword, verifyPassword, makeSession, sessionCookie, clearCookie, userIdFromReq } from '@/lib/session'
import { createUser, findUserByEmail, findUserById, listAccounts } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cookie = (setCookie: string, data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'set-cookie': setCookie } })

// GET /api/auth/me → current user + their accounts (no secrets)
export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action !== 'me') return json({ error: 'Not found' }, 404)
  const uid = userIdFromReq(req)
  if (!uid) return json({ user: null })
  const u = await findUserById(uid)
  if (!u) return json({ user: null })
  const accounts = (await listAccounts(uid)).map((a) => ({ id: a.id, label: a.label, email: a.from_email, isDefault: !!a.is_default }))
  return json({ user: { id: u.id, email: u.email, avatar: u.avatar ?? null }, accounts })
}

// POST /api/auth/register|login|logout
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params
  if (action === 'logout') return cookie(clearCookie(), { ok: true })

  let body: { email?: string; password?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''

  // A real, single, well-formed address — no spaces, exactly one @, a dotted
  // TLD of 2+ chars. Rejects the junk (`asdf`, `a@b`, `x@y.`) that used to register.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254

  if (action === 'register') {
    if (!emailValid) return json({ error: 'Please enter a valid email address.' }, 400)
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
    if (await findUserByEmail(email)) return json({ error: 'An account with that email already exists' }, 409)
    const u = await createUser(email, hashPassword(password))
    return cookie(sessionCookie(makeSession(u.id)), { ok: true, user: { id: u.id, email } })
  }
  if (action === 'login') {
    const u = await findUserByEmail(email)
    if (!u || !verifyPassword(password, u.pw_hash)) return json({ error: 'Wrong email or password' }, 401)
    return cookie(sessionCookie(makeSession(u.id)), { ok: true, user: { id: u.id, email } })
  }
  return json({ error: 'Not found' }, 404)
}
