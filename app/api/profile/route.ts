import { json } from '@/lib/auth'
import { userIdFromReq } from '@/lib/session'
import { setUserAvatar } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Data-URL avatars are stored inline in the users row; keep them small.
const MAX = 300 * 1024

// POST /api/profile  { avatar: <data-url> | null }  → set/clear the signed-in
// user's profile picture. Shown next to their name inside Zaim (and reused as
// the sender avatar on mail they send from this client).
export async function POST(req: Request) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Not signed in' }, 401)
  let body: { avatar?: string | null }
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }
  const avatar = body.avatar
  if (avatar != null) {
    if (typeof avatar !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(avatar)) {
      return json({ error: 'Avatar must be an image data URL' }, 400)
    }
    if (avatar.length > MAX) return json({ error: 'Image too large — pick a smaller one' }, 400)
  }
  await setUserAvatar(uid, avatar ?? null)
  return json({ ok: true, avatar: avatar ?? null })
}
