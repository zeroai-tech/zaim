/**
 * The AI interface layer.
 *
 * ── On the requested design ────────────────────────────────────────────────
 * The brief asked for a browser-authenticated claude.ai session driven from
 * Zaim. That is not built here, and should not be: automating the consumer web
 * session to serve an application is outside Anthropic's supported interfaces,
 * and a DOM-scraping bridge breaks on any front-end change.
 *
 * Claude Code in print mode gives every property that was actually wanted. It
 * runs on the subscription rather than metered API credit, it runs locally in
 * a terminal, it needs no API key, and it is a supported entry point. It also
 * returns a session id, so continuity is a documented flag rather than a
 * cookie jar someone has to keep alive.
 *
 * ── Providers ──────────────────────────────────────────────────────────────
 * Two backends behind one call:
 *   claude_code  the local subscription bridge (default)
 *   api          Anthropic / OpenAI / any OpenAI-shaped endpoint
 *
 * Both receive an identical, already-constrained prompt. The provider never
 * sees a bare request: recall.mjs has already turned it into instructions
 * carrying the style rules, the prohibitions and the retrieved precedent. That
 * is what stops a fallback provider from sounding like a different person.
 */

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

/**
 * Find the claude binary without depending on PATH.
 *
 * An app launched from Finder or the Dock inherits a minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) rather than the one from a login shell, so
 * `claude` installed under ~/.local/bin is invisible to the packaged desktop
 * app while working perfectly in a terminal. That produces the worst kind of
 * bug report: works for the developer, fails for everyone else.
 */
let cachedBin = null
export function claudeBinary() {
  if (cachedBin) return cachedBin
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) {
    return (cachedBin = process.env.CLAUDE_BIN)
  }
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(homedir(), '.bun', 'bin', 'claude'),
    join(homedir(), '.npm-global', 'bin', 'claude'),
  ]
  for (const c of candidates) if (existsSync(c)) return (cachedBin = c)
  // Fall back to the name and let PATH resolution try, which is right in a
  // terminal and simply fails with a clear message elsewhere.
  return (cachedBin = 'claude')
}

export const PROVIDERS = ['claude_code', 'anthropic', 'openai_compatible']

export function configuredProvider() {
  return process.env.NNDB_PROVIDER || 'claude_code'
}

/* ───────────────────────────────────────────── local subscription bridge ── */

export async function claudeCodeAvailable() {
  try { await run(claudeBinary(), ['--version'], { timeout: 15_000 }); return true }
  catch { return false }
}

/**
 * One turn through the local CLI.
 *
 * The prompt goes in on stdin, never as an argv element: an outreach email is
 * long, contains quotes and newlines, and would otherwise be mangled or hit
 * the argument length limit.
 *
 * Tools are disabled. This call is asked to produce text from context that has
 * already been assembled, so a model that decides to go and read files is a
 * latency and safety problem, not a feature.
 */
export async function askClaudeCode(prompt, { system = null, resume = null, timeoutMs = 180_000, allowTools = null } = {}) {
  // Drafting runs with no tools: the context is already assembled, so a model
  // that wanders off to read files is latency and risk, not capability.
  // Research is the one job that genuinely needs the web, and it gets exactly
  // that and nothing that can write.
  const args = allowTools?.length
    ? ['-p', '--output-format', 'json', '--allowedTools', allowTools.join(','),
       '--disallowedTools', 'Bash,Edit,Write,NotebookEdit']
    : ['-p', '--output-format', 'json', '--disallowedTools', 'Bash,Edit,Write,Read,WebFetch,WebSearch']
  if (system) args.push('--append-system-prompt', system)
  if (resume) args.push('--resume', resume)

  // spawn, not execFile: execFile has no stdin, and its `input` option is
  // silently ignored, which surfaces as the CLI complaining that no prompt was
  // supplied. The prompt has to be written to the pipe explicitly.
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(claudeBinary(), args, {
      // Run somewhere with no project context, so a CLAUDE.md from whatever
      // directory Zaim happens to run in cannot alter the drafting rules.
      cwd: process.env.TMPDIR || '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let out = '', err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`claude bridge timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude bridge failed to start: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`claude bridge exited ${code}: ${(err || out).slice(0, 300)}`))
      resolve(out)
    })

    child.stdin.on('error', () => { /* closed early; the exit code reports why */ })
    child.stdin.end(prompt)
  })

  let parsed
  try { parsed = JSON.parse(stdout) } catch { return { text: stdout.trim(), sessionId: null } }

  const text = parsed.result ?? parsed.text ?? ''
  if (!text) throw new Error(`claude bridge returned no text (stop_reason: ${parsed.stop_reason})`)
  return {
    text: String(text).trim(),
    sessionId: parsed.session_id ?? null,
    costUsd: parsed.total_cost_usd ?? null,
  }
}

/* ─────────────────────────────────────────────────────── api fallback ── */

async function askAnthropic(prompt, system) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.NNDB_ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 2000,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
  return { text: (data.content?.[0]?.text ?? '').trim(), sessionId: null }
}

/**
 * Anything speaking the OpenAI chat shape: OpenAI, Groq, xAI, a local relay.
 *
 * The path is overridable because "OpenAI-compatible" only ever means the
 * request and response bodies. Zaim's own relay answers on /v1/chat, so
 * appending /chat/completions to a base URL 404s against the very endpoint
 * this fallback is most likely to be pointed at.
 */
async function askOpenAiCompatible(prompt, system) {
  const explicit = process.env.NNDB_OPENAI_URL
  const base = process.env.NNDB_OPENAI_BASE || 'https://api.openai.com/v1'
  const endpoint = explicit || `${base.replace(/\/$/, '')}/chat/completions`
  const key = process.env.NNDB_OPENAI_KEY || process.env.OPENAI_API_KEY
  if (!key) throw new Error('NNDB_OPENAI_KEY is not set')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.NNDB_OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 2000,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`provider ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
  return { text: (data.choices?.[0]?.message?.content ?? '').trim(), sessionId: null }
}

/* ─────────────────────────────────────────────────────────── one door ── */

export async function ask(prompt, { system = null, provider = null, resume = null, allowTools = null, timeoutMs = null } = {}) {
  const p = provider || configuredProvider()
  switch (p) {
    case 'claude_code': {
      // Falling back silently would be worse than failing: the API path bills
      // per token, and a bridge that is merely not running should be fixed,
      // not quietly paid around.
      if (!(await claudeCodeAvailable())) {
        throw new Error(
          'The Claude Code bridge is not available. Install the CLI, or set NNDB_PROVIDER to anthropic or openai_compatible.',
        )
      }
      return askClaudeCode(prompt, { system, resume, allowTools, ...(timeoutMs ? { timeoutMs } : {}) })
    }
    case 'anthropic':
    case 'openai_compatible': {
      // Neither API path can search the web, so a research call routed there
      // would answer from model memory and defeat the point of researching.
      if (allowTools?.length) {
        throw new Error(`Research needs web access, which the "${p}" provider does not have. Use the claude_code bridge for research.`)
      }
      return p === 'anthropic' ? askAnthropic(prompt, system) : askOpenAiCompatible(prompt, system)
    }
    default: throw new Error(`unknown provider "${p}" (expected one of ${PROVIDERS.join(', ')})`)
  }
}
