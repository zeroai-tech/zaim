'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, field, Mark } from '@/lib/client-utils'

const REL = 'https://github.com/zeroai-tech/zaim/releases/download/desktop-latest'

// Deterministic PRNG so decorative layout (scatter positions, delays) is stable
// across server and client render — Math.random() here would cause a hydration
// mismatch since the server has no way to match the client's random sequence.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Reveals a section once (first scroll into view) rather than replaying on
// every scroll past, so the "assembly" moments read as a single event.
function useReveal<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, shown }
}

// ── The first three seconds ──────────────────────────────────────────────────
function Intro({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([])
  const [logo, setLogo] = useState(false)
  useEffect(() => {
    if (sessionStorage.getItem('zaim-intro-seen')) { onDone(); return }
    const t: number[] = []
    const at = (ms: number, fn: () => void) => t.push(window.setTimeout(fn, ms))
    at(500, () => setLines(['Incoming…']))
    at(1300, () => setLines((l) => [...l, '3,842 emails received today.']))
    at(2500, () => setLines((l) => [...l, '']))
    at(3000, () => setLines((l) => [...l, 'Only 7 actually mattered.']))
    at(4400, () => setLogo(true))
    at(5200, () => { sessionStorage.setItem('zaim-intro-seen', '1'); onDone() })
    return () => t.forEach(clearTimeout)
  }, [onDone])
  function skip() { sessionStorage.setItem('zaim-intro-seen', '1'); onDone() }
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center cursor-pointer" style={{ background: 'var(--bg)' }} onClick={skip}>
      {!logo ? (
        <div className="font-mono text-sm md:text-base text-center leading-relaxed px-6" style={{ color: 'var(--accent-2)' }}>
          {lines.map((l, i) => <div key={i}>{l || ' '}</div>)}
          <span className="inline-block w-2 h-4 ml-0.5 align-middle anim-safe" style={{ background: 'var(--accent-2)', animation: 'blink 1s step-end infinite' }} />
        </div>
      ) : (
        <div className="flex items-center gap-3 fade-in"><Mark big /><span className="font-extrabold text-2xl tracking-tight">Zaim</span></div>
      )}
      <span className="absolute bottom-6 text-[11px]" style={{ color: 'var(--muted)' }}>Click to skip</span>
    </div>
  )
}

// ── Hero right side: a living, ambient visualization — not a screenshot ─────
const SHELVES: [string, number, number][] = [['Invoices', 20, 78], ['Meetings', 46, 85], ['Replies', 72, 76], ['Projects', 90, 55]]
function HeroVisual() {
  const dots = useMemo(() => {
    const rnd = mulberry32(11)
    return Array.from({ length: 16 }, (_, i) => {
      const edge = Math.floor(rnd() * 4)
      const along = rnd() * 100
      const start = edge === 0 ? [along, -6] : edge === 1 ? [106, along] : edge === 2 ? [along, 106] : [-6, along]
      const spam = rnd() < 0.2
      const shelf = SHELVES[i % SHELVES.length]
      const target = spam ? [start[0] + (rnd() - 0.5) * 12, start[1] + (rnd() - 0.5) * 12] : [shelf[1] + (rnd() - 0.5) * 10, shelf[2] + (rnd() - 0.5) * 10]
      const dur = 5 + rnd() * 4
      return { x0: start[0], y0: start[1], x1: target[0], y1: target[1], dur, delay: -(rnd() * dur), spam }
    })
  }, [])
  return (
    <div className="relative rounded-2xl glass overflow-hidden min-h-[340px] md:min-h-[440px]">
      <div className="absolute inset-x-6 top-5 text-[11px] font-mono" style={{ color: 'var(--muted)' }}>$ zaim triage --live</div>
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute w-2 h-2 rounded-full anim-safe"
          style={{
            '--x0': `${d.x0}%`, '--y0': `${d.y0}%`, '--x1': `${d.x1}%`, '--y1': `${d.y1}%`,
            animation: `travel ${d.dur}s linear infinite`, animationDelay: `${d.delay}s`,
            background: d.spam ? 'rgba(255,255,255,0.25)' : 'var(--accent-2)',
          } as React.CSSProperties}
        />
      ))}
      {SHELVES.map(([name, x, y]) => (
        <div key={name} className="absolute text-[11px] font-semibold px-2.5 py-1 rounded-full glass" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}>{name}</div>
      ))}
    </div>
  )
}

// ── Floor 1: chaos resolves into clusters on scroll ──────────────────────────
const CLUSTERS: [string, number, number][] = [['Projects', 15, 28], ['Invoices', 50, 15], ['Meetings', 85, 28], ['Family', 32, 78], ['Clients', 68, 78]]
function Floor1() {
  const { ref, shown } = useReveal<HTMLDivElement>()
  const dots = useMemo(() => {
    const rnd = mulberry32(42)
    return Array.from({ length: 48 }, (_, i) => {
      const c = i % CLUSTERS.length
      const [, cx, cy] = CLUSTERS[c]
      return { x0: rnd() * 92 + 4, y0: rnd() * 80 + 10, x1: cx + (rnd() - 0.5) * 16, y1: cy + (rnd() - 0.5) * 16, c, delay: rnd() * 0.5 }
    })
  }, [])
  const colors = ['#5b8cff', '#4dd4ac', '#f6bd60', '#ff7a9c', '#b892ff']
  return (
    <section ref={ref} className="max-w-6xl mx-auto px-6 py-20 md:py-28">
      <h2 className="text-2xl md:text-3xl font-extrabold text-center tracking-tight">{shown ? 'Order emerges.' : 'Every email looks the same at first.'}</h2>
      <p className="text-sm text-center mt-3 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>{shown ? 'Only a few of these actually needed you.' : '3,842 arrived today. All at once, all equally loud.'}</p>
      <div className="relative h-[340px] mt-10 rounded-2xl glass overflow-hidden">
        {dots.map((d, i) => (
          <span
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full transition-all ease-out"
            style={{
              left: `${shown ? d.x1 : d.x0}%`, top: `${shown ? d.y1 : d.y0}%`,
              background: shown ? colors[d.c] : 'var(--muted)', opacity: shown ? 0.9 : 0.35,
              transitionDuration: '1100ms', transitionDelay: `${d.delay}s`,
            }}
          />
        ))}
        {shown && CLUSTERS.map(([name, x, y], i) => (
          <span key={name} className="absolute text-[11px] font-semibold px-2.5 py-1 rounded-full fade-in" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, 150%)', background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)', animationDelay: `${i * 0.06 + 0.4}s` }}>{name}</span>
        ))}
      </div>
    </section>
  )
}

// ── Floor 2: the real panels assemble — no invented features, just Zaim's own ─
const CHIPS = [
  { icon: '🔍', label: 'Search', note: 'Filter this folder as you type.' },
  { icon: '💬', label: 'Conversation', note: 'A clean threaded view, not raw HTML.' },
  { icon: '🧑', label: 'Context', note: "Who they are — no invented data." },
  { icon: '🤖', label: 'Agents', note: 'A scoped key for Claude Code, Codex or Gemini.' },
  { icon: '📎', label: 'Files', note: 'Attach, preview, and download — inline.' },
  { icon: '🗂️', label: 'Spaces', note: 'Real folders, plus Unread & Today.' },
]
function Floor2() {
  const { ref, shown } = useReveal<HTMLDivElement>()
  const scatter = useMemo(() => {
    const rnd = mulberry32(7)
    return CHIPS.map(() => ({ x: (rnd() - 0.5) * 220, y: (rnd() - 0.5) * 110, r: (rnd() - 0.5) * 36, delay: rnd() * 0.45 }))
  }, [])
  return (
    <section ref={ref} className="max-w-6xl mx-auto px-6 py-20 md:py-28">
      <h2 className="text-2xl md:text-3xl font-extrabold text-center tracking-tight">One interface. Every part real.</h2>
      <p className="text-sm text-center mt-3 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>Not a moodboard — the panels Zaim actually ships with.</p>
      <div className="relative mt-16 h-[220px] md:h-[140px] overflow-hidden">
        <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-3 md:gap-4 content-center">
          {CHIPS.map((c, i) => (
            <div
              key={c.label}
              className="glass rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all ease-out"
              style={{
                transform: shown ? 'translate(0,0) rotate(0deg)' : `translate(${scatter[i].x}px, ${scatter[i].y}px) rotate(${scatter[i].r}deg)`,
                opacity: shown ? 1 : 0, transitionDuration: '900ms', transitionDelay: `${scatter[i].delay}s`,
              }}
            >
              <span className="text-base">{c.icon}</span><span className="text-sm font-bold">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
      {shown && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6 fade-in">
          {CHIPS.map((c) => (
            <div key={c.label} className="rounded-xl p-4" style={{ border: '1px solid var(--line)' }}>
              <div className="text-xs font-bold flex items-center gap-1.5">{c.icon} {c.label}</div>
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{c.note}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Landing({ onSignIn, onStart, authMode, closeAuth, onDone }: { onSignIn: () => void; onStart: () => void; authMode: null | 'login' | 'register'; closeAuth: () => void; onDone: () => void }) {
  const [introDone, setIntroDone] = useState(false)
  if (!introDone) return <Intro onDone={() => setIntroDone(true)} />

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
      <header className="max-w-6xl mx-auto px-6 pt-14 md:pt-20 pb-16 md:pb-24 grid md:grid-cols-[42fr_58fr] gap-10 md:gap-12 items-center fade-in">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-6" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
            <span className="w-1.5 h-1.5 rounded-full accent-grad" /> Secure mail, built for you and your AI
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95]">
            Email<br />should<br /><span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>think.</span><br />Not you.
          </h1>
          <p className="text-base mt-6 leading-relaxed" style={{ color: 'var(--muted)' }}>
            Zaim is a beautiful, private mail client that companies self-host like Outlook — plus an API and CLI so Claude Code, Codex and Gemini can read, draft and send your mail. Your inbox, your rules, your keys.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-8">
            <button onClick={onStart} className="accent-grad text-white font-bold px-6 py-3 rounded-xl hover:opacity-90 text-sm">Get started free</button>
            <a href="#floor-1" className="font-semibold px-6 py-3 rounded-xl text-sm hover:bg-white/5" style={{ border: '1px solid var(--line)' }}>See it think ↓</a>
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>No credit card · Bring your own mailbox · Passwords encrypted at rest</p>
        </div>
        <HeroVisual />
      </header>

      <div id="floor-1"><Floor1 /></div>
      <Floor2 />

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
