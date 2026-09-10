/**
 * Ingest Claude Code transcripts as the decision corpus.
 *
 * These are used for how Lottie decides, not how Lottie writes. The prompts
 * are terse, frequently voice-dictated, and full of corrections mid-sentence.
 * They carry priorities, standing rules and the moments where a plan was
 * rejected, all of which are worth modelling. They are a bad model of prose,
 * which is why sent mail is a separate corpus with a separate source_kind.
 *
 * A transcript is mostly not the human. Of 5,611 entries with role "user" in
 * one session file, 136 were actually typed by a person; the rest were tool
 * results, hook output, skill injections and system reminders wearing the same
 * role. Everything below exists to throw those away.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { first, insert } from './db.mjs'

const ROOT = process.env.CLAUDE_PROJECTS ?? join(homedir(), '.claude', 'projects')

// Text that arrives as role:"user" but was injected by the harness, a hook, a
// skill or a tool. Matched against the opening of the message.
const NOT_HUMAN = [
  'Base directory for this skill:', '<system-reminder>', '<command-name>',
  'Caveat: The messages below', '[Request interrupted', 'tool_use_error',
  '<local-command-stdout>', 'This session is being continued from',
  'UserPromptSubmit hook', 'PreToolUse:', 'PostToolUse:', '<task-notification>',
  'Codebase and user instructions are shown below', '<user-prompt-submit-hook>',
  'The user opened the file', 'Result of calling the',
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      // subagents/ holds prompts this system wrote to itself, never the human.
      if (name === 'subagents') continue
      yield* walk(p)
    } else if (name.endsWith('.jsonl')) yield p
  }
}

export function humanMessages(file) {
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'user') continue
    const m = o.message
    if (!m || typeof m !== 'object' || m.role !== 'user') continue

    const parts = typeof m.content === 'string'
      ? [m.content]
      : Array.isArray(m.content)
        // A tool_result block also has role "user"; only a text block can be typed.
        ? m.content.filter((p) => p?.type === 'text').map((p) => p.text ?? '')
        : []

    for (const raw of parts) {
      const text = (raw ?? '').trim()
      if (text.length < 12) continue
      if (NOT_HUMAN.some((n) => text.slice(0, 400).includes(n))) continue
      out.push({ text, ts: o.timestamp, file })
    }
  }
  return out
}

export async function ingestTranscripts({ since = null } = {}) {
  const cutoff = since ? Date.parse(since) : 0
  const stats = { files: 0, messages: 0, inserted: 0, skipped: 0 }

  for (const file of walk(ROOT)) {
    stats.files++
    for (const [i, m] of humanMessages(file).entries()) {
      stats.messages++
      const when = m.ts ? Date.parse(m.ts) : 0
      if (cutoff && when && when < cutoff) { stats.skipped++; continue }

      // File plus index is stable across re-runs: transcripts are append only,
      // so an earlier message keeps its position and will not be duplicated.
      const ref = `${file.split('/').slice(-2).join('/')}#${i}`
      const exists = await first(
        'SELECT id FROM writing_samples WHERE source_kind = ? AND external_ref = ?',
        ['prompt', ref],
      )
      if (exists) { stats.skipped++; continue }

      await insert(
        `INSERT INTO writing_samples
           (source_kind, external_ref, recipient, subject, body, words, occurred_at)
         VALUES ('prompt', ?, NULL, NULL, ?, ?, ?)`,
        [ref, m.text, m.text.split(/\s+/).length, Math.floor((when || Date.now()) / 1000)],
      )
      stats.inserted++
    }
  }
  return stats
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sinceArg = process.argv.find((a) => a.startsWith('--since='))
  console.log(await ingestTranscripts({ since: sinceArg?.split('=')[1] ?? null }))
}
