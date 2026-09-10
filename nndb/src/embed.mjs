/**
 * Embeddings, locally.
 *
 * Ollama with all-minilm rather than an embedding API: the whole point of this
 * system is that Lottie's cognition is not shipped to a third party, and an
 * embedding endpoint would send every sent email and every prompt off the
 * machine to build the index.
 *
 * 384 dimensions. Small enough that a full scan of the corpus is a few
 * milliseconds, which is why there is no vector database here.
 */

import { all, first, insert, packVector, unpackVector, norm, cosine } from './db.mjs'

const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
export const MODEL = process.env.NNDB_EMBED_MODEL ?? 'all-minilm'
export const DIMS = 384

export async function embeddingsAvailable() {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const { models = [] } = await res.json()
    return models.some((m) => m.name?.startsWith(MODEL))
  } catch { return false }
}

// all-minilm has a 512 token window and errors rather than truncating, so a
// full outreach email does not fit in one call. Measured: 1400 characters is
// rejected, 1000 is accepted, so 900 leaves room for text that tokenises
// worse than average.
const CHUNK = 900

async function embedOne(text, depth = 0) {
  const res = await fetch(`${HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200)
    // Token count per character varies with the text, so a chunk sized by
    // characters can still overflow. Halve and average rather than failing the
    // whole ingest over one dense paragraph.
    if (detail.includes('exceeds the context length') && text.length > 120 && depth < 4) {
      const mid = Math.floor(text.length / 2)
      const [a, b] = await Promise.all([
        embedOne(text.slice(0, mid), depth + 1),
        embedOne(text.slice(mid), depth + 1),
      ])
      return a.map((x, i) => (x + b[i]) / 2)
    }
    throw new Error(`ollama ${res.status}: ${detail}`)
  }

  const { embedding } = await res.json()
  if (!Array.isArray(embedding) || embedding.length !== DIMS) {
    throw new Error(`expected ${DIMS} dims, got ${embedding?.length}`)
  }
  return embedding
}

/** Split on paragraph boundaries where possible, so a chunk is a whole thought. */
function chunk(text) {
  const paras = text.split(/\n\s*\n/)
  const out = []
  let buf = ''
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > CHUNK) {
      if (buf) out.push(buf)
      // A single paragraph over the limit still has to be cut somewhere.
      if (p.length > CHUNK) {
        for (let i = 0; i < p.length; i += CHUNK) out.push(p.slice(i, i + CHUNK))
        buf = ''
      } else buf = p
    } else buf = buf ? `${buf}\n\n${p}` : p
  }
  if (buf) out.push(buf)
  return out.length ? out : ['']
}

/**
 * Mean-pooled across chunks, so a long email is represented by all of it
 * rather than by whichever 512 tokens happened to come first. The average of
 * unit-ish sentence vectors is the standard way to get a document vector from
 * a sentence model, and it keeps everything in one 384-dimension space.
 */
export async function embed(text) {
  const parts = chunk(text.trim() || ' ')
  if (parts.length === 1) return embedOne(parts[0])

  const acc = new Float64Array(DIMS)
  for (const p of parts) {
    const v = await embedOne(p)
    for (let i = 0; i < DIMS; i++) acc[i] += v[i]
  }
  return Array.from(acc, (x) => x / parts.length)
}

/** Embed and store, skipping anything already embedded with this model. */
export async function upsertEmbedding(sourceKind, sourceId, text) {
  const existing = await first(
    'SELECT id FROM embeddings WHERE source_kind = ? AND source_id = ? AND model = ?',
    [sourceKind, sourceId, MODEL],
  )
  if (existing) return existing.id

  const vec = await embed(text)
  const n = norm(vec)
  return insert(
    `INSERT INTO embeddings (source_kind, source_id, model, dims, vector, norm)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sourceKind, sourceId, MODEL, DIMS, packVector(vec), n],
  )
}

/**
 * Nearest neighbours by cosine.
 *
 * The whole index is pulled and scanned in process. That is deliberate: at a
 * few thousand vectors it costs single-digit milliseconds and one round trip,
 * where a vector service would cost a dependency, a second set of credentials
 * and a sync problem for a corpus that fits comfortably in memory.
 */
export async function search(queryText, { kind = null, limit = 8 } = {}) {
  const qv = await embed(queryText)
  const qn = norm(qv)

  const rows = await all(
    `SELECT source_kind, source_id, vector, norm FROM embeddings
     WHERE model = ?${kind ? ' AND source_kind = ?' : ''}`,
    kind ? [MODEL, kind] : [MODEL],
  )

  return rows
    .map((r) => ({
      source_kind: r.source_kind,
      source_id: r.source_id,
      score: cosine(qv, unpackVector(r.vector), qn, r.norm),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Search and hydrate writing samples in one call, which is the common case.
 *
 * `sourceKind` defaults to sent mail. Both corpora live in one table, and
 * searching across both meant asking a mail client "what have I said like
 * this before" and getting back a voice-dictated Claude Code prompt. The
 * prompts are the decision corpus; they are not things that were said to
 * anyone.
 *
 * Over-fetches before filtering, because the filter happens after scoring and
 * the top matches by cosine may all be from the other corpus.
 */
export async function similarWriting(queryText, limit = 5, { sourceKind = 'sent_email' } = {}) {
  const hits = await search(queryText, { kind: 'writing_sample', limit: limit * 6 })
  if (!hits.length) return []
  const ids = hits.map((h) => h.source_id)
  const rows = await all(
    `SELECT id, source_kind, recipient, subject, body, occurred_at
     FROM writing_samples
     WHERE id IN (${ids.map(() => '?').join(',')})
       ${sourceKind ? 'AND source_kind = ?' : ''}`,
    sourceKind ? [...ids, sourceKind] : ids,
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  return hits
    .map((h) => ({ ...byId.get(h.source_id), score: h.score }))
    .filter((r) => r.id)
    .slice(0, limit)
}
