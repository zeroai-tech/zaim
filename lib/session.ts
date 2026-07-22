import crypto from 'node:crypto'

// Password hashing: scrypt with a random salt (no native dep beyond sqlite).
// Stored as `scrypt:<salt>:<hash>` (base64).
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const h = crypto.scryptSync(pw, salt, 64)
  return `scrypt:${salt.toString('base64')}:${h.toString('base64')}`
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [, salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64)
  const hb = Buffer.from(hash, 'base64')
  return h.length === hb.length && crypto.timingSafeEqual(h, hb)
}

// Sessions: a stateless HMAC-signed token `<userId>.<exp>.<sig>` in an httpOnly
// cookie. Signed with ZAIM_SESSION_SECRET (falls back to ZAIM_API_KEY).
function secret(): string {
  return process.env.ZAIM_SESSION_SECRET || process.env.ZAIM_API_KEY || ''
}
const sign = (data: string) => crypto.createHmac('sha256', secret()).update(data).digest('base64url')

export function makeSession(userId: string, days = 30): string {
  const exp = Date.now() + days * 864e5
  const data = `${userId}.${exp}`
  return `${data}.${sign(data)}`
}
export function readSession(token: string | undefined): string | null {
  if (!token || !secret()) return null
  const i = token.lastIndexOf('.')
  const data = token.slice(0, i), sig = token.slice(i + 1)
  if (!crypto.timingSafeEqual(Buffer.from(sign(data)), Buffer.from(sig))) return null
  const [uid, exp] = data.split('.')
  if (!uid || Date.now() > Number(exp)) return null
  return uid
}

export function sessionCookie(token: string): string {
  // Secure only when actually served over HTTPS. The desktop app serves over
  // http://127.0.0.1 with NODE_ENV=production, where a `Secure` cookie won't be
  // stored — so the local-HTTP flag (set by the Electron shell) disables it.
  const secure = process.env.NODE_ENV === 'production' && process.env.ZAIM_LOCAL_HTTP !== '1'
  return `zaim_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`
}
export const clearCookie = () => 'zaim_session=; HttpOnly; Path=/; Max-Age=0'
export const userIdFromReq = (req: Request): string | null =>
  readSession((req.headers.get('cookie') || '').match(/(?:^|;\s*)zaim_session=([^;]+)/)?.[1])
