/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer', 'better-sqlite3'],
}
export default nextConfig
