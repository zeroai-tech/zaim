/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer', 'better-sqlite3'],
}
export default nextConfig
