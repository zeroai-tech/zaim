import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { nndbLearn, nndbLearnStatus } from '@/lib/nndb'
import { OAUTH_PREFIX } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST — start learning. GET — how far it has got.
//
// Reading a mailbox, embedding it and deriving rules takes minutes, so this
// starts a background job and the panel polls. Holding the request open would
// hit every gateway timeout between here and the browser.
export async function POST(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)

  // Hand over the mailbox this request is already authenticated for, so
  // learning uses the session the person is actually signed in to rather than
  // a separately-expiring CLI token.
  const im = r.ctx.account.imap
  const token = im.pass?.startsWith(OAUTH_PREFIX) ? im.pass.slice(OAUTH_PREFIX.length) : null

  try {
    return json(await nndbLearn({
      host: im.host, port: im.port, secure: im.secure, user: im.user,
      ...(token ? { accessToken: token } : { pass: im.pass }),
    }))
  } catch (e: any) { return json({ error: e?.message ?? String(e) }, 502) }
}

export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  try { return json(await nndbLearnStatus()) }
  catch (e: any) { return json({ error: e?.message ?? String(e) }, 502) }
}
