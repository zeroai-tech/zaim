import path from 'node:path'
import { fileURLToPath } from 'node:url'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer', 'better-sqlite3', 'pg'],
}
export default nextConfig
