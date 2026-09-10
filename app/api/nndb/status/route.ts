import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { nndbAvailable } from '@/lib/nndb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — is the cognitive layer up, and has it learned anything yet?
//
// The panel needs both. "Running" is not the same as "usable": a fresh
// install has no rules, and drafting from an empty rule set would produce
// generic mail while looking like it worked.
export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)

  const health = await nndbAvailable()
  if (!health) {
    return json({
      running: false,
      reason: 'The cognitive layer is not running. It starts with the desktop app; on the web build there is no local process to run it.',
    })
  }
  return json({ running: true, ...health })
}
