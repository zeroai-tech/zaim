'use client'
import { useEffect, useState, useCallback } from 'react'

type Msg = { uid: number; subject: string; from: string; fromName: string; to: string; date: string; seen: boolean; flagged: boolean }
type Full = Msg & { html: string | null; text: string | null }
type Account = { id: string; label: string; email: string; isDefault: boolean }

const api = (path: string, init?: RequestInit) =>
  fetch(path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }).then((r) => r.json())

function initials(name: string) {
  const p = (name || '?').replace(/[<>"]/g, '').trim().split(/[\s@.]+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
function when(d: string) {
  const t = new Date(d), now = new Date()
  return t.toDateString() === now.toDateString() ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : t.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
const AV = ['#5b8cff', '#ff7a9c', '#4dd4ac', '#f6bd60', '#b892ff', '#5ec4e6']
const avatarColor = (s: string) => AV[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]

export default function Zaim() {
  const [phase, setPhase] = useState<'loading' | 'auth' | 'add-account' | 'app'>('loading')
  const [email, setEmail] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [sel, setSel] = useState<Full | null>(null)
  const [selUid, setSelUid] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [compose, setCompose] = useState<null | { to: string; subject: string; body: string; sending?: boolean; error?: string }>(null)

  const refreshMe = useCallback(async () => {
    const me = await api('/api/auth/me')
    if (!me.user) { setPhase('auth'); return }
    setEmail(me.user.email); setAccounts(me.accounts || [])
    setPhase((me.accounts || []).length ? 'app' : 'add-account')
  }, [])
  useEffect(() => { refreshMe() }, [refreshMe])

  const load = useCallback(() => {
    setListLoading(true)
    api('/api/mail/list?limit=40').then((r) => setMessages(r.messages || [])).finally(() => setListLoading(false))
  }, [])
  useEffect(() => { if (phase === 'app') load() }, [phase, load])

  async function open(uid: number) {
    setSelUid(uid); setSel(null)
    const r = await api(`/api/mail/message/${uid}`)
    if (r.ok) { setSel(r.message); setMessages((m) => m.map((x) => (x.uid === uid ? { ...x, seen: true } : x))) }
  }
  async function send() {
    if (!compose) return
    setCompose({ ...compose, sending: true, error: undefined })
    const r = await api('/api/mail/send', { method: 'POST', body: JSON.stringify({ to: compose.to, subject: compose.subject, html: `<p>${compose.body.replace(/\n/g, '<br>')}</p>` }) })
    if (r.ok) setCompose(null); else setCompose({ ...compose, sending: false, error: r.error || 'Send failed' })
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setPhase('auth'); setMessages([]); setSel(null) }

  if (phase === 'loading') return <Splash />
  if (phase === 'auth') return <Auth onDone={refreshMe} />
  if (phase === 'add-account') return <AddAccount onDone={refreshMe} email={email} />

  return (
    <div className="h-screen w-screen grid" style={{ gridTemplateColumns: '236px 380px 1fr' }}>
      <aside className="glass flex flex-col p-4 gap-1" style={{ borderRight: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2 px-1 mb-5"><Mark /><span className="font-extrabold tracking-tight text-[17px]">Zaim</span></div>
        <button onClick={() => setCompose({ to: '', subject: '', body: '' })} className="accent-grad text-white font-bold rounded-xl py-2.5 text-sm mb-4 hover:opacity-90 transition">✏️  Compose</button>
        {[['Inbox', '📥', true], ['Starred', '⭐', false], ['Sent', '📤', false], ['Drafts', '📝', false], ['Archive', '🗄️', false]].map(([l, i, on]) => (
          <div key={l as string} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer ${on ? 'bg-white/5 text-white font-semibold' : 'text-[color:var(--muted)] hover:bg-white/5'}`}><span>{i as string}</span>{l as string}</div>
        ))}
        <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2 px-1">
            <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold text-white" style={{ background: avatarColor(email) }}>{initials(email)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate">{accounts[0]?.email || email}</div>
              <div className="text-[10px] text-[color:var(--muted)] truncate">{email}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setPhase('add-account')} className="text-[11px] text-[color:var(--muted)] hover:text-white">+ mailbox</button>
            <button onClick={logout} className="text-[11px] text-[color:var(--muted)] hover:text-white ml-auto">Sign out</button>
          </div>
        </div>
      </aside>

      <section className="flex flex-col overflow-hidden" style={{ borderRight: '1px solid var(--line)' }}>
        <header className="flex items-center justify-between px-5 h-14 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <h1 className="font-bold">Inbox</h1>
          <button onClick={load} className="text-xs text-[color:var(--muted)] hover:text-white">↻ Refresh</button>
        </header>
        <div className="overflow-y-auto">
          {listLoading && messages.length === 0 && <div className="p-6 text-sm text-[color:var(--muted)]">Loading…</div>}
          {!listLoading && messages.length === 0 && <div className="p-6 text-sm text-[color:var(--muted)]">No messages.</div>}
          {messages.map((m) => (
            <button key={m.uid} onClick={() => open(m.uid)} className={`w-full text-left px-4 py-3 flex gap-3 items-start transition ${selUid === m.uid ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`} style={{ borderBottom: '1px solid var(--line)' }}>
              <span className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-white" style={{ background: avatarColor(m.fromName || m.from) }}>{initials(m.fromName || m.from)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${m.seen ? 'font-medium text-[color:var(--muted)]' : 'font-bold'}`}>{m.fromName || m.from}</span>
                  <span className="text-[11px] text-[color:var(--muted)] shrink-0">{when(m.date)}</span>
                </span>
                <span className={`block truncate text-[13px] mt-0.5 ${m.seen ? 'text-[color:var(--muted)]' : 'text-white'}`}>{m.subject}</span>
              </span>
              {!m.seen && <span className="mt-2 w-2 h-2 rounded-full accent-grad shrink-0" />}
            </button>
          ))}
        </div>
      </section>

      <main className="overflow-hidden flex flex-col">
        {!sel && selUid == null && <Empty />}
        {!sel && selUid != null && <div className="p-8 text-sm text-[color:var(--muted)]">Opening…</div>}
        {sel && (
          <div className="flex flex-col h-full fade-in">
            <header className="px-8 pt-7 pb-5 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="text-xl font-bold leading-snug">{sel.subject}</h2>
              <div className="flex items-center gap-3 mt-4">
                <span className="w-10 h-10 rounded-full grid place-items-center text-sm font-bold text-white" style={{ background: avatarColor(sel.fromName || sel.from) }}>{initials(sel.fromName || sel.from)}</span>
                <div className="min-w-0"><div className="text-sm font-semibold truncate">{sel.fromName || sel.from}</div><div className="text-xs text-[color:var(--muted)] truncate">{sel.from} · to {sel.to}</div></div>
                <span className="ml-auto text-xs text-[color:var(--muted)]">{new Date(sel.date).toLocaleString()}</span>
                <button onClick={() => setCompose({ to: sel.from.replace(/.*<|>.*/g, ''), subject: 'Re: ' + sel.subject, body: '' })} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10">↩ Reply</button>
              </div>
            </header>
            <iframe title="message" sandbox="" className="flex-1 w-full bg-white" srcDoc={sel.html || `<pre style="font-family:system-ui;white-space:pre-wrap;padding:24px;color:#111">${(sel.text || '').replace(/</g, '&lt;')}</pre>`} />
          </div>
        )}
      </main>

      {compose && <Compose c={compose} set={setCompose} onSend={send} onClose={() => setCompose(null)} />}
    </div>
  )
}

function Mark() { return <span className="w-7 h-7 rounded-lg accent-grad grid place-items-center text-white font-black text-sm">Z</span> }
function Splash() { return <div className="h-screen grid place-items-center"><div className="flex items-center gap-3 opacity-70"><Mark /><span className="font-extrabold text-lg">Zaim</span></div></div> }
function Empty() {
  return <div className="h-full grid place-items-center text-center px-8"><div className="opacity-70">
    <div className="mx-auto mb-4 w-14 h-14 rounded-2xl accent-grad grid place-items-center text-white text-2xl font-black">Z</div>
    <div className="font-bold text-lg">Select a message</div><div className="text-sm text-[color:var(--muted)] mt-1">Secure mail, ready for you and your agents.</div>
  </div></div>
}
const field = 'w-full bg-[color:var(--panel-2)] border rounded-xl px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]'

function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr(''); setBusy(true)
    const r = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password: pw }) })
    setBusy(false)
    if (r.ok) onDone(); else setErr(r.error || 'Failed')
  }
  return (
    <div className="h-screen grid place-items-center px-6">
      <div className="glass rounded-2xl p-8 w-full max-w-sm fade-in">
        <div className="flex items-center gap-2 mb-6"><Mark /><span className="font-extrabold text-lg tracking-tight">Zaim</span></div>
        <h1 className="text-xl font-bold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1 mb-5">Secure mail for you and your agents.</p>
        <div className="flex flex-col gap-3">
          <input className={field} style={{ borderColor: 'var(--line)' }} placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={field} style={{ borderColor: 'var(--line)' }} type="password" placeholder={mode === 'register' ? 'password (8+ chars)' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        <button disabled={busy} onClick={go} className="accent-grad text-white font-bold rounded-xl py-3 w-full mt-4 hover:opacity-90 disabled:opacity-50">{busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr('') }} className="text-xs text-[color:var(--muted)] hover:text-white mt-4 w-full text-center">
          {mode === 'login' ? "No account? Create one" : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}

function AddAccount({ onDone, email }: { onDone: () => void; email: string }) {
  const [f, setF] = useState({ label: '', imapHost: '', imapUser: email, imapPass: '', imapPort: '993' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr(''); setBusy(true)
    const r = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ ...f, imapPort: Number(f.imapPort), label: f.label || f.imapUser }) })
    setBusy(false)
    if (r.ok) onDone(); else setErr(r.error || (r.verified === false ? 'Could not connect — check host/user/password' : 'Failed'))
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="h-screen grid place-items-center px-6">
      <div className="glass rounded-2xl p-8 w-full max-w-md fade-in">
        <div className="flex items-center gap-2 mb-6"><Mark /><span className="font-extrabold text-lg tracking-tight">Zaim</span></div>
        <h1 className="text-xl font-bold">Connect a mailbox</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1 mb-5">Your credentials are encrypted at rest and only used to reach your mail host.</p>
        <div className="flex flex-col gap-3">
          <input className={field} style={{ borderColor: 'var(--line)' }} placeholder="Label (e.g. Work)" value={f.label} onChange={set('label')} />
          <input className={field} style={{ borderColor: 'var(--line)' }} placeholder="Email address" value={f.imapUser} onChange={set('imapUser')} />
          <input className={field} style={{ borderColor: 'var(--line)' }} placeholder="Password / app password" type="password" value={f.imapPass} onChange={set('imapPass')} />
          <div className="flex gap-3">
            <input className={field + ' flex-[2]'} style={{ borderColor: 'var(--line)' }} placeholder="IMAP host (e.g. imap.gmail.com)" value={f.imapHost} onChange={set('imapHost')} />
            <input className={field + ' flex-[1]'} style={{ borderColor: 'var(--line)' }} placeholder="Port" value={f.imapPort} onChange={set('imapPort')} />
          </div>
        </div>
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
        <button disabled={busy || !f.imapHost || !f.imapPass} onClick={go} className="accent-grad text-white font-bold rounded-xl py-3 w-full mt-4 hover:opacity-90 disabled:opacity-50">{busy ? 'Verifying…' : 'Connect'}</button>
        <p className="text-[11px] text-[color:var(--muted)] mt-3 text-center">SMTP is auto-derived from your host · sending uses the same account.</p>
      </div>
    </div>
  )
}

function Compose({ c, set, onSend, onClose }: { c: { to: string; subject: string; body: string; sending?: boolean; error?: string }; set: (v: any) => void; onSend: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-2xl fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12" style={{ borderBottom: '1px solid var(--line)' }}><span className="font-bold text-sm">New message</span><button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button></div>
        <div className="p-5 flex flex-col gap-3">
          <input value={c.to} onChange={(e) => set({ ...c, to: e.target.value })} placeholder="To" className="bg-transparent border-b pb-2 text-sm outline-none focus:border-[color:var(--accent)]" style={{ borderColor: 'var(--line)' }} />
          <input value={c.subject} onChange={(e) => set({ ...c, subject: e.target.value })} placeholder="Subject" className="bg-transparent border-b pb-2 text-sm outline-none focus:border-[color:var(--accent)]" style={{ borderColor: 'var(--line)' }} />
          <textarea value={c.body} onChange={(e) => set({ ...c, body: e.target.value })} placeholder="Write your message…" rows={10} className="bg-transparent text-sm outline-none resize-none leading-relaxed" />
          {c.error && <p className="text-xs text-red-400">{c.error}</p>}
          <div className="flex items-center gap-3"><button disabled={c.sending || !c.to} onClick={onSend} className="accent-grad text-white font-bold rounded-xl px-6 py-2.5 text-sm disabled:opacity-50">{c.sending ? 'Sending…' : 'Send'}</button><span className="text-xs text-[color:var(--muted)]">Encrypted transport · sends from your account</span></div>
        </div>
      </div>
    </div>
  )
}
