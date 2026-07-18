import crypto from 'node:crypto'
import { apiKey, json } from '@/lib/auth'
import { isConfigured } from '@/lib/config'
import { userIdFromReq } from '@/lib/session'
import { resolveAccount, findByApiKey } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → is the current caller authenticated + is a mailbox configured for them.
// Same identity resolution as resolveForRequest() (lib/resolve.ts), except a
// missing mailbox means `configured: false` rather than failing the request —
// this endpoint's whole job is to report that distinction, not enforce it.
export async function GET(req: Request) {
  const uid = userIdFromReq(req)
  if (uid) {
    const account = await resolveAccount(uid)
    return json({ authed: true, configured: !!account })
  }

  const auth = req.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const cookieKey = (req.headers.get('cookie') || '').match(/(?:^|;\s*)zaim_key=([^;]+)/)?.[1]
  const provided = bearer || (cookieKey ? decodeURIComponent(cookieKey) : '')
  if (!provided) return json({ authed: false, configured: false })

  const owner = await findByApiKey(provided)
  if (owner) {
    const account = await resolveAccount(owner.userId, owner.accountId || undefined)
    return json({ authed: true, configured: !!account })
  }

  const key = apiKey()
  if (key && provided.length === key.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
    return json({ authed: true, configured: isConfigured() })
  }
  return json({ authed: false, configured: false })
}

// POST { key } → exchange the API key for an httpOnly session cookie (webapp login).
// Accepts either a per-user vault key or the legacy shared env key.
export async function POST(req: Request) {
  let body: { key?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const provided = body.key || ''
  if (!provided) return json({ error: 'Wrong key' }, 401)

  const owner = await findByApiKey(provided)
  const key = apiKey()
  const legacyMatch = !!key && provided.length === key.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))
  if (!owner && !legacyMatch) return json({ error: 'Wrong key' }, 401)

  const secure = process.env.NODE_ENV === 'production'
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `zaim_key=${encodeURIComponent(provided)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`,
    },
  })
}
