/**
 * Draft an email through the cognitive layer.
 *
 * The loop is: assemble a constrained prompt, generate, check the result
 * against the rules that can be checked, and if it broke one, hand the model
 * its own violation and ask again. Two attempts, then it returns the draft
 * with the problems attached rather than pretending it passed.
 */

import { buildDraftPrompt, validateDraft } from './recall.mjs'
import { ask } from './bridge.mjs'
import { insert } from './db.mjs'

const SYSTEM = `You write as Lottie Mukuka, a Zambian engineer and founder, writing to institutions.
You are given their real rules and their real sent mail. Follow the rules exactly.
Never invent facts, numbers, credentials or partnerships. If a fact is not supplied, leave it out.`

export function splitSubject(text) {
  const m = text.match(/^\s*Subject:\s*(.+?)\s*\n([\s\S]*)$/)
  if (!m) return { subject: null, body: text.trim() }
  return { subject: m[1].trim(), body: m[2].trim() }
}

export async function draftEmail({ brief, recipient = null, subject = null, provider = null, attempts = 2 }) {
  const { prompt, used } = await buildDraftPrompt({ brief, recipient, subject })

  let text = ''
  let check = { ok: false, problems: [] }
  let sessionId = null

  for (let i = 0; i < attempts; i++) {
    const ask_ = i === 0
      ? prompt
      : // Re-asking with the violation quoted works far better than asking
        // again from scratch, which tends to reproduce the same mistake.
        `${prompt}\n\nYour previous draft was rejected for: ${check.problems.join('; ')}.\nRewrite it without those problems. Return the email only.`

    const res = await ask(ask_, { system: SYSTEM, provider })
    text = res.text
    sessionId = res.sessionId ?? sessionId
    check = await validateDraft(text)
    if (check.ok) break
  }

  const { subject: subj, body } = splitSubject(text)

  return {
    subject: subj ?? subject,
    body,
    valid: check.ok,
    problems: check.problems,
    context: used,
    sessionId,
  }
}

/**
 * Record a correction. This is the only thing that moves a rule's weight after
 * ingestion, and it stores both drafts so the rule can be re-derived from the
 * difference rather than guessed at.
 */
export async function recordCorrection({ drafted, corrected, note = null, targetKind = 'writing_style', targetId = null }) {
  return insert(
    `INSERT INTO corrections (target_kind, target_id, drafted, corrected, note)
     VALUES (?, ?, ?, ?, ?)`,
    [targetKind, targetId, drafted, corrected, note],
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : null
  }
  const brief = arg('brief')
  if (!brief) {
    console.error('usage: node src/draft.mjs --brief="..." [--to=addr] [--subject="..."]')
    process.exit(1)
  }
  const out = await draftEmail({ brief, recipient: arg('to'), subject: arg('subject') })
  console.log(`\n=== context used ===`)
  console.log(out.context)
  console.log(`\n=== draft ${out.valid ? '(passed checks)' : `(PROBLEMS: ${out.problems.join('; ')})`} ===\n`)
  console.log(`Subject: ${out.subject}\n`)
  console.log(out.body)
}
