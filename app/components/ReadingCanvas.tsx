'use client'
import { Att, ComposeInit, Full, Account, Folder, Avatar, emailOf, fmtSize, q } from '@/lib/client-utils'
import { Compose } from './Compose'

function Empty() {
  return <div className="h-full grid place-items-center text-center px-8"><div className="opacity-70">
    <div className="mx-auto mb-4 w-14 h-14 rounded-2xl accent-grad grid place-items-center text-white text-2xl font-black">Z</div>
    <div className="font-bold text-lg">Select a message</div><div className="text-sm text-[color:var(--muted)] mt-1">Secure mail, ready for you and your agents.</div>
  </div></div>
}

export function ReadingCanvas({
  sel, selUid, activeFolder, folders, activeAccount, loadingDraft, onEditDraft, onReply,
  compose, from, account, onComposeClose, onComposeSent,
}: {
  sel: Full | null; selUid: number | null; activeFolder: string; folders: Folder[]; activeAccount: string
  loadingDraft: boolean; onEditDraft: () => void; onReply: () => void
  compose: ComposeInit | null; from?: string; account: string; onComposeClose: () => void; onComposeSent: () => void
}) {
  if (compose) return <Compose initial={compose} from={from} account={account} onClose={onComposeClose} onSent={onComposeSent} />
  if (!sel && selUid == null) return <Empty />
  if (!sel && selUid != null) return <div className="p-8 text-sm text-[color:var(--muted)]">Opening…</div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[900px] mx-auto px-8 py-10 fade-in">
        <h2 className="text-2xl font-bold leading-snug">{sel!.subject}</h2>
        <div className="flex items-center gap-3 mt-5 pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <Avatar email={emailOf(sel!.from)} name={sel!.fromName || sel!.from} cls="w-11 h-11 rounded-full text-sm" txt="text-sm" />
          <div className="min-w-0"><div className="text-sm font-semibold truncate">{sel!.fromName || sel!.from}</div><div className="text-xs text-[color:var(--muted)] truncate">{sel!.from} · to {sel!.to}</div></div>
          <span className="ml-auto text-xs text-[color:var(--muted)] shrink-0">{new Date(sel!.date).toLocaleString()}</span>
          {activeFolder === 'drafts'
            ? <button onClick={onEditDraft} disabled={loadingDraft} className="text-xs font-semibold px-3 py-1.5 rounded-lg accent-grad text-white hover:opacity-90 disabled:opacity-50 shrink-0">{loadingDraft ? 'Loading…' : '✏️ Edit & Send'}</button>
            : <button data-testid="reply-button" onClick={onReply} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 shrink-0">↩ Reply</button>}
        </div>

        {sel!.attachments && sel!.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
            {sel!.attachments.map((a, i) => (
              <a key={i} download href={'/api/mail/attachment' + q({ uid: String(sel!.uid), mailbox: folders.find((f) => f.key === activeFolder)?.path || 'INBOX', index: String(i), account: activeAccount })}
                className="flex items-center gap-2 rounded-lg pl-2.5 pr-3 py-1.5 text-xs hover:bg-white/5 transition" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                <span className="text-sm">📎</span>
                <span className="max-w-[220px] truncate font-medium">{a.filename}</span>
                <span className="text-[color:var(--muted)]">{fmtSize(a.size)}</span>
                <span className="text-[color:var(--accent)]">↓</span>
              </a>
            ))}
          </div>
        )}

        <div className="rounded-2xl overflow-hidden mt-6" style={{ border: '1px solid var(--line)' }}>
          <iframe title="message" sandbox="" className="w-full bg-white" style={{ height: '60vh' }} srcDoc={sel!.html || `<pre style="font-family:system-ui;white-space:pre-wrap;padding:24px;color:#111">${(sel!.text || '').replace(/</g, '&lt;')}</pre>`} />
        </div>
      </div>
    </div>
  )
}
