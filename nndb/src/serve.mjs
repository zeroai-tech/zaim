#!/usr/bin/env node
/**
 * NNDB as a local service.
 *
 * Zaim runs on Vercel, where there is no shell and therefore no subscription
 * bridge: `claude -p` cannot be spawned from a serverless function. So the
 * cognitive layer runs here, on Lottie's own machine, and Zaim calls it.
 *
 * When this is not running, Zaim degrades to its existing relay rather than
 * failing. The difference is visible in the UI, because a draft written
 * without the NNDB is not in the same voice and should not be presented as if
 * it were.
 *
 * Bound to loopback and requiring a shared token, because it will happily
 * draft mail as its owner.
 */

import { createServer } from 'node:http'
import { draftEmail, recordCorrection } from './draft.mjs'
import { ingestSentMail } from './ingest-mail.mjs'
import { deriveStyle } from './derive-style.mjs'
import { researchRecipient } from './research.mjs'
import { embeddingsAvailable, similarWriting, upsertEmbedding } from './embed.mjs'
import { styleRules, prohibitions, priorContact } from './recall.mjs'
import { all, first, backend, location } from './db.mjs'

const PORT = Number(process.env.NNDB_PORT ?? 4455)
const TOKEN = process.env.NNDB_TOKEN ?? ''

if (!TOKEN) {
  console.error('Set NNDB_TOKEN. This service drafts and reads mail as its owner.')
  process.exit(1)
}

const json = (res, code, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

/**
 * Learning runs for minutes, not milliseconds, so it cannot be a request that
 * blocks. A downloadable app also cannot ask its owner to open a terminal and
 * run four commands in the right order, which is what this replaces.
 */
const learning = { running: false, step: null, started: null, finished: null, result: null, error: null }

async function runLearn({ deriveRules = true, imap = null } = {}) {
  learning.running = true
  learning.started = Date.now()
  learning.error = null
  learning.result = null
  try {
    learning.step = 'reading sent mail'
    const mail = await ingestSentMail({ imap })

    learning.step = 'embedding'
    const rows = await all(`SELECT id, subject, body FROM writing_samples`)
    const done = new Set(
      (await all(`SELECT source_id FROM embeddings WHERE source_kind = 'writing_sample'`))
        .map((r) => r.source_id),
    )
    let embedded = 0
    for (const r of rows) {
      if (done.has(r.id)) continue
      try { await upsertEmbedding('writing_sample', r.id, `${r.subject ?? ''}\n\n${r.body}`); embedded++ } catch { /* one bad sample must not stop the run */ }
    }

    let rules = 0
    if (deriveRules) {
      learning.step = 'deriving your writing rules'
      const d = await deriveStyle()
      rules = d.rules ?? 0
    }

    learning.result = { ...mail, embedded, rules }
  } catch (e) {
    learning.error = String(e.message).slice(0, 400)
  } finally {
    learning.running = false
    learning.step = null
    learning.finished = Date.now()
  }
}

const routes = {
  'GET /health': async () => {
    const [samples, embeds, rules, sent] = await Promise.all([
      first(`SELECT COUNT(*) n FROM writing_samples`),
      first(`SELECT COUNT(*) n FROM embeddings`),
      first(`SELECT COUNT(*) n FROM writing_style`),
      first(`SELECT COUNT(*) n FROM writing_samples WHERE source_kind = 'sent_email'`),
    ])
    return {
      ok: true,
      provider: process.env.NNDB_PROVIDER ?? 'claude_code',
      samples: samples.n, embeddings: embeds.n, rules: rules.n, sentEmails: sent.n,
      storage: backend, location,
      embeddings_ready: await embeddingsAvailable(),
      // A fresh install has learned nothing yet, and the UI needs to say so
      // rather than silently drafting from an empty rule set.
      trained: rules.n > 0 && sent.n > 0,
      learning: learning.running ? learning.step : null,
    }
  },

  'POST /draft': async (body) => {
    if (!body?.brief) return { error: 'brief is required', status: 400 }
    return draftEmail({
      brief: body.brief,
      recipient: body.recipient ?? null,
      subject: body.subject ?? null,
      provider: body.provider ?? null,
    })
  },

  'POST /search': async (body) => {
    if (!body?.query) return { error: 'query is required', status: 400 }
    const hits = await similarWriting(body.query, Math.min(body.limit ?? 5, 20))
    return { hits: hits.map((h) => ({ ...h, body: h.body.slice(0, 600) })) }
  },

  'POST /context': async (body) => {
    const [rules, banned, prior] = await Promise.all([
      styleRules(), prohibitions(),
      body?.recipient ? priorContact(body.recipient) : null,
    ])
    return { rules, prohibitions: banned, priorContact: prior }
  },

  'POST /correction': async (body) => {
    if (!body?.corrected) return { error: 'corrected is required', status: 400 }
    const id = await recordCorrection(body)
    return { id }
  },

  'GET /rules': async () => ({ rules: await styleRules() }),

  // Kicked off, not awaited: the caller polls /learn.
  'POST /learn': async (body) => {
    if (learning.running) return { error: `already running: ${learning.step}`, status: 409 }
    if (!(await embeddingsAvailable())) {
      return {
        error: 'Ollama is not running, or the embedding model is missing. Start Ollama and run: ollama pull all-minilm',
        status: 503,
      }
    }
    // The caller supplies the mailbox when it has one, which the desktop app
    // always does. Without it the ingester falls back to the CLI's token file.
    runLearn({ deriveRules: body?.deriveRules !== false, imap: body?.imap ?? null })
    return { started: true }
  },

  'GET /learn': async () => ({
    running: learning.running,
    step: learning.step,
    startedAt: learning.started,
    finishedAt: learning.finished,
    result: learning.result,
    error: learning.error,
  }),

  'POST /research': async (body) => {
    if (!body?.recipient) return { error: 'recipient is required', status: 400 }
    return researchRecipient(body.recipient, { hint: body.hint ?? null, force: Boolean(body.force) })
  },

  'GET /intents': async () => ({
    intents: await all(`SELECT goal, horizon, priority, success_looks_like FROM intent_models WHERE active = 1 ORDER BY priority DESC`),
  }),
}

createServer(async (req, res) => {
  // Loopback only. The bind below already enforces this; the check is here so
  // a future change to the bind address cannot silently expose it.
  const remote = req.socket.remoteAddress ?? ''
  if (!remote.includes('127.0.0.1') && !remote.includes('::1')) {
    return json(res, 403, { error: 'loopback only' })
  }

  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'unauthorised' })

  const key = `${req.method} ${new URL(req.url, 'http://localhost').pathname}`
  const handler = routes[key]
  if (!handler) return json(res, 404, { error: `no route for ${key}` })

  const body = req.method === 'POST' ? await readBody(req) : {}
  if (body === null) return json(res, 400, { error: 'body must be JSON' })

  try {
    const out = await handler(body)
    json(res, out?.status ?? 200, out)
  } catch (e) {
    // The message often names the real cause (bridge missing, token expired),
    // and this is loopback-only, so returning it is help rather than leakage.
    json(res, 500, { error: String(e.message).slice(0, 400) })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`NNDB listening on http://127.0.0.1:${PORT}`)
  console.log(`provider: ${process.env.NNDB_PROVIDER ?? 'claude_code'}`)
})
