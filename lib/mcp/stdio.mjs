// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/stdio.mjs — Stdio transport runner for local MCP clients
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline'
import { ZaimApiClient } from './client.mjs'
import { handleMcpRequest, makeErrorResponse } from './server.mjs'

export function runStdioServer(options) {
  const client =
    options?.client ||
    new ZaimApiClient({
      authResolver: options?.authResolver,
    })

  const rawScopes = process.env.ZAIM_SCOPES
  const scopes =
    options?.scopes ??
    (rawScopes ? rawScopes.split(',').map((s) => s.trim()).filter(Boolean) : null)

  const rl = createInterface({
    input: options?.input || process.stdin,
    output: options?.output || process.stdout,
    terminal: false,
  })

  const send = (msg) => {
    const out = options?.output || process.stdout
    out.write(JSON.stringify(msg) + '\n')
  }

  rl.on('line', (line) => {
    const s = line.trim()
    if (!s) return

    let request
    try {
      request = JSON.parse(s)
    } catch {
      send(makeErrorResponse(null, -32700, 'Parse error: Invalid JSON'))
      return
    }

    if (!request || typeof request !== 'object' || !request.method) {
      send(makeErrorResponse(request?.id ?? null, -32600, 'Invalid Request: missing `method`'))
      return
    }

    const context = {
      client,
      scopes,
    }

    Promise.resolve(handleMcpRequest(request, context))
      .then((response) => {
        if (response) send(response)
      })
      .catch((err) => {
        if (request.id !== undefined && request.id !== null) {
          send(makeErrorResponse(request.id, -32603, `Internal error: ${err.message || String(err)}`))
        }
      })
  })

  return rl
}
