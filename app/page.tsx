'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Msg, Full, Att, ComposeInit, Account, Folder, SmartView,
  api, q, isToday,
  Avatar, Mark, Collapsible, Drawer, field,
} from '@/lib/client-utils'
import { TopBar } from './components/TopBar'
import { SpacesPanel } from './components/SpacesPanel'
import { ConversationList } from './components/ConversationList'
import { ReadingCanvas } from './components/ReadingCanvas'
import { ContextPanel } from './components/ContextPanel'
import { AIPanel } from './components/AIPanel'
import { VoicePanel } from './components/VoicePanel'
import { Landing } from './components/Landing'
import { DesktopSignIn } from './components/SignIn'
import { Icon } from './components/Icon'
import { isDesktop } from '@/lib/platform'
import { isZeroAIEmail } from '@/lib/managed-mail'

export default function Zaim() {
  const [phase, setPhase] = useState<'loading' | 'auth' | 'add-account' | 'app'>('loading')
  // Resolved after mount: the server has no user agent, and guessing wrong on
  // the server would hydrate the wrong shell.
  const [desktop, setDesktop] = useState(false)
  useEffect(() => { setDesktop(isDesktop()) }, [])
  const [authOpen, setAuthOpen] = useState(true)
  const [email, setEmail] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolder, setActiveFolder] = useState('INBOX')
  const [smartView, setSmartView] = useState<SmartView>(null)
  const [search, setSearch] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [sel, setSel] = useState<Full | null>(null)
  const [selUid, setSelUid] = useState<number | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [compose, setCompose] = useState<null | ComposeInit>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [avatar, setAvatar] = useState<string>('')
  const [showProfile, setShowProfile] = useState(false)
  const [editAccount, setEditAccount] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0) // bump to re-discover folders + reload mail (e.g. after repointing a mailbox's server)
  const [panelState, setPanelState] = useState({ spaces: true, context: false, ai: false })
  // Which single pane a phone is showing. Desktop ignores this entirely and
  // keeps every column visible.
  const [mobilePane, setMobilePane] = useState<'list' | 'reader'>('list')
  const [drawer, setDrawer] = useState(false)
  const [handoff, setHandoff] = useState<null | { want: string; current: string }>(null)
  const [legacySession, setLegacySession] = useState(false)
  const [offline,setOffline] = useState(false)
  const [listError,setListError] = useState('')
  const [readerError,setReaderError] = useState('')
  const [downloadStatus,setDownloadStatus] = useState('')
  const [downloading,setDownloading] = useState(false)
  const [dark,setDark] = useState(false)
  const readSeq = useRef(0)
  useEffect(()=>{try {const saved=localStorage.getItem('zaim-theme');setDark(saved==='dark');document.documentElement.dataset.theme=saved==='dark'?'dark':'light'}catch{}},[])
  function toggleTheme(){setDark(value=>{const next=!value;document.documentElement.dataset.theme=next?'dark':'light';try{localStorage.setItem('zaim-theme',next?'dark':'light')}catch{}return next})}


  const refreshMe = useCallback(async () => {
    const me = await api('/api/auth/me')
    if (typeof me.desktop === 'boolean') setDesktop(me.desktop)
    if (me.networkError || me.error) { setListError(me.error || 'Could not reach your local mail server.'); setPhase('auth'); return }
    if (!me.user) { setPhase('auth'); return }
    setEmail(me.user.email)
    setAvatar(me.user.avatar || '')
    const accs: Account[] = me.accounts || []
    setAccounts(accs)

    // ZaiPanel opens a specific mailbox as `?email=<addr>`. Prefilling the sign-in
    // form isn't enough: if a session already exists the form never renders, and
    // the click silently lands in whatever inbox was already open. So resolve the
    // request against the mailboxes this session can actually reach.
    const want = (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('email') || '' : '').toLowerCase()
    const clearWant = () => {
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname)
    }
    let target = ''
    if (want) {
      const match = accs.find((a) => a.email.toLowerCase() === want)
      if (match) { target = match.id; clearWant() }
      else { setHandoff({ want, current: me.user.email }) }   // different mailbox — ask
    }

    setActiveAccount((cur) => target || (cur && accs.some((a) => a.id === cur) ? cur
      : (accs.find((a) => a.isDefault)?.id || accs[0]?.id || '')))

    // A session created before mailbox sign-in existed has no sealed mailbox, so
    // it still runs on stored IMAP/SMTP credentials. Nothing breaks, but the
    // person is on the old path without knowing it — offer the one-click fix.
    setLegacySession(accs.length > 0 && !accs.some((a) => a.id === 'mailbox'))

    // No mailbox at all means this session predates mailbox sign-in and its
    // saved accounts are gone — there is nothing to show. The old "connect a
    // mailbox" form is the wrong answer here: it asks for IMAP/SMTP details
    // that signing in no longer needs, and it strands anyone who simply
    // removed their old accounts. Send them to sign in instead.
    if (!accs.length) {
      await api('/api/auth/logout', { method: 'POST' })
      setAccounts([]); setPhase('auth'); return
    }

    setPhase('app')
  }, [])
  useEffect(() => { refreshMe() }, [refreshMe])

  // Discover this account's real folders (Sent/Drafts/… differ per provider).
  useEffect(() => {
    if (phase !== 'app' || !activeAccount) return
    let live=true
    setFolders([{ key:'INBOX',label:'Inbox',icon:'inbox',path:'INBOX' }, ...(desktop ? [{key:'local-drafts',label:'Local drafts',icon:'draft',path:'local-drafts'}] : [])])
    api('/api/mail/folders'+q({account:activeAccount,offline:offline?'1':undefined})).then(r=>{
      if(!live)return
      if(r.ok){setFolders([...r.folders,...(desktop?[{key:'local-drafts',label:'Local drafts',icon:'draft',path:'local-drafts'}]:[])]);if(r.cached)setOffline(true)}
    })
    return ()=>{live=false}
  }, [phase, activeAccount, reloadTick, desktop])

  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadSeq = useRef(0)
  
  // Resolve to the mailbox *path* (a stable string), not the folders array itself —
  // once the real folder list arrives it's a new array reference even when the
  // path for the active folder hasn't changed, which used to re-trigger a fully
  // redundant duplicate fetch of the same list right after the first one ran.
  const activeMailbox = folders.find((x) => x.key === activeFolder)?.path || 'INBOX'
  const load = useCallback((isLoadMore = false, forceLive = false) => {
    if (!activeAccount) return
    const seq = ++loadSeq.current
    if (!isLoadMore) {
      setListLoading(true); setListError('')
    } else {
      setLoadingMore(true)
    }
    
    const targetPage = isLoadMore ? page + 1 : 1
    api(activeFolder === 'local-drafts' ? '/api/local/drafts'+q({account:activeAccount}) : '/api/mail/list' + q({ offline: !forceLive && offline ? '1' : undefined, limit: '40', page: String(targetPage), mailbox: activeMailbox, flagged: activeFolder === 'starred' ? '1' : undefined, account: activeAccount }))
      .then((r) => { 
        if (seq === loadSeq.current) {
          if(!r.ok){setListError(r.error || 'Could not refresh your mailbox.');setHasMore(false);return}
          if(activeFolder !== 'local-drafts') setOffline(!!r.cached)
          const newMsgs = r.messages || []
          setMessages(isLoadMore ? (prev) => [...prev, ...newMsgs] : newMsgs)
          setHasMore(activeFolder !== 'local-drafts' && newMsgs.length === 40)
          if (isLoadMore) setPage(targetPage)
          else setPage(1)
        }
      })
      .finally(() => { 
        if (seq === loadSeq.current) {
          setListLoading(false)
          setLoadingMore(false)
        }
      })
  }, [activeAccount, activeFolder, activeMailbox, page, offline])
  
  useEffect(() => { if (phase === 'app') load() }, [phase, activeAccount, activeFolder, activeMailbox])

  // Commands from the native menu bar (New Message, Refresh, Find, panels).
  //
  // The menu dispatches a DOM event rather than talking over IPC, which keeps
  // the preload surface at nothing: the shell can already run script in this
  // page, so a bridge would add reach without adding capability.
  useEffect(() => {
    if (phase !== 'app') return
    function onMenu(e: Event) {
      const action = (e as CustomEvent<string>).detail
      if (action === 'compose') { setCompose({ to: '', subject: '' }); showReader(); return }
      if (action === 'refresh') { load(); return }
      if (action === 'keys') { setShowKeys(true); return }
      if (action === 'profile') { setShowProfile(true); return }
      if (action === 'search') {
        const el = document.getElementById('zaim-search') as HTMLInputElement | null
        el?.focus(); el?.select()
        return
      }
      if (action.startsWith('panel:')) {
        const p = action.slice(6) as 'spaces' | 'context' | 'ai'
        setPanelState((st) => ({ ...st, [p]: !st[p] }))
      }
    }
    window.addEventListener('zaim:menu', onMenu)
    return () => window.removeEventListener('zaim:menu', onMenu)
  }, [phase, load])

  async function open(uid: number) {
    const sequence=++readSeq.current
    setSelUid(uid);setSel(null);setReaderError('')
    if(activeFolder==='local-drafts'){
      const result=await api('/api/local/drafts'+q({account:activeAccount}))
      const draft=result.drafts?.find((item:{id:number})=>item.id===uid)
      if(sequence!==readSeq.current)return
      if(!draft){setReaderError(result.error||'Local draft not found.');return}
      setSel({uid:draft.id,subject:draft.subject||'(no subject)',from:email,fromName:'Local draft',to:draft.to,date:draft.updatedAt,seen:true,flagged:false,html:draft.html,text:null,cc:draft.cc})
      return
    }
    const result=await api(`/api/mail/message/${uid}`+q({mailbox:activeMailbox,account:activeAccount,offline:offline?'1':undefined}))
    if(sequence!==readSeq.current)return
    if(result.ok){setSel(result.message);if(result.cached)setOffline(true);if(!result.cached)setMessages(list=>list.map(item=>item.uid===uid?{...item,seen:true}:item))}
    else setReaderError(result.error||'This message has not been downloaded. Reconnect to load it.')
  }
  async function downloadFolder(){
    setDownloading(true);setDownloadStatus('')
    let downloaded=0
    // Download only the currently loaded messages; do not change unread flags.
    for(const message of messages){
      const result=await api(`/api/mail/message/${message.uid}`+q({mailbox:activeMailbox,account:activeAccount,download:'1'}))
      if(!result.ok || result.cached){setDownloadStatus('Download interrupted. Reconnect and try again.');break}
      downloaded++
      for(let index=0;index<(result.message.attachments?.length||0);index++){
        const attachment=await fetch('/api/mail/attachment'+q({uid:String(message.uid),mailbox:activeMailbox,index:String(index),account:activeAccount}),{credentials:'include'})
        if(!attachment.ok)setDownloadStatus('Some attachments could not be downloaded. Reconnect and retry.')
      }
    }
    setDownloadStatus(previous=>previous||`${downloaded} messages and their available attachments saved on this device.`)
    setDownloading(false)
  }
  // Load a draft (recipient, Cc, body, attachments) into the composer to send.
  async function editDraft() {
    if (!sel) return
    if(activeFolder==='local-drafts'){
      const result=await api('/api/local/drafts'+q({account:activeAccount}))
      const draft=result.drafts?.find((item:{id:number})=>item.id===sel.uid)
      if(draft)setCompose({to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,html:draft.html,localDraftId:draft.id,attachments:(draft.attachments||[]).map((item:{filename:string;content:string;contentType:string})=>({name:item.filename,content:item.content,contentType:item.contentType,size:Math.floor(item.content.length*3/4)}))})
      else setReaderError('Could not open this local draft.')
      return
    }
    setLoadingDraft(true)
    const mailbox = folders.find((f) => f.key === activeFolder)?.path || 'INBOX'
    const attachments: Att[] = []
    // A failed or slow attachment fetch (IMAP hiccup, timeout) used to leave
    // loadingDraft stuck true forever with no error — the button just hung on
    // "Loading..." with no way to retry. Always land back in an idle state.
    try {
      for (let i = 0; i < (sel.attachments?.length || 0); i++) {
        const meta = sel.attachments![i]
        const res = await fetch('/api/mail/attachment' + q({ uid: String(sel.uid), mailbox, index: String(i), account: activeAccount, offline: offline?'1':undefined }), { credentials: 'include' })
        if (!res.ok) throw new Error(`Could not load attachment "${meta.filename}" — please try again.`)
        const blob = await res.blob()
        const content = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r((fr.result as string).split(',')[1] || ''); fr.readAsDataURL(blob) })
        attachments.push({ name: meta.filename, size: meta.size, content, contentType: meta.contentType })
      }
      setCompose({ to: sel.to, cc: sel.cc, subject: sel.subject, html: sel.html || '', text: sel.text || undefined, attachments, draft: { uid: sel.uid, mailbox } })
    } catch (e) {
      alert((e as Error).message || 'Could not load this draft — please try again.')
    } finally {
      setLoadingDraft(false)
    }
  }
  // Delete a message — the open one (reading pane) or any row (list). If a Trash
  // folder exists and we're not already in it, move it there (recoverable);
  // otherwise (already in Trash, or no Trash folder on this account) permanently
  // expunge, after confirming. The list is updated optimistically so the message
  // vanishes immediately, then reloaded.
  async function deleteMail(uid?: number) {
    const target = uid ?? sel?.uid
    if (target == null) return
    const mailbox = folders.find((f) => f.key === activeFolder)?.path || 'INBOX'
    if(activeFolder==='local-drafts'){
      const result=await api('/api/local/drafts'+q({account:activeAccount,id:String(target)}),{method:'DELETE'})
      if(result.ok){setSel(null);setSelUid(null);load()}else setReaderError(result.error)
      return
    }
    if(offline){setReaderError('Reconnect before changing mail on the server.');return}
    const trash = folders.find((f) => f.key === 'trash')?.path
    const permanent = !trash || trash === mailbox
    if (permanent && !confirm('Permanently delete this message? This cannot be undone.')) return
    setDeleting(true)
    const r = await api(`/api/mail/message/${target}` + q({ mailbox, to: permanent ? undefined : trash, account: activeAccount }), { method: 'DELETE' })
    setDeleting(false)
    if (r.ok) {
      setMessages((m) => m.filter((x) => x.uid !== target))
      if (selUid === target) { setSel(null); setSelUid(null) }
      load()
    } else {
      alert(r.error || 'Could not delete this message — please try again.')
    }
  }
  // Open a message found via mailbox-wide attachment search — it may live in a
  // different folder than the one currently active, so switch to it first.
  // Opening or composing takes a phone to the reading pane; the list is one
  // tap away via Back.
  function showReader() { setMobilePane('reader') }

  async function openFromSearch(mailbox: string, uid: number) {
    const f = folders.find((x) => x.path === mailbox)
    if (f) { setSearch(''); setSmartView(null); setActiveFolder(f.key) }
    setSelUid(uid); setSel(null)
    const r = await api(`/api/mail/message/${uid}` + q({ mailbox, account: activeAccount }))
    if (r.ok) setSel(r.message)
  }
  async function logout() { setCompose(null); setOffline(false); await api('/api/auth/logout', { method: 'POST' }); setPhase('auth'); setMessages([]); setSel(null); setAccounts([]) }
  function togglePanel(p: 'spaces' | 'context' | 'ai') { setPanelState((s) => ({ ...s, [p]: !s[p] })) }
  function selectFolder(key: string) { setMobilePane('list');readSeq.current++;setSearch('');setActiveFolder(key);setMessages([]);setSel(null);setSelUid(null);setReaderError('');setListError('');setDownloadStatus('') }

  if (phase === 'loading') return <Splash desktop={desktop} />
  // The desktop app opens straight into sign-in. Showing the website here
  // meant an installed application greeted its owner with a hero, a feature
  // grid and a Download button pointing at the thing they were already running.
  if (phase === 'auth') {
    return desktop
      ? <DesktopSignIn onDone={refreshMe} />
      : <Landing onSignIn={() => setAuthOpen(true)} onStart={() => setAuthOpen(true)} authOpen={authOpen} closeAuth={() => setAuthOpen(false)} onDone={refreshMe} />
  }
  if (phase === 'add-account') return <AddAccount onDone={refreshMe} email={email} canCancel={accounts.length > 0} onCancel={() => setPhase('app')} />

  const active = accounts.find((a) => a.id === activeAccount)
  const folderTitle = smartView === 'unread' ? 'Unread' : smartView === 'today' ? 'Today' : (folders.find((f) => f.key === activeFolder)?.label || 'Inbox')

  // Smart views filter the loaded folder's messages client-side (no new data —
  // see SpacesPanel for why Attachments/Waiting/Needs Reply/Scheduled aren't here).
  let visibleMessages = messages
  if (smartView === 'unread') visibleMessages = visibleMessages.filter((m) => !m.seen)
  if (smartView === 'today') visibleMessages = visibleMessages.filter((m) => isToday(m.date))
  if (search.trim()) {
    const s = search.trim().toLowerCase()
    visibleMessages = visibleMessages.filter((m) => m.subject.toLowerCase().includes(s) || m.from.toLowerCase().includes(s) || m.fromName.toLowerCase().includes(s) || m.to.toLowerCase().includes(s))
  }

  return (
    <div className="h-screen w-full flex flex-col">
      <TopBar
        accounts={accounts} activeAccount={activeAccount} activeEmail={active?.email || email} activeLabel={active?.label || 'Mailbox'}
        email={email} avatar={avatar}
        onSwitchAccount={(id) => { readSeq.current++;setSel(null);setSelUid(null);setMessages([]);setCompose(null);setReaderError('');setListError('');setMobilePane('list');setActiveAccount(id); setActiveFolder('INBOX'); setSmartView(null) }}
        onAddAccount={() => setPhase('add-account')}
        onEditAccount={(id) => setEditAccount(id)}
        search={search} onSearch={setSearch}
        onCompose={() => { setCompose({ to: '', subject: '' }); showReader() }}
        onShowKeys={() => setShowKeys(true)} onShowProfile={() => setShowProfile(true)} onLogout={logout}
        offline={offline} dark={dark} onTheme={toggleTheme}
        panelState={panelState} onTogglePanel={togglePanel} onOpenDrawer={() => setDrawer(true)}
      />
      {(offline || downloadStatus) && <div className="connection-banner" role="status"><Icon name={offline?'cloud':'check'} size={15}/><span>{offline?'Working from downloaded mail. Local drafts are never sent automatically.':downloadStatus}</span>{offline && <button onClick={()=>{setOffline(false);setReloadTick(t=>t+1);load(false,true)}}>Reconnect & refresh</button>}{!offline && <button aria-label="Dismiss download status" onClick={()=>setDownloadStatus('')}><Icon name="close" size={14}/></button>}</div>}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Collapsible open={panelState.spaces} width={210}>
          <SpacesPanel folders={folders} activeFolder={activeFolder} smartView={smartView} onSelectFolder={selectFolder} onSelectSmartView={setSmartView} />
        </Collapsible>
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          <SpacesPanel
            folders={folders} activeFolder={activeFolder} smartView={smartView}
            onSelectFolder={(k) => { selectFolder(k); setDrawer(false); setMobilePane('list') }}
            onSelectSmartView={(v) => { setSmartView(v); setDrawer(false); setMobilePane('list') }}
          />
        </Drawer>

        <div
          className={`w-full md:w-[340px] shrink-0 h-full ${mobilePane === 'reader' ? 'hidden md:block' : 'block'}`}
          style={{ borderRight: '1px solid var(--line)' }}
        >
          <ConversationList
            error={listError} desktop={desktop} onDownload={downloadFolder} downloading={downloading}
            messages={visibleMessages}
            activeFolder={activeFolder}
            selUid={selUid}
            listLoading={listLoading}
            folderTitle={folderTitle}
            onOpen={(uid: number) => { open(uid); showReader() }}
            onRefresh={() => load(false)}
            onDelete={deleteMail}
            deleting={deleting}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => load(true)}
            search={search}
            onSearch={setSearch}
          />
        </div>

        <div
          className={`flex-1 min-w-0 h-full ${mobilePane === 'list' ? 'hidden md:block' : 'block'}`}
          style={{ borderRight: '1px solid var(--line)' }}
        >
          <ReadingCanvas desktop={desktop} offline={offline} error={readerError}
            onBack={() => { setMobilePane('list'); setSel(null); setSelUid(null) }}
            sel={sel} selUid={selUid} activeFolder={activeFolder} folders={folders} activeAccount={activeAccount}
            loadingDraft={loadingDraft} onEditDraft={editDraft} deleting={deleting} onDelete={deleteMail}
            onReply={() => sel && setCompose({ to: sel.from.replace(/.*<|>.*/g, ''), subject: 'Re: ' + sel.subject })}
            compose={compose} from={active?.email} account={activeAccount}
            onComposeClose={() => {setCompose(null);load();setMobilePane('list')}} onComposeSent={() => { setCompose(null);setMobilePane('list'); load() }}
          />
        </div>

        <Collapsible open={panelState.context} width={320}>
          <ContextPanel sel={sel} messages={messages} />
        </Collapsible>
        <Collapsible open={panelState.ai} width={360} side="right">
          <VoicePanel onDraft={(subject, html) => setCompose({ to: '', subject, html })} />
          <div style={{ borderTop: '1px solid var(--line)' }} />
          <AIPanel key={selUid} sel={sel} onDraftReply={(html) => sel && setCompose({ to: sel.from.replace(/.*<|>.*/g, ''), subject: 'Re: ' + sel.subject, html })} onOpenSearchResult={openFromSearch} />
        </Collapsible>
      </div>

      {editAccount && <EditAccount accountId={editAccount}
        onClose={() => setEditAccount(null)}
        onSaved={() => { setEditAccount(null); refreshMe(); setReloadTick((t) => t + 1) }}
        onDeleted={() => { setEditAccount(null); refreshMe() }} />}
      {handoff && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-6">
          <div className="glass rounded-2xl p-7 w-full max-w-sm fade-in">
            <h2 className="text-lg font-bold">Open a different mailbox</h2>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
              The panel asked to open <b style={{ color: 'var(--fg)' }}>{handoff.want}</b>, but you&rsquo;re
              signed in as <b style={{ color: 'var(--fg)' }}>{handoff.current}</b>. Signing in as that
              mailbox needs its own password.
            </p>
            <button
              onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = `/?email=${encodeURIComponent(handoff.want)}` }}
              className="accent-grad text-white font-bold rounded-xl py-2.5 w-full mt-5 hover:opacity-90 text-sm">
              Sign in as {handoff.want}
            </button>
            <button
              onClick={() => { setHandoff(null); window.history.replaceState(null, '', window.location.pathname) }}
              className="text-xs mt-3 w-full text-center hover:underline" style={{ color: 'var(--muted)' }}>
              Stay signed in as {handoff.current}
            </button>
          </div>
        </div>
      )}

      {legacySession && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 glass rounded-xl px-4 py-3 flex items-center gap-3 fade-in max-w-[92vw]">
          <span className="text-sm">
            You&rsquo;re on an older session that still uses stored mail-server settings.
          </span>
          <button
            onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.reload() }}
            className="accent-grad text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:opacity-90 shrink-0">
            Sign in again
          </button>
          <button onClick={() => setLegacySession(false)} className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>Later</button>
        </div>
      )}

      {showKeys && <Keys accounts={accounts} onClose={() => setShowKeys(false)} />}
      {showProfile && <ProfileModal email={email} avatar={avatar} onClose={() => setShowProfile(false)} onSaved={(a) => setAvatar(a)} />}
    </div>
  )
}

/**
 * The boot screen.
 *
 * On the web this is gone in a blink. In the desktop app it covers a real
 * wait: Electron starts a local server and the window opens before it is
 * listening, so the honest thing is to say what is happening rather than sit
 * on a logo and let it read as a hang. The line only appears after a second,
 * so a fast start still just flashes the mark.
 */
function Splash({ desktop }: { desktop?: boolean }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="h-screen grid place-items-center" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-3 opacity-70"><Mark /><span className="font-extrabold text-lg">Zaim</span></div>
        {slow && desktop && (
          <p className="text-[11px] fade-in" style={{ color: 'var(--muted)' }}>Starting your local mail server</p>
        )}
      </div>
    </div>
  )
}

function AddAccount({ onDone, email, canCancel, onCancel }: { onDone: () => void; email: string; canCancel?: boolean; onCancel?: () => void }) {
  const [f, setF] = useState({ label: '', imapHost: '', imapUser: email, imapPass: '', imapPort: '993' })
  const [err, setErr] = useState(''); const [detail, setDetail] = useState(''); const [hint, setHint] = useState('')
  // Only shown once we've genuinely failed to find the server ourselves.
  const [showServer, setShowServer] = useState(false)
  const [busy, setBusy] = useState(false)
  async function go() {
    setErr(''); setDetail(''); setHint(''); setBusy(true)
    const r = await api('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({
        ...f,
        // Blank means "work it out from the address", which is what it can do
        // for Gmail, Outlook, Zoho and our own server.
        imapHost: !isZeroAIEmail(f.imapUser) && showServer ? f.imapHost.trim() || undefined : undefined,
        imapPort: f.imapHost.trim() ? Number(f.imapPort) : undefined,
        label: f.label || f.imapUser,
      }),
    })
    setBusy(false)
    if (r.ok) return onDone()
    setErr(r.error || 'Could not connect to that mailbox.')
    setDetail(r.detail || ''); setHint(r.hint || '')
    if (r.needsMailServer && !isZeroAIEmail(f.imapUser)) setShowServer(true)
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="min-h-screen grid place-items-center px-6 py-8">
      <div className="glass rounded-2xl p-8 w-full max-w-md fade-in">
        <div className="flex items-center gap-2 mb-6"><Mark /><span className="font-extrabold text-lg tracking-tight">Zaim</span>{canCancel && <button onClick={onCancel} aria-label="Close mailbox settings" className="ml-auto icon-button"><Icon name="close" /></button>}</div>
        <h1 className="text-xl font-bold">Connect a mailbox</h1>
        <p className="text-sm text-[color:var(--muted)] mt-1 mb-5">Your credentials are encrypted at rest and only used to reach your mail host.</p>
        <div className="flex flex-col gap-3">
          <input className={field} style={{ borderColor: 'var(--line)' }} placeholder="Label (e.g. Work)" value={f.label} onChange={set('label')} />
          <input className={field} style={{ borderColor: 'var(--line)' }} aria-label="Email address" type="email" autoComplete="username" placeholder="Email address" value={f.imapUser} onChange={e => { setF({ ...f, imapUser: e.target.value, imapHost: '' }); setShowServer(false) }} />
          <input className={field} style={{ borderColor: 'var(--line)' }} aria-label="Mailbox password" autoComplete="current-password" placeholder={isZeroAIEmail(f.imapUser) ? "Mailbox password" : "Password / app password"} type="password" value={f.imapPass} onChange={set('imapPass')} onKeyDown={e => { if (e.key === 'Enter' && !busy && f.imapUser && f.imapPass) go() }} />
          {showServer && !isZeroAIEmail(f.imapUser) && (
            <div className="flex gap-3 fade-in">
              <input className={field + ' flex-[2]'} style={{ borderColor: 'var(--line)' }} placeholder="Incoming mail server (e.g. imap.gmail.com)" value={f.imapHost} onChange={set('imapHost')} />
              <input className={field + ' flex-[1]'} style={{ borderColor: 'var(--line)' }} placeholder="993" value={f.imapPort} onChange={set('imapPort')} />
            </div>
          )}
        </div>
        {!isZeroAIEmail(f.imapUser) && <button onClick={() => setShowServer(v => !v)} className="text-xs mt-3 text-[color:var(--muted)]">{showServer ? "Hide server settings" : "Advanced server settings"}</button>}
        {err && (
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-xs text-red-400">{err}</p>
            {detail && <p className="text-[11px] font-mono leading-relaxed break-words" style={{ color: 'var(--muted)' }}>{detail}</p>}
            {hint && <p className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>{hint}</p>}
          </div>
        )}
        <button disabled={busy || !f.imapUser || !f.imapPass} onClick={go} className="accent-grad text-white font-bold rounded-xl py-3 w-full mt-4 hover:opacity-90 disabled:opacity-50">{busy ? 'Verifying…' : 'Connect'}</button>
        <p className="text-[11px] text-[color:var(--muted)] mt-3 text-center">
          {isZeroAIEmail(f.imapUser) ? 'ZeroAI Mail — sign in with your email and mailbox password. Server settings are managed automatically.' : showServer
            ? 'Enter the incoming server. The sending server is worked out from it.'
            : 'Your mail server is found from your address. With two-factor on, use an app password.'}
        </p>
      </div>
    </div>
  )
}

// Edit a mailbox's server settings (the fix for a box that sends but no longer
// receives — its IMAP host still points at the old server) or remove it. The
// server verifies the new settings before saving, so a bad edit can't lock it.
type EditForm = { label: string; imapHost: string; imapPort: string; imapSecure: boolean; imapUser: string; smtpHost: string; smtpPort: string; smtpSecure: boolean; smtpUser: string; pass: string }
function EditAccount({ accountId, onClose, onSaved, onDeleted }: { accountId: string; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [f, setF] = useState<EditForm | null>(null)
  const [managed, setManaged] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let live = true
    api(`/api/accounts/${accountId}`).then((r) => {
      if (!live) return
      if (!r.ok || !r.account) { setErr(r.error || 'Could not load settings'); return }
      const a = r.account
      setManaged(!!r.managed); setReadOnly(!!r.readOnly)
      setF({ label: a.label || '', imapHost: a.imapHost || '', imapPort: String(a.imapPort || 993), imapSecure: a.imapSecure !== false, imapUser: a.imapUser || '', smtpHost: a.smtpHost || '', smtpPort: String(a.smtpPort || 465), smtpSecure: a.smtpSecure !== false, smtpUser: a.smtpUser || '', pass: '' })
    })
    return () => { live = false }
  }, [accountId])

  async function save() {
    if (!f) return
    setErr(''); setBusy(true)
    const r = await api(`/api/accounts/${accountId}`, { method: 'PUT', body: JSON.stringify({
      label: f.label, imapHost: f.imapHost, imapPort: Number(f.imapPort), imapSecure: f.imapSecure, imapUser: f.imapUser,
      smtpHost: f.smtpHost, smtpPort: Number(f.smtpPort), smtpSecure: f.smtpSecure, smtpUser: f.smtpUser || f.imapUser,
      imapPass: f.pass || undefined, smtpPass: f.pass || undefined,
    }) })
    setBusy(false)
    if (r.ok) onSaved(); else setErr(r.error || 'Could not save — check the settings and password.')
  }
  async function del() {
    setBusy(true)
    const r = await api(`/api/accounts/${accountId}`, { method: 'DELETE' })
    setBusy(false)
    if (r.ok) onDeleted(); else setErr(r.error || 'Could not remove.')
  }
  const upd = (k: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((cur) => cur ? { ...cur, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } : cur)
  const bd = { borderColor: 'var(--line)' }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 px-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 w-full max-w-md fade-in max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4"><span className="font-extrabold text-lg tracking-tight">Mailbox settings</span><button onClick={onClose} aria-label="Close mailbox settings" className="ml-auto icon-button"><Icon name="close" /></button></div>
        {!f ? <p className="text-sm text-[color:var(--muted)] py-6 text-center">{err || 'Loading…'}</p> : (<>
          <div className="flex flex-col gap-3">
            <input className={field} style={bd} aria-label="Mailbox label" disabled={readOnly} placeholder="Label" value={f.label} onChange={upd('label')} />
            <input className={field} style={bd} aria-label="Mailbox email" readOnly={managed || readOnly} placeholder="Email / username" value={f.imapUser} onChange={upd('imapUser')} />
            {managed && <p className="text-xs text-[color:var(--muted)]">ZeroAI Mail manages your connection automatically.</p>}
            {!managed && !readOnly && <button className="text-xs text-left text-[color:var(--muted)]" onClick={() => setAdvanced(v => !v)}>{advanced ? "Hide server settings" : "Advanced server settings"}</button>}
            {!managed && advanced && <><div>
              <div className="text-[11px] font-semibold text-[color:var(--muted)] mb-1">Incoming — IMAP</div>
              <div className="flex gap-2">
                <input className={field + ' flex-[2]'} style={bd} placeholder="IMAP host" value={f.imapHost} onChange={upd('imapHost')} />
                <input className={field + ' flex-[1]'} style={bd} placeholder="Port" value={f.imapPort} onChange={upd('imapPort')} />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[color:var(--muted)] mt-1.5"><input type="checkbox" checked={f.imapSecure} onChange={upd('imapSecure')} /> SSL/TLS (typically port 993)</label>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[color:var(--muted)] mb-1">Outgoing — SMTP</div>
              <div className="flex gap-2">
                <input className={field + ' flex-[2]'} style={bd} placeholder="SMTP host" value={f.smtpHost} onChange={upd('smtpHost')} />
                <input className={field + ' flex-[1]'} style={bd} placeholder="Port" value={f.smtpPort} onChange={upd('smtpPort')} />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[color:var(--muted)] mt-1.5"><input type="checkbox" checked={f.smtpSecure} onChange={upd('smtpSecure')} /> SSL/TLS (typically port 465)</label>
            </div>
            </>}
            {!readOnly && <input className={field} style={bd} type="password" placeholder="New password (leave blank to keep current)" value={f.pass} onChange={upd('pass')} />}
          </div>
          {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
          {readOnly ? <p className="text-xs text-[color:var(--muted)] mt-4">This is your signed-in mailbox. Sign out and sign in again to update its credentials.</p> : <><button disabled={busy || !f.imapHost} onClick={save} className="accent-grad text-white font-bold rounded-xl py-3 w-full mt-4 hover:opacity-90 disabled:opacity-50">{busy ? 'Verifying…' : 'Save & verify'}</button>
          <p className="text-[11px] text-[color:var(--muted)] mt-2 text-center">The incoming server is tested before saving, so a wrong setting can’t lock you out.</p>
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
            {!confirmDel ? (
              <button onClick={() => setConfirmDel(true)} className="text-xs text-red-400 hover:text-red-300">Remove this mailbox from Zaim</button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[color:var(--muted)] flex-1">Remove it? Your mail stays on the server.</span>
                <button disabled={busy} onClick={del} className="text-xs font-semibold text-red-400 hover:text-red-300">Yes, remove</button>
                <button onClick={() => setConfirmDel(false)} className="text-xs text-[color:var(--muted)]">Cancel</button>
              </div>
            )}
          </div>
          </>}
        </>)}
      </div>
    </div>
  )
}

type KeyRow = { id: string; label: string; account_id: string | null; created_at: number; last_used: number | null }
async function imageToAvatar(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale, h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally { URL.revokeObjectURL(url) }
}

function Keys({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  // Agent access used to mean a key minted here and stored in Postgres. There is
  // no database any more: agents sign in against the mail server itself, so this
  // screen explains that rather than handing out a credential Zaim would have to
  // remember. Revoking happens on the mail server, where it also ends IMAP.
  const [copied, setCopied] = useState('')
  const email = accounts[0]?.email || 'you@yourdomain.com'
  const cmd = `zaim login ${email}`
  const install = 'npm i -g github:zeroai-tech/zaim'
  const mcpCmd = 'claude mcp add zaim -s user -e ZAIM_URL=https://zaim.zeroaitech.tech -- zaim-mcp'
  const copy = (t: string, k: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1500) }
  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div className="flex gap-3">
      <span className="w-6 h-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold accent-grad text-white">{n}</span>
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div>{children}</div>
    </div>
  )
  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-4 sm:p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-lg fade-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12 sticky top-0" style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
          <span className="font-bold text-sm">🤖 Connect an agent</span>
          <button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-5">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Claude Code, Codex or the <code>zaim</code> CLI can read and send from this mailbox.
            They sign in to your mail server directly — Zaim never stores a key, and revoking
            access on the mail server ends it everywhere, including IMAP.
          </p>

          <Step n={1} title="Install the CLI">
            <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
              Installs <code>zaim</code>, <code>zaim-login</code> and <code>zaim-mcp</code>. Takes a minute or two.
            </p>
            <div className="flex gap-2 mt-1.5">
              <code className="flex-1 text-[11px] break-all bg-black/30 rounded-lg px-3 py-2">{install}</code>
              <button onClick={() => copy(install, 'i')} className="shrink-0 text-xs font-bold px-3 rounded-lg" style={{ border: '1px solid var(--line)' }}>{copied === 'i' ? '\u2713' : 'Copy'}</button>
            </div>
          </Step>

          <Step n={2} title="Sign in">
            <div className="flex gap-2 mt-1.5">
              <code className="flex-1 text-[11px] break-all bg-black/30 rounded-lg px-3 py-2">{cmd}</code>
              <button onClick={() => copy(cmd, 'c')} className="shrink-0 accent-grad text-white text-xs font-bold px-3 rounded-lg">{copied === 'c' ? '\u2713' : 'Copy'}</button>
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
              It prints a short code and a link. Approve it in your browser, once. The agent
              then renews itself and will not ask again.
            </p>
          </Step>

          <Step n={3} title="Register it with Claude Code">
            <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
              One command. Adds the mailbox tools to every project on this machine.
            </p>
            <div className="flex gap-2 mt-1.5">
              <code className="flex-1 text-[11px] break-all bg-black/30 rounded-lg px-3 py-2">{mcpCmd}</code>
              <button onClick={() => copy(mcpCmd, 'm')} className="shrink-0 text-xs font-bold px-3 rounded-lg" style={{ border: '1px solid var(--line)' }}>{copied === 'm' ? '\u2713' : 'Copy'}</button>
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
              Check it with <code>claude mcp list</code>. For Codex or another client, run
              <code> zaim-mcp</code> as a stdio server with the same <code>ZAIM_URL</code>.
            </p>
          </Step>

          <div className="rounded-xl p-3.5 text-[11px] leading-relaxed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
            Signing in a <b>second</b> mailbox replaces the first, because credentials live in one
            file. To keep both, point the second at its own store:
            <code className="block mt-1.5 bg-black/30 rounded-lg px-3 py-2 break-all">ZAIM_CONFIG_DIR=~/.zaim-other zaim login other@yourdomain.com</code>
            Set the same variable when you run the agent, and it uses that mailbox.
          </div>

          <div className="rounded-xl p-3.5 text-[11px] leading-relaxed" style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
            For a phone or desktop mail app, create an <b>app password</b> in your mail server&rsquo;s
            portal instead — it is scoped, expiring, and revocable without touching your main password.
          </div>
        </div>
      </div>
    </div>
  )
}


function ProfileModal({ email, avatar, onClose, onSaved }: { email: string; avatar: string; onClose: () => void; onSaved: (a: string) => void }) {
  const [preview, setPreview] = useState(avatar)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileIn = useRef<HTMLInputElement>(null)

  async function pick(file?: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    setErr('')
    try { setPreview(await imageToAvatar(file)) } catch { setErr('Could not read that image.') }
  }
  async function save(next: string | null) {
    setBusy(true); setErr('')
    const r = await api('/api/profile', { method: 'POST', body: JSON.stringify({ avatar: next }) })
    setBusy(false)
    if (r.ok) { onSaved(next || ''); onClose() } else setErr(r.error || 'Could not save')
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/50 backdrop-blur-sm z-50 p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-sm fade-in p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <span className="font-bold text-sm">Profile picture</span>
          <button onClick={onClose} className="text-[color:var(--muted)] hover:text-white">✕</button>
        </div>
        <div className="flex flex-col items-center gap-4">
          <Avatar src={preview} name={email} cls="w-28 h-28 rounded-full text-3xl" txt="text-3xl" />
          <p className="text-[11px] text-[color:var(--muted)] text-center">Shown next to your name in Zaim. A matching Gravatar also appears in some other mail apps.</p>
          <input ref={fileIn} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="flex gap-2 w-full">
            <button onClick={() => fileIn.current?.click()} className="flex-1 accent-grad text-white font-bold rounded-xl py-2.5 text-sm hover:opacity-90">Upload photo</button>
            {preview && <button onClick={() => setPreview('')} className="px-3 rounded-xl text-sm text-[color:var(--muted)] hover:text-white" style={{ border: '1px solid var(--line)' }}>Clear</button>}
          </div>
          {err && <p className="text-[color:var(--danger,#ff6b6b)] text-xs">{err}</p>}
          <div className="flex gap-2 w-full mt-1">
            <button onClick={onClose} className="flex-1 rounded-xl py-2.5 text-sm text-[color:var(--muted)] hover:text-white" style={{ border: '1px solid var(--line)' }}>Cancel</button>
            <button disabled={busy || preview === avatar} onClick={() => save(preview || null)} className="flex-1 accent-grad text-white font-bold rounded-xl py-2.5 text-sm hover:opacity-90 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
