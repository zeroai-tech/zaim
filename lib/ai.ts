// Talks to our own AI relay (Oracle VM → Groq), never to Groq directly — the
// Groq key lives only on that VM. See ai-relay/server.js.
const RELAY_URL = process.env.AI_RELAY_URL
const RELAY_TOKEN = process.env.AI_RELAY_TOKEN

export async function chat(messages: { role: 'system' | 'user'; content: string }[], opts: { max_tokens?: number; temperature?: number } = {}): Promise<string> {
  if (!RELAY_URL || !RELAY_TOKEN) throw new Error('AI relay not configured (set AI_RELAY_URL / AI_RELAY_TOKEN)')
  const res = await fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${RELAY_TOKEN}` },
    body: JSON.stringify({ messages, ...opts }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `AI relay error (${res.status})`)
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI returned no content')
  return String(content).trim()
}
