import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Zaim — secure mail, agent-ready',
  description: 'A stylish, secure mail client with an agent API. Human webapp + CLI + AI control. By ZeroAI.',
  icons: { icon: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
