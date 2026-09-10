#!/usr/bin/env node
/**
 * Create or update the schema in whichever backend is configured.
 *
 * Two jobs, because a database can be either new or old. CREATE TABLE IF NOT
 * EXISTS handles a fresh one and does nothing to an existing one, so a column
 * added to the schema later never reaches a database that already exists.
 * That is exactly what happened: `quality` was added to the live D1 by hand,
 * never written into the schema file, and the first fresh install died on
 * "no such column: quality" during style derivation.
 *
 * So after the schema runs, every table is compared against what it should
 * have and anything missing is added. SQLite has no ADD COLUMN IF NOT EXISTS,
 * and blindly issuing ALTERs would report failures on every healthy database,
 * which trains people to ignore the output.
 */
import { migrate, all, q, backend, location } from '../src/db.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql')
const sql = join(SQL_DIR, '001_core.sql')

// Columns added after the first release. Keep in step with 001_core.sql.
const EXPECTED = {
  writing_samples: { quality: 'REAL NOT NULL DEFAULT 1.0' },
  facts: {
    entity_id: 'INTEGER REFERENCES entities(id) ON DELETE CASCADE',
    source_url: 'TEXT',
    researched_at: 'INTEGER',
  },
  posts: {},
}

const r = await migrate(sql)
console.log(`${backend} (${location}): ${r.ok} statements applied`)

// An index over a column added later cannot be created until the column is.
// Reported after the reconciliation below rather than here, where it is
// simply premature.
const deferred = r.failed.filter((f) => /^CREATE INDEX/i.test(f.sql))
for (const f of r.failed.filter((f) => !deferred.includes(f))) {
  console.error(`  failed: ${f.sql} — ${f.error.slice(0, 90)}`)
}

let added = 0
for (const [table, cols] of Object.entries(EXPECTED)) {
  if (!Object.keys(cols).length) continue
  let existing
  try { existing = new Set((await all(`PRAGMA table_info(${table})`)).map((c) => c.name)) }
  catch { continue }               // table not in this database at all
  if (!existing.size) continue
  for (const [name, decl] of Object.entries(cols)) {
    if (existing.has(name)) continue
    try { await q(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`); added++; console.log(`  + ${table}.${name}`) }
    catch (e) { console.error(`  could not add ${table}.${name}: ${String(e.message).slice(0, 80)}`) }
  }
}
if (added) console.log(`  ${added} column(s) added to an existing database`)

// The guards go in last, once every column they need exists. Without them a
// fresh install drafts with nothing stopping it repeating a retracted claim.
const seed = await migrate(join(SQL_DIR, '002_baseline.sql'))
if (seed.ok) console.log(`  baseline: ${seed.ok} statement(s)`)
for (const f of seed.failed) console.error(`  baseline failed: ${f.error.slice(0, 90)}`)

// Now the columns exist, so any index that depended on one can be built.
for (const f of deferred) {
  try { await q(f.sql); console.log(`  + index ${f.sql.match(/idx_\w+/)?.[0] ?? ''}`) }
  catch (e) { console.error(`  failed: ${f.sql} — ${String(e.message).slice(0, 90)}`) }
}
