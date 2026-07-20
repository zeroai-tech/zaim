import { json } from '@/lib/auth'
import { resolveForRequest } from '@/lib/resolve'
import { getAttachment } from '@/lib/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET ?uid=&mailbox=&index= → stream one attachment as a download.
export async function GET(req: Request) {
  const r = await resolveForRequest(req)
  if (!r.ok) return json({ error: r.error }, r.status)
  const url = new URL(req.url)
  const uid = parseInt(url.searchParams.get('uid') || '0', 10)
  const mailbox = url.searchParams.get('mailbox') || 'INBOX'
  const index = parseInt(url.searchParams.get('index') || '0', 10)
  try {
    const a = await getAttachment(r.ctx.account, uid, mailbox, index)
    if (!a) return json({ error: 'Attachment not found' }, 404)
    return new Response(new Uint8Array(a.content), {
      headers: {
        'content-type': a.contentType,
        'content-disposition': `attachment; filename="${a.filename.replace(/"/g, '')}"`,
      },
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}
