#!/usr/bin/env node
// Create the schema in whichever backend is configured. Safe to re-run.
import { migrate, backend, location } from '../src/db.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const sql = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', '001_core.sql')
const r = await migrate(sql)
console.log(`${backend} (${location}): ${r.ok} statements applied`)
for (const f of r.failed) console.error(`  failed: ${f.sql} — ${f.error.slice(0, 90)}`)
