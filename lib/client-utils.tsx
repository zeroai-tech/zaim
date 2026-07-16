'use client'
import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared client-side types, fetch helpers, formatters, and small presentational
//  components used across the app shell (TopBar, SpacesPanel, ConversationList,
//  ReadingCanvas, ContextPanel) so no single file owns all of it.
// ─────────────────────────────────────────────────────────────────────────────

export type Msg = { uid: number; subject: string; from: string; fromName: string; to: string; date: string; seen: boolean; flagged: boolean }
export type Full = Msg & { html: string | null; text: string | null; cc?: string; attachments?: { filename: string; contentType: string; size: number }[] }
export type Att = { name: string; size: number; content: string; contentType: string }
export type ComposeInit = { to: string; subject: string; cc?: string; html?: string; attachments?: Att[]; draft?: { uid: number; mailbox: string } }
export type Account = { id: string; label: string; email: string; isDefault: boolean }
export type Folder = { key: string; label: string; icon: string; path: string }
export type SmartView = 'unread' | 'today' | null

export const api = (path: string, init?: RequestInit) =>
  fetch(path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers || {}) } }).then((r) => r.json())
export const q = (params: Record<string, string | undefined>) =>
  '?' + Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')

export function initials(name: string) {
  const p = (name || '?').replace(/[<>"]/g, '').trim().split(/[\s@.]+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}
export function when(d: string) {
  const t = new Date(d), now = new Date()
  return t.toDateString() === now.toDateString() ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : t.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
const AV = ['#5b8cff', '#ff7a9c', '#4dd4ac', '#f6bd60', '#b892ff', '#5ec4e6']
export const avatarColor = (s: string) => AV[[...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]
export const emailOf = (s: string) => { const m = /<([^>]+)>/.exec(s || ''); return (m ? m[1] : (s || '')).trim().toLowerCase() }
export const fmtSize = (n: number) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
export const readB64 = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] || ''); r.readAsDataURL(f) })
export const isToday = (d: string) => new Date(d).toDateString() === new Date().toDateString()

// Avatar: an explicitly-set picture (this user's own upload) wins; otherwise we
// try the sender's Gravatar (free, per-address, works for anyone who has one);
// otherwise a coloured initials badge. Falls back gracefully on any miss.
export function Avatar({ src, email, name, cls, txt = 'text-xs' }: { src?: string | null; email?: string; name: string; cls: string; txt?: string }) {
  const [grav, setGrav] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setBad(false)
    if (src || !email || typeof crypto === 'undefined' || !crypto.subtle) { setGrav(null); return }
    let on = true
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
      .then((buf) => { if (on) setGrav('https://www.gravatar.com/avatar/' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') + '?d=404&s=96') })
      .catch(() => {})
    return () => { on = false }
  }, [src, email])
  const use = src || grav
  if (use && !bad) return <img src={use} alt="" onError={() => setBad(true)} className={`${cls} object-cover shrink-0`} />
  return <span className={`${cls} grid place-items-center ${txt} font-bold text-white shrink-0`} style={{ background: avatarColor(name || email || '?') }}>{initials(name || email || '?')}</span>
}

export function Mark({ big }: { big?: boolean }) { return <span className={`${big ? 'w-9 h-9 text-lg rounded-xl' : 'w-7 h-7 text-sm rounded-lg'} accent-grad grid place-items-center text-white font-black`}>Z</span> }

export const field = 'w-full bg-[color:var(--panel-2)] border rounded-xl px-4 py-3 text-sm outline-none focus:border-[color:var(--accent)]'

// A panel that slides open/shut by animating width instead of unmounting, so it
// reads as "sliding" per the design brief rather than popping in and out.
export function Collapsible({ open, width, side = 'left', children }: { open: boolean; width: number; side?: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <div
      className="h-full overflow-hidden shrink-0 transition-[width] duration-200 ease-out"
      style={{ width: open ? width : 0, borderRight: side === 'left' ? (open ? '1px solid var(--line)' : 'none') : undefined, borderLeft: side === 'right' ? (open ? '1px solid var(--line)' : 'none') : undefined }}
    >
      <div style={{ width }} className="h-full">{children}</div>
    </div>
  )
}
