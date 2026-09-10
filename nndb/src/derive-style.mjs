/**
 * Derive the writing rules from the sent corpus.
 *
 * Two passes, deliberately.
 *
 * The measurable rules are counted, not inferred. Whether Lottie uses em
 * dashes is a fact about 221 emails, and asking a model to guess it would be
 * worse than counting. Anything with a clear signal becomes a `hard` rule,
 * which the drafting prompt states as a prohibition rather than a preference.
 *
 * The structural rules, the moves an email makes and in what order, are not
 * countable, so those go through the bridge with real samples attached. Every
 * rule it returns has to cite the email it came from, so a rule can be checked
 * rather than trusted.
 */

import { all, first, run, insert } from './db.mjs'
import { ask } from './bridge.mjs'

/* ─────────────────────────────────────────────────── measured rules ── */

const MEASURES = [
  {
    rule: 'Never use an em dash. Use a comma, a full stop, or a colon.',
    rationale: 'Counted across the sent corpus.',
    test: (b) => b.includes('—'),
    // Present in fewer than this share of emails means it is avoided.
    absentBelow: 0.05,
  },
  {
    rule: 'Never use exclamation marks.',
    rationale: 'Counted across the sent corpus.',
    test: (b) => b.includes('!'),
    absentBelow: 0.05,
  },
  {
    rule: 'Write sums and quantities as words in prose ("ten thousand five hundred US dollars"), not as numerals.',
    rationale: 'Counted: money appears spelled out far more often than as digits.',
    test: (b) => /\$\s?\d|\bUSD\s?\d|\b\d{4,}\b/.test(b),
    absentBelow: 0.35,
  },
  {
    rule: 'Do not use emoji.',
    rationale: 'Counted across the sent corpus.',
    test: (b) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b),
    absentBelow: 0.02,
  },
]

async function measured(samples) {
  const found = []
  for (const m of MEASURES) {
    const hits = samples.filter((s) => m.test(s.body)).length
    const share = hits / samples.length
    if (share <= m.absentBelow) {
      found.push({
        kind: 'hard',
        rule: m.rule,
        rationale: `${m.rationale} Present in ${hits} of ${samples.length} sent emails (${(share * 100).toFixed(1)}%).`,
        confidence: Math.min(0.99, 1 - share),
      })
    }
  }
  return found
}

/* ───────────────────────────────────────────────── structural rules ── */

const SYSTEM = `You are analysing one person's real sent emails to extract their writing rules.
You are not writing anything in their voice. You are describing, precisely, what they do.
Report only patterns you can point to in the supplied emails. Do not invent rules that sound plausible.`

function structuralPrompt(samples) {
  const corpus = samples
    .map((s, i) => `--- EMAIL ${i + 1} (to ${s.recipient || 'unknown'}) ---\nSubject: ${s.subject}\n\n${s.body}`)
    .join('\n\n')

  return `Below are ${samples.length} real emails written by Lottie Mukuka, founder of ZeroAI Technologies.

Extract the rules that govern how these are written. Focus on:
- the order of moves an email makes, from opening to ask
- how the opening establishes standing with a stranger
- how claims are evidenced
- how the ask is phrased
- what is deliberately admitted or conceded, and where
- sentence and paragraph shape

Return STRICT JSON, an array of at most 12 objects:
[{"kind":"soft","rule":"<imperative, specific, usable as an instruction>","rationale":"<why, in one sentence>","evidence":"<a short verbatim quote from one of the emails above>"}]

Rules must be specific enough to change a draft. "Be professional" is useless.
"State what has already been delivered before what is planned, with a number attached" is useful.
Every rule needs a verbatim quote in "evidence" that demonstrates it.
Output the JSON array only, with no prose around it.

${corpus}`
}

function parseJsonArray(text) {
  // The bridge sometimes wraps JSON in a fence despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error(`no JSON array in model output: ${text.slice(0, 200)}`)
  return JSON.parse(body.slice(start, end + 1))
}

/* ──────────────────────────────────────────────────────────── main ── */

export async function deriveStyle({ sampleSize = 14, dryRun = false } = {}) {
  // Only the high-quality corpus. The sent folder spans two eras: earlier
  // sends were generated and pasted, and they leak markdown asterisks into
  // the body and use em dashes at three times the rate of the recent ones.
  // Deriving rules from the mixture produced a "no em dash" rule that the data
  // refused to support, because 29% of all sent mail contains one and almost
  // all of those are from the era being replaced.
  const samples = await all(
    `SELECT id, recipient, subject, body FROM writing_samples
     WHERE source_kind = 'sent_email' AND quality >= 0.9
     ORDER BY occurred_at DESC`,
  )
  if (samples.length < 5) throw new Error(`only ${samples.length} sent emails ingested; run ingest-mail first`)

  const rules = await measured(samples)

  // A spread across the corpus rather than the newest few, so the rules are
  // not derived from one week's campaign.
  const step = Math.max(1, Math.floor(samples.length / sampleSize))
  const spread = samples.filter((_, i) => i % step === 0).slice(0, sampleSize)

  const { text } = await ask(structuralPrompt(spread), { system: SYSTEM })
  for (const r of parseJsonArray(text)) {
    if (!r?.rule) continue
    rules.push({
      kind: r.kind === 'hard' ? 'hard' : 'soft',
      rule: String(r.rule).trim(),
      rationale: String(r.rationale ?? '').trim(),
      example_good: String(r.evidence ?? '').trim(),
      confidence: 0.7,
    })
  }

  if (dryRun) return rules

  let saved = 0
  for (const r of rules) {
    await run(
      `INSERT INTO writing_style (kind, scope, rule, rationale, example_good, confidence)
       VALUES (?, 'email', ?, ?, ?, ?)
       ON CONFLICT (scope, rule) DO UPDATE SET
         kind = excluded.kind,
         rationale = excluded.rationale,
         example_good = COALESCE(excluded.example_good, writing_style.example_good),
         confidence = excluded.confidence,
         version = writing_style.version + 1`,
      [r.kind, r.rule, r.rationale ?? null, r.example_good ?? null, r.confidence],
    )
    saved++
  }

  await insert(
    `INSERT INTO cognition_versions (label, note) VALUES (?, ?)`,
    [`style-${new Date().toISOString().slice(0, 10)}`, `Derived from ${samples.length} sent emails, ${spread.length} sampled for structure.`],
  )

  return { corpus: samples.length, sampled: spread.length, rules: saved }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry-run')
  const out = await deriveStyle({ dryRun: dry })
  console.log(dry ? JSON.stringify(out, null, 2) : out)
}
