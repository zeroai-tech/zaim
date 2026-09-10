/**
 * Research a recipient before writing to them.
 *
 * This closes the one place the system could still invent confidently. A cold
 * draft to Rwanda's Ministry of Education cited the ICT in Education Policy,
 * the Smart Rwanda Master Plan and Vision 2050. All three are real, and none
 * of them came from the database: the model supplied them from its own
 * memory. That is exactly the failure mode this system exists to prevent,
 * because a plausible policy name with a wrong year, in an email to the
 * ministry that wrote it, costs the relationship.
 *
 * So recipient facts are researched first, stored with a source URL, and the
 * drafting prompt is then told to use those and invent nothing else. Research
 * is the only call in the system allowed to touch the web, and it cannot
 * write anything.
 */

import { all, first, insert, run } from './db.mjs'
import { ask } from './bridge.mjs'

const SYSTEM = `You are researching an organisation so that someone can write to them accurately.
Report only what you can verify from a source you actually retrieved in this session.
An unverifiable claim is worse than no claim: it will be sent to the organisation that would know it is wrong.
If you cannot find something, say so rather than filling the gap from memory.`

/** How long a researched fact is trusted before it is re-checked. */
const STALE_AFTER_DAYS = 90

function prompt(org, domain, hint) {
  return `Research the organisation at the domain "${domain}"${org ? ` (${org})` : ''}.

Use web search. Base every fact on a page you actually retrieved.

Find, if they exist:
- the organisation's full official name and what it is responsible for
- named policies, strategies or programmes it runs, with the year each was published
- any stated priority relating to education technology, teacher training, digital skills or ICT in schools
- the correct department, unit or role that would handle an unsolicited teacher-training proposal
- anything that would make an approach inappropriate or badly timed

${hint ? `Additional context from the sender: ${hint}\n` : ''}
Return STRICT JSON, an array of at most 10 objects, no prose around it:
[{"claim":"<one specific verifiable fact, written as a full sentence>","source_url":"<the URL you actually read>","confidence":<0.0-1.0>}]

Rules:
- Every object needs a real source_url you retrieved. No source, no fact.
- Do not include a fact you are recalling rather than reading. Return fewer facts instead.
- Give a year for any policy, strategy or programme you name.
- If you find nothing verifiable, return [].`
}

function parseArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const a = body.indexOf('[')
  const b = body.lastIndexOf(']')
  if (a === -1 || b === -1) throw new Error(`no JSON array in research output: ${text.slice(0, 200)}`)
  return JSON.parse(body.slice(a, b + 1))
}

async function entityFor(email) {
  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : email.toLowerCase()
  await run(
    `INSERT INTO entities (kind, name, email, notes, first_seen_at, last_seen_at, touches)
     VALUES ('org', ?, ?, 'created by research', unixepoch(), unixepoch(), 0)
     ON CONFLICT (kind, name) DO NOTHING`,
    [domain, email.includes('@') ? email.toLowerCase() : null],
  )
  const row = await first(`SELECT id, name FROM entities WHERE kind = 'org' AND name = ?`, [domain])
  return { id: row.id, domain: row.name }
}

/** Facts already known about this recipient, freshest first. */
export async function recipientFacts(email) {
  if (!email) return []
  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : email.toLowerCase()
  return all(
    `SELECT f.claim, f.source_url, f.confidence, f.researched_at
     FROM facts f JOIN entities e ON e.id = f.entity_id
     WHERE e.kind = 'org' AND e.name = ?
     ORDER BY f.confidence DESC, f.researched_at DESC`,
    [domain],
  )
}

export async function isStale(email) {
  const facts = await recipientFacts(email)
  if (!facts.length) return true
  const newest = Math.max(...facts.map((f) => f.researched_at ?? 0))
  return (Date.now() / 1000 - newest) > STALE_AFTER_DAYS * 86400
}

export async function researchRecipient(email, { hint = null, force = false } = {}) {
  if (!email) throw new Error('a recipient is required')
  const { id: entityId, domain } = await entityFor(email)

  if (!force && !(await isStale(email))) {
    return { domain, cached: true, facts: await recipientFacts(email) }
  }

  const { text } = await ask(prompt(null, domain, hint), {
    system: SYSTEM,
    // The only call in the system with web access, and it still cannot write.
    allowTools: ['WebSearch', 'WebFetch'],
    // Several searches plus fetches, so this needs far longer than a draft.
    // The default three minutes cut it off mid-research.
    timeoutMs: 600_000,
  })

  const found = parseArray(text)
  let stored = 0

  for (const f of found) {
    const claim = String(f?.claim ?? '').trim()
    const url = String(f?.source_url ?? '').trim()
    // A fact with no source is the thing being prevented. Drop it silently
    // rather than storing it at low confidence, where it would still reach a
    // draft and still be unverifiable.
    if (!claim || !/^https?:\/\//.test(url)) continue

    await run(
      `INSERT INTO facts (subject, claim, sensitivity, source, confidence, entity_id, source_url, researched_at)
       VALUES (?, ?, 'public', 'researched', ?, ?, ?, unixepoch())
       ON CONFLICT (subject, claim) DO UPDATE SET
         source_url    = excluded.source_url,
         confidence    = excluded.confidence,
         researched_at = excluded.researched_at`,
      [domain, claim, Math.min(1, Math.max(0, Number(f.confidence) || 0.6)), entityId, url],
    )
    stored++
  }

  return { domain, cached: false, stored, rejected: found.length - stored, facts: await recipientFacts(email) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const to = process.argv.find((a) => a.startsWith('--to='))?.slice(5)
  const hint = process.argv.find((a) => a.startsWith('--hint='))?.slice(7) ?? null
  if (!to) { console.error('usage: node src/research.mjs --to=addr [--hint="..."] [--force]'); process.exit(1) }
  const out = await researchRecipient(to, { hint, force: process.argv.includes('--force') })
  console.log(`${out.domain}: ${out.cached ? 'cached' : `${out.stored} stored, ${out.rejected} rejected for having no source`}`)
  for (const f of out.facts) console.log(`  · ${f.claim}\n    ${f.source_url}`)
}
