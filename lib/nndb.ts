// The cognitive layer, reached over loopback.
//
// Zaim deploys to Vercel, which has no shell, so it cannot run the Claude
// subscription bridge itself: `claude -p` needs a real process. The NNDB
// service runs on Lottie's own machine and Zaim calls it when it is reachable.
//
// When it is not reachable, drafting falls back to lib/ai.ts (the Groq relay).
// That fallback is reported, never hidden: a draft written without the style
// rules and the retrieved precedent is not in the same voice, and presenting
// it as if it were is how the system would quietly stop being useful.

const NNDB_URL = process.env.NNDB_URL || 'http://127.0.0.1:4455'
const NNDB_TOKEN = process.env.NNDB_TOKEN || ''

export type NndbHealth = {
  ok: true
  provider: string
  samples: number
  embeddings: number
  rules: number
  sentEmails: number
  storage: 'sqlite' | 'd1'
  location: string
  embeddings_ready: boolean
  /** False on a fresh install: running, but with nothing learned yet. */
  trained: boolean
  learning: string | null
}

export type NndbDraft = {
  subject: string | null
  body: string
  valid: boolean
  problems: string[]
  context: {
    hardRules: number
    softRules: number
    prohibitions: number
    facts: number
    precedent: number
    priorContact: boolean
  }
}

export type NndbHit = {
  id: number
  subject: string
  recipient: string
  body: string
  score: number
  occurred_at: number
}

async function call<T>(path: string, body?: unknown, timeoutMs = 240_000): Promise<T> {
  if (!NNDB_TOKEN) throw new Error('NNDB_TOKEN is not set')
  const res = await fetch(`${NNDB_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${NNDB_TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `NNDB ${res.status}`)
  return data as T
}

/** Is the cognitive layer up? Short timeout: this gates a UI affordance. */
export async function nndbAvailable(): Promise<NndbHealth | null> {
  try { return await call<NndbHealth>('/health', undefined, 2500) }
  catch { return null }
}

export async function nndbDraft(input: {
  brief: string
  recipient?: string | null
  subject?: string | null
}): Promise<NndbDraft> {
  return call<NndbDraft>('/draft', input)
}

/** Semantic search over what has actually been sent, not IMAP keyword search. */
export async function nndbSearch(query: string, limit = 5): Promise<NndbHit[]> {
  const { hits } = await call<{ hits: NndbHit[] }>('/search', { query, limit }, 30_000)
  return hits
}

export type NndbLearnStatus = {
  running: boolean
  step: string | null
  startedAt: number | null
  finishedAt: number | null
  result: { seen: number; inserted: number; embedded: number; rules: number } | null
  error: string | null
}

export type NndbFact = { claim: string; source_url: string; confidence: number }

export type NndbImap = {
  host: string; port?: number; secure?: boolean
  user: string; pass?: string; accessToken?: string
}

/**
 * Start the learn cycle, handing over the mailbox the caller is signed in to.
 *
 * Without this the ingester falls back to the CLI's own OAuth token file,
 * which expires on its own schedule: learning failed with "run zaim login" for
 * someone already signed into the app. The credentials travel over loopback to
 * a service that already drafts mail as this person, so this widens nothing.
 */
export async function nndbLearn(imap?: NndbImap): Promise<{ started: boolean }> {
  return call<{ started: boolean }>('/learn', { imap: imap ?? null }, 15_000)
}

export async function nndbLearnStatus(): Promise<NndbLearnStatus> {
  return call<NndbLearnStatus>('/learn', undefined, 10_000)
}

/** Sourced facts about a recipient. Slow: it is really searching the web. */
export async function nndbResearch(recipient: string, hint?: string, force = false) {
  return call<{ domain: string; cached: boolean; stored?: number; rejected?: number; facts: NndbFact[] }>(
    '/research', { recipient, hint, force }, 600_000,
  )
}

/** A correction is the only thing that moves a rule's weight after ingestion. */
export async function nndbCorrection(input: {
  drafted: string
  corrected: string
  note?: string
}): Promise<{ id: number }> {
  return call<{ id: number }>('/correction', input, 15_000)
}
