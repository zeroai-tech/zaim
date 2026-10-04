import type { Metadata } from 'next'
import './globals.css'
import { DesktopUpdates } from './components/DesktopUpdates'

export const metadata: Metadata = {
  metadataBase: new URL('https://zaim.zeroaitech.tech'),
  title: 'Zaim — secure mail, agent-ready',
  description: 'A focused email workspace for people and agents. Read downloaded mail and save drafts offline in the desktop app. Web, desktop, CLI and MCP by ZeroAI Technologies.',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon.png', type: 'image/png' }], apple: '/icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<DesktopUpdates /></body>
    </html>
  )
}
