import path from 'node:path'
import crypto from 'node:crypto'
import { encryptSecret, decryptSecret, type MailAccount } from './config'

// ─────────────────────────────────────────────────────────────────────────────
//  The vault store — users, their mail accounts, and agent API keys. Passwords
//  are AES-256-GCM encrypted at rest (ZAIM_ENC_KEY).
//
//  Two interchangeable backends behind one async interface:
//    · Postgres (pg)   — when POSTGRES_URL / DATABASE_URL is set. For Vercel /
//                        any serverless multi-tenant deploy (Neon, Supabase, …).
//    · SQLite (better-sqlite3) — otherwise. For local dev + the desktop app,
//                        which have a real writable disk.
//  Serverless (Vercel) has no persistent writable disk, so SQLite can't work
//  there — set POSTGRES_URL and this transparently uses Postgres instead.
// ─────────────────────────────────────────────────────────────────────────────

const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
const usePg = !!PG_URL

type Params = readonly unknown[]
interface Driver {
  run(sql: string, p?: Params): Promise<void>
  get<T>(sql: string, p?: Params): Promise<T | undefined>
  all<T>(sql: string, p?: Params): Promise<T[]>
}

// One shared schema — SQLite treats BIGINT as INTEGER affinity, so it fits both.
// (Timestamps are ms since epoch → need 64-bit, hence BIGINT not INTEGER on PG.)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
     imap_host TEXT, imap_port INTEGER, imap_secure INTEGER, imap_user TEXT, imap_pass TEXT,
     smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER, smtp_user TEXT, smtp_pass TEXT,
     from_name TEXT, from_email TEXT, reply_to TEXT, is_default INTEGER DEFAULT 0, created_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)`,
  `CREATE TABLE IF NOT EXISTS api_keys (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, key_hash TEXT UNIQUE NOT NULL,
     account_id TEXT, created_at BIGINT NOT NULL, last_used BIGINT)`,
  `CREATE INDEX IF NOT EXISTS idx_keys_hash ON api_keys(key_hash)`,
]

// Additive, idempotent migrations for databases created before a column existed.
// (SQLite has no ADD COLUMN IF NOT EXISTS, so we just ignore the "duplicate" error.)
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN avatar TEXT', // per-user profile picture (data URL)
]

// Strip sslmode/ssl query params so the connection string can't force cert
// verification — we drive SSL ourselves below. (Supabase/Neon present a
// self-signed chain; `sslmode=require` in the URL would otherwise override our
// ssl options and throw SELF_SIGNED_CERT_IN_CHAIN.)
function pgConnString(raw: string): string {
  try {
    const u = new URL(raw)
    u.searchParams.delete('sslmode')
    u.searchParams.delete('ssl')
    return u.toString()
  } catch {
    return raw.replace(/[?&](sslmode|ssl)=[^&]*/g, '')
  }
}

async function makePg(): Promise<Driver> {
  const pg = await import('pg')
  pg.types.setTypeParser(20, (v: string) => parseInt(v, 10)) // bigint(oid 20) → number (ms fits JS safe int)
  // Managed Postgres (Neon/Supabase/Vercel) uses SSL with a self-signed chain; a
  // local server has none. Verify off for managed (they're reached over a trusted
  // network path), off entirely for localhost.
  const local = /@(localhost|127\.0\.0\.1|::1)[:\/]/.test(PG_URL) || /sslmode=disable/.test(PG_URL)
  const pool = new pg.Pool({ connectionString: pgConnString(PG_URL), ssl: local ? false : { rejectUnauthorized: false }, max: 3 })
  const d: Driver = {
    async run(sql, p = []) { await pool.query(sql, p as unknown[]) },
    async get<T>(sql: string, p: Params = []) { return (await pool.query(sql, p as unknown[])).rows[0] as T | undefined },
    async all<T>(sql: string, p: Params = []) { return (await pool.query(sql, p as unknown[])).rows as T[] },
  }
  for (const ddl of SCHEMA) await d.run(ddl)
  for (const m of MIGRATIONS) { try { await d.run(m) } catch { /* already applied */ } }
  return d
}

async function makeSqlite(): Promise<Driver> {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(process.env.ZAIM_DB_PATH || path.join(process.cwd(), 'zaim.db'))
  db.pragma('journal_mode = WAL')
  const toQ = (sql: string) => sql.replace(/\$\d+/g, '?') // $1,$2… (in order) → positional ?
  const d: Driver = {
    async run(sql, p = []) { db.prepare(toQ(sql)).run(...(p as unknown[])) },
    async get<T>(sql: string, p: Params = []) { return db.prepare(toQ(sql)).get(...(p as unknown[])) as T | undefined },
    async all<T>(sql: string, p: Params = []) { return db.prepare(toQ(sql)).all(...(p as unknown[])) as T[] },
  }
  for (const ddl of SCHEMA) await d.run(ddl)
  for (const m of MIGRATIONS) { try { await d.run(m) } catch { /* already applied */ } }
  return d
}

let _ready: Promise<Driver> | null = null
const ready = (): Promise<Driver> => (_ready ??= (usePg ? makePg() : makeSqlite()))

const id = () => crypto.randomUUID()

// Diagnostic: confirm the DB is reachable + report which backend is active.
export async function dbPing(): Promise<{ backend: 'postgres' | 'sqlite' }> {
  const d = await ready()
  await d.get('SELECT 1 AS one')
  return { backend: usePg ? 'postgres' : 'sqlite' }
}

// ── Users ────────────────────────────────────────────────────────────────────
export interface User { id: string; email: string; pw_hash: string; created_at: number; avatar?: string | null }
export async function createUser(email: string, pwHash: string): Promise<User> {
  const u: User = { id: id(), email: email.toLowerCase(), pw_hash: pwHash, created_at: Date.now() }
  await (await ready()).run('INSERT INTO users (id,email,pw_hash,created_at) VALUES ($1,$2,$3,$4)', [u.id, u.email, u.pw_hash, u.created_at])
  return u
}
export const findUserByEmail = async (email: string): Promise<User | undefined> =>
  (await ready()).get<User>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
export const findUserById = async (uid: string): Promise<User | undefined> =>
  (await ready()).get<User>('SELECT * FROM users WHERE id = $1', [uid])
export async function setUserAvatar(userId: string, avatar: string | null): Promise<void> {
  await (await ready()).run('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, userId])
}

// ── Accounts (mail credentials, encrypted) ───────────────────────────────────
export interface AccountRow {
  id: string; user_id: string; label: string; is_default: number
  imap_host: string; imap_port: number; imap_secure: number; imap_user: string; imap_pass: string
  smtp_host: string; smtp_port: number; smtp_secure: number; smtp_user: string; smtp_pass: string
  from_name: string; from_email: string; reply_to: string
}
export interface AccountInput {
  label: string
  imapHost: string; imapPort?: number; imapSecure?: boolean; imapUser: string; imapPass: string
  smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPass?: string
  fromName?: string; fromEmail?: string; replyTo?: string
}

export async function addAccount(userId: string, a: AccountInput): Promise<string> {
  const rows = await listAccounts(userId)
  const aid = id()
  await (await ready()).run(
    `INSERT INTO accounts
       (id,user_id,label,imap_host,imap_port,imap_secure,imap_user,imap_pass,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass,from_name,from_email,reply_to,is_default,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [aid, userId, a.label, a.imapHost, a.imapPort ?? 993, a.imapSecure === false ? 0 : 1, a.imapUser, encryptSecret(a.imapPass),
     a.smtpHost || a.imapHost, a.smtpPort ?? 465, a.smtpSecure === false ? 0 : 1, a.smtpUser || a.imapUser, encryptSecret(a.smtpPass || a.imapPass),
     a.fromName || a.imapUser, a.fromEmail || a.imapUser, a.replyTo || a.imapUser, rows.length === 0 ? 1 : 0, Date.now()])
  return aid
}
export const listAccounts = async (userId: string): Promise<AccountRow[]> =>
  (await ready()).all<AccountRow>('SELECT * FROM accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC', [userId])

export async function setDefault(userId: string, accountId: string) {
  const d = await ready()
  await d.run('UPDATE accounts SET is_default = 0 WHERE user_id = $1', [userId])
  await d.run('UPDATE accounts SET is_default = 1 WHERE id = $1 AND user_id = $2', [accountId, userId])
}
export async function deleteAccount(userId: string, accountId: string) {
  await (await ready()).run('DELETE FROM accounts WHERE id = $1 AND user_id = $2', [accountId, userId])
}

// Current settings for the edit form — everything EXCEPT the passwords (secrets
// never leave the server; the form leaves the password blank = "keep current").
export interface AccountSettings {
  id: string; label: string
  imapHost: string; imapPort: number; imapSecure: boolean; imapUser: string
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string
  fromEmail: string; replyTo: string
}
export async function getAccount(userId: string, accountId: string): Promise<AccountSettings | null> {
  const r = (await listAccounts(userId)).find((x) => x.id === accountId)
  if (!r) return null
  return {
    id: r.id, label: r.label,
    imapHost: r.imap_host, imapPort: r.imap_port, imapSecure: !!r.imap_secure, imapUser: r.imap_user,
    smtpHost: r.smtp_host, smtpPort: r.smtp_port, smtpSecure: !!r.smtp_secure, smtpUser: r.smtp_user,
    fromEmail: r.from_email, replyTo: r.reply_to,
  }
}

// Partial update of one account. Only the fields provided are written; a blank
// password means "leave the stored one untouched". Passwords are re-encrypted.
export interface AccountEdit {
  label?: string
  imapHost?: string; imapPort?: number; imapSecure?: boolean; imapUser?: string; imapPass?: string
  smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string; smtpPass?: string
  fromEmail?: string; replyTo?: string
}
export async function updateAccount(userId: string, accountId: string, e: AccountEdit): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  const put = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (e.label !== undefined) put('label', e.label)
  if (e.imapHost !== undefined) put('imap_host', e.imapHost)
  if (e.imapPort !== undefined) put('imap_port', e.imapPort)
  if (e.imapSecure !== undefined) put('imap_secure', e.imapSecure ? 1 : 0)
  if (e.imapUser !== undefined) put('imap_user', e.imapUser)
  if (e.imapPass) put('imap_pass', encryptSecret(e.imapPass))
  if (e.smtpHost !== undefined) put('smtp_host', e.smtpHost)
  if (e.smtpPort !== undefined) put('smtp_port', e.smtpPort)
  if (e.smtpSecure !== undefined) put('smtp_secure', e.smtpSecure ? 1 : 0)
  if (e.smtpUser !== undefined) put('smtp_user', e.smtpUser)
  if (e.smtpPass) put('smtp_pass', encryptSecret(e.smtpPass))
  if (e.fromEmail !== undefined) put('from_email', e.fromEmail)
  if (e.replyTo !== undefined) put('reply_to', e.replyTo)
  if (!sets.length) return
  vals.push(accountId, userId)
  await (await ready()).run(
    `UPDATE accounts SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND user_id = $${vals.length}`, vals)
}

// ── Admin: bulk-repoint mailboxes left on an old mail host ────────────────────
// After a server migration, mailboxes added earlier still point IMAP/SMTP at the
// OLD host, so they send but never receive. This finds every such mailbox (across
// ALL users — admin only) so they can be moved in one shot. Matched by host
// substring (case-insensitive) so unrelated accounts (Gmail, etc.) are untouched.
export interface StaleAccount { id: string; from_email: string; imap_host: string; smtp_host: string }
export async function findAccountsByHost(hostLike: string): Promise<StaleAccount[]> {
  const like = `%${hostLike.toLowerCase()}%`
  return (await ready()).all<StaleAccount>(
    'SELECT id, from_email, imap_host, smtp_host FROM accounts WHERE LOWER(imap_host) LIKE $1 OR LOWER(smtp_host) LIKE $1', [like])
}
export async function repointAccounts(hostLike: string, newHost: string): Promise<StaleAccount[]> {
  const rows = await findAccountsByHost(hostLike)
  const d = await ready()
  for (const r of rows) {
    await d.run(
      'UPDATE accounts SET imap_host=$1, imap_port=$2, imap_secure=1, smtp_host=$3, smtp_port=$4, smtp_secure=1 WHERE id=$5',
      [newHost, 993, newHost, 465, r.id])
  }
  return rows
}

// Resolve the MailAccount (decrypted) for a user's chosen/default account.
export async function resolveAccount(userId: string, accountId?: string): Promise<MailAccount | null> {
  const rows = await listAccounts(userId)
  const r = (accountId ? rows.find((x) => x.id === accountId) : rows.find((x) => x.is_default)) || rows[0]
  if (!r) return null
  return {
    imap: { host: r.imap_host, port: r.imap_port, secure: !!r.imap_secure, user: r.imap_user, pass: decryptSecret(r.imap_pass) },
    smtp: { host: r.smtp_host, port: r.smtp_port, secure: !!r.smtp_secure, user: r.smtp_user, pass: decryptSecret(r.smtp_pass) },
    from: { name: r.from_name, email: r.from_email }, replyTo: r.reply_to,
  }
}
export const usesVault = (): boolean => !!process.env.ZAIM_ENC_KEY || process.env.ZAIM_MULTIUSER === '1'

// ── Per-user API keys (agent access) ─────────────────────────────────────────
// The raw key is high-entropy random, so a fast SHA-256 hash is stored (shown
// once, never recoverable). An optional account_id pins the key to one mailbox.
export interface ApiKeyRow { id: string; user_id: string; label: string; account_id: string | null; created_at: number; last_used: number | null }
const hashKey = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

export async function createApiKey(userId: string, label?: string, accountId?: string): Promise<{ row: ApiKeyRow; secret: string }> {
  const secret = 'zaim_' + crypto.randomBytes(24).toString('hex')
  const row: ApiKeyRow = { id: id(), user_id: userId, label: label || 'Agent key', account_id: accountId || null, created_at: Date.now(), last_used: null }
  await (await ready()).run('INSERT INTO api_keys (id,user_id,label,key_hash,account_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [row.id, row.user_id, row.label, hashKey(secret), row.account_id, row.created_at])
  return { row, secret }
}
export const listApiKeys = async (userId: string): Promise<ApiKeyRow[]> =>
  (await ready()).all<ApiKeyRow>('SELECT id,user_id,label,account_id,created_at,last_used FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC', [userId])
export async function revokeApiKey(userId: string, keyId: string) {
  await (await ready()).run('DELETE FROM api_keys WHERE id = $1 AND user_id = $2', [keyId, userId])
}
// Resolve a raw agent key → the owning user + pinned account (hash lookup).
export async function findByApiKey(raw: string): Promise<{ userId: string; accountId: string | null } | null> {
  const d = await ready()
  const r = await d.get<{ id: string; user_id: string; account_id: string | null }>('SELECT id,user_id,account_id FROM api_keys WHERE key_hash = $1', [hashKey(raw)])
  if (!r) return null
  await d.run('UPDATE api_keys SET last_used = $1 WHERE id = $2', [Date.now(), r.id])
  return { userId: r.user_id, accountId: r.account_id }
}
