/**
 * Storage, with two interchangeable backends behind one async interface.
 *
 *   SQLite  when NNDB_DB_PATH is set, or nothing else is configured.
 *   D1      when the Cloudflare credentials are present.
 *
 * The desktop build uses SQLite and needs no credentials at all: install the
 * app, sign in to mail, and the cognition is built on the device and stays
 * there. D1 remains for the case where the same cognition should follow you
 * across machines, which costs a token to configure.
 *
 * This mirrors what Zaim's own lib/store.ts already does for the vault, so the
 * two halves of the desktop app behave the same way.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
const DB_ID = process.env.NNDB_DATABASE_ID ?? ''
const TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN ?? ''
const SQLITE_PATH = process.env.NNDB_DB_PATH ?? ''

const useD1 = Boolean(ACCOUNT && DB_ID && TOKEN) && !SQLITE_PATH

export const backend = useD1 ? 'd1' : 'sqlite'
export const location = useD1 ? `d1:${DB_ID.slice(0, 8)}` : (SQLITE_PATH || 'nndb.sqlite')

/* ─────────────────────────────────────────────────────────────── sqlite ── */

let sqlite = null
function db() {
  if (sqlite) return sqlite
  // Required lazily so the D1 path needs no native module at all, which keeps
  // the dependency optional for anything that only talks to Cloudflare.
  const require_ = createRequire(import.meta.url)
  const Database = require_('better-sqlite3')
  sqlite = new Database(SQLITE_PATH || 'nndb.sqlite')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

// D1 binds with ? and so does better-sqlite3, so statements need no rewriting.
function runSqlite(sql, params) {
  const stmt = db().prepare(sql)
  const head = sql.trim().slice(0, 6).toUpperCase()
  // A PRAGMA that assigns (`PRAGMA foreign_keys = ON`) returns nothing, while
  // one that asks (`PRAGMA table_info(x)`) returns rows. Treating both as
  // queries made every migration report a spurious failure.
  const isPragmaQuery = head === 'PRAGMA' && !sql.includes('=')
  const returnsRows = head === 'SELECT' || isPragmaQuery || /\bRETURNING\b/i.test(sql)
  if (returnsRows) return { results: stmt.all(...params), meta: null }
  const info = stmt.run(...params)
  return { results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
}

/* ───────────────────────────────────────────────────────────────── d1 ── */

async function runD1(sql, params) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  )
  const body = await res.json()
  if (!body.success) {
    throw new Error(`D1: ${JSON.stringify(body.errors).slice(0, 300)}\n  ${sql.slice(0, 120)}`)
  }
  const r = body.result?.[0]
  return { results: r?.results ?? [], meta: r?.meta ?? null }
}

/* ───────────────────────────────────────────────────────────── surface ── */

export async function q(sql, params = []) {
  return useD1 ? runD1(sql, params) : runSqlite(sql, params)
}

export const all = async (sql, p = []) => (await q(sql, p)).results ?? []
export const first = async (sql, p = []) => (await all(sql, p))[0] ?? null
export const run = async (sql, p = []) => (await q(sql, p)).meta

/** Insert and return the new row id. */
export async function insert(sql, params = []) {
  const meta = await run(sql, params)
  // SQLite hands the id back directly; D1's HTTP API needs a second statement.
  if (meta && Number.isFinite(meta.last_row_id) && meta.last_row_id > 0) return meta.last_row_id
  const row = await first('SELECT last_insert_rowid() AS id')
  return row?.id ?? null
}

/**
 * Apply a .sql file statement by statement.
 *
 * Splitting on ";" naively is wrong: an end-of-line comment containing a
 * semicolon splits the statement it is attached to, and the halves fail with
 * errors pointing nowhere near the real problem. Comments are stripped first,
 * respecting string literals so a semicolon inside a default value survives.
 */
export async function migrate(path) {
  const raw = readFileSync(path, 'utf8')
  const results = { ok: 0, failed: [] }
  for (const stmt of splitStatements(raw)) {
    try { await q(stmt); results.ok++ }
    catch (e) { results.failed.push({ sql: stmt.slice(0, 80).replace(/\s+/g, ' '), error: e.message }) }
  }
  return results
}

/**
 * Split a .sql file into statements, respecting string literals and comments.
 *
 * Both naive approaches have already broken here. Splitting on ";" cut a
 * statement in half at a semicolon inside quoted text, and the halves failed
 * with errors pointing nowhere near the real problem. Stripping comments
 * without tracking strings would corrupt any literal containing two hyphens.
 *
 * So this walks the file once: inside a string, nothing is a delimiter and
 * nothing starts a comment; a doubled quote is an escaped quote and does not
 * end the string.
 */
export function splitStatements(sql) {
  const out = []
  let buf = ''
  let inStr = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    const next = sql[i + 1]

    if (inLineComment) { if (c === '\n') { inLineComment = false; buf += c } continue }
    if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++ } continue }

    if (inStr) {
      buf += c
      if (c === "'") {
        // A doubled quote is an escaped quote, not the end of the string.
        if (next === "'") { buf += next; i++ } else inStr = false
      }
      continue
    }

    if (c === '-' && next === '-') { inLineComment = true; i++; continue }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue }
    if (c === "'") { inStr = true; buf += c; continue }
    if (c === ';') { if (buf.trim()) out.push(buf.trim()); buf = ''; continue }
    buf += c
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/* ------------------------------------------------------------- vectors -- */

/**
 * base64 of float32 little-endian, stored as text.
 *
 * A real BLOB does not survive D1's HTTP transport. Binding a Buffer there
 * serialises it as JSON, and reading it back returns a string that is not the
 * bytes that went in: a 384 dimension vector came back as three enormous
 * garbage floats, with a stored norm that no longer matched the data. That
 * fails silently, because a corrupt vector still scores against other corrupt
 * vectors and simply returns nonsense neighbours.
 *
 * base64 is explicit, survives both transports unchanged, and costs 2KB.
 */
export function packVector(arr) {
  const f = new Float32Array(arr)
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64')
}

export function unpackVector(value) {
  const b = Buffer.from(String(value), 'base64')
  if (b.byteLength % 4 !== 0) throw new Error(`vector is ${b.byteLength} bytes, not a whole number of float32`)
  // Copy rather than view: Buffer.from(base64) may not be 4-byte aligned, and
  // Float32Array over an unaligned offset throws.
  const out = new Float32Array(b.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4)
  return out
}

export function norm(vec) {
  let s = 0
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i]
  return Math.sqrt(s)
}

/** Cosine similarity, with both norms supplied so this is one pass. */
export function cosine(a, b, na, nb) {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  const d = na * nb
  return d === 0 ? 0 : dot / d
}
