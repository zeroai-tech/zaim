import { json } from '@/lib/auth'
import { dbPing } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Diagnostic endpoint — reports which required env vars are present (booleans only,
// never values) and whether the database actually connects. Safe to remove later.
export async function GET() {
  const env = {
    POSTGRES_URL: !!process.env.POSTGRES_URL,
    DATABASE_URL: !!process.env.DATABASE_URL,
    ZAIM_ENC_KEY: !!process.env.ZAIM_ENC_KEY,
    ZAIM_SESSION_SECRET: !!process.env.ZAIM_SESSION_SECRET,
    ZAIM_API_KEY: !!process.env.ZAIM_API_KEY,
  }
  try {
    const r = await dbPing()
    return json({ ok: true, ...r, env })
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    return json({ ok: false, env, error: err?.message || String(e), code: err?.code }, 500)
  }
}
