export const ZEROAI_MAIL_HOST = 'mail.zeroaitech.tech'
export function isZeroAIEmail(email: string): boolean {
  return email.trim().toLowerCase().split('@')[1] === 'zeroaitech.tech'
}
