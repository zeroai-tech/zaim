'use client'
import { useState } from 'react'
import { Full, api, fmtSize } from '@/lib/client-utils'

// Generate Invoice stays a placeholder — it needs a billing/line-items data
// model this codebase doesn't have. Everything else is real: five actions
// scoped to the open thread's own text, plus a mailbox-wide attachment search
// (metadata only, via IMAP bodyStructure — no data source missing there).
const PLANNED = ['Generate Invoice']

type Action = 'summarize' | 'reply' | 'translate' | 'tasks' | 'notes' | 'contract'
type AttHit = { mailbox: string; uid: number; subject: string; from: string; fromName: string; date: string; attachments: { filename: string; contentType: string; size: number }[] }

function plainText(sel: Full) {
  if (sel.text) return sel.text
  return (sel.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function AIPanel({ sel, onDraftReply, onOpenSearchResult }: { sel: Full | null; onDraftReply: (html: string) => void; onOpenSearchResult: (mailbox: string, uid: number) => void }) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [result, setResult] = useState<{ label: string; content: string; warn?: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [targetLang, setTargetLang] = useState('Spanish')

  const [attQuery, setAttQuery] = useState('')
  const [attHits, setAttHits] = useState<AttHit[] | null>(null)
  const [attBusy, setAttBusy] = useState(false)
  const [attErr, setAttErr] = useState('')

  async function run(action: Action, path: string, body: Record<string, unknown>, label: string, field: string, warn?: boolean) {
    if (!sel) return
    setBusy(action); setErr(''); setResult(null)
    const r = await api(path, { method: 'POST', body: JSON.stringify(body) })
    setBusy(null)
    if (r.ok) setResult({ label, content: r[field], warn }); else setErr(r.error || `Could not ${label.toLowerCase()}`)
  }

  async function draftReply() {
    if (!sel) return
    setBusy('reply'); setErr('')
    const r = await api('/api/ai/reply', { method: 'POST', body: JSON.stringify({ subject: sel.subject, from: sel.from, text: plainText(sel) }) })
    setBusy(null)
    if (r.ok) onDraftReply(r.draft.replace(/\n/g, '<br>')); else setErr(r.error || 'Could not draft a reply')
  }

  async function searchAttachments() {
    setAttBusy(true); setAttErr(''); setAttHits(null)
    const r = await api('/api/mail/attachments/search' + (attQuery.trim() ? `?q=${encodeURIComponent(attQuery.trim())}` : ''))
    setAttBusy(false)
    if (r.ok) setAttHits(r.hits); else setAttErr(r.error || 'Search failed')
  }

  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-5">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-1">AI Assistant</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">Runs on Zaim's AI relay. The per-message actions below only see the message you have open — nothing else in your mailbox.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)]">Find attachments</div>
        <div className="flex gap-2">
          <input value={attQuery} onChange={(e) => setAttQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchAttachments()} placeholder="Filename, e.g. invoice.pdf" className="flex-1 bg-[color:var(--panel-2)] border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]" style={{ borderColor: 'var(--line)' }} />
          <button disabled={attBusy} onClick={searchAttachments} className="text-xs font-bold rounded-lg px-3 hover:bg-white/5 disabled:opacity-50" style={{ border: '1px solid var(--line)' }}>{attBusy ? '…' : 'Search'}</button>
        </div>
        {attErr && <p className="text-[11px] text-red-400">{attErr}</p>}
        {attHits && (
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {attHits.length === 0 && <p className="text-[11px] text-[color:var(--muted)]">No attachments found across your folders.</p>}
            {attHits.map((h) => (
              <button key={`${h.mailbox}:${h.uid}`} onClick={() => onOpenSearchResult(h.mailbox, h.uid)} className="text-left rounded-lg px-2.5 py-2 hover:bg-white/5" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                <div className="text-xs font-semibold truncate">{h.subject}</div>
                <div className="text-[10px] text-[color:var(--muted)] truncate">{h.fromName} · {new Date(h.date).toLocaleDateString()}</div>
                <div className="text-[10px] mt-1 flex flex-wrap gap-1.5">
                  {h.attachments.map((a, i) => <span key={i} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--line)' }}>📎 {a.filename} ({fmtSize(a.size)})</span>)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pt-1" style={{ borderTop: '1px solid var(--line)' }} />

      {!sel ? (
        <p className="text-xs text-[color:var(--muted)]">Open a message to summarize it, draft a reply, or the rest below.</p>
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
          <button
            disabled={busy !== null}
            onClick={() => run('contract', '/api/ai/draft-contract', { subject: sel.subject, from: sel.from, text: plainText(sel) }, 'Contract draft', 'draft', true)}
            className="text-xs font-bold rounded-lg py-2 hover:bg-white/5 disabled:opacity-50"
            style={{ border: '1px solid #f6bd60', color: '#f6bd60' }}
          >
            {busy === 'contract' ? '…' : '⚠ Draft contract (not legal advice)'}
          </button>

          {err && <p className="text-[11px] text-red-400">{err}</p>}
          {result && !result.warn && (
            <div className="rounded-lg px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-1.5">{result.label}</div>
              {result.content}
            </div>
          )}
          {result && result.warn && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #f6bd60' }}>
              <div className="px-3 py-2 text-[11px] font-bold" style={{ background: 'rgba(246,189,96,0.15)', color: '#f6bd60' }}>⚠ Not legal advice — have a qualified lawyer review before use or sending.</div>
              <div className="px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--panel-2)' }}>{result.content}</div>
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
