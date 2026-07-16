'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Msg, Full, Att, ComposeInit, Account, Folder, SmartView,
  api, q, isToday,
  Avatar, Mark, Collapsible,
} from '@/lib/client-utils'
import { TopBar } from './components/TopBar'
import { SpacesPanel } from './components/SpacesPanel'
import { ConversationList } from './components/ConversationList'
import { ReadingCanvas } from './components/ReadingCanvas'
import { ContextPanel } from './components/ContextPanel'
import { AIPanel } from './components/AIPanel'

export default function Zaim() {
  const [phase, setPhase] = useState<'loading' | 'auth' | 'add-account' | 'app'>('loading')
  const [authMode, setAuthMode] = useState<null | 'login' | 'register'>(null)
  const [email, setEmail] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolder, setActiveFolder] = useState('INBOX')
  const [smartView, setSmartView] = useState<SmartView>(null)
  const [search, setSearch] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [sel, setSel] = useState<Full | null>(null)
  const [selUid, setSelUid] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [compose, setCompose] = useState<null | ComposeInit>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [avatar, setAvatar] = useState<string>('')
  const [showProfile, setShowProfile] = useState(false)
  const [panelState, setPanelState] = useState({ spaces: true, context: true, ai: false })

  const refreshMe = useCallback(async () => {
    const me = await api('/api/auth/me')
    if (!me.user) { setPhase('auth'); return }
    setEmail(me.user.email)
    setAvatar(me.user.avatar || '')
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
  // Load a draft (recipient, Cc, body, attachments) into the composer to send.
  async function editDraft() {
    if (!sel) return
    setLoadingDraft(true)
    const mailbox = folders.find((f) => f.key === activeFolder)?.path || 'INBOX'
    const attachments: Att[] = []
    for (let i = 0; i < (sel.attachments?.length || 0); i++) {
      const meta = sel.attachments![i]
      const res = await fetch('/api/mail/attachment' + q({ uid: String(sel.uid), mailbox, index: String(i), account: activeAccount }), { credentials: 'include' })
      const blob = await res.blob()
      const content = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r((fr.result as string).split(',')[1] || ''); fr.readAsDataURL(blob) })
      attachments.push({ name: meta.filename, size: meta.size, content, contentType: meta.contentType })
    }
    setLoadingDraft(false)
    setCompose({ to: sel.to, cc: sel.cc, subject: sel.subject, html: sel.html || '', attachments, draft: { uid: sel.uid, mailbox } })
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setPhase('auth'); setMessages([]); setSel(null); setAccounts([]) }
  function togglePanel(p: 'spaces' | 'context' | 'ai') { setPanelState((s) => ({ ...s, [p]: !s[p] })) }
  function selectFolder(key: string) { setSearch(''); setActiveFolder(key) }

  if (phase === 'loading') return <Splash />
  if (phase === 'auth') return <Landing onSignIn={() => setAuthMode('login')} onStart={() => setAuthMode('register')} authMode={authMode} closeAuth={() => setAuthMode(null)} onDone={refreshMe} />
  if (phase === 'add-account') return <AddAccount onDone={refreshMe} email={email} canCancel={accounts.length > 0} onCancel={() => setPhase('app')} />

  const active = accounts.find((a) => a.id === activeAccount)
  const folderTitle = smartView === 'unread' ? 'Unread' : smartView === 'today' ? 'Today' : (folders.find((f) => f.key === activeFolder)?.label || 'Inbox')

  // Smart views filter the loaded folder's messages client-side (no new data —
  // see SpacesPanel for why Attachments/Waiting/Needs Reply/Scheduled aren't here).
  let visibleMessages = messages
  if (smartView === 'unread') visibleMessages = visibleMessages.filter((m) => !m.seen)
  if (smartView === 'today') visibleMessages = visibleMessages.filter((m) => isToday(m.date))
  if (search.trim()) {
    const s = search.trim().toLowerCase()
    visibleMessages = visibleMessages.filter((m) => m.subject.toLowerCase().includes(s) || m.from.toLowerCase().includes(s) || m.fromName.toLowerCase().includes(s) || m.to.toLowerCase().includes(s))
  }

  return (
    <div className="h-screen w-screen flex flex-col">
      <TopBar
        accounts={accounts} activeAccount={activeAccount} activeEmail={active?.email || email} activeLabel={active?.label || 'Mailbox'}
        email={email} avatar={avatar}
        onSwitchAccount={(id) => { setActiveAccount(id); setActiveFolder('INBOX'); setSmartView(null) }}
        onAddAccount={() => setPhase('add-account')}
        search={search} onSearch={setSearch}
        onCompose={() => setCompose({ to: '', subject: '' })}
        onShowKeys={() => setShowKeys(true)} onShowProfile={() => setShowProfile(true)} onLogout={logout}
        panelState={panelState} onTogglePanel={togglePanel}
      />
      <div className="flex-1 flex overflow-hidden">
        <Collapsible open={panelState.spaces} width={220}>
          <SpacesPanel folders={folders} activeFolder={activeFolder} smartView={smartView} onSelectFolder={selectFolder} onSelectSmartView={setSmartView} />
        </Collapsible>

        <div className="w-[360px] shrink-0 h-full" style={{ borderRight: '1px solid var(--line)' }}>
          <ConversationList messages={visibleMessages} activeFolder={activeFolder} selUid={selUid} listLoading={listLoading} folderTitle={folderTitle} onOpen={open} onRefresh={load} />
        </div>

        <div className="flex-1 min-w-0 h-full" style={{ borderRight: '1px solid var(--line)' }}>
          <ReadingCanvas
            sel={sel} selUid={selUid} activeFolder={activeFolder} folders={folders} activeAccount={activeAccount}
            loadingDraft={loadingDraft} onEditDraft={editDraft}
            onReply={() => sel && setCompose({ to: sel.from.replace(/.*<|>.*/g, ''), subject: 'Re: ' + sel.subject })}
            compose={compose} from={active?.email} account={activeAccount}
            onComposeClose={() => setCompose(null)} onComposeSent={() => { setCompose(null); load() }}
          />
        </div>

        <Collapsible open={panelState.context} width={320}>
          <ContextPanel sel={sel} messages={messages} />
        </Collapsible>
        <Collapsible open={panelState.ai} width={360} side="right">
          <AIPanel />
        </Collapsible>
      </div>

      {showKeys && <Keys accounts={accounts} onClose={() => setShowKeys(false)} />}
      {showProfile && <ProfileModal email={email} avatar={avatar} onClose={() => setShowProfile(false)} onSaved={(a) => setAvatar(a)} />}
    </div>
  )
}

function Splash() { return <div className="h-screen grid place-items-center"><div className="flex items-center gap-3 opacity-70"><Mark /><span className="font-extrabold text-lg">Zaim</span></div></div> }
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
                  <div className="text-[10px] text-[color:var(--muted)]">{k.last_used ? `last used ${new Date(k.last_used).toLocaleString()}` : 'never used'}{k.account_id ? '' : ' · default mailbox'}</div>
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

// Resize + center-crop an image file to a small square JPEG data URL (keeps the
// avatar tiny enough to store inline in the users row).
async function imageToAvatar(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale, h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally { URL.revokeObjectURL(url) }
}

function ProfileModal({ email, avatar, onClose, onSaved }: { email: string; avatar: string; onClose: () => void; onSaved: (a: string) => void }) {
  const [preview, setPreview] = useState(avatar)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileIn = useRef<HTMLInputElement>(null)

  async function pick(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    setErr('')
    try { setPreview(await imageToAvatar(file)) } catch { setErr('Could not read that image.') }
  }
  async function save(next: string | null) {
    setBusy(true); setErr('')
    const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ avatar: next }) })
    setBusy(false)
    if (r.ok) { onSaved(next || ''); onClose() } else setErr(r.error || 'Could not save')
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-sm fade-in p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <span className="font-bold text-sm">Profile picture</span>
          <button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
        </div>
        <div className="flex flex-col items-center gap-4">
          <Avatar src={preview} name={email} cls="w-28 h-28 rounded-full text-3xl" txt="text-3xl" />
          <p className="text-[11px] text-[color:var(--muted)] text-center">Shown next to your name in Zaim. A matching Gravatar also appears in some other mail apps.</p>
          <input ref={fileIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="flex gap-2 w-full">
            <button onClick={() => fileIn.current?.click()} className="flex-1 accent-grad text-white font-bold rounded-xl py-2.5 text-sm hover:opacity-90">Upload photo</button>
            {preview && <button onClick={() => setPreview('')} className="px-3 rounded-xl text-sm text-[color:var(--muted)] hover:text-white" style={{ border: '1px solid var(--line)' }}>Clear</button>}
          </div>
          {err && <p className="text-[color:var(--danger,#ff6b6b)] text-xs">{err}</p>}
          <div className="flex gap-2 w-full mt-1">
            <button onClick={onClose} className="flex-1 rounded-xl py-2.5 text-sm text-[color:var(--muted)] hover:text-white" style={{ border: '1px solid var(--line)' }}>Cancel</button>
            <button disabled={busy || preview === avatar} onClick={() => save(preview || null)} className="flex-1 accent-grad text-white font-bold rounded-xl py-2.5 text-sm hover:opacity-90 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
