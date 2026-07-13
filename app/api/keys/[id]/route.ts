import { json } from '@/lib/auth'
import { userIdFromReq } from '@/lib/session'
import { revokeApiKey } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE → revoke an agent key (immediately stops working).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  const { id } = await params
  await revokeApiKey(uid, id)
  return json({ ok: true })
}
