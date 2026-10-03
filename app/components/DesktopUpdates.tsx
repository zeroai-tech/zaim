'use client'
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
type UpdateState = { status: string; currentVersion: string; version?: string; progress?: number; error?: string }
type UpdateBridge = {
  state: () => Promise<UpdateState>; check: () => Promise<UpdateState>; download: () => Promise<UpdateState>; install: () => Promise<UpdateState>
  subscribe: (callback: (state: UpdateState) => void) => () => void
}
declare global { interface Window { zaimUpdates?: UpdateBridge } }
export function DesktopUpdates() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const bridge = window.zaimUpdates
    if (!bridge) return
    let live = true
    const update = (value: UpdateState) => { if (live) { setState(value); if (value.status === 'available' || value.status === 'ready') setOpen(true) } }
    bridge.state().then(update).catch(() => {})
    const unsubscribe = bridge.subscribe(update)
    const menu = (event: Event) => { if ((event as CustomEvent).detail === 'updates') { setOpen(true); setError(''); void bridge.check().catch(() => setError('Could not check for updates. Try again.')) } }
    window.addEventListener('zaim:menu', menu)
    return () => { live = false; unsubscribe(); window.removeEventListener('zaim:menu', menu) }
  }, [])
  if (!state || state.status === 'disabled' || !open) return null
  async function action() {
    setError('')
    const bridge = window.zaimUpdates
    if (!bridge || !state) return
    try {
      if (state.status === 'ready') {
        const pending: Promise<boolean>[] = []
        window.dispatchEvent(new CustomEvent('zaim:flush-drafts', { detail: { pending } }))
        if ((await Promise.all(pending)).some(saved => !saved)) throw new Error('Your draft could not be saved. Save it before restarting.')
        await bridge.install()
      } else if (state.status === 'available') await bridge.download()
      else await bridge.check()
    } catch (error) { setError((error as Error).message || 'Could not update. Try again.') }
  }
  const busy = ['checking', 'downloading', 'installing'].includes(state.status)
  const text = state.status === 'available' ? `Zaim ${state.version} is available.` : state.status === 'ready' ? `Zaim ${state.version} is ready to install.` : state.status === 'downloading' ? `Downloading update · ${state.progress || 0}%` : state.status === 'installing' ? 'Installing update…' : state.status === 'checking' ? 'Checking for updates…' : state.status === 'current' ? 'You have the latest version.' : 'Check for the latest Zaim updates.'
  return <aside className="desktop-update-panel" aria-label="Zaim updates" aria-live="polite">
    <div className="flex items-center gap-2"><Icon name="download" size={17} /><strong className="text-sm">Zaim updates</strong><button className="icon-button ml-auto" aria-label="Close updates" disabled={state.status === 'installing'} onClick={() => setOpen(false)}><Icon name="close" size={16} /></button></div>
    <p className="text-sm mt-2">{text}</p>
    <p className="text-xs text-[color:var(--muted)] mt-1">Installed version {state.currentVersion}</p>
    {state.status === 'downloading' && <progress className="w-full mt-3" max={100} value={state.progress || 0} aria-label="Update download progress" />}
    {(error || state.error) && <p role="alert" className="text-xs text-red-600 mt-2">{error || state.error}</p>}
    <button disabled={busy} onClick={action} className="primary-button mt-3 w-full justify-center">{state.status === 'ready' ? 'Restart and update' : state.status === 'available' ? 'Update' : busy ? 'Please wait…' : 'Check for updates'}</button>
    {state.status === 'ready' && <p className="text-xs text-[color:var(--muted)] mt-2">Your open draft will be saved before Zaim restarts.</p>}
  </aside>
}
