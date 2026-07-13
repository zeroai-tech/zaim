'use client'
import { useEffect, useState, useCallback, useRef } from 'react'

type Msg = { uid: number; subject: string; from: string; fromName: string; to: string; date: string; seen: boolean; flagged: boolean }
type Full = Msg & { html: string | null; text: string | null }
type Account = { id: string; label: string; email: string; isDefault: boolean }
type Folder = { key: string; label: string; icon: string; path: string }

const api = (path: string, init?: RequestInit) =>
  fetch(path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }).then((r) => r.json())
const q = (params: Record<string, string | undefined>) =>
  '?' + Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

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
  const [authMode, setAuthMode] = useState<null | 'login' | 'register'>(null)
  const [email, setEmail] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolder, setActiveFolder] = useState('INBOX')
  const [acctMenu, setAcctMenu] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [sel, setSel] = useState<Full | null>(null)
  const [selUid, setSelUid] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [compose, setCompose] = useState<null | { to: string; subject: string }>(null)
  const [showKeys, setShowKeys] = useState(false)

  const refreshMe = useCallback(async () => {
    const me = await api('/api/auth/me')
    if (!me.user) { setPhase('auth'); return }
    setEmail(me.user.email)
    const accs: Account[] = me.accounts || []
    setAccounts(accs)
    setActiveAccount((cur) => cur && accs.some((a) => a.id === cur) ? cur : (accs.find((a) => a.isDefault)?.id || accs[0]?.id || ''))
    setPhase(accs.length ? 'app' : 'add-account')
  }, [])
  useEffect(() => { refreshMe() }, [refreshMe])

  // Discover this account's real folders (Sent/Drafts/… differ per provider).
  useEffect(() => {
    if (phase !== 'app' || !activeAccount) return
    setFolders([{ key: 'INBOX', label: 'Inbox', icon: '📥', path: 'INBOX' }])
    api('/api/mail/folders' + q({ account: activeAccount })).then((r) => { if (r.ok) setFolders(r.folders) })
  }, [phase, activeAccount])

  const load = useCallback(() => {
    if (!activeAccount) return
    const f = folders.find((x) => x.key === activeFolder)
    setListLoading(true); setSel(null); setSelUid(null)
    api('/api/mail/list' + q({ limit: '40', mailbox: f?.path || 'INBOX', flagged: activeFolder === 'starred' ? '1' : undefined, account: activeAccount }))
      .then((r) => setMessages(r.messages || [])).finally(() => setListLoading(false))
  }, [activeAccount, activeFolder, folders])
  useEffect(() => { if (phase === 'app') load() }, [phase, load])

  async function open(uid: number) {
    setSelUid(uid); setSel(null)
    const f = folders.find((x) => x.key === activeFolder)
    const r = await api(`/api/mail/message/${uid}` + q({ mailbox: f?.path || 'INBOX', account: activeAccount }))
    if (r.ok) { setSel(r.message); setMessages((m) => m.map((x) => (x.uid === uid ? { ...x, seen: true } : x))) }
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setPhase('auth'); setMessages([]); setSel(null); setAccounts([]) }

  if (phase === 'loading') return <Splash />
  if (phase === 'auth') return <Landing onSignIn={() => setAuthMode('login')} onStart={() => setAuthMode('register')} authMode={authMode} closeAuth={() => setAuthMode(null)} onDone={refreshMe} />
  if (phase === 'add-account') return <AddAccount onDone={refreshMe} email={email} canCancel={accounts.length > 0} onCancel={() => setPhase('app')} />

  const active = accounts.find((a) => a.id === activeAccount)
  const folderTitle = folders.find((f) => f.key === activeFolder)?.label || 'Inbox'

  return (
    <div className="h-screen w-screen grid" style={{ gridTemplateColumns: '246px 380px 1fr' }}>
      <aside className="glass flex flex-col p-4 gap-1 relative" style={{ borderRight: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2 px-1 mb-4"><Mark /><span className="font-extrabold tracking-tight text-[17px]">Zaim</span></div>

        {/* Account switcher */}
        <button onClick={() => setAcctMenu((v) => !v)} className="flex items-center gap-2 rounded-xl px-2.5 py-2 mb-3 hover:bg-white/5 transition text-left" style={{ border: '1px solid var(--line)' }}>
          <span className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold text-white shrink-0" style={{ background: avatarColor(active?.email || email) }}>{initials(active?.email || email)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold truncate">{active?.label || 'Mailbox'}</span>
            <span className="block text-[10px] text-[color:var(--muted)] truncate">{active?.email || email}</span>
          </span>
          <span className="text-[color:var(--muted)] text-xs">{acctMenu ? '▲' : '▼'}</span>
        </button>
        {acctMenu && (
          <div className="absolute z-20 left-4 right-4 top-[104px] glass rounded-xl p-1.5 shadow-xl fade-in" style={{ border: '1px solid var(--line)' }}>
            {accounts.map((a) => (
              <button key={a.id} onClick={() => { setActiveAccount(a.id); setActiveFolder('INBOX'); setAcctMenu(false) }} className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 ${a.id === activeAccount ? 'bg-white/5' : ''}`}>
                <span className="w-6 h-6 rounded-md grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(a.email) }}>{initials(a.email)}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold truncate">{a.label}</span><span className="block text-[10px] text-[color:var(--muted)] truncate">{a.email}</span></span>
                {a.id === activeAccount && <span className="text-[color:var(--accent)] text-xs">✓</span>}
              </button>
            ))}
            <button onClick={() => { setAcctMenu(false); setPhase('add-account') }} className="w-full text-left rounded-lg px-2 py-2 text-xs text-[color:var(--muted)] hover:bg-white/5 hover:text-white">+ Add another mailbox</button>
          </div>
        )}

        <button onClick={() => setCompose({ to: '', subject: '' })} className="accent-grad text-white font-bold rounded-xl py-2.5 text-sm mb-3 hover:opacity-90 transition">✏️  Compose</button>

        {folders.map((f) => (
          <button key={f.key} onClick={() => setActiveFolder(f.key)} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer text-left ${activeFolder === f.key ? 'bg-white/5 text-white font-semibold' : 'text-[color:var(--muted)] hover:bg-white/5'}`}>
            <span>{f.icon}</span>{f.label}
          </button>
        ))}

        <div className="mt-auto pt-4 flex gap-3" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={() => setShowKeys(true)} className="text-[11px] text-[color:var(--muted)] hover:text-white">🔑 Agent keys</button>
          <button onClick={logout} className="text-[11px] text-[color:var(--muted)] hover:text-white ml-auto">Sign out</button>
        </div>
      </aside>

      <section className="flex flex-col overflow-hidden" style={{ borderRight: '1px solid var(--line)' }}>
        <header className="flex items-center justify-between px-5 h-14 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <h1 className="font-bold">{folderTitle}</h1>
          <button onClick={load} className="text-xs text-[color:var(--muted)] hover:text-white">↻ Refresh</button>
        </header>
        <div className="overflow-y-auto">
          {listLoading && <div className="p-6 text-sm text-[color:var(--muted)]">Loading…</div>}
          {!listLoading && messages.length === 0 && <div className="p-6 text-sm text-[color:var(--muted)]">Nothing in {folderTitle.toLowerCase()}.</div>}
          {!listLoading && messages.map((m) => {
            const who = activeFolder === 'sent' || activeFolder === 'drafts' ? m.to : (m.fromName || m.from)
            return (
              <button key={m.uid} onClick={() => open(m.uid)} className={`w-full text-left px-4 py-3 flex gap-3 items-start transition ${selUid === m.uid ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`} style={{ borderBottom: '1px solid var(--line)' }}>
                <span className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-white" style={{ background: avatarColor(who) }}>{initials(who)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${m.seen ? 'font-medium text-[color:var(--muted)]' : 'font-bold'}`}>{activeFolder === 'sent' || activeFolder === 'drafts' ? 'To: ' + who : who}</span>
                    <span className="text-[11px] text-[color:var(--muted)] shrink-0">{when(m.date)}</span>
                  </span>
                  <span className={`block truncate text-[13px] mt-0.5 ${m.seen ? 'text-[color:var(--muted)]' : 'text-white'}`}>{m.flagged && '⭐ '}{m.subject}</span>
                </span>
                {!m.seen && <span className="mt-2 w-2 h-2 rounded-full accent-grad shrink-0" />}
              </button>
            )
          })}
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
                <button onClick={() => setCompose({ to: sel.from.replace(/.*<|>.*/g, ''), subject: 'Re: ' + sel.subject })} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10">↩ Reply</button>
              </div>
            </header>
            <iframe title="message" sandbox="" className="flex-1 w-full bg-white" srcDoc={sel.html || `<pre style="font-family:system-ui;white-space:pre-wrap;padding:24px;color:#111">${(sel.text || '').replace(/</g, '&lt;')}</pre>`} />
          </div>
        )}
      </main>

      {compose && <Compose initial={compose} from={active?.email} account={activeAccount} onClose={() => setCompose(null)} onSent={() => { setCompose(null); load() }} />}
      {showKeys && <Keys accounts={accounts} onClose={() => setShowKeys(false)} />}
    </div>
  )
}

function Mark({ big }: { big?: boolean }) { return <span className={`${big ? 'w-9 h-9 text-lg rounded-xl' : 'w-7 h-7 text-sm rounded-lg'} accent-grad grid place-items-center text-white font-black`}>Z</span> }
function Splash() { return <div className="h-screen grid place-items-center"><div className="flex items-center gap-3 opacity-70"><Mark /><span className="font-extrabold text-lg">Zaim</span></div></div> }
function Empty() {
  return <div className="h-full grid place-items-center text-center px-8"><div className="opacity-70">
    <div className="mx-auto mb-4 w-14 h-14 rounded-2xl accent-grad grid place-items-center text-white text-2xl font-black">Z</div>
    <div className="font-bold text-lg">Select a message</div><div className="text-sm text-[color:var(--muted)] mt-1">Secure mail, ready for you and your agents.</div>
  </div></div>
}
const field = 'w-full bg-[color:var(--panel-2)] border rounded-xl px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]'
const REL = 'https://github.com/zeroai-tech/zaim/releases/download/desktop-latest'

// ── Marketing landing (signed-out) ───────────────────────────────────────────
function Landing({ onSignIn, onStart, authMode, closeAuth, onDone }: { onSignIn: () => void; onStart: () => void; authMode: null | 'login' | 'register'; closeAuth: () => void; onDone: () => void }) {
  return (
    <div className="min-h-screen overflow-y-auto">
      <nav className="flex items-center gap-3 px-6 md:px-10 h-16 max-w-6xl mx-auto">
        <Mark /><span className="font-extrabold tracking-tight text-lg">Zaim</span>
        <div className="ml-auto flex items-center gap-2">
          <a href="#download" className="hidden sm:block text-sm text-[color:var(--muted)] hover:text-white px-3 py-2">Download</a>
          <a href="#agents" className="hidden sm:block text-sm text-[color:var(--muted)] hover:text-white px-3 py-2">For agents</a>
          <button onClick={onSignIn} className="text-sm font-semibold px-3 py-2 rounded-lg hover:bg-white/5">Sign in</button>
          <button onClick={onStart} className="accent-grad text-white text-sm font-bold px-4 py-2 rounded-lg hover:opacity-90">Get started</button>
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-4xl mx-auto text-center px-6 pt-16 md:pt-24 pb-16 fade-in">
        <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-6" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
          <span className="w-1.5 h-1.5 rounded-full accent-grad" /> Secure mail, built for you and your AI
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Professional email,<br /><span className="text-transparent bg-clip-text accent-grad">answered by your agents.</span>
        </h1>
        <p className="text-base md:text-lg text-[color:var(--muted)] mt-6 max-w-2xl mx-auto leading-relaxed">
          Zaim is a beautiful, private mail client that companies self-host like Outlook — plus an API and CLI so Claude Code, Codex and Gemini can read, draft and send your mail. Your inbox, your rules, your keys.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-9">
          <button onClick={onStart} className="accent-grad text-white font-bold px-6 py-3 rounded-xl hover:opacity-90 text-sm">Get started free</button>
          <a href="#download" className="font-semibold px-6 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>⤓ Download the app</a>
        </div>
        <p className="text-xs text-[color:var(--muted)] mt-4">No credit card · Bring your own mailbox · Passwords encrypted at rest</p>
      </header>

      {/* Why different */}
      <section className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-5 pb-20">
        {[
          ['🔒', 'Total security by design', 'Your IMAP/SMTP passwords are AES-256 encrypted at rest with a key only your deployment holds. Email renders in a locked sandbox. Nothing is shared, nothing is mined.'],
          ['🤖', 'An inbox your AI can use', 'Generate a scoped agent key and hand it to Claude Code, Codex or Gemini. They triage, draft and send on your behalf — through the same secure engine, never your raw password.'],
          ['🏢', 'Yours to deploy like Outlook', 'Self-host on Vercel for your whole company, run the CLI on a server, or install the desktop app. One codebase, every surface. You own the data.'],
        ].map(([icon, title, body]) => (
          <div key={title} className="glass rounded-2xl p-6">
            <div className="w-11 h-11 rounded-xl grid place-items-center text-xl mb-4" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>{icon}</div>
            <h3 className="font-bold text-[15px]">{title}</h3>
            <p className="text-sm text-[color:var(--muted)] mt-2 leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      {/* Use cases */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl md:text-3xl font-extrabold text-center tracking-tight">Built for the way you actually work</h2>
        <div className="grid md:grid-cols-2 gap-4 mt-10">
          {[
            ['Founders & operators', 'Let an agent clear your inbox to zero — summarise threads, draft replies in your voice, flag what needs you. You approve and send.'],
            ['Support & sales teams', 'Point your agents at a shared mailbox. They respond to routine questions instantly and escalate the rest, all logged and secure.'],
            ['Developers', '`zaim send`, `zaim list`, `zaim read` from any script or CI job. Wire email into your automations without a bloated SDK.'],
            ['Whole companies', 'Deploy one Zaim for everyone. Each person connects their own mailbox and manages their own agent keys — no shared secrets.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl p-6" style={{ border: '1px solid var(--line)' }}>
              <h3 className="font-bold text-[15px] flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full accent-grad" />{t}</h3>
              <p className="text-sm text-[color:var(--muted)] mt-2 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agents strip */}
      <section id="agents" className="max-w-5xl mx-auto px-6 pb-20">
        <div className="glass rounded-2xl p-8 md:p-10 text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Give your AI a real inbox</h2>
          <p className="text-sm text-[color:var(--muted)] mt-3 max-w-xl mx-auto">Generate a key in Settings, drop it into your agent, and it works through Zaim’s secure engine — never your raw credentials.</p>
          <pre className="text-left text-xs md:text-sm mt-6 mx-auto max-w-xl overflow-x-auto rounded-xl p-5 leading-relaxed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>{`export ZAIM_API_KEY="zaim_•••"
zaim list --unread          # triage the inbox
zaim read 4821              # pull a thread
zaim send --to ceo@acme.com \\
  --subject "Re: Q3 numbers" ...`}</pre>
        </div>
      </section>

      {/* Download */}
      <section id="download" className="max-w-5xl mx-auto px-6 pb-24 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Install Zaim on your machine</h2>
        <p className="text-sm text-[color:var(--muted)] mt-3">The full secure client, running locally — offline-capable, your data on your device.</p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          <a href={`${REL}/Zaim-0.1.0-arm64.dmg`} className="font-semibold px-5 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>  macOS (Apple Silicon)</a>
          <a href={`${REL}/Zaim-0.1.0.dmg`} className="font-semibold px-5 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>  macOS (Intel)</a>
          <a href={`${REL}/Zaim-0.1.0-win.zip`} className="font-semibold px-5 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>⊞ Windows</a>
          <a href={`${REL}/Zaim-0.1.0.AppImage`} className="font-semibold px-5 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>🐧 Linux</a>
        </div>
        <div className="mt-12">
          <button onClick={onStart} className="accent-grad text-white font-bold px-7 py-3 rounded-xl hover:opacity-90 text-sm">Start using Zaim in your browser →</button>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 flex items-center gap-2 text-xs text-[color:var(--muted)]" style={{ borderTop: '1px solid var(--line)' }}>
        <Mark /><span className="font-semibold">Zaim</span> <span>— a ZeroAI product. Secure mail for humans and their agents.</span>
        <span className="ml-auto">© {new Date().getFullYear()} ZeroAI Technologies</span>
      </footer>

      {authMode && <AuthModal mode={authMode} onClose={closeAuth} onDone={onDone} />}
    </div>
  )
}

function AuthModal({ mode: initial, onClose, onDone }: { mode: 'login' | 'register'; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>(initial)
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go() {
    setErr(''); setBusy(true)
    const r = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password: pw }) })
    setBusy(false)
    if (r.ok) onDone(); else setErr(r.error || 'Failed')
  }
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/60 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl p-8 w-full max-w-sm fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-6"><Mark /><span className="font-extrabold text-lg tracking-tight">Zaim</span><button onClick={onClose} className="ml-auto text-[color:var(--muted)] hover:text-white">✕</button></div>
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

function AddAccount({ onDone, email, canCancel, onCancel }: { onDone: () => void; email: string; canCancel?: boolean; onCancel?: () => void }) {
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
        <div className="flex items-center gap-2 mb-6"><Mark /><span className="font-extrabold text-lg tracking-tight">Zaim</span>{canCancel && <button onClick={onCancel} className="ml-auto text-[color:var(--muted)] hover:text-white">✕</button>}</div>
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

type Att = { name: string; size: number; content: string; contentType: string }
const fmtSize = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
const readB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] || ''); r.readAsDataURL(f) })

function Compose({ initial, from, account, onClose, onSent }: { initial: { to: string; subject: string }; from?: string; account: string; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(initial.to); const [cc, setCc] = useState(''); const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(initial.subject)
  const [showCc, setShowCc] = useState(false); const [showBcc, setShowBcc] = useState(false)
  const [atts, setAtts] = useState<Att[]>([])
  const [sending, setSending] = useState(false); const [error, setError] = useState('')
  const ed = useRef<HTMLDivElement>(null); const fileIn = useRef<HTMLInputElement>(null)

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
    }) })
    setSending(false)
    if (r.ok) onSent(); else setError(r.error || 'Send failed')
  }
  const line = 'bg-transparent border-b pb-2 text-sm outline-none focus:border-[color:var(--accent)] w-full'
  const tbtn = 'w-8 h-8 rounded-lg grid place-items-center text-[color:var(--muted)] hover:text-white hover:bg-white/5 text-sm'

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-2xl fade-in flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="font-bold text-sm">New message{from ? ` · from ${from}` : ''}</span>
          <button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-3 overflow-y-auto">
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

          {/* formatting toolbar */}
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
            className="zaim-editor min-h-[180px] max-h-[38vh] overflow-y-auto text-sm outline-none leading-relaxed rounded-xl px-3 py-3"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }} />

          {/* attachments */}
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
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
          <button disabled={sending || !to} onClick={send} className="accent-grad text-white font-bold rounded-xl px-6 py-2.5 text-sm disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
          <button onClick={() => fileIn.current?.click()} className="text-xs text-[color:var(--muted)] hover:text-white">📎 Attach</button>
          <span className="text-xs text-[color:var(--muted)] ml-auto">Encrypted transport{atts.length ? ` · ${atts.length} file${atts.length > 1 ? 's' : ''}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

type KeyRow = { id: string; label: string; account_id: string | null; created_at: number; last_used: number | null }
function Keys({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [label, setLabel] = useState(''); const [acct, setAcct] = useState('')
  const [fresh, setFresh] = useState<{ label: string; secret: string } | null>(null)
  const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false)
  const reload = useCallback(() => { api('/api/keys').then((r) => setKeys(r.keys || [])) }, [])
  useEffect(() => { reload() }, [reload])
  async function mint() {
    setBusy(true)
    const r = await api('/api/keys', { method: 'POST', body: JSON.stringify({ label: label || 'Agent key', accountId: acct || undefined }) })
    setBusy(false)
    if (r.ok) { setFresh({ label: r.label, secret: r.secret }); setLabel(''); reload() }
  }
  async function revoke(id: string) { await api(`/api/keys/${id}`, { method: 'DELETE' }); reload() }
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-lg fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="font-bold text-sm">🔑 Agent keys</span><button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <p className="text-xs text-[color:var(--muted)] -mt-1">Give Claude Code, Codex or the <code>zaim</code> CLI a key so they can read + send from your mailbox. Each key is shown once — store it safely; revoke anytime.</p>
          {fresh ? (
            <div className="rounded-xl p-4" style={{ background: 'var(--panel-2)', border: '1px solid var(--accent)' }}>
              <div className="text-xs font-semibold mb-2">New key “{fresh.label}” — copy it now, it won’t be shown again:</div>
              <div className="flex gap-2">
                <code className="flex-1 text-[11px] break-all bg-black/30 rounded-lg px-3 py-2 leading-relaxed">{fresh.secret}</code>
                <button onClick={() => { navigator.clipboard?.writeText(fresh.secret); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="shrink-0 accent-grad text-white text-xs font-bold px-3 rounded-lg">{copied ? '✓' : 'Copy'}</button>
              </div>
              <button onClick={() => setFresh(null)} className="text-[11px] text-[color:var(--muted)] hover:text-white mt-3">Done</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input className={field + ' flex-1'} style={{ borderColor: 'var(--line)' }} placeholder="Key name (e.g. Claude Code)" value={label} onChange={(e) => setLabel(e.target.value)} />
              {accounts.length > 1 && (
                <select className={field + ' flex-1'} style={{ borderColor: 'var(--line)' }} value={acct} onChange={(e) => setAcct(e.target.value)}>
                  <option value="">Default mailbox</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              )}
              <button disabled={busy} onClick={mint} className="accent-grad text-white font-bold rounded-xl px-4 text-sm disabled:opacity-50 shrink-0">{busy ? '…' : 'Generate'}</button>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {keys.length === 0 && <div className="text-xs text-[color:var(--muted)]">No keys yet.</div>}
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)' }}>
                <span className="w-7 h-7 rounded-lg grid place-items-center text-xs" style={{ background: 'var(--line)' }}>🔑</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{k.label}</div>
                  <div className="text-[10px] text-[color:var(--muted)]">{k.last_used ? `last used ${when(new Date(k.last_used).toISOString())}` : 'never used'}{k.account_id ? '' : ' · default mailbox'}</div>
                </div>
                <button onClick={() => revoke(k.id)} className="text-[11px] text-red-400 hover:text-red-300 shrink-0">Revoke</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
