'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/client-utils'

// Drafting in your own voice, as opposed to AIPanel's per-message actions.
//
// The difference is what the model is given. AIPanel sends the open message to
// a relay. This sends nothing until the cognitive layer has assembled the
// rules derived from your sent mail, the claims you have ruled out making, and
// real precedent retrieved by meaning. That layer runs as a local process, so
// this whole panel is only useful in the desktop app.

type Status = {
  running: boolean
  reason?: string
  trained?: boolean
  rules?: number
  sentEmails?: number
  embeddings?: number
  storage?: string
  provider?: string
  embeddings_ready?: boolean
  learning?: string | null
}

type Draft = {
  subject: string | null
  body: string
  valid: boolean
  problems: string[]
  source: 'nndb' | 'relay'
  degraded?: boolean
  note?: string
  context?: {
    hardRules: number; softRules: number; prohibitions: number
    facts: number; precedent: number; recipientFacts: number
    recipientResearchStale: boolean
  }
}

type Fact = { claim: string; source_url: string }

const label = 'text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)]'
const field = 'w-full bg-[color:var(--panel-2)] border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]'
const ghost = 'text-xs font-bold rounded-lg py-2 px-3 hover:bg-white/5 disabled:opacity-50'

export function VoicePanel({ onDraft }: { onDraft: (subject: string, bodyHtml: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [to, setTo] = useState('')
  const [brief, setBrief] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [facts, setFacts] = useState<Fact[] | null>(null)
  const [busy, setBusy] = useState<'draft' | 'research' | 'learn' | null>(null)
  const [learnStep, setLearnStep] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    refresh()
    return () => { if (poll.current) clearInterval(poll.current) }
  }, [])

  async function refresh() {
    const r = await api('/api/nndb/status')
    setStatus(r)
    // A learn cycle already in flight (started before this panel opened, or by
    // another window) must still show progress here.
    if (r?.learning) startPolling()
  }

  function startPolling() {
    if (poll.current) return
    setBusy('learn')
    poll.current = setInterval(async () => {
      const s = await api('/api/nndb/learn')
      setLearnStep(s?.step ?? null)
      if (s && !s.running) {
        clearInterval(poll.current!); poll.current = null
        setBusy(null); setLearnStep(null)
        if (s.error) setErr(s.error)
        refresh()
      }
    }, 3000)
  }

  async function learn() {
    setErr(''); setBusy('learn')
    const r = await api('/api/nndb/learn', { method: 'POST' })
    if (r?.error) { setErr(r.error); setBusy(null); return }
    startPolling()
  }

  async function research() {
    if (!to.trim()) return
    setBusy('research'); setErr(''); setFacts(null)
    const r = await api('/api/nndb/research', { method: 'POST', body: JSON.stringify({ recipient: to.trim(), hint: brief.trim() || undefined }) })
    setBusy(null)
    if (r?.error) setErr(r.error); else setFacts(r.facts ?? [])
  }

  async function makeDraft() {
    if (!brief.trim()) return
    setBusy('draft'); setErr(''); setDraft(null)
    const r = await api('/api/nndb/draft', { method: 'POST', body: JSON.stringify({ brief: brief.trim(), to: to.trim() || undefined }) })
    setBusy(null)
    if (r?.error) setErr(r.error); else setDraft(r)
  }

  /* ── the layer is not there at all ─────────────────────────────── */
  if (status && !status.running) {
    return (
      <div className="h-full overflow-y-auto p-5 flex flex-col gap-3">
        <div className={label}>Your voice</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">{status.reason}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-5">
      <div>
        <div className={`${label} mb-1`}>Your voice</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">
          Drafts from the rules in your own sent mail, on your Claude subscription. Everything
          stays on this device.
        </p>
      </div>

      {/* ── untrained: the one thing worth doing first ─────────────── */}
      {status && status.running && !status.trained && (
        <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <div className="text-xs font-semibold">Nothing learned yet</div>
          <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">
            Read your sent mail once to work out how you write. It stays on this machine.
          </p>
          {status.embeddings_ready === false && (
            <p className="text-[11px] text-amber-400 leading-relaxed">
              Ollama is not running. Start it and run <code>ollama pull all-minilm</code> first.
            </p>
          )}
          <button
            disabled={busy !== null || status.embeddings_ready === false}
            onClick={learn}
            className="accent-grad text-white text-xs font-bold rounded-lg py-2 hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'learn' ? (learnStep ?? 'Working…') : 'Learn how I write'}
          </button>
        </div>
      )}

      {status?.trained && (
        <div className="text-[10px] text-[color:var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
          <span><b className="text-[color:var(--fg)]">{status.rules}</b> rules</span>
          <span><b className="text-[color:var(--fg)]">{status.sentEmails}</b> emails read</span>
          <span>{status.storage === 'sqlite' ? 'on this device' : 'synced'}</span>
          {busy === 'learn' && <span className="text-[color:var(--accent)]">{learnStep ?? 'refreshing…'}</span>}
        </div>
      )}

      <div className="pt-1" style={{ borderTop: '1px solid var(--line)' }} />

      {/* ── compose ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className={label}>Write to</div>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@ministry.gov" className={field} />

        <div className={`${label} mt-1`}>What do you want to say</div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder="Ask whether a ten school pilot is feasible, and which desk should see it."
          className={field}
        />

        <div className="flex gap-2 mt-1">
          <button
            disabled={busy !== null || !brief.trim()}
            onClick={makeDraft}
            className="flex-1 accent-grad text-white text-xs font-bold rounded-lg py-2 hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'draft' ? 'Writing…' : 'Draft it'}
          </button>
          <button
            disabled={busy !== null || !to.trim()}
            onClick={research}
            className={ghost}
            style={{ border: '1px solid var(--line)' }}
            title="Find sourced facts about this recipient before writing to them"
          >
            {busy === 'research' ? 'Reading…' : 'Research them'}
          </button>
        </div>
      </div>

      {err && <p className="text-[11px] text-red-400 leading-relaxed">{err}</p>}

      {/* ── researched facts, each with where it came from ─────────── */}
      {facts && (
        <div className="flex flex-col gap-2">
          <div className={label}>What I found about them</div>
          {facts.length === 0 && <p className="text-[11px] text-[color:var(--muted)]">Nothing verifiable found. The draft will avoid naming their policies.</p>}
          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {facts.map((f, i) => (
              <div key={i} className="rounded-lg px-2.5 py-2 text-[11px] leading-relaxed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                {f.claim}
                <a href={f.source_url} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] truncate" style={{ color: 'var(--accent)' }}>
                  {f.source_url}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── the draft, and what went into it ──────────────────────── */}
      {draft && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className={label}>Draft</div>
            {draft.source === 'relay' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase tracking-wide">not your voice</span>
            )}
            {draft.source === 'nndb' && !draft.valid && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold uppercase tracking-wide">broke a rule</span>
            )}
          </div>

          {draft.degraded && <p className="text-[11px] text-amber-400 leading-relaxed">{draft.note}</p>}
          {draft.problems?.length > 0 && (
            <p className="text-[11px] text-red-400 leading-relaxed">{draft.problems.join('; ')}</p>
          )}

          {draft.subject && <div className="text-xs font-semibold">{draft.subject}</div>}
          <div className="text-[11px] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto rounded-lg px-2.5 py-2" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
            {draft.body}
          </div>

          {draft.context && (
            <p className="text-[10px] text-[color:var(--muted)] leading-relaxed">
              Used {draft.context.hardRules + draft.context.softRules} of your rules,{' '}
              {draft.context.precedent} past {draft.context.precedent === 1 ? 'email' : 'emails'},{' '}
              {draft.context.recipientFacts} researched {draft.context.recipientFacts === 1 ? 'fact' : 'facts'} about them.
              {draft.context.recipientFacts === 0 && to.trim() ? ' Research them first for anything specific to their organisation.' : ''}
            </p>
          )}

          <button
            onClick={() => onDraft(draft.subject ?? '', draft.body.replace(/\n/g, '<br>'))}
            className="accent-grad text-white text-xs font-bold rounded-lg py-2 hover:opacity-90"
          >
            Open in composer
          </button>
        </div>
      )}
    </div>
  )
}
