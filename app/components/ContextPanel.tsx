'use client'
import { Full, Msg, Avatar, emailOf } from '@/lib/client-utils'

// Real, minimal contact context — no invented data. Contact/company enrichment,
// invoices, calendar, and shared files (per the design brief) need backends that
// don't exist yet (a contacts store, calendar integration, a documents index),
// so this only surfaces what the graph actually has: who they are and how often
// they show up in what's currently loaded.
export function ContextPanel({ sel, messages }: { sel: Full | null; messages: Msg[] }) {
  if (!sel) {
    return <div className="h-full grid place-items-center text-center px-6">
      <p className="text-xs text-[color:var(--muted)]">Open a message to see context about who it's from.</p>
    </div>
  }
  const senderEmail = emailOf(sel.from)
  const fromThisSender = messages.filter((m) => emailOf(m.from) === senderEmail)
  const unreadFromThisSender = fromThisSender.filter((m) => !m.seen).length

  return (
    <div className="h-full overflow-y-auto p-5 flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-2 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <Avatar email={senderEmail} name={sel.fromName || sel.from} cls="w-16 h-16 rounded-full text-lg" txt="text-lg" />
        <div><div className="text-sm font-bold">{sel.fromName || sel.from}</div><div className="text-xs text-[color:var(--muted)]">{sel.from}</div></div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-2">In this folder</div>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)' }}><span className="text-[color:var(--muted)]">Messages from them</span><span className="font-semibold">{fromThisSender.length}</span></div>
          <div className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)' }}><span className="text-[color:var(--muted)]">Unread from them</span><span className="font-semibold">{unreadFromThisSender}</span></div>
          {sel.cc && <div className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)' }}><span className="text-[color:var(--muted)]">Cc</span><span className="font-semibold truncate max-w-[140px]">{sel.cc}</span></div>}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] mb-2">Coming later</div>
        <p className="text-[11px] text-[color:var(--muted)] leading-relaxed">Company/contact profiles, invoices, calendar, and shared files need their own data sources (a contacts store, calendar sync, a documents index) that don't exist yet — this panel will grow into those once those exist, rather than showing placeholder data now.</p>
      </div>
    </div>
  )
}
