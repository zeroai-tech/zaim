import { apiKey, requireAuth, json } from '@/lib/auth'
import { isConfigured } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET → is the current caller authenticated + is the server mail-configured.
export async function GET(req: Request) {
  const auth = requireAuth(req)
  return json({ authed: auth.ok, configured: isConfigured() })
}

// POST { key } → exchange the API key for an httpOnly session cookie (webapp login).
export async function POST(req: Request) {
  let body: { key?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const key = apiKey()
  if (!key) return json({ error: 'Server not configured' }, 503)
  if (!body.key || body.key !== key) return json({ error: 'Wrong key' }, 401)
  const secure = process.env.NODE_ENV === 'production'
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `zaim_key=${encodeURIComponent(body.key)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`,
    },
  })
}
