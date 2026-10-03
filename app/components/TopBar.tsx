'use client'
import { useState, useEffect, useRef } from 'react'
import { Account, Avatar, Mark } from '@/lib/client-utils'
import { Icon } from './Icon'
export function TopBar({ accounts, activeAccount, activeEmail, activeLabel, email, avatar, onSwitchAccount, onAddAccount, onEditAccount, search, onSearch, onCompose, onShowKeys, onShowProfile, onLogout, panelState, onTogglePanel, onOpenDrawer, offline, dark, onTheme }: {
  accounts: Account[]; activeAccount: string; activeEmail: string; activeLabel: string; email: string; avatar: string
  onSwitchAccount: (id: string) => void; onAddAccount: () => void; onEditAccount: (id: string) => void
  search: string; onSearch: (v: string) => void; onCompose: () => void
  onShowKeys: () => void; onShowProfile: () => void; onLogout: () => void
  panelState: { spaces: boolean; context: boolean; ai: boolean }; onTogglePanel: (p: 'spaces' | 'context' | 'ai') => void; onOpenDrawer: () => void
  offline: boolean; dark: boolean; onTheme: () => void
}) {
  const [menu, setMenu] = useState<'account' | 'profile' | null>(null)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    function close(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setMenu(null) }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [])
  return <header className="mail-topbar" ref={ref}>
    <button className="icon-button md:hidden" aria-label="Folders" onClick={onOpenDrawer}><Icon name="menu" /></button>
    <button className="icon-button hidden md:flex" aria-label="Toggle folders" aria-pressed={panelState.spaces} onClick={() => onTogglePanel('spaces')}><Icon name="menu" /></button>
    <div className="mail-brand"><Mark /><span>Zaim<span className="brand-byline">by ZeroAI</span></span></div>
    <div className="relative"><button className="account-trigger" aria-label="Switch mailbox" aria-expanded={menu === 'account'} onClick={() => setMenu(menu === 'account' ? null : 'account')}><span className="hidden lg:block">{activeLabel}</span><Icon name="chevron" size={15} /></button>
      {menu === 'account' && <div className="mail-menu account-menu">{accounts.map(account => <div key={account.id} className="flex items-center"><button className="flex-1 min-w-0" onClick={() => { onSwitchAccount(account.id); setMenu(null) }}><span className="block font-semibold truncate">{account.label}</span><span className="block text-xs truncate text-[color:var(--muted)]">{account.email}</span></button>{account.id === activeAccount && <Icon name="check" />}<button aria-label={`Settings for ${account.label}`} onClick={() => { onEditAccount(account.id); setMenu(null) }}><Icon name="settings" size={16} /></button></div>)}<button onClick={() => { setMenu(null); onAddAccount() }}>Add another mailbox</button></div>}
    </div>
    <label className="mail-search hidden md:flex"><Icon name="search" size={17} /><input id="zaim-search" aria-label="Search this folder" value={search} onChange={e => onSearch(e.target.value)} placeholder="Search mail in this folder" /><kbd>⌘ F</kbd></label>
    <div className="ml-auto flex items-center gap-1 sm:gap-2">
      <span className={'mail-status hidden lg:flex ' + (offline ? 'is-offline' : '')}><span />{offline ? 'Cached mail' : 'Mailbox'}</span>
      <button className="primary-button compose-trigger" aria-label="Compose" onClick={onCompose}><Icon name="compose" size={17} /><span className="hidden sm:inline">Compose</span></button>
      <button className="icon-button hidden lg:flex" aria-label="Toggle contact details" aria-pressed={panelState.context} onClick={() => onTogglePanel('context')}><Icon name="info" /></button>
      <button className="icon-button hidden lg:flex" aria-label="Toggle assistant" aria-pressed={panelState.ai} onClick={() => onTogglePanel('ai')}><Icon name="bot" /></button>
      <button className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={onTheme}><Icon name={dark ? 'sun' : 'moon'} /></button>
      <div className="relative"><button className="profile-trigger" aria-label="Profile menu" aria-expanded={menu === 'profile'} onClick={() => setMenu(menu === 'profile' ? null : 'profile')}><Avatar src={avatar} name={email} cls="w-8 h-8 rounded-full" /></button>
        {menu === 'profile' && <div className="mail-menu profile-menu"><p>{email}</p><button onClick={() => { setMenu(null); onShowProfile() }}>Edit profile picture</button><a href={`https://mail.${activeEmail.split('@')[1] || 'zeroaitech.tech'}/`} target="_blank" rel="noopener noreferrer">Mailbox settings</a><button onClick={() => { setMenu(null); onShowKeys() }}>Connect an agent</button><button className="text-red-600" onClick={onLogout}>Sign out</button></div>}
      </div>
    </div>
  </header>
}
