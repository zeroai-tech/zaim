'use client'
import { Folder, SmartView } from '@/lib/client-utils'

// The left "Spaces" rail. Real mailbox folders (Inbox/Sent/Drafts/Archive/…) are
// Spaces; Starred/Unread/Today are dynamic smart views layered on top of
// whichever folder is loaded, per the design brief's "Spaces vs. dynamic views"
// split. Attachments/Waiting/Needs Reply/Scheduled aren't here yet — they need
// data the mail API doesn't expose per-message yet (attachment presence in the
// list endpoint) or a feature that doesn't exist (send-later, reply-tracking).
export function SpacesPanel({
  folders, activeFolder, smartView, onSelectFolder, onSelectSmartView,
}: {
  folders: Folder[]; activeFolder: string; smartView: SmartView
  onSelectFolder: (key: string) => void; onSelectSmartView: (v: SmartView) => void
}) {
  const spaces = folders.filter((f) => f.key !== 'starred')
  const starred = folders.find((f) => f.key === 'starred')
  const rowCls = (active: boolean) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer text-left w-full ${active ? 'bg-white/5 text-white font-semibold' : 'text-[color:var(--muted)] hover:bg-white/5'}`

  return (
    <div className="h-full flex flex-col p-3 gap-1 overflow-y-auto">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] px-3 pt-2 pb-1">Spaces</div>
      {spaces.map((f) => (
        <button key={f.key} onClick={() => { onSelectSmartView(null); onSelectFolder(f.key) }} className={rowCls(!smartView && activeFolder === f.key)}>
          <span>{f.icon}</span>{f.label}
        </button>
      ))}

      <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--muted)] px-3 pt-4 pb-1">Smart Views</div>
      {starred && (
        <button onClick={() => { onSelectSmartView(null); onSelectFolder('starred') }} className={rowCls(!smartView && activeFolder === 'starred')}>
          <span>{starred.icon}</span>{starred.label}
        </button>
      )}
      <button onClick={() => { onSelectFolder('INBOX'); onSelectSmartView('unread') }} className={rowCls(smartView === 'unread')}>
        <span>●</span>Unread
      </button>
      <button onClick={() => { onSelectFolder('INBOX'); onSelectSmartView('today') }} className={rowCls(smartView === 'today')}>
        <span>◐</span>Today
      </button>
    </div>
  )
}
