'use client'
import { useState } from 'react'
import { Full, api } from '@/lib/client-utils'

// Summarize, Draft reply, Translate, Extract Tasks, and Meeting Notes are all
// real, wired to Zaim's AI relay (Oracle VM → Groq) and scoped to the open
// thread's own text. Find Attachments / Generate Invoice / Draft Contract stay
// placeholders — each needs something this codebase doesn't have yet (a
// cross-folder attachment search, a billing data model, or legally-reviewed
// contract handling), not just a missing button.
const PLANNED = ['Find Attachments', 'Generate Invoice', 'Draft Contract']

type Action = 'summarize' | 'reply' | 'translate' | 'tasks' | 'notes'

function plainText(sel: Full) {
  if (sel.text) return sel.text
  return (sel.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function AIPanel({ sel, onDraftReply }: { sel: Full | null; onDraftReply: (html: string) => void }) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [result, setResult] = useState<{ label: string; content: string } | null>(null)
  const [err, setErr] = useState('')
  const [targetLang, setTargetLang] = useState('Spanish')

  async function run(action: Action, path: string, body: Record<string, unknown>, label: string, field: string) {
    if (!sel) return
    setBusy(action); setErr(''); setResult(null)
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) })
    setBusy(null)
    if (r.ok) setResult({ label, content: r[field] }); else setErr(r.error || `Could not ${label.toLowerCase()}`)
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
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">Runs on Zaim's AI relay, scoped to the open message. Nothing below reads or acts on anything else in your mailbox.</p>
      </div>

      {!sel ? (
        <p className="text-xs text-[color:var(--muted)]">Open a message to use these.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button disabled={busy !== null} onClick={() => run('summarize', '/api/ai/summarize', { subject: sel.subject, from: sel.from, text: plainText(sel) }, 'Summary', 'summary')} className="flex-1 accent-grad text-white text-xs font-bold rounded-lg py-2 hover:opacity-90 disabled:opacity-50">{busy === 'summarize' ? '…' : 'Summarize'}</button>
            <button disabled={busy !== null} onClick={draftReply} className="flex-1 text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{busy === 'reply' ? '…' : 'Draft reply'}</button>
          </div>
          <div className="flex gap-2">
            <button disabled={busy !== null} onClick={() => run('tasks', '/api/ai/extract-tasks', { subject: sel.subject, from: sel.from, text: plainText(sel) }, 'Action items', 'tasks')} className="flex-1 text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{busy === 'tasks' ? '…' : 'Extract tasks'}</button>
            <button disabled={busy !== null} onClick={() => run('notes', '/api/ai/meeting-notes', { subject: sel.subject, from: sel.from, text: plainText(sel) }, 'Meeting details', 'notes')} className="flex-1 text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{busy === 'notes' ? '…' : 'Meeting notes'}</button>
          </div>
          <div className="flex gap-2">
            <input value={targetLang} onChange={(e) => setTargetLang(e.target.value)} placeholder="Language" className="w-24 bg-[color:var(--panel-2)] border rounded-lg px-2.5 text-xs outline-none focus:border-[color:var(--accent)]" style={{ borderColor: 'var(--line)' }} />
            <button disabled={busy !== null || !targetLang.trim()} onClick={() => run('translate', '/api/ai/translate', { text: plainText(sel), target: targetLang.trim() }, `Translated (${targetLang.trim()})`, 'translation')} className="flex-1 text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{busy === 'translate' ? '…' : 'Translate'}</button>
          </div>
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          {result && (
            <div className="rounded-lg px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-1.5">{result.label}</div>
              {result.content}
            </div>
          )}
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
