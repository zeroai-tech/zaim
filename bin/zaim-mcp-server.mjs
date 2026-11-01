#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  zaim-mcp-server — Remote HTTP Model Context Protocol server for Zaim
//
//  Serves the Model Context Protocol over Streamable HTTP (POST /mcp) and SSE (GET /mcp),
//  enabling remote AI clients such as ChatGPT, Claude, and Cursor to securely connect
//  to a Zaim mailbox over the internet.
//
//  Config (env):
//    ZAIM_URL       URL of the Zaim web deployment (default: http://localhost:3000)
//    ZAIM_MCP_HOST  Interface to bind (default: 0.0.0.0)
//    ZAIM_MCP_PORT  Port to listen on (default: 3001, respects PORT)
//    ZAIM_MCP_PATH  MCP endpoint path (default: /mcp)
//    ZAIM_API_KEY   Optional default API key for single-tenant server mode
//    ZAIM_SCOPES    Optional comma-separated scopes for the default key
// ─────────────────────────────────────────────────────────────────────────────

import { McpHttpServer } from '../lib/mcp/index.mjs'

const host = process.env.ZAIM_MCP_HOST || '0.0.0.0'
const port = parseInt(process.env.ZAIM_MCP_PORT || process.env.PORT || '3001', 10)
const path = (process.env.ZAIM_MCP_PATH || '/mcp').replace(/\/$/, '') || '/mcp'
const zaimUrl = process.env.ZAIM_URL || 'http://localhost:3000'

const server = new McpHttpServer({
  host,
  port,
  path,
  allowAnonymous: !!process.env.ZAIM_ALLOW_ANONYMOUS,
})

server
  .start()
  .then(() => {
    console.log(`[zaim-mcp] Server running on http://${host}:${port}`)
    console.log(`[zaim-mcp] MCP Endpoint:  http://${host}:${port}${path}`)
    console.log(`[zaim-mcp] Health Check:  http://${host}:${port}/health`)
    console.log(`[zaim-mcp] Upstream Zaim: ${zaimUrl}`)
    console.log(`[zaim-mcp] Auth:          Bearer <ZAIM_API_KEY> required`)
  })
  .catch((err) => {
    console.error(`[zaim-mcp] Failed to start server:`, err.message)
    process.exit(1)
  })

// Graceful shutdown
const shutdown = () => {
  console.log('\n[zaim-mcp] Shutting down server gracefully...')
  server.stop().then(() => {
    console.log('[zaim-mcp] Server stopped.')
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
