/**
 * The control layer.
 *
 * Nothing reaches a model as a bare request. A drafting brief goes in, and a
 * fully constrained instruction comes out, carrying the hard prohibitions, the
 * structural rules, the facts that may and may not be stated, and real
 * precedent retrieved from what has actually been sent.
 *
 * This is what makes the provider interchangeable. Swap the local bridge for
 * an API and the output still reads the same, because the constraints live
 * here rather than in whatever model happens to answer.
 */

import { all } from './db.mjs'
import { similarWriting } from './embed.mjs'
import { recipientFacts, isStale } from './research.mjs'

/* ────────────────────────────────────────────────────────── retrieval ── */

export async function styleRules() {
  return all(
    `SELECT kind, rule, rationale, example_good FROM writing_style
     WHERE scope IN ('email','any') ORDER BY kind DESC, confidence DESC`,
  )
}

export async function prohibitions() {
  const [claims, rules] = await Promise.all([
    all(`SELECT subject, claim FROM facts WHERE sensitivity = 'never_claim'`),
    all(`SELECT scenario, action FROM behavioral_rules WHERE prohibition = 1`),
  ])
  return [
    ...claims.map((c) => `Never claim: ${c.subject} — ${c.claim}`),
    ...rules.map((r) => `${r.scenario}: ${r.action}`),
  ]
}

export async function statableFacts(limit = 20) {
  return all(
    `SELECT subject, claim FROM facts
     WHERE sensitivity = 'public' ORDER BY confidence DESC LIMIT ?`,
    [limit],
  )
}

/** Has this organisation been written to before, and what happened? */
export async function priorContact(email) {
  if (!email?.includes('@')) return null
  const domain = email.split('@')[1].toLowerCase()
  const [entity] = await all(
    `SELECT id, name, touches, last_seen_at, notes FROM entities
     WHERE kind = 'org' AND name = ?`,
    [domain],
  )
  if (!entity) return null
  const previous = await all(
    `SELECT subject, occurred_at FROM writing_samples
     WHERE source_kind = 'sent_email' AND recipient LIKE ?
     ORDER BY occurred_at DESC LIMIT 5`,
    [`%@${domain}%`],
  )
  return { ...entity, previous }
}

/* ──────────────────────────────────────────────────── prompt assembly ── */

function renderRules(rules) {
  const hard = rules.filter((r) => r.kind === 'hard')
  const soft = rules.filter((r) => r.kind === 'soft')
  const lines = []
  if (hard.length) {
    lines.push('ABSOLUTE RULES. Breaking one of these makes the draft unusable:')
    hard.forEach((r) => lines.push(`  - ${r.rule}`))
    lines.push('')
  }
  if (soft.length) {
    lines.push('HOW THIS PERSON WRITES. These are observed from their own sent mail, not guidelines:')
    soft.forEach((r) => lines.push(`  - ${r.rule}`))
  }
  return lines.join('\n')
}

function renderPrecedent(samples) {
  if (!samples.length) return ''
  return [
    '',
    'PRECEDENT. Real emails this person has already sent to comparable recipients.',
    'Match their moves and their register. Do not copy sentences.',
    '',
    ...samples.map((s, i) =>
      `--- PRECEDENT ${i + 1} (to ${s.recipient || 'unknown'}, similarity ${s.score.toFixed(2)}) ---\n` +
      `Subject: ${s.subject}\n\n${s.body}`,
    ),
  ].join('\n')
}

/**
 * Build the drafting instruction.
 *
 * `brief` is what the user wants said. Everything else is assembled from the
 * database, so the caller cannot accidentally omit the constraints.
 */
export async function buildDraftPrompt({ brief, recipient = null, subject = null, precedentCount = 3 }) {
  if (!brief?.trim()) throw new Error('a brief is required')

  const [rules, banned, facts, prior, precedent, aboutThem, stale] = await Promise.all([
    styleRules(),
    prohibitions(),
    statableFacts(),
    recipient ? priorContact(recipient) : null,
    similarWriting(`${subject ?? ''}\n${brief}`, precedentCount),
    recipient ? recipientFacts(recipient) : [],
    recipient ? isStale(recipient) : false,
  ])

  // Precedent is drawn only from writing worth imitating.
  const clean = precedent.filter((p) => p.source_kind === 'sent_email')

  const parts = [
    'Draft an email as Lottie Mukuka, founder of ZeroAI Technologies.',
    'Write it as they would write it. The reader must not be able to tell it was drafted by a machine.',
    '',
    renderRules(rules),
  ]

  if (banned.length) {
    parts.push('', 'NEVER STATE. These claims have had to be retracted before:', ...banned.map((b) => `  - ${b}`))
  }

  if (facts.length) {
    parts.push('', 'FACTS YOU MAY USE. Do not invent others, and do not inflate these:',
      ...facts.map((f) => `  - ${f.subject}: ${f.claim}`))
  }

  // Recipient specifics are the one thing the model will otherwise supply from
  // its own memory: a first pass named three Rwandan policies, all plausible,
  // none of them from here. Either they come from research with a source, or
  // the draft is told it does not know them.
  if (aboutThem.length) {
    parts.push('', 'ABOUT THE RECIPIENT. Researched, each with a source. These are the ONLY',
      'recipient-specific facts you may state. Do not add policies, programme names,',
      'dates, office names or job titles from your own knowledge, even if you are confident.',
      ...aboutThem.map((f) => `  - ${f.claim}\n    [${f.source_url}]`))
  } else if (recipient) {
    parts.push('', 'ABOUT THE RECIPIENT: nothing has been researched.',
      'State no policy names, programme names, dates, office names or job titles for them.',
      'Write the approach so it does not depend on knowing their specifics.')
  }

  if (prior?.touches) {
    parts.push('', `PRIOR CONTACT. ${prior.name} has been written to ${prior.touches} time(s) already.`,
      ...(prior.previous ?? []).map((p) => `  - "${p.subject}" on ${new Date(p.occurred_at * 1000).toISOString().slice(0, 10)}`),
      'Acknowledge the earlier approach rather than writing as a first contact.')
  }

  parts.push(renderPrecedent(clean))

  parts.push('', 'THE BRIEF', brief.trim())
  if (recipient) parts.push('', `Recipient: ${recipient}`)
  if (subject) parts.push(`Intended subject: ${subject}`)

  parts.push(
    '',
    'Return the email only. No preamble, no explanation, no markdown formatting of any kind.',
    'First line must be "Subject: ..." and the body follows after a blank line.',
  )

  return {
    prompt: parts.filter((p) => p !== undefined).join('\n'),
    used: {
      hardRules: rules.filter((r) => r.kind === 'hard').length,
      softRules: rules.filter((r) => r.kind === 'soft').length,
      prohibitions: banned.length,
      facts: facts.length,
      precedent: clean.length,
      priorContact: Boolean(prior?.touches),
      recipientFacts: aboutThem.length,
      recipientResearchStale: stale,
    },
  }
}

/* ───────────────────────────────────────────────────────── enforcement ── */

/**
 * Check a draft against the rules that can be checked mechanically.
 *
 * A model told not to do something still sometimes does it, and the whole
 * premise here is that output is constrained rather than hoped for. Only the
 * hard rules are testable; the structural ones are not, and pretending to
 * verify them would be theatre.
 */
export async function validateDraft(text) {
  const rules = await styleRules()
  const banned = await prohibitions()
  const problems = []

  for (const r of rules.filter((x) => x.kind === 'hard')) {
    if (/em dash/i.test(r.rule) && text.includes('—')) problems.push('contains an em dash')
    if (/exclamation/i.test(r.rule) && text.includes('!')) problems.push('contains an exclamation mark')
    if (/emoji/i.test(r.rule) && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) problems.push('contains an emoji')
  }

  // Markdown leaking into an email body is the signature of the drafting era
  // this system exists to replace.
  if (/\*\w|\*\*|^#{1,6}\s/m.test(text)) problems.push('contains markdown formatting')

  for (const b of banned) {
    const claim = b.replace(/^Never claim:\s*/, '').split('—')[0].trim()
    if (claim.length > 6 && text.toLowerCase().includes(claim.toLowerCase())) {
      problems.push(`states a forbidden claim: ${claim}`)
    }
  }

  return { ok: problems.length === 0, problems }
}
