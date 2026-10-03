import type { CSSProperties } from 'react'
export type IconName = 'menu' | 'search' | 'compose' | 'refresh' | 'inbox' | 'sent' | 'draft' | 'archive' | 'trash' | 'star' | 'close' | 'chevron' | 'settings' | 'bot' | 'info' | 'attach' | 'reply' | 'back' | 'download' | 'lock' | 'check' | 'sun' | 'moon' | 'cloud' | 'warning'
const paths: Record<IconName, React.ReactNode> = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  compose: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 3l7 7M10 14l3-1 8-8-3-3-8 8-1 4Z" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M19 17a8 8 0 0 1-13 2l-2-3" /></>,
  inbox: <><path d="m4 4-2 10v6h20v-6L20 4H4ZM2 14h6l2 3h4l2-3h6" /></>,
  sent: <path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2" />,
  draft: <><path d="M13 3H5v18h14V9l-6-6ZM13 3v6h6M8 14h8M8 17h5" /></>,
  archive: <><path d="M3 3h18v5H3zM5 8v13h14V8M9 12h6" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  star: <path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9Z" /><circle cx="12" cy="12" r="3" /></>,
  bot: <><rect x="4" y="7" width="16" height="14" rx="4" /><path d="M12 3v4M8 12v2M16 12v2M9 17h6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  attach: <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M5 16 15 6" />,
  reply: <path d="m9 5-7 7 7 7M2 12h12a7 7 0 0 1 7 7" />,
  back: <path d="m14 5-7 7 7 7" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" /></>,
  moon: <path d="M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z" />,
  cloud: <path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13 1 4.5 4.5 0 0 1 0 9H6Z" />,
  warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
}
export function Icon({ name, size = 18, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={'shrink-0 ' + className} style={style}>{paths[name]}</svg>
}
