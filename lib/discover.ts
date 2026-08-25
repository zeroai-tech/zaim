import { promises as dns } from 'node:dns'

// ─────────────────────────────────────────────────────────────────────────────
//  Where does this address's mail live?
//
//  Sign-in asks for an email and a password and nothing else, so the server has
//  to work out the mail host itself. In order:
//    1. Our own server — the domain's MX points at ZAIM_HOSTED_MAIL_HOST. Every
//       mailbox we create for a client lands here, which is the case that has to
//       be effortless.
//    2. A well-known provider (Gmail, Outlook, …), by MX or by domain.
//    3. The conventional `mail.<domain>` / `imap.<domain>` names, which is what
//       most small business domains actually use.
//  Only if all three miss do we ask the person for their server.
// ─────────────────────────────────────────────────────────────────────────────

export interface MailHosts {
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  hosted: boolean
  // True when our server is only a last-resort guess (nothing in DNS pointed
  // here), so a failure against it shouldn't be reported as a wrong password.
  fallback?: boolean
  label: string
}

export const hostedHost = (): string => (process.env.ZAIM_HOSTED_MAIL_HOST || '').trim().toLowerCase()

const ssl = (host: string, hosted: boolean, label: string): MailHosts => ({
  imapHost: host, imapPort: 993, imapSecure: true,
  smtpHost: host, smtpPort: 465, smtpSecure: true,
  hosted, label,
})

// Providers whose IMAP host differs from their MX, keyed by an MX suffix.
const BY_MX: [string, string, string, string][] = [
  // mx suffix           imap                    smtp                      label
  ['google.com',         'imap.gmail.com',       'smtp.gmail.com',         'Gmail'],
  ['googlemail.com',     'imap.gmail.com',       'smtp.gmail.com',         'Gmail'],
  ['outlook.com',        'outlook.office365.com','smtp.office365.com',     'Outlook'],
  ['protection.outlook.com', 'outlook.office365.com', 'smtp.office365.com','Microsoft 365'],
  ['zoho.com',           'imap.zoho.com',        'smtp.zoho.com',          'Zoho'],
  ['zoho.in',            'imap.zoho.in',         'smtp.zoho.in',           'Zoho'],
  ['yahoodns.net',       'imap.mail.yahoo.com',  'smtp.mail.yahoo.com',    'Yahoo'],
  ['icloud.com',         'imap.mail.me.com',     'smtp.mail.me.com',       'iCloud'],
  ['messagingengine.com','imap.fastmail.com',    'smtp.fastmail.com',      'Fastmail'],
  ['mail.protonmail.ch', '127.0.0.1',            '127.0.0.1',              'Proton Bridge'],
]

const dnsOk = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

// Resolve without touching the mail server. `candidates` are tried in order by
// the caller, since only an actual IMAP login can confirm which one is right.
export async function discover(email: string): Promise<MailHosts[]> {
  const domain = (email.split('@')[1] || '').toLowerCase()
  if (!domain) return []
  const HOSTED = hostedHost()
  const out: MailHosts[] = []

  // 1. Our own mail server. Match the bare domain too (mail.zeroaitech.tech
  //    hosts zeroaitech.tech) so sign-in works even mid-DNS-propagation.
  if (HOSTED && (domain === HOSTED || HOSTED.endsWith('.' + domain))) out.push(ssl(HOSTED, true, 'ZeroAI Mail'))

  const mx = (await dnsOk(dns.resolveMx(domain))) || []
  const exchanges = mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase().replace(/\.$/, ''))

  if (HOSTED && exchanges.some((e) => e === HOSTED) && !out.length) out.push(ssl(HOSTED, true, 'ZeroAI Mail'))

  // 2. A known provider, identified by its MX.
  for (const e of exchanges) {
    const hit = BY_MX.find(([suffix]) => e === suffix || e.endsWith('.' + suffix))
    if (hit && !out.some((o) => o.imapHost === hit[1])) {
      out.push({ imapHost: hit[1], imapPort: 993, imapSecure: true, smtpHost: hit[2], smtpPort: 587, smtpSecure: false, hosted: false, label: hit[3] })
    }
  }

  // 3. Convention: mail.<domain>, then imap.<domain>, then the MX itself.
  for (const guess of [`mail.${domain}`, `imap.${domain}`, exchanges[0]]) {
    if (guess && !out.some((o) => o.imapHost === guess) && (await dnsOk(dns.resolve(guess).then(() => true)))) {
      out.push(ssl(guess, false, guess))
    }
  }

  // 4. Last resort: our own server anyway. A domain onboarded in the panel has
  //    real mailboxes here from the moment it's created, but its MX may not be
  //    pointed yet (or DNS is still propagating) — so nothing above finds it.
  //    Trying is one cheap IMAP attempt that either authenticates or doesn't.
  if (HOSTED && !out.some((o) => o.imapHost === HOSTED)) out.push({ ...ssl(HOSTED, true, 'ZeroAI Mail'), fallback: true })
  return out
}

// True when we host this domain — used to word the error message ("check your
// password" vs "check your mail server details").
export async function isHosted(email: string): Promise<boolean> {
  const c = await discover(email)
  return c.some((x) => x.hosted)
}
