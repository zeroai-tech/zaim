/**
 * Embed everything that has text but no vector yet.
 *
 * Kept separate from ingestion so a slow local model cannot hold an IMAP
 * connection open until it times out, and so a re-run after adding a new
 * source only does the work that is actually missing.
 */

import { all } from './db.mjs'
import { upsertEmbedding, embeddingsAvailable, MODEL } from './embed.mjs'

const SOURCES = [
  { kind: 'writing_sample', sql: `SELECT id, subject, body FROM writing_samples`, text: (r) => `${r.subject ?? ''}\n\n${r.body}` },
  { kind: 'fact', sql: `SELECT id, subject, claim FROM facts`, text: (r) => `${r.subject}: ${r.claim}` },
  { kind: 'thought_pattern', sql: `SELECT id, name, trigger, rule FROM thought_patterns`, text: (r) => `${r.name}\nWhen: ${r.trigger}\nThen: ${r.rule}` },
  { kind: 'memory', sql: `SELECT id, summary FROM conversation_memory`, text: (r) => r.summary },
]

if (!(await embeddingsAvailable())) {
  console.error(`ollama is not serving "${MODEL}". Start it with: ollama serve`)
  process.exit(1)
}

const done = new Set(
  (await all('SELECT source_kind, source_id FROM embeddings WHERE model = ?', [MODEL]))
    .map((r) => `${r.source_kind}:${r.source_id}`),
)

let embedded = 0, failed = 0
for (const src of SOURCES) {
  const rows = await all(src.sql)
  for (const row of rows) {
    if (done.has(`${src.kind}:${row.id}`)) continue
    const text = src.text(row)
    if (!text?.trim()) continue
    try {
      await upsertEmbedding(src.kind, row.id, text)
      embedded++
      if (embedded % 25 === 0) process.stdout.write(`  ${embedded} embedded\n`)
    } catch (e) {
      failed++
      console.error(`  failed ${src.kind}#${row.id}: ${e.message.slice(0, 120)}`)
    }
  }
}
console.log({ embedded, failed })
