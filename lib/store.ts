import Database from 'better-sqlite3'
import path from 'node:path'
import crypto from 'node:crypto'
import { encryptSecret, decryptSecret, type MailAccount } from './config'

// ─────────────────────────────────────────────────────────────────────────────
//  The vault store — users + their mail accounts. Passwords are AES-256-GCM
//  encrypted at rest (ZAIM_ENC_KEY). SQLite here powers local dev + the desktop
//  app; the same interface (below) is what a Postgres driver implements for a
//  Vercel/multi-tenant cloud deploy — the API/UI never touch the driver directly.
// ─────────────────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null
function db(): Database.Database {
  if (_db) return _db
  const file = process.env.ZAIM_DB_PATH || path.join(process.cwd(), 'zaim.db')
  _db = new Database(file)
  _db.pragma('journal_mode = WAL')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
      imap_host TEXT, imap_port INTEGER, imap_secure INTEGER, imap_user TEXT, imap_pass TEXT,
      smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER, smtp_user TEXT, smtp_pass TEXT,
      from_name TEXT, from_email TEXT, reply_to TEXT, is_default INTEGER DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, key_hash TEXT UNIQUE NOT NULL,
      account_id TEXT, created_at INTEGER NOT NULL, last_used INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_keys_hash ON api_keys(key_hash);
  `)
  return _db
}

const id = () => crypto.randomUUID()

// ── Users ────────────────────────────────────────────────────────────────────
export interface User { id: string; email: string; pw_hash: string; created_at: number }
export function createUser(email: string, pwHash: string): User {
  const u: User = { id: id(), email: email.toLowerCase(), pw_hash: pwHash, created_at: Date.now() }
  db().prepare('INSERT INTO users (id,email,pw_hash,created_at) VALUES (?,?,?,?)').run(u.id, u.email, u.pw_hash, u.created_at)
  return u
}
export const findUserByEmail = (email: string): User | undefined =>
  db().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as User | undefined
export const findUserById = (uid: string): User | undefined =>
  db().prepare('SELECT * FROM users WHERE id = ?').get(uid) as User | undefined

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

export function addAccount(userId: string, a: AccountInput): string {
  const rows = listAccounts(userId)
  const aid = id()
  db().prepare(`INSERT INTO accounts
    (id,user_id,label,imap_host,imap_port,imap_secure,imap_user,imap_pass,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass,from_name,from_email,reply_to,is_default,created_at)
    VALUES (@id,@user_id,@label,@imap_host,@imap_port,@imap_secure,@imap_user,@imap_pass,@smtp_host,@smtp_port,@smtp_secure,@smtp_user,@smtp_pass,@from_name,@from_email,@reply_to,@is_default,@created_at)`).run({
    id: aid, user_id: userId, label: a.label,
    imap_host: a.imapHost, imap_port: a.imapPort ?? 993, imap_secure: a.imapSecure === false ? 0 : 1,
    imap_user: a.imapUser, imap_pass: encryptSecret(a.imapPass),
    smtp_host: a.smtpHost || a.imapHost, smtp_port: a.smtpPort ?? 465, smtp_secure: a.smtpSecure === false ? 0 : 1,
    smtp_user: a.smtpUser || a.imapUser, smtp_pass: encryptSecret(a.smtpPass || a.imapPass),
    from_name: a.fromName || a.imapUser, from_email: a.fromEmail || a.imapUser, reply_to: a.replyTo || a.imapUser,
    is_default: rows.length === 0 ? 1 : 0, created_at: Date.now(),
  })
  return aid
}
export const listAccounts = (userId: string): AccountRow[] =>
  db().prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').all(userId) as AccountRow[]

export function setDefault(userId: string, accountId: string) {
  const d = db()
  d.prepare('UPDATE accounts SET is_default = 0 WHERE user_id = ?').run(userId)
  d.prepare('UPDATE accounts SET is_default = 1 WHERE id = ? AND user_id = ?').run(accountId, userId)
}
export function deleteAccount(userId: string, accountId: string) {
  db().prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(accountId, userId)
}

// Resolve the MailAccount (decrypted) for a user's chosen/default account.
export function resolveAccount(userId: string, accountId?: string): MailAccount | null {
  const rows = listAccounts(userId)
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

export function createApiKey(userId: string, label?: string, accountId?: string): { row: ApiKeyRow; secret: string } {
  const secret = 'zaim_' + crypto.randomBytes(24).toString('hex')
  const row: ApiKeyRow = { id: id(), user_id: userId, label: label || 'Agent key', account_id: accountId || null, created_at: Date.now(), last_used: null }
  db().prepare('INSERT INTO api_keys (id,user_id,label,key_hash,account_id,created_at) VALUES (?,?,?,?,?,?)')
    .run(row.id, row.user_id, row.label, hashKey(secret), row.account_id, row.created_at)
  return { row, secret }
}
export const listApiKeys = (userId: string): ApiKeyRow[] =>
  db().prepare('SELECT id,user_id,label,account_id,created_at,last_used FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ApiKeyRow[]
export function revokeApiKey(userId: string, keyId: string) {
  db().prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(keyId, userId)
}
// Resolve a raw agent key → the owning user + pinned account (timing-safe via hash lookup).
export function findByApiKey(raw: string): { userId: string; accountId: string | null } | null {
  const r = db().prepare('SELECT id,user_id,account_id FROM api_keys WHERE key_hash = ?').get(hashKey(raw)) as { id: string; user_id: string; account_id: string | null } | undefined
  if (!r) return null
  db().prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), r.id)
  return { userId: r.user_id, accountId: r.account_id }
}
