#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  zaim-mcp — a Model Context Protocol server for the Zaim mail API.
//
//  Exposes Zaim's agent API (read / list / send / draft / delete mail) as
//  first-class MCP tools, so Claude Code / Codex / any MCP client can manage a
//  mailbox through tool calls instead of shelling out to curl or the CLI.
//
//  Transport: stdio (newline-delimited JSON-RPC 2.0), zero dependencies — same
//  no-deps philosophy as bin/zaim.mjs, so it ships and self-hosts with the app.
//
//  Config (env):
//    ZAIM_URL      base URL of a Zaim deployment (default http://localhost:3000)
//    ZAIM_API_KEY  a per-user Agent Key minted in Zaim ("🔑 Agent keys")
// ─────────────────────────────────────────────────────────────────────────────
import { createInterface } from 'node:readline'

const BASE = (process.env.ZAIM_URL || 'http://localhost:3000').replace(/\/$/, '')
const KEY = process.env.ZAIM_API_KEY || ''
const NAME = 'zaim'
const VERSION = '0.1.0'

// ── Zaim API helper ──────────────────────────────────────────────────────────
async function call(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
  return body
}
const qs = (params) =>
  '?' + Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

// ── Tool definitions ─────────────────────────────────────────────────────────
const tools = [
  {
    name: 'zaim_status',
    description: 'Check whether the Zaim agent key is authenticated and a mailbox is configured. Call this first to confirm the connection works.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const s = await call('/api/session')
      return `authenticated: ${s.authed} · mailbox configured: ${s.configured} · ${BASE}`
    },
  },
  {
    name: 'zaim_folders',
    description: 'List the mailbox folders available on this account (Inbox, Sent, Drafts, Trash, etc.), with the exact folder paths to pass to other tools as `mailbox`.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const r = await call('/api/mail/folders')
      return JSON.stringify(r.folders, null, 2)
    },
  },
  {
    name: 'zaim_list',
    description: 'List messages in a mailbox folder, newest first. Returns uid, from, subject, date, and read/flagged state for each.',
    inputSchema: {
      type: 'object',
      properties: {
        mailbox: { type: 'string', description: 'Folder path (default "INBOX"). Use zaim_folders to discover paths like "INBOX.Sent" or "[Gmail]/Drafts".' },
        limit: { type: 'number', description: 'Max messages to return (default 40, capped at 100).' },
        flagged: { type: 'boolean', description: 'If true, only return flagged/starred messages.' },
      },
    },
    run: async (a) => {
      const r = await call('/api/mail/list' + qs({ mailbox: a.mailbox || 'INBOX', limit: a.limit || 40, flagged: a.flagged ? '1' : undefined }))
      return JSON.stringify(r.messages, null, 2)
    },
  },
  {
    name: 'zaim_read',
    description: 'Read one message in full by its uid (subject, from, to, date, body text/html, and attachment metadata).',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: 'The message uid (from zaim_list).' },
        mailbox: { type: 'string', description: 'Folder the message lives in (default "INBOX").' },
      },
      required: ['uid'],
    },
    run: async (a) => {
      const r = await call(`/api/mail/message/${a.uid}` + qs({ mailbox: a.mailbox || 'INBOX' }))
      return JSON.stringify(r.message, null, 2)
    },
  },
  {
    name: 'zaim_send',
    description: 'Send an email immediately via SMTP, and save a copy to Sent. Use zaim_draft instead when a human should review before it goes out.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
        subject: { type: 'string' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body (takes precedence over text in rendering).' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
      },
      required: ['to', 'subject'],
    },
    run: async (a) => {
      const r = await call('/api/mail/send', { method: 'POST', body: JSON.stringify({ to: a.to, subject: a.subject, text: a.text, html: a.html, cc: a.cc, bcc: a.bcc }) })
      return `sent — ${r.messageId}${r.sentWarning ? ` (warning: ${r.sentWarning})` : ''}`
    },
  },
  {
    name: 'zaim_draft',
    description: 'Compose a message and save it to the Drafts folder WITHOUT sending. Purely an IMAP append (no SMTP), so it can never go out unreviewed — the safe choice for preparing outreach a human will review and send.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
        subject: { type: 'string' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body.' },
        cc: { type: 'string' },
        bcc: { type: 'string' },
      },
      required: ['to', 'subject'],
    },
    run: async (a) => {
      await call('/api/mail/draft', { method: 'POST', body: JSON.stringify({ to: a.to, subject: a.subject, text: a.text, html: a.html, cc: a.cc, bcc: a.bcc }) })
      return 'saved to Drafts — not sent'
    },
  },
  {
    name: 'zaim_delete',
    description: 'Delete a message. By default moves it to the given Trash folder (recoverable). Omit `trash` (or set it equal to `mailbox`) to permanently expunge instead — that is irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'number', description: 'The message uid (from zaim_list).' },
        mailbox: { type: 'string', description: 'Folder the message is currently in (default "INBOX").' },
        trash: { type: 'string', description: 'Trash folder path to move it to (recoverable). If omitted, the message is permanently deleted.' },
      },
      required: ['uid'],
    },
    run: async (a) => {
      const mailbox = a.mailbox || 'INBOX'
      await call(`/api/mail/message/${a.uid}` + qs({ mailbox, to: a.trash && a.trash !== mailbox ? a.trash : undefined }), { method: 'DELETE' })
      return a.trash && a.trash !== mailbox ? `moved to ${a.trash}` : 'permanently deleted'
    },
  },
]
const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))

// ── JSON-RPC / MCP wiring ────────────────────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  const isRequest = id !== undefined && id !== null

  switch (method) {
    case 'initialize':
      // Echo the client's requested protocol version for maximum compatibility.
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      })
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return // notifications: no response
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const tool = toolMap[params?.name]
      if (!tool) return err(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        const text = await tool.run(params.arguments || {})
        return ok(id, { content: [{ type: 'text', text }] })
      } catch (e) {
        // Tool-level failures return isError content (per MCP), not a protocol error.
        return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true })
      }
    }
    default:
      if (isRequest) return err(id, -32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const s = line.trim()
  if (!s) return
  let msg
  try { msg = JSON.parse(s) } catch { return } // ignore non-JSON noise
  Promise.resolve(handle(msg)).catch((e) => {
    if (msg?.id !== undefined && msg?.id !== null) err(msg.id, -32603, `Internal error: ${e.message}`)
  })
})
