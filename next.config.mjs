import path from 'node:path'
import { fileURLToPath } from 'node:url'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer', 'better-sqlite3', 'pg'],
  // Security headers (audit 2026-11-24): no framing by other sites, no MIME sniffing, short referrers.
  // A full script CSP is not set yet; it needs a report-only trial first.
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Report-only trial (2026-11-24): blocks nothing, reports what a strict policy would block.
      // Email bodies render in a sandboxed srcdoc iframe with their own CSP (ReadingCanvas.tsx).
      { key: 'Content-Security-Policy-Report-Only', value: [
        "default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
        "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: blob: cid: https:", "media-src 'self' blob: data:",
        "connect-src 'self'", "frame-src 'self' about: data: blob:", "worker-src 'self' blob:",
        "report-uri https://zai-csp-reports.zeroai.workers.dev/r/zaim",
      ].join('; ') },
    ] }]
  },
}
export default nextConfig
