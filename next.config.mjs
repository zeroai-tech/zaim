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
    ] }]
  },
}
export default nextConfig
