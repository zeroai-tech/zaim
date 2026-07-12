import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0b0f', panel: '#12141c', panel2: '#0e1017', line: 'rgba(255,255,255,0.08)',
        accent: '#5b8cff', accent2: '#8ab4ff', muted: '#8a93a6',
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config
