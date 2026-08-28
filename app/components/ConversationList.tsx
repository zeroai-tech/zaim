'use client'
import { Msg, Avatar, emailOf, when } from '@/lib/client-utils'

export function ConversationList({
  messages, activeFolder, selUid, listLoading, folderTitle, onOpen, onRefresh, onDelete, deleting,
  hasMore, loadingMore, onLoadMore, search, onSearch
}: {
  messages: Msg[]; activeFolder: string; selUid: number | null; listLoading: boolean; folderTitle: string
  onOpen: (uid: number) => void; onRefresh: () => void; onDelete: (uid: number) => void; deleting: boolean
  hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void
  /** Search lives in the top bar on desktop; on a phone that bar has no room
   *  for it, so it belongs here above the messages it filters. */
  search: string; onSearch: (v: string) => void
}) {
  const isSentLike = activeFolder === 'sent' || activeFolder === 'drafts'
  const trashLabel = activeFolder === 'trash' ? 'Delete permanently' : 'Move to Trash'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between px-4 h-12">
          <h1 className="font-bold text-sm">{folderTitle}</h1>
          <button onClick={onRefresh} className="text-xs text-[color:var(--muted)] hover:text-white">↻ Refresh</button>
        </div>
        <div className="md:hidden px-3 pb-2.5">
          <div className="flex items-center gap-2 rounded-xl px-3 h-9" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
            <span className="text-[color:var(--muted)] text-sm">⌕</span>
            <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search this folder…"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-[color:var(--muted)]" />
            {search && <button onClick={() => onSearch('')} aria-label="Clear search" className="text-[color:var(--muted)] hover:text-white text-xs">✕</button>}
          </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 pb-8">
        {listLoading && <div className="p-4 text-sm text-[color:var(--muted)]">Loading…</div>}
        {!listLoading && messages.length === 0 && <div className="p-4 text-sm text-[color:var(--muted)]">Nothing here.</div>}
        {!listLoading && messages.map((m) => {
          const who = isSentLike ? m.to : (m.fromName || m.from)
          const active = selUid === m.uid
          // Row is a div (not a button) so the delete control can be a real
          // nested button — a button inside a button is invalid HTML. Keyboard
          // access is preserved via role/tabIndex + Enter/Space handling.
          return (
            <div
              key={m.uid}
              data-testid="conversation-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(m.uid)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(m.uid) } }}
              className={`group w-full cursor-pointer text-left px-3 py-2.5 rounded-xl flex gap-3 items-start transition ${active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]'}`}
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
              <button
                data-testid="row-delete-button"
                title={trashLabel}
                disabled={deleting}
                onClick={(e) => { e.stopPropagation(); onDelete(m.uid) }}
                className="mt-0.5 shrink-0 w-6 h-6 grid place-items-center rounded-md text-[color:var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/10 hover:text-red-400 disabled:opacity-50 transition"
              >🗑</button>
            </div>
          )
        })}
        {hasMore && !listLoading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="mt-2 w-full py-2.5 text-sm font-medium text-[color:var(--muted)] hover:text-white hover:bg-white/[0.035] rounded-xl transition disabled:opacity-50"
          >
            {loadingMore ? 'Loading older messages...' : 'Load older messages'}
          </button>
        )}
      </div>
    </div>
  )
}
