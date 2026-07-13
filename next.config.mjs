/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer', 'better-sqlite3', 'pg'],
}
export default nextConfig
