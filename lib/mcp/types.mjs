// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/types.mjs — Constants & core schema definitions for Zaim MCP
// ─────────────────────────────────────────────────────────────────────────────

export const SCOPE_MAIL_READ = 'mail.read'
export const SCOPE_MAIL_SEARCH = 'mail.search'
export const SCOPE_MAIL_DRAFT = 'mail.draft'
export const SCOPE_MAIL_SEND = 'mail.send'
export const SCOPE_MAIL_DELETE = 'mail.delete'
export const SCOPE_MAIL_MANAGE = 'mail.manage'

export const ALL_SCOPES = [
  SCOPE_MAIL_READ,
  SCOPE_MAIL_SEARCH,
  SCOPE_MAIL_DRAFT,
  SCOPE_MAIL_SEND,
  SCOPE_MAIL_DELETE,
  SCOPE_MAIL_MANAGE,
]

export const PRIVILEGED_SCOPES = [
  SCOPE_MAIL_SEND,
  SCOPE_MAIL_DELETE,
  SCOPE_MAIL_MANAGE,
]

export const SCOPE_DESCRIPTIONS = {
  [SCOPE_MAIL_READ]: 'Read email messages, inspect threads, and view folder contents',
  [SCOPE_MAIL_SEARCH]: 'List mailbox folders and search/filter messages',
  [SCOPE_MAIL_DRAFT]: 'Compose and save draft messages in Drafts folder (no SMTP sending)',
  [SCOPE_MAIL_SEND]: 'Privileged: Send email immediately via SMTP to external recipients',
  [SCOPE_MAIL_DELETE]: 'Privileged: Delete messages (move to trash or permanently expunge)',
  [SCOPE_MAIL_MANAGE]: 'Full access: Perform any mailbox operation across all scopes',
}
