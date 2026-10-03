import { json } from '@/lib/auth'
export const dynamic = 'force-dynamic'
export function GET() {
  if (process.env.ZAIM_DESKTOP !== '1') return json({ ok: false }, 404)
  return json({ ok: true, desktop: true, version: process.env.ZAIM_APP_VERSION, instance: process.env.ZAIM_INSTANCE })
}
