import crypto from 'node:crypto'

// Phase-1 auth: a single shared API key gates every /api/mail call. Agents
// (Claude Code / Gemini / Codex) send `Authorization: Bearer <key>`; the webapp
// sends the same key it holds in an httpOnly cookie. Constant-time compare so the
// key can't be timing-probed. Phase 2 upgrades this to per-user sessions + scoped
// keys without changing the routes (they just call requireAuth()).
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function apiKey(): string {
  return process.env.ZAIM_API_KEY || ''
}

export function requireAuth(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const key = apiKey()
  if (!key) return { ok: false, status: 503, error: 'ZAIM_API_KEY not configured on the server' }
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const cookie = (req.headers.get('cookie') || '').match(/(?:^|;\s*)zaim_key=([^;]+)/)?.[1]
  const provided = bearer || (cookie ? decodeURIComponent(cookie) : '')
  if (!provided || !timingSafeEqual(provided, key)) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
