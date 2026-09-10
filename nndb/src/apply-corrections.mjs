/**
 * Turn corrections into rules.
 *
 * `corrections` stored both sides of every edit and nothing consumed them, so
 * the system could be corrected and would then make the same mistake forever.
 * This closes that: the diff between what was drafted and what was actually
 * sent is the highest quality signal available, because it is Lottie
 * disagreeing with the model on a real email rather than describing a
 * preference in the abstract.
 *
 * Deriving the rule is a model job, but the decision is not. A correction can
 * be one-off, and promoting a one-off into a standing rule is how a style
 * model rots. So a derived rule enters at low confidence and has to be seen
 * again before it outranks a rule measured from the corpus.
 */

import { all, first, run } from './db.mjs'
import { ask } from './bridge.mjs'

const SYSTEM = `You compare a drafted email with the version a person actually sent.
You are identifying the writing rule the edit implies, not describing the edit.
A rule must be specific enough to change a future draft, and general enough to apply beyond this one email.
If the edit is purely factual or one-off, say so rather than inventing a style rule.`

function prompt(c) {
  return `A draft was written for this person, and they edited it before sending.

--- DRAFTED ---
${c.drafted ?? '(not recorded)'}

--- WHAT THEY ACTUALLY SENT ---
${c.corrected}

${c.note ? `--- THEIR NOTE ---\n${c.note}\n` : ''}
What writing rule does this edit imply?

Return STRICT JSON, no prose around it:
{"generalisable": true|false,
 "kind": "hard"|"soft",
 "rule": "<imperative, specific, usable as an instruction>",
 "rationale": "<one sentence: what the edit changed and why it matters>"}

Set "generalisable": false when the edit only fixed a fact, a name, a number, or
something specific to this one recipient. Do not manufacture a style rule from a
factual correction. When false, still fill "rationale" with what the edit was.`
}

function parseObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a === -1 || b === -1) throw new Error(`no JSON object in output: ${text.slice(0, 200)}`)
  return JSON.parse(body.slice(a, b + 1))
}

// A rule derived from one edit is a hypothesis. A rule measured across 118
// emails is evidence. This keeps the first from outranking the second.
const DERIVED_CONFIDENCE = 0.45
const REINFORCE_STEP = 0.15

export async function applyCorrections({ limit = 20, dryRun = false } = {}) {
  const pending = await all(
    `SELECT id, drafted, corrected, note FROM corrections
     WHERE applied = 0 AND corrected IS NOT NULL
     ORDER BY created_at ASC LIMIT ?`,
    [limit],
  )
  if (!pending.length) return { pending: 0, learned: 0, reinforced: 0, factual: 0 }

  const out = { pending: pending.length, learned: 0, reinforced: 0, factual: 0, rules: [] }

  for (const c of pending) {
    let verdict
    try {
      verdict = parseObject((await ask(prompt(c), { system: SYSTEM })).text)
    } catch (e) {
      console.error(`  correction #${c.id}: ${e.message.slice(0, 120)}`)
      continue
    }

    if (!verdict.generalisable || !verdict.rule?.trim()) {
      out.factual++
      if (!dryRun) await run(`UPDATE corrections SET applied = 1 WHERE id = ?`, [c.id])
      continue
    }

    const rule = String(verdict.rule).trim()
    const kind = verdict.kind === 'hard' ? 'hard' : 'soft'

    const existing = await first(
      `SELECT id, confidence, hits FROM writing_style WHERE scope = 'email' AND rule = ?`,
      [rule],
    )

    if (dryRun) {
      out.rules.push({ id: c.id, rule, kind, seen: Boolean(existing) })
      existing ? out.reinforced++ : out.learned++
      continue
    }

    if (existing) {
      // Seen before: this is the second observation, so it earns confidence.
      await run(
        `UPDATE writing_style
         SET confidence = MIN(0.95, confidence + ?), hits = hits + 1, version = version + 1
         WHERE id = ?`,
        [REINFORCE_STEP, existing.id],
      )
      out.reinforced++
    } else {
      await run(
        `INSERT INTO writing_style (kind, scope, rule, rationale, confidence, hits)
         VALUES (?, 'email', ?, ?, ?, 1)
         ON CONFLICT (scope, rule) DO UPDATE SET hits = writing_style.hits + 1`,
        [kind, rule, `Learned from a correction: ${String(verdict.rationale ?? '').trim()}`, DERIVED_CONFIDENCE],
      )
      out.learned++
    }

    out.rules.push({ id: c.id, rule, kind, seen: Boolean(existing) })
    await run(`UPDATE corrections SET applied = 1 WHERE id = ?`, [c.id])
  }

  if (!dryRun && (out.learned || out.reinforced)) {
    await run(
      `INSERT INTO cognition_versions (label, note) VALUES (?, ?)`,
      [`corrections-${new Date().toISOString().slice(0, 10)}`,
       `${out.learned} rule(s) learned, ${out.reinforced} reinforced, ${out.factual} factual-only.`],
    )
  }

  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await applyCorrections({ dryRun: process.argv.includes('--dry-run') })
  console.log({ pending: out.pending, learned: out.learned, reinforced: out.reinforced, factual: out.factual })
  for (const r of out.rules ?? []) console.log(`  [${r.kind}]${r.seen ? ' (reinforced)' : ''} ${r.rule}`)
}
