// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/tools.mjs — Canonical Zaim MCP tools & shared execution handler
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCOPE_MAIL_READ,
  SCOPE_MAIL_SEARCH,
  SCOPE_MAIL_DRAFT,
  SCOPE_MAIL_SEND,
  SCOPE_MAIL_DELETE,
} from './types.mjs'
import { validateScopeForTool } from './scopes.mjs'

export const MCP_TOOLS = [
  {
    name: 'zaim_status',
    description:
      'Check whether the Zaim agent key is authenticated, which mailbox is configured, and granted permission scopes. Call this first to confirm the connection works.',
    requiredScope: SCOPE_MAIL_READ,
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const s = await ctx.client.getSession(ctx.authToken)
      const scopesStr = ctx.scopes && ctx.scopes.length ? ctx.scopes.join(', ') : 'all (*)'
      return `authenticated: ${s.authed} · mailbox configured: ${s.configured} · scopes: [${scopesStr}] · server: ${ctx.client.baseUrl}`
    },
  },
  {
    name: 'zaim_folders',
    description:
      'List the mailbox folders available on this account (Inbox, Sent, Drafts, Trash, etc.), with the exact folder paths to pass to other tools as `mailbox`.',
    requiredScope: SCOPE_MAIL_READ,
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const r = await ctx.client.getFolders(ctx.authToken)
      return JSON.stringify(r.folders, null, 2)
    },
  },
  {
    name: 'zaim_list',
    description:
      'List messages in a mailbox folder, newest first. Returns uid, from, subject, date, and read/flagged state for each.',
    requiredScope: SCOPE_MAIL_SEARCH,
    inputSchema: {
      type: 'object',
      properties: {
        mailbox: {
          type: 'string',
          description:
            'Folder path (default "INBOX"). Use zaim_folders to discover paths like "INBOX.Sent" or "[Gmail]/Drafts".',
        },
        limit: {
          type: 'number',
          description: 'Max messages to return (default 40, capped at 100).',
        },
        flagged: {
          type: 'boolean',
          description: 'If true, only return flagged/starred messages.',
        },
      },
    },
    run: async (a, ctx) => {
      const r = await ctx.client.listMessages(
        {
          mailbox: a.mailbox || 'INBOX',
          limit: a.limit != null ? Math.min(Math.max(Number(a.limit), 1), 100) : 40,
          flagged: Boolean(a.flagged),
        },
        ctx.authToken
      )
      return JSON.stringify(r.messages, null, 2)
    },
  },
  {
    name: 'zaim_read',
    description:
      'Read one message in full by its uid (subject, from, to, date, body text/html, and attachment metadata).',
    requiredScope: SCOPE_MAIL_READ,
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'The message uid (from zaim_list).',
        },
        mailbox: {
          type: 'string',
          description: 'Folder the message lives in (default "INBOX").',
        },
      },
      required: ['uid'],
    },
    run: async (a, ctx) => {
      if (a.uid == null || isNaN(Number(a.uid))) {
        throw new Error('Invalid parameter: `uid` must be a valid message number.')
      }
      const r = await ctx.client.readMessage(Number(a.uid), a.mailbox || 'INBOX', ctx.authToken)
      return JSON.stringify(r.message, null, 2)
    },
  },
  {
    name: 'zaim_send',
    description:
      'PRIVILEGED: Send an email immediately via SMTP, and save a copy to Sent. Use zaim_draft instead when a human should review before it goes out.',
    requiredScope: SCOPE_MAIL_SEND,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
        subject: { type: 'string', description: 'Email subject line.' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body.' },
        cc: { type: 'string', description: 'Optional CC recipient(s).' },
        bcc: { type: 'string', description: 'Optional BCC recipient(s).' },
      },
      required: ['to', 'subject'],
    },
    run: async (a, ctx) => {
      if (!a.to || typeof a.to !== 'string' || !a.to.trim()) {
        throw new Error('Missing parameter: `to` recipient address is required.')
      }
      if (!a.subject || typeof a.subject !== 'string') {
        throw new Error('Missing parameter: `subject` is required.')
      }
      const r = await ctx.client.sendMessage(
        {
          to: a.to.trim(),
          subject: a.subject,
          text: a.text || '',
          html: a.html || undefined,
          cc: a.cc || undefined,
          bcc: a.bcc || undefined,
        },
        ctx.authToken
      )
      return `sent — ${r.messageId}${r.sentWarning ? ` (warning: ${r.sentWarning})` : ''}`
    },
  },
  {
    name: 'zaim_draft',
    description:
      'Compose a message and save it to the Drafts folder WITHOUT sending. Purely an IMAP append (no SMTP), so it can never go out unreviewed — the safe choice for preparing outreach a human will review and send.',
    requiredScope: SCOPE_MAIL_DRAFT,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
        subject: { type: 'string', description: 'Draft subject line.' },
        text: { type: 'string', description: 'Plain-text draft content.' },
        html: { type: 'string', description: 'Optional HTML draft content.' },
        cc: { type: 'string', description: 'Optional CC recipient(s).' },
        bcc: { type: 'string', description: 'Optional BCC recipient(s).' },
      },
      required: ['to', 'subject'],
    },
    run: async (a, ctx) => {
      if (!a.to || typeof a.to !== 'string' || !a.to.trim()) {
        throw new Error('Missing parameter: `to` recipient address is required.')
      }
      if (!a.subject || typeof a.subject !== 'string') {
        throw new Error('Missing parameter: `subject` is required.')
      }
      await ctx.client.createDraft(
        {
          to: a.to.trim(),
          subject: a.subject,
          text: a.text || '',
          html: a.html || undefined,
          cc: a.cc || undefined,
          bcc: a.bcc || undefined,
        },
        ctx.authToken
      )
      return 'saved to Drafts — not sent'
    },
  },
  {
    name: 'zaim_delete',
    description:
      'PRIVILEGED: Delete a message. By default moves it to the given Trash folder (recoverable). Omit `trash` (or set it equal to `mailbox`) to permanently expunge instead — that is irreversible.',
    requiredScope: SCOPE_MAIL_DELETE,
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: 'The message uid (from zaim_list).' },
        mailbox: {
          type: 'string',
          description: 'Folder the message is currently in (default "INBOX").',
        },
        trash: {
          type: 'string',
          description:
            'Trash folder path to move it to (recoverable). If omitted or equal to mailbox, the message is permanently deleted.',
        },
      },
      required: ['uid'],
    },
    run: async (a, ctx) => {
      if (a.uid == null || isNaN(Number(a.uid))) {
        throw new Error('Invalid parameter: `uid` must be a valid message number.')
      }
      const mailbox = a.mailbox || 'INBOX'
      await ctx.client.deleteMessage(Number(a.uid), mailbox, a.trash, ctx.authToken)
      return a.trash && a.trash !== mailbox ? `moved to ${a.trash}` : 'permanently deleted'
    },
  },
]

export const MCP_TOOL_MAP = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t])
)

/**
 * Executes an MCP tool with full server-side permission scope enforcement.
 */
export async function executeTool(toolName, args = {}, ctx) {
  const tool = MCP_TOOL_MAP[toolName]
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  // 1. Enforce permission scopes server-side
  validateScopeForTool(ctx.scopes, toolName, tool.requiredScope)

  // 2. Execute business logic
  try {
    const text = await tool.run(args, ctx)
    return {
      content: [{ type: 'text', text }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }],
      isError: true,
    }
  }
}
