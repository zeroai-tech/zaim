/**
 * Ingest sent mail as the writing-style corpus.
 *
 * This is the corpus that matters for email generation, and it is NOT the
 * Claude Code transcripts. Prompts typed at an agent are terse, often
 * voice-dictated, and imperative; sent mail to a ministry is formal, structured
 * and careful. Learning email style from prompts would produce something that
 * reads nothing like Lottie writing to a school.
 *
 * Authentication is the OAuth token Stalwart issued to `zaim login`, read from
 * ~/.zaim/credentials.json. No password is guessed against the server: a wrong
 * one bans the IP across every port on that box, SSH included.
 */

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { first, insert, run } from './db.mjs'

const CRED = join(homedir(), '.zaim', 'credentials.json')

function credentials() {
  const c = JSON.parse(readFileSync(CRED, 'utf8'))
  const expires = Number(c.expires_at)
  // expires_at is milliseconds. A stale token fails as a plain auth error,
  // which looks identical to a wrong password, so check before connecting.
  if (Number.isFinite(expires) && expires < Date.now()) {
    throw new Error(`Zaim token expired ${new Date(expires).toISOString()}. Run: zaim login`)
  }
  return c
}

/**
 * Reduce a sent message to Lottie's own prose.
 *
 * The naive version produced samples of 2.4MB carrying 139 words. Some sent
 * mail has an inline attachment that the parser folds into the text body as an
 * unbroken base64 run, which is invisible to a word count and swamps anything
 * downstream: fourteen "samples" came to 2.4 million characters.
 */
export function cleanBody(text) {
  if (!text) return ''
  let t = text.replace(/\r\n/g, '\n')

  // Quoted history: everything from the first "On <date> ... wrote:" onward.
  t = t.replace(/\nOn .{5,80}wrote:[\s\S]*$/m, '')
  t = t.split('\n').filter((l) => !l.startsWith('>')).join('\n')

  // Inline attachments and tracking blobs: a long line with no spaces is never
  // prose. Dropped by line so surrounding text survives.
  t = t.split('\n').filter((l) => !(l.length > 120 && !/\s/.test(l))).join('\n')

  // The signature block is stable and would otherwise dominate every sample.
  t = t.replace(/\n(Respectfully yours|Kind regards|Best regards|Warm regards|Regards|Sincerely)[\s,]*\n[\s\S]*$/i, '')

  // Collapse the whitespace that HTML-to-text conversion leaves behind.
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

/**
 * Is this Lottie writing, or a bulk template from an earlier era?
 *
 * The old campaign sends open by claiming "IBM Partner Plus Member" and
 * "STEM.org Certified", both of which are claims the company has since ruled
 * out making. Learning style from them would teach the system to reintroduce
 * exactly the wording that had to be retracted.
 */
const FORBIDDEN_ERA = [
  /IBM Partner Plus/i,
  /STEM\.org Certified/i,
]

export function isUsableSample(body) {
  if (!body) return false
  const words = body.split(/\s+/).length
  if (words < 40) return false            // an acknowledgement, not evidence
  if (body.length > 20000) return false   // still pathological after cleaning
  // A ratio this bad means what survived is not sentences.
  if (body.length / words > 40) return false
  return !FORBIDDEN_ERA.some((re) => re.test(body))
}

/**
 * Fetch and store only. Embedding happens in a separate pass (embed-pending)
 * because generating a vector per message inside the fetch loop kept the IMAP
 * connection open long enough to time out, and losing the connection lost the
 * whole run rather than one message.
 */
export async function ingestSentMail({ limit = 400, mailbox = 'Sent Items' } = {}) {
  const c = credentials()
  const client = new ImapFlow({
    host: c.host,
    port: 993,
    secure: true,
    auth: { user: c.email, accessToken: c.access_token },
    logger: false,
  })

  await client.connect()
  const stats = { seen: 0, inserted: 0, skipped: 0 }

  try {
    const lock = await client.getMailboxLock(mailbox)
    try {
      const total = client.mailbox.exists
      if (!total) return stats
      const from = Math.max(1, total - limit + 1)

      for await (const msg of client.fetch(`${from}:*`, { uid: true, source: true })) {
        stats.seen++
        const parsed = await simpleParser(msg.source)
        const body = cleanBody(parsed.text ?? '')
        if (!isUsableSample(body)) { stats.skipped++; continue }

        const ref = String(msg.uid)
        const exists = await first(
          'SELECT id FROM writing_samples WHERE source_kind = ? AND external_ref = ?',
          ['sent_email', ref],
        )
        if (exists) { stats.skipped++; continue }

        const to = (parsed.to?.value ?? []).map((a) => a.address).join(', ')
        const id = await insert(
          `INSERT INTO writing_samples
             (source_kind, external_ref, recipient, subject, body, words, occurred_at)
           VALUES ('sent_email', ?, ?, ?, ?, ?, ?)`,
          [ref, to, parsed.subject ?? '', body, body.split(/\s+/).length,
           Math.floor((parsed.date?.getTime() ?? Date.now()) / 1000)],
        )
        stats.inserted++

        // The recipient is a real counterparty worth remembering, and the
        // graph later walks from a new address to what was said to similar ones.
        if (to) await touchEntity(to, parsed.date)

      }
    } finally { lock.release() }
  } finally { await client.logout() }

  return stats
}

/**
 * One entity per organisation, keyed on the domain.
 *
 * Looking up by address while the unique key was (kind, name) meant a second
 * contact at an organisation already seen collided instead of counting as
 * another touch. For outreach the organisation is the thing being tracked, so
 * the domain is the identity and the address is only the contact last used.
 */
async function touchEntity(email, when) {
  const addr = email.split(',')[0].trim().toLowerCase()
  if (!addr.includes('@')) return null
  const domain = addr.split('@')[1]
  const ts = Math.floor((when?.getTime() ?? Date.now()) / 1000)

  await run(
    `INSERT INTO entities (kind, name, email, notes, first_seen_at, last_seen_at, touches)
     VALUES ('org', ?, ?, 'seen as a mail recipient', ?, ?, 1)
     ON CONFLICT (kind, name) DO UPDATE SET
       touches      = touches + 1,
       last_seen_at = MAX(COALESCE(last_seen_at, 0), excluded.last_seen_at),
       email        = COALESCE(entities.email, excluded.email)`,
    [domain, addr, ts, ts],
  )
  const row = await first('SELECT id FROM entities WHERE kind = ? AND name = ?', ['org', domain])
  return row?.id ?? null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await ingestSentMail())
}
