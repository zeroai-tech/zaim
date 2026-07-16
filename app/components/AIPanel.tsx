'use client'
import { useState } from 'react'
import { Full, api } from '@/lib/client-utils'

// Summarize + Draft reply are real, wired to Zaim's AI relay (Oracle VM → Groq).
// The rest stay honest placeholders — each needs its own data source (a tasks
// store, a documents index, invoice/contract records) that doesn't exist yet.
const PLANNED = ['Translate', 'Extract Tasks', 'Find Attachments', 'Meeting Notes', 'Generate Invoice', 'Draft Contract']

function plainText(sel: Full) {
  if (sel.text) return sel.text
  return (sel.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function AIPanel({ sel, onDraftReply }: { sel: Full | null; onDraftReply: (html: string) => void }) {
  const [busy, setBusy] = useState<'summarize' | 'reply' | null>(null)
  const [summary, setSummary] = useState('')
  const [err, setErr] = useState('')

  async function summarize() {
    if (!sel) return
    setBusy('summarize'); setErr(''); setSummary('')
    const r = await api('/api/ai/summarize', { method: 'POST', body: JSON.stringify({ subject: sel.subject, from: sel.from, text: plainText(sel) }) })
    setBusy(null)
    if (r.ok) setSummary(r.summary); else setErr(r.error || 'Could not summarize')
  }
  async function draftReply() {
    if (!sel) return
    setBusy('reply'); setErr('')
    const r = await api('/api/ai/reply', { method: 'POST', body: JSON.stringify({ subject: sel.subject, from: sel.from, text: plainText(sel) }) })
    setBusy(null)
    if (r.ok) onDraftReply(r.draft.replace(/\n/g, '<br>')); else setErr(r.error || 'Could not draft a reply')
  }

  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-1">AI Assistant</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">Summarize and Draft reply run on Zaim's AI relay. The rest below are the plan, not working buttons yet.</p>
      </div>

      {!sel ? (
        <p className="text-xs text-[color:var(--muted)]">Open a message to summarize it or draft a reply.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button disabled={busy !== null} onClick={summarize} className="flex-1 accent-grad text-white text-xs font-bold rounded-lg py-2 hover:opacity-90 disabled:opacity-50">{busy === 'summarize' ? '…' : 'Summarize'}</button>
            <button disabled={busy !== null} onClick={draftReply} className="flex-1 text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{busy === 'reply' ? '…' : 'Draft reply'}</button>
          </div>
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          {summary && <div className="rounded-lg px-3 py-2.5 text-xs leading-relaxed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>{summary}</div>}
        </div>
      )}

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-2">Coming later</div>
        <div className="flex flex-col gap-1.5">
          {PLANNED.map((label) => (
            <div key={label} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[color:var(--muted)] cursor-not-allowed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }} title="Not built yet">
              <span className="opacity-50">✦</span>{label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
