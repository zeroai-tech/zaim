import { json } from '@/lib/auth'
import { userIdFromReq } from '@/lib/session'
import { setDefault, deleteAccount } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  const { id } = await ctx.params
  setDefault(uid, id)
  return json({ ok: true })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = userIdFromReq(req)
  if (!uid) return json({ error: 'Unauthorized' }, 401)
  const { id } = await ctx.params
  deleteAccount(uid, id)
  return json({ ok: true })
}
