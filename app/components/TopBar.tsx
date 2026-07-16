'use client'
import { useState } from 'react'
import { Account, Avatar, Mark, avatarColor, initials } from '@/lib/client-utils'

export function TopBar({
  accounts, activeAccount, activeEmail, activeLabel, email, avatar,
  onSwitchAccount, onAddAccount,
  search, onSearch,
  onCompose,
  onShowKeys, onShowProfile, onLogout,
  panelState, onTogglePanel,
}: {
  accounts: Account[]; activeAccount: string; activeEmail: string; activeLabel: string; email: string; avatar: string
  onSwitchAccount: (id: string) => void; onAddAccount: () => void
  search: string; onSearch: (v: string) => void
  onCompose: () => void
  onShowKeys: () => void; onShowProfile: () => void; onLogout: () => void
  panelState: { spaces: boolean; context: boolean; ai: boolean }
  onTogglePanel: (p: 'spaces' | 'context' | 'ai') => void
}) {
  const [acctMenu, setAcctMenu] = useState(false)
  const [profMenu, setProfMenu] = useState(false)
  const toggleBtn = 'w-8 h-8 rounded-lg grid place-items-center text-sm hover:bg-white/5 transition shrink-0'

  return (
    <header className="h-[72px] shrink-0 flex items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
      <button onClick={() => onTogglePanel('spaces')} title="Toggle Spaces" className={toggleBtn + (panelState.spaces ? ' text-white' : ' text-[color:var(--muted)]')}>☰</button>
      <div className="flex items-center gap-2 mr-1"><Mark /><span className="font-extrabold tracking-tight text-[15px] hidden sm:inline">Zaim</span></div>

      {/* Account switcher */}
      <div className="relative">
        <button onClick={() => setAcctMenu((v) => !v)} className="flex items-center gap-2 rounded-xl pl-1.5 pr-2.5 py-1.5 hover:bg-white/5 transition text-left" style={{ border: '1px solid var(--line)' }}>
          <span className="w-6 h-6 rounded-md grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(activeEmail) }}>{initials(activeEmail)}</span>
          <span className="min-w-0 hidden md:block"><span className="block text-xs font-semibold truncate max-w-[140px]">{activeLabel}</span></span>
          <span className="text-[color:var(--muted)] text-[10px]">{acctMenu ? '▲' : '▼'}</span>
        </button>
        {acctMenu && (
          <div className="absolute z-20 left-0 top-[42px] w-64 glass rounded-xl p-1.5 shadow-xl fade-in" style={{ border: '1px solid var(--line)' }}>
            {accounts.map((a) => (
              <button key={a.id} onClick={() => { onSwitchAccount(a.id); setAcctMenu(false) }} className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 ${a.id === activeAccount ? 'bg-white/5' : ''}`}>
                <span className="w-6 h-6 rounded-md grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(a.email) }}>{initials(a.email)}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold truncate">{a.label}</span><span className="block text-[10px] text-[color:var(--muted)] truncate">{a.email}</span></span>
                {a.id === activeAccount && <span className="text-[color:var(--accent)] text-xs">✓</span>}
              </button>
            ))}
            <button onClick={() => { setAcctMenu(false); onAddAccount() }} className="w-full text-left rounded-lg px-2 py-2 text-xs text-[color:var(--muted)] hover:bg-white/5 hover:text-white">+ Add another mailbox</button>
          </div>
        )}
      </div>

      {/* Search — filters the currently loaded conversation list by subject/sender */}
      <div className="flex-1 max-w-xl mx-2">
        <div className="flex items-center gap-2 rounded-xl px-3 h-9" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
          <span className="text-[color:var(--muted)] text-sm">⌕</span>
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search this folder…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--muted)]" />
          {search && <button onClick={() => onSearch('')} className="text-[color:var(--muted)] hover:text-white text-xs">✕</button>}
        </div>
      </div>

      <button onClick={onCompose} className="accent-grad text-white font-bold rounded-xl px-4 py-2 text-sm hover:opacity-90 transition shrink-0">✏️ Compose</button>

      <button onClick={() => onTogglePanel('context')} title="Toggle context panel" className={toggleBtn + (panelState.context ? ' text-white' : ' text-[color:var(--muted)]')}>ⓘ</button>
      <button onClick={() => onTogglePanel('ai')} title="Toggle AI assistant" className={toggleBtn + (panelState.ai ? ' text-white' : ' text-[color:var(--muted)]')}>✦</button>

      {/* Profile */}
      <div className="relative ml-1">
        <button onClick={() => setProfMenu((v) => !v)} className="rounded-full hover:opacity-80 transition shrink-0">
          <Avatar src={avatar} name={email} cls="w-8 h-8 rounded-full text-[11px]" />
        </button>
        {profMenu && (
          <div className="absolute z-20 right-0 top-[42px] w-56 glass rounded-xl p-1.5 shadow-xl fade-in" style={{ border: '1px solid var(--line)' }}>
            <div className="px-2.5 py-2 text-xs text-[color:var(--muted)] truncate">{email}</div>
            <button onClick={() => { setProfMenu(false); onShowProfile() }} className="w-full text-left rounded-lg px-2.5 py-2 text-xs hover:bg-white/5">✎ Edit profile picture</button>
            <button onClick={() => { setProfMenu(false); onShowKeys() }} className="w-full text-left rounded-lg px-2.5 py-2 text-xs hover:bg-white/5">🔑 Agent keys</button>
            <button onClick={onLogout} className="w-full text-left rounded-lg px-2.5 py-2 text-xs text-red-400 hover:bg-white/5">Sign out</button>
          </div>
        )}
      </div>
    </header>
  )
}
