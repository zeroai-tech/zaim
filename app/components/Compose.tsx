'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Att, ComposeInit, api, fmtSize, q, readB64 } from '@/lib/client-utils'
import { Icon } from './Icon'

function cleanEditorHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const allowed = new Set(['P','BR','DIV','SPAN','STRONG','B','EM','I','U','UL','OL','LI','A','BLOCKQUOTE'])
  doc.body.querySelectorAll('*').forEach(el => {
    if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','IMG','SVG','MATH'].includes(el.tagName)) { el.remove(); return }
    if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return }
    for (const attr of Array.from(el.attributes)) if (!(el.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value))) el.removeAttribute(attr.name)
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer') }
  })
  return doc.body.innerHTML
}
export function Compose({ initial, from, account, onClose, onSent, desktop, offline }: { initial: ComposeInit; from?: string; account: string; onClose: () => void; onSent: () => void; desktop: boolean; offline: boolean }) {
  const [to, setTo] = useState(initial.to), [cc, setCc] = useState(initial.cc || ''), [bcc, setBcc] = useState(initial.bcc || '')
  const [subject, setSubject] = useState(initial.subject), [atts, setAtts] = useState<Att[]>(initial.attachments || [])
  const [body, setBody] = useState(''), [showCopies, setShowCopies] = useState(!!initial.cc || !!initial.bcc)
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [saveStatus, setSaveStatus] = useState('')
  const ed = useRef<HTMLDivElement>(null), fileIn = useRef<HTMLInputElement>(null), draftId = useRef(initial.localDraftId)
  const queue = useRef<Promise<boolean>>(Promise.resolve(true)), mounted = useRef(true), sent = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!ed.current) return
    ed.current.innerHTML = initial.html ? cleanEditorHtml(initial.html) : (initial.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
    setBody(ed.current.innerHTML)
  }, [initial.html, initial.text])
  const payload = useCallback(() => ({ to, cc, bcc, subject, html: ed.current?.innerHTML || body, attachments: atts.map(a => ({ filename: a.name, content: a.content, contentType: a.contentType })) }), [to, cc, bcc, subject, body, atts])
  const latestSave = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  useEffect(() => () => { if (!sent.current) void latestSave.current() }, [])
  const save = useCallback(() => {
    const data = payload()
    if (!desktop || sent.current) return Promise.resolve(true)
    if (mounted.current) setSaveStatus('Saving to device…')
    queue.current = queue.current.catch(() => false).then(async () => {
      if (sent.current) return true
      const result = await api('/api/local/drafts' + q({ account }), { method:'POST', body: JSON.stringify({ ...data, id: draftId.current }) })
      if (result.ok) draftId.current = result.draft.id
      if (mounted.current) { setSaveStatus(result.ok ? 'Saved on this device' : 'Draft could not be saved'); if (!result.ok) setError(result.error || 'Could not save draft.') }
      return !!result.ok
    })
    return queue.current
  }, [desktop, account, payload])
  latestSave.current = save
  useEffect(() => {
    const flush = (event: Event) => { (event as CustomEvent<{ pending: Promise<boolean>[] }>).detail.pending.push(latestSave.current()) }
    window.addEventListener('zaim:flush-drafts', flush)
    return () => window.removeEventListener('zaim:flush-drafts', flush)
  }, [])
  useEffect(() => {
    if (!desktop || sending || (!to && !subject && !body && !atts.length)) return
    const timer = setTimeout(() => { void save() }, 800)
    return () => clearTimeout(timer)
  }, [desktop, sending, to, subject, body, atts, save])
  async function close() { if (!desktop || await save()) onClose() }
  async function addFiles(files: FileList | null) {
    if (!files) return
    const next: Att[] = []
    try {
      if (atts.reduce((n,a) => n+a.size,0) + Array.from(files).reduce((n,f) => n+f.size,0) > 15*1024*1024) throw new Error('Keep total attachments under 15 MB.')
      for (const f of Array.from(files)) next.push({ name:f.name, size:f.size, content:await readB64(f), contentType:f.type || 'application/octet-stream' })
      setAtts(a => [...a,...next])
    } catch (error) { setError((error as Error).message) }
  }
  async function send() {
    if (offline) { setError('Reconnect before sending. Your draft stays on this device.'); return }
    setError(''); setSending(true)
    if (desktop && !(await save())) { setSending(false); return }
    const r = await api('/api/mail/send'+q({account}), { method:'POST', body:JSON.stringify({ ...payload(), saveToSent:true, draft:initial.draft, localDraftId:draftId.current }) })
    setSending(false)
    if (r.ok) { sent.current = true; if (r.draftWarning || r.sentWarning) alert([r.draftWarning,r.sentWarning].filter(Boolean).join(' ')); onSent() }
    else setError((r.error || 'Sending could not be confirmed.') + ' Your draft is retained. Check Sent before retrying if the connection failed during delivery.')
  }
  const exec = (command:string,value?:string) => { document.execCommand(command,false,value); ed.current?.focus(); setBody(ed.current?.innerHTML || '') }
  return <div data-testid="compose-inline" className="flex flex-col h-full" style={{background:'var(--panel)'}}>
    <div className="reader-toolbar"><Icon name="compose" /><strong className="text-sm">{initial.localDraftId ? 'Edit local draft' : 'New message'}</strong><button className="ml-auto" aria-label="Close composer" onClick={close}><Icon name="close" /></button></div>
    <div className="compose-form"><p className="text-xs text-[color:var(--muted)] mb-4">From {from || 'your mailbox'}</p><label>To<input aria-label="To" placeholder="recipient@company.com" value={to} onChange={e=>setTo(e.target.value)} /></label><button className="text-xs text-[color:var(--accent)] mt-3" onClick={()=>setShowCopies(!showCopies)}>{showCopies ? 'Hide' : 'Add'} Cc / Bcc</button>{showCopies && <><label>Cc<input aria-label="Cc" value={cc} onChange={e=>setCc(e.target.value)} /></label><label>Bcc<input aria-label="Bcc" value={bcc} onChange={e=>setBcc(e.target.value)} /></label></>}<label className="mt-4">Subject<input aria-label="Subject" placeholder="What is this about?" value={subject} onChange={e=>setSubject(e.target.value)} /></label>
      <div className="compose-toolbar" aria-label="Formatting"><button onClick={()=>exec('bold')} aria-label="Bold"><b>B</b></button><button onClick={()=>exec('italic')} aria-label="Italic"><i>I</i></button><button onClick={()=>exec('underline')} aria-label="Underline"><u>U</u></button><button onClick={()=>{const url=prompt('Link URL'); if(url && /^(https?:|mailto:)/i.test(url))exec('createLink',url)}} aria-label="Insert link"><Icon name="reply" size={15} /></button><button onClick={()=>fileIn.current?.click()} aria-label="Attach files"><Icon name="attach" size={16} /></button></div>
      <div ref={ed} contentEditable suppressContentEditableWarning data-ph="Write your message…" role="textbox" aria-label="Message body" aria-multiline="true" className="zaim-editor min-h-[240px] text-sm leading-7 outline-none" onInput={()=>setBody(ed.current?.innerHTML || '')} />
      <input ref={fileIn} type="file" multiple className="hidden" onChange={e=>{void addFiles(e.target.files);e.target.value=''}} />
      {atts.length>0 && <div className="flex flex-wrap gap-2 mt-5">{atts.map((a,i)=><div className="mail-attachment" key={i}><Icon name="attach" size={14} /><span>{a.name} · {fmtSize(a.size)}</span><button aria-label={`Remove ${a.name}`} onClick={()=>setAtts(list=>list.filter((_,j)=>j!==i))}><Icon name="close" size={13} /></button></div>)}</div>}
      {error && <p role="alert" className="text-xs text-red-600 mt-5 leading-relaxed">{error}</p>}
    </div><div className="compose-footer"><button className="primary-button" disabled={sending || !to || offline} onClick={send}><Icon name="sent" size={16} />{sending?'Sending…':'Send message'}</button><button className="secondary-button" disabled={sending} onClick={async()=>{if(desktop){await save()}else{setError('');const r=await api('/api/mail/draft'+q({account}),{method:'POST',body:JSON.stringify(payload())});setSaveStatus(r.ok?'Saved to mailbox Drafts':'');if(!r.ok)setError(r.error)}}}>Save draft</button><span role="status" className="text-[10px] text-[color:var(--muted)] ml-auto">{offline?'Offline · ':''}{saveStatus}</span></div>
  </div>
}
