'use client'
import { useEffect, useRef, useState } from 'react'
import { Att, ComposeInit, api, fmtSize, q, readB64 } from '@/lib/client-utils'

// Renders inline in the Reading Canvas (no modal) — per the design brief,
// "the reading canvas transforms" into the composer rather than a popup
// appearing on top of it.
export function Compose({ initial, from, account, onClose, onSent }: { initial: ComposeInit; from?: string; account: string; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(initial.to); const [cc, setCc] = useState(initial.cc || ''); const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(initial.subject)
  const [showCc, setShowCc] = useState(!!initial.cc); const [showBcc, setShowBcc] = useState(false)
  const [atts, setAtts] = useState<Att[]>(initial.attachments || [])
  const [sending, setSending] = useState(false); const [error, setError] = useState('')
  const ed = useRef<HTMLDivElement>(null); const fileIn = useRef<HTMLInputElement>(null)

  // A draft saved with only a plain-text body (no html part) has no `initial.html`
  // at all — fall back to the text so its content isn't silently dropped.
  useEffect(() => {
    if (!ed.current) return
    if (initial.html) ed.current.innerHTML = initial.html
    else if (initial.text) ed.current.innerHTML = initial.text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  }, [initial.html, initial.text])
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); ed.current?.focus() }
  async function addFiles(files: FileList | null) {
    if (!files) return
    const next: Att[] = []
    for (const f of Array.from(files)) next.push({ name: f.name, size: f.size, content: await readB64(f), contentType: f.type || 'application/octet-stream' })
    setAtts((a) => [...a, ...next])
  }
  async function send() {
    setError(''); setSending(true)
    const html = ed.current?.innerHTML || ''
    const r = await api('/api/mail/send' + q({ account }), { method: 'POST', body: JSON.stringify({
      to, cc: cc || undefined, bcc: bcc || undefined, subject, html,
      attachments: atts.map((a) => ({ filename: a.name, content: a.content, contentType: a.contentType })),
      saveToSent: true, draft: initial.draft,
    }) })
    setSending(false)
    if (r.ok) { if (r.draftWarning || r.sentWarning) alert([r.draftWarning, r.sentWarning].filter(Boolean).join(' ')); onSent() }
    else setError(r.error || 'Send failed')
  }
  const line = 'bg-transparent border-b pb-2 text-sm outline-none focus:border-[color:var(--accent)] w-full'
  const tbtn = 'w-8 h-8 rounded-lg grid place-items-center text-[color:var(--muted)] hover:text-white hover:bg-white/5 text-sm'

  return (
    <div data-testid="compose-inline" className="flex flex-col h-full fade-in">
      <div className="flex items-center justify-between px-8 h-14 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        <span className="font-bold text-sm">New message{from ? ` · from ${from}` : ''}</span>
        <button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
      </div>
      <div className="p-8 flex flex-col gap-3 overflow-y-auto flex-1 max-w-[900px]">
        <div className="flex items-center gap-2" style={{ borderBottom: '1px solid var(--line)' }}>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className={line} style={{ border: 'none' }} />
          <div className="flex gap-2 text-[11px] shrink-0">
            {!showCc && <button onClick={() => setShowCc(true)} className="text-[color:var(--muted)] hover:text-white">Cc</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)} className="text-[color:var(--muted)] hover:text-white">Bcc</button>}
          </div>
        </div>
        {showCc && <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc" className={line} style={{ borderColor: 'var(--line)' }} autoFocus />}
        {showBcc && <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Bcc" className={line} style={{ borderColor: 'var(--line)' }} autoFocus />}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={line} style={{ borderColor: 'var(--line)' }} />

        <div className="flex items-center gap-0.5 -mb-1">
          <button onClick={() => exec('bold')} className={tbtn + ' font-bold'} title="Bold">B</button>
          <button onClick={() => exec('italic')} className={tbtn + ' italic'} title="Italic">I</button>
          <button onClick={() => exec('underline')} className={tbtn + ' underline'} title="Underline">U</button>
          <span className="w-px h-4 mx-1" style={{ background: 'var(--line)' }} />
          <button onClick={() => exec('insertUnorderedList')} className={tbtn} title="Bulleted list">•</button>
          <button onClick={() => exec('insertOrderedList')} className={tbtn} title="Numbered list">1.</button>
          <button onClick={() => { const u = prompt('Link URL:'); if (u) exec('createLink', u) }} className={tbtn} title="Insert link">🔗</button>
          <span className="w-px h-4 mx-1" style={{ background: 'var(--line)' }} />
          <button onClick={() => fileIn.current?.click()} className={tbtn} title="Attach files">📎</button>
        </div>

        <div ref={ed} contentEditable suppressContentEditableWarning data-ph="Write your message…"
          className="zaim-editor flex-1 min-h-[220px] overflow-y-auto text-sm outline-none leading-relaxed rounded-xl px-3 py-3"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }} />

        <input ref={fileIn} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        {atts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {atts.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg pl-2.5 pr-2 py-1.5 text-xs" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                <span>📎</span><span className="max-w-[180px] truncate font-medium">{a.name}</span>
                <span className="text-[color:var(--muted)]">{fmtSize(a.size)}</span>
                <button onClick={() => setAtts((x) => x.filter((_, j) => j !== i))} className="text-[color:var(--muted)] hover:text-red-400 ml-0.5">✕</button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      <div className="flex items-center gap-3 px-8 py-4 shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
        <button disabled={sending || !to} onClick={send} className="accent-grad text-white font-bold rounded-xl px-6 py-2.5 text-sm disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
        <button onClick={() => fileIn.current?.click()} className="text-xs text-[color:var(--muted)] hover:text-white">📎 Attach</button>
        <span className="text-xs text-[color:var(--muted)] ml-auto">Encrypted transport{atts.length ? ` · ${atts.length} file${atts.length > 1 ? 's' : ''}` : ''}</span>
      </div>
    </div>
  )
}
