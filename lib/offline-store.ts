import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { encryptSecret, decryptSecret, type MailAccount } from './config'

export const desktopStorageEnabled = () => process.env.ZAIM_DESKTOP === '1' && !!process.env.ZAIM_ENC_KEY && !!process.env.ZAIM_DB_PATH
export const cacheScope = (account: MailAccount, owner: string | null) => crypto.createHash('sha256').update(JSON.stringify([owner, account.imap.host.toLowerCase(), account.imap.port, account.imap.user.toLowerCase()])).digest('hex')
const directory = () => path.join(path.dirname(process.env.ZAIM_DB_PATH!), 'offline-mail')
const recordPath = (scope: string, key: string) => path.join(directory(), crypto.createHash('sha256').update(scope + '\0' + key).digest('hex') + '.enc')
export type Cached<T> = { value: T; savedAt: string }

export function readLocal<T>(scope: string, key: string): Cached<T> | null {
  if (!desktopStorageEnabled()) return null
  try {
    const envelope = JSON.parse(decryptSecret(fs.readFileSync(recordPath(scope, key), 'utf8')))
    return envelope.version === 1 ? { value: envelope.value, savedAt: envelope.savedAt } : null
  } catch { return null }
}
export function writeLocal<T>(scope: string, key: string, value: T) {
  if (!desktopStorageEnabled()) return
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 })
  const target = recordPath(scope, key)
  const temporary = target + '.' + crypto.randomUUID() + '.tmp'
  try {
    fs.writeFileSync(temporary, encryptSecret(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), value })), { mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally { try { fs.unlinkSync(temporary) } catch { /* renamed or absent */ } }
}
export function removeLocal(scope: string, key: string) {
  if (!desktopStorageEnabled()) return
  try { fs.unlinkSync(recordPath(scope, key)) } catch { /* absent */ }
}

// Mail reads may fall back only for transport outages, never credential rejection.
export function isTransportFailure(error: unknown) {
  const e = error as { authenticationFailed?: boolean; code?: string; message?: string; responseStatus?: string }
  if (e.authenticationFailed || /auth|credential|password|certificate/i.test(e.message || '')) return false
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ESOCKET|ETIMEOUT|NoConnection|ConnectionTimeout|GreetingTimeout/i.test(e.code || '') || /network|socket|connect.*(closed|timeout|failed|unavailable)|connection.*(closed|timeout|timed out)|not connected/i.test(e.message || '')
}

export async function cachedRead<T>(scope: string, key: string | (() => string), fetchLive: () => Promise<T>, preferCache = false): Promise<{ value: T; cached: boolean; savedAt?: string }> {
  const currentKey = () => typeof key === 'function' ? key() : key
  const previous = () => readLocal<T>(scope, currentKey())
  if (preferCache) {
    const cache = previous()
    if (cache) return { ...cache, cached: true }
    throw new Error('This item has not been downloaded to this device. Reconnect to load it.')
  }
  try {
    const value = await fetchLive()
    try { writeLocal(scope, currentKey(), value) } catch { /* preserve successful reads if disk is full */ }
    return { value, cached: false }
  } catch (error) {
    if (isTransportFailure(error)) {
      const cache = previous()
      if (cache) return { ...cache, cached: true }
    }
    throw error
  }
}

export type LocalDraft = { id: number; to: string; cc?: string; bcc?: string; subject: string; html: string; attachments?: { filename: string; content: string; contentType?: string }[]; updatedAt: string }
export function localDrafts(scope: string): LocalDraft[] { return readLocal<LocalDraft[]>(scope, 'drafts')?.value || [] }
export function saveLocalDraft(scope: string, input: Omit<LocalDraft, 'id' | 'updatedAt'> & { id?: number }): LocalDraft {
  const drafts = localDrafts(scope)
  const draft = { ...input, id: input.id ?? -(Date.now() * 1000 + crypto.randomInt(1000)), updatedAt: new Date().toISOString() }
  writeLocal(scope, 'drafts', [draft, ...drafts.filter(d => d.id !== draft.id)])
  return draft
}
export function deleteLocalDraft(scope: string, id: number) { writeLocal(scope, 'drafts', localDrafts(scope).filter(d => d.id !== id)) }

export function folderGeneration(scope: string, mailbox: string, generation: string) { writeLocal(scope, `generation:${mailbox}`, generation) }
export function mailCacheKey(scope: string, mailbox: string, key: string) { return () => `${key}:${readLocal<string>(scope, `generation:${mailbox}`)?.value || 'initial'}` }
