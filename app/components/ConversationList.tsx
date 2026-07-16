'use client'
import { Msg, Avatar, emailOf, when } from '@/lib/client-utils'

export function ConversationList({
  messages, activeFolder, selUid, listLoading, folderTitle, onOpen, onRefresh,
}: {
  messages: Msg[]; activeFolder: string; selUid: number | null; listLoading: boolean; folderTitle: string
  onOpen: (uid: number) => void; onRefresh: () => void
}) {
  const isSentLike = activeFolder === 'sent' || activeFolder === 'drafts'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        <h1 className="font-bold text-sm">{folderTitle}</h1>
        <button onClick={onRefresh} className="text-xs text-[color:var(--muted)] hover:text-white">↻ Refresh</button>
      </header>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {listLoading && <div className="p-4 text-sm text-[color:var(--muted)]">Loading…</div>}
        {!listLoading && messages.length === 0 && <div className="p-4 text-sm text-[color:var(--muted)]">Nothing here.</div>}
        {!listLoading && messages.map((m) => {
          const who = isSentLike ? m.to : (m.fromName || m.from)
          const active = selUid === m.uid
          return (
            <button
              key={m.uid}
              data-testid="conversation-card"
              onClick={() => onOpen(m.uid)}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex gap-3 items-start transition ${active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]'}`}
              style={{ border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}` }}
            >
              <Avatar email={emailOf(isSentLike ? m.to : m.from)} name={who} cls="w-9 h-9 rounded-full text-xs" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${m.seen ? 'font-medium text-[color:var(--muted)]' : 'font-bold'}`}>{isSentLike ? 'To: ' + who : who}</span>
                  <span className="text-[11px] text-[color:var(--muted)] shrink-0">{when(m.date)}</span>
                </span>
                <span className={`block truncate text-[13px] mt-0.5 ${m.seen ? 'text-[color:var(--muted)]' : 'text-white'}`}>{m.flagged && '⭐ '}{m.subject}</span>
              </span>
              {!m.seen && <span className="mt-2 w-2 h-2 rounded-full accent-grad shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
