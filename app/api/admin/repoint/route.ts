import { json } from '@/lib/auth'
import { findAccountsByHost, repointAccounts } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// One-time admin fix: mailboxes still pointing at the old Namecheap host send
// mail but never receive it (new mail now lands on the new server). This moves
// every such mailbox — across all users — to the new server in one shot.
//   GET  ?secret=…            → preview (who WOULD move; changes nothing)
//   POST ?secret=…            → apply
// Gated on ZAIM_ADMIN_SECRET (set it in Vercel env). Only mailboxes whose host
// contains OLD_HOST are touched — Gmail / other providers are never affected.
const OLD_HOST = 'privateemail'          // matches mail.privateemail.com (case-insensitive substring)
const NEW_HOST = 'mail.zeroaitech.tech'

function authed(req: Request): boolean {
  const secret = (process.env.ZAIM_ADMIN_SECRET || '').trim()
  if (!secret) return false // never open when unset
  const given = (req.headers.get('x-admin-secret') || new URL(req.url).searchParams.get('secret') || '').trim()
  return given.length > 0 && given === secret
}

export async function GET(req: Request) {
  if (!authed(req)) return json({ error: 'Forbidden. Set ZAIM_ADMIN_SECRET in Vercel and pass ?secret=…' }, 403)
  const rows = await findAccountsByHost(OLD_HOST)
  return json({ ok: true, mode: 'preview', wouldMove: rows.length, from: OLD_HOST, to: NEW_HOST, accounts: rows })
}

export async function POST(req: Request) {
  if (!authed(req)) return json({ error: 'Forbidden. Set ZAIM_ADMIN_SECRET in Vercel and pass ?secret=…' }, 403)
  const moved = await repointAccounts(OLD_HOST, NEW_HOST)
  return json({ ok: true, mode: 'applied', repointed: moved.length, to: `${NEW_HOST} (IMAP 993 / SMTP 465, SSL)`, emails: moved.map((r) => r.from_email) })
}
