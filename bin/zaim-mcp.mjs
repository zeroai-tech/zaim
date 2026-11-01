#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  zaim-mcp — a Model Context Protocol server for the Zaim mail API.
//
//  Exposes Zaim's agent API (read / list / send / draft / delete mail) as
//  first-class MCP tools, so Claude Code / Codex / any MCP client can manage a
//  mailbox through tool calls instead of shelling out to curl or the CLI.
//
//  Transport: stdio (newline-delimited JSON-RPC 2.0).
//
//  Config (env):
//    ZAIM_URL      base URL of a Zaim deployment (default http://localhost:3000)
//    ZAIM_API_KEY  a per-user Agent Key minted in Zaim ("🔑 Agent keys")
//    ZAIM_SCOPES   optional comma-separated permission scopes (e.g. mail.read,mail.draft)
// ─────────────────────────────────────────────────────────────────────────────
import * as oauth from './lib/oauth.mjs'
import { runStdioServer, ZaimApiClient } from '../lib/mcp/index.mjs'

const authResolver = async () => {
  try {
    const c = await oauth.accessToken()
    if (c?.access_token) return `Bearer stalwart ${c.email} ${c.access_token}`
  } catch {
    /* fall through to ZAIM_API_KEY */
  }
  const key = process.env.ZAIM_API_KEY
  if (key) return `Bearer ${key}`
  throw new Error('Not signed in. Run `zaim login you@yourdomain.com`, or set ZAIM_API_KEY.')
}

const client = new ZaimApiClient({
  authResolver,
})

runStdioServer({ client, authResolver })
