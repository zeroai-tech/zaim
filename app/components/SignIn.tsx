'use client'
import { useState } from 'react'
import { api, Mark } from '@/lib/client-utils'

// The sign-in form, on its own.
//
// This logic used to live inside Landing.tsx as a modal floating over the
// marketing page, which meant the desktop app had to render an entire website
// in order to show a password field. It is the same form either way, so it
// lives here and both shells use it: the website opens it over the landing
// page, the desktop app fills its window with it.

export function SignInForm({ onDone, autoFocus = false }: { onDone: () => void; autoFocus?: boolean }) {
  // ZaiPanel links here as `?email=someone@domain` when an admin opens a
  // mailbox, the way cPanel opens RoundCube. Only the address is passed; the
  // person still types their own mailbox password, so the panel never handles
  // anyone's credentials.
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return ''
    const q = new URLSearchParams(window.location.search).get('email') || ''
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q) ? q.toLowerCase() : ''
  })
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Only shown when we genuinely cannot work out where this address's mail
  // lives. Never for a mailbox on our own server.
  const [needsServer, setNeedsServer] = useState(false)
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')

  async function go() {
    setErr('')
    const em = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return setErr('Please enter a valid email address.')
    if (!pw) return setErr('Please enter your mailbox password.')
    if (needsServer && !imapHost.trim()) return setErr('Enter your incoming (IMAP) mail server.')

    setBusy(true)
    const payload: Record<string, unknown> = { email: em, password: pw }
    if (needsServer) {
      Object.assign(payload, {
        imapHost: imapHost.trim(), imapPort: +imapPort || 993,
        smtpHost: smtpHost.trim() || undefined, smtpPort: +smtpPort || 465,
      })
    }

    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) })
    if (r.ok) { setBusy(false); return onDone() }
    if (r.needsMailServer) {
      setBusy(false); setNeedsServer(true)
      setErr(r.error || 'Enter your mail server details to continue.')
      return
    }

    // A slow cold start can time the response out after the cookie was already
    // set, so re-check before showing a failure. Otherwise a successful
    // sign-in gets reported as a wrong password.
    const me = await api('/api/auth/me')
    setBusy(false)
    if (me?.user) return onDone()
    setErr(r.error || 'Something went wrong, please try again.')
  }

  const field = 'w-full bg-[color:var(--panel-2)] border rounded-xl px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]'
  const line = { borderColor: 'var(--line)' as const }

  return (
    <>
      <div className="flex flex-col gap-3">
        <input
          className={field} style={line} autoFocus={autoFocus}
          placeholder="you@yourdomain.com" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && go()}
        />
        <input
          className={field} style={line} type="password"
          placeholder="mailbox password" autoComplete="current-password"
          value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && !needsServer && go()}
        />

        {needsServer && (
          <div className="flex flex-col gap-2 pt-1 fade-in">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Your mail server, from your email provider:
            </p>
            <div className="flex gap-2">
              <input className={field} style={{ ...line, flex: 3 }} placeholder="imap.provider.com" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
              <input className={field} style={{ ...line, flex: 1, minWidth: 0 }} placeholder="993" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <input className={field} style={{ ...line, flex: 3 }} placeholder="smtp.provider.com (optional)" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              <input className={field} style={{ ...line, flex: 1, minWidth: 0 }} placeholder="465" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {err && <p className="text-xs text-red-400 mt-3">{err}</p>}

      <button
        disabled={busy} onClick={go}
        className="accent-grad text-white font-bold rounded-xl py-3 w-full mt-4 hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Checking your mailbox…' : 'Sign in'}
      </button>
    </>
  )
}

/**
 * The desktop application's first screen.
 *
 * No navigation, no hero, no feature grid and above all no download link. This
 * is what opens when someone launches an app they have already installed, so
 * the only thing it owes them is the way in, plus an honest word about where
 * their mail is going to live.
 */
export function DesktopSignIn({ onDone }: { onDone: () => void }) {
  return (
    <div className="h-screen grid place-items-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8">
          <Mark />
          <span className="font-extrabold text-lg tracking-tight">Zaim</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider px-2 py-1 rounded" style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>
            Desktop
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Sign in to your mailbox</h1>
        <p className="text-sm text-[color:var(--muted)] mt-2 mb-6 leading-relaxed">
          Your email address and its password, the ones your mail server already knows.
          There is no Zaim account to create.
        </p>

        <SignInForm onDone={onDone} autoFocus />

        <div className="mt-8 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">
            Mail is fetched straight from your server to this machine. Your password is
            encrypted on this device and never sent to us, because there is no us in the
            middle: nothing here reaches a Zaim server.
          </p>
          <p className="text-[11px] text-[color:var(--muted)] leading-relaxed mt-2">
            Forgotten the password? Your mail administrator can reset it.
          </p>
        </div>
      </div>
    </div>
  )
}
