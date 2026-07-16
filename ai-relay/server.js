'use strict'
// Thin authenticated proxy: Zaim's serverless backend (Vercel) never holds the
// Groq key itself — it calls this, which lives on our own infra, and this
// forwards to Groq. Prompt/model choice stays in Zaim's route handlers so
// adding new AI actions never requires redeploying this service.
const http = require('http')
const https = require('https')

const PORT = process.env.PORT || 8020
const AUTH_TOKEN = process.env.AI_RELAY_TOKEN
const GROQ_API_KEY = process.env.GROQ_API_KEY

if (!AUTH_TOKEN || !GROQ_API_KEY) {
  console.error('AI_RELAY_TOKEN and GROQ_API_KEY must be set')
  process.exit(1)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy() })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function forwardToGroq(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${GROQ_API_KEY}`,
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat') {
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: 'not found' }))
  }
  if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: 'unauthorized' }))
  }
  try {
    const input = JSON.parse(await readBody(req))
    if (!Array.isArray(input.messages) || !input.messages.length) throw new Error('messages required')
    const { status, body } = await forwardToGroq({
      model: input.model || 'llama-3.3-70b-versatile',
      messages: input.messages,
      temperature: input.temperature ?? 0.4,
      max_tokens: Math.min(input.max_tokens || 600, 1200),
    })
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body)
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`AI relay listening on 127.0.0.1:${PORT}`))
