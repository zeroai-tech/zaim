// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/http.mjs — Production-ready Remote HTTP MCP Transport Server
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http'
import crypto from 'node:crypto'
import { ZaimApiClient } from './client.mjs'
import { handleMcpRequest, makeErrorResponse } from './server.mjs'

export class McpHttpServer {
  constructor(options) {
    this.host = options?.host || process.env.ZAIM_MCP_HOST || '0.0.0.0'
    const portEnv = process.env.ZAIM_MCP_PORT || process.env.PORT
    this.port = options?.port || (portEnv ? parseInt(portEnv, 10) : 3001)
    this.path = (options?.path || process.env.ZAIM_MCP_PATH || '/mcp').replace(/\/$/, '') || '/mcp'
    this.client = options?.client || new ZaimApiClient()
    this.maxBodyBytes = options?.maxBodyBytes || 5 * 1024 * 1024 // 5 MB limit
    this.allowAnonymous = options?.allowAnonymous ?? false

    this.server = null
    this.sessions = new Map()
    this.tokenScopeCache = new Map()
  }

  /**
   * Resolves scopes for an API key token.
   * Caches resolved scopes for 60 seconds to avoid repeating /api/session requests.
   */
  async resolveScopes(token) {
    const cached = this.tokenScopeCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.scopes
    }

    try {
      const session = await this.client.getSession(token)
      if (session && session.authed) {
        const scopes = session.scopes || null
        this.tokenScopeCache.set(token, { scopes, expiresAt: Date.now() + 60_000 })
        return scopes
      }
    } catch {
      // Fallback: check if local env ZAIM_SCOPES is configured
      if (process.env.ZAIM_SCOPES) {
        const scopes = process.env.ZAIM_SCOPES.split(',').map((s) => s.trim()).filter(Boolean)
        return scopes
      }
    }

    return null
  }

  /**
   * Extracts Bearer token from the incoming HTTP request.
   */
  extractToken(req) {
    const auth = req.headers['authorization']
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim()
    }
    // Also check query param ?token= for SSE handshakes where headers cannot be set in browser EventSource
    try {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
      const queryToken = url.searchParams.get('token') || url.searchParams.get('api_key')
      if (queryToken) return queryToken.trim()
    } catch {
      /* ignore */
    }
    return null
  }

  sendJson(res, statusCode, data, headers) {
    const body = JSON.stringify(data)
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      ...(headers || {}),
    })
    res.end(body)
  }

  handleCors(res) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Accept, Last-Event-ID',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
  }

  /**
   * Handles incoming HTTP requests.
   */
  async handleRequest(req, res) {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname.replace(/\/$/, '') || '/'

    // 1. CORS Preflight
    if (req.method === 'OPTIONS') {
      return this.handleCors(res)
    }

    // 2. Health Endpoint
    if (pathname === '/health' && req.method === 'GET') {
      return this.sendJson(res, 200, {
        status: 'ok',
        service: 'zaim-mcp',
      })
    }

    // 3. Routing check for MCP endpoint
    if (pathname !== this.path) {
      return this.sendJson(res, 404, {
        error: `Not Found. Zaim MCP endpoint is located at POST ${this.path}`,
      })
    }

    // 4. Session Identification & Tracking
    const rawSessionId = req.headers['mcp-session-id']
    const sessionId = (typeof rawSessionId === 'string' && rawSessionId.trim()) ? rawSessionId.trim() : crypto.randomUUID()
    const sessionHeaders = {
      'Mcp-Session-Id': sessionId,
    }

    // 5. Authentication check
    let token = this.extractToken(req)
    if (!token && this.allowAnonymous && this.client.defaultKey) {
      token = this.client.defaultKey
    }

    if (!token) {
      return this.sendJson(
        res,
        401,
        makeErrorResponse(null, -32000, 'Unauthorized: Missing `Authorization: Bearer <ZAIM_API_KEY>` header.'),
        sessionHeaders
      )
    }

    // 6. DELETE /mcp (Session termination)
    if (req.method === 'DELETE') {
      this.sessions.delete(sessionId)
      return this.sendJson(res, 200, { status: 'session terminated', sessionId }, sessionHeaders)
    }

    // 7. GET /mcp (SSE streaming handshake)
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        ...sessionHeaders,
      })

      // Send initial connect event
      res.write(`event: endpoint\ndata: ${JSON.stringify({ endpoint: this.path, sessionId })}\n\n`)

      // Keepalive heartbeat
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(': heartbeat\n\n')
        }
      }, 25000)

      req.on('close', () => {
        clearInterval(heartbeat)
      })
      return
    }

    // 8. POST /mcp (Streamable HTTP JSON-RPC execution)
    if (req.method === 'POST') {
      const chunks = []
      let totalSize = 0

      req.on('data', (chunk) => {
        totalSize += chunk.length
        if (totalSize > this.maxBodyBytes) {
          req.destroy()
          return this.sendJson(
            res,
            413,
            makeErrorResponse(null, -32600, `Payload too large. Exceeds ${this.maxBodyBytes} bytes.`),
            sessionHeaders
          )
        }
        chunks.push(chunk)
      })

      req.on('end', async () => {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim()
        if (!rawBody) {
          return this.sendJson(
            res,
            400,
            makeErrorResponse(null, -32600, 'Invalid Request: Empty body.'),
            sessionHeaders
          )
        }

        let jsonRpcReq
        try {
          jsonRpcReq = JSON.parse(rawBody)
        } catch {
          return this.sendJson(
            res,
            400,
            makeErrorResponse(null, -32700, 'Parse error: Malformed JSON.'),
            sessionHeaders
          )
        }

        if (!jsonRpcReq || typeof jsonRpcReq !== 'object' || !jsonRpcReq.method) {
          return this.sendJson(
            res,
            400,
            makeErrorResponse(jsonRpcReq?.id ?? null, -32600, 'Invalid Request: Missing `method`.'),
            sessionHeaders
          )
        }

        try {
          const scopes = await this.resolveScopes(token)

          const context = {
            client: this.client,
            authToken: token,
            scopes,
            sessionId,
          }

          const response = await handleMcpRequest(jsonRpcReq, context)

          if (response == null) {
            // Notification: acknowledge with HTTP 204 No Content
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              ...sessionHeaders,
            })
            return res.end()
          }

          const acceptHeader = req.headers['accept'] || ''
          const isStreaming = acceptHeader.includes('text/event-stream')

          if (isStreaming) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*',
              ...sessionHeaders,
            })
            res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
            return res.end()
          }

          return this.sendJson(res, 200, response, sessionHeaders)
        } catch (err) {
          return this.sendJson(
            res,
            500,
            makeErrorResponse(
              jsonRpcReq.id ?? null,
              -32603,
              `Internal server error: ${err.message || String(err)}`
            ),
            sessionHeaders
          )
        }
      })

      req.on('error', (err) => {
        this.sendJson(
          res,
          500,
          makeErrorResponse(null, -32603, `Socket read error: ${err.message}`),
          sessionHeaders
        )
      })
      return
    }

    // Unsupported method
    return this.sendJson(res, 405, { error: `Method ${req.method} not allowed` })
  }

  /**
   * Starts the HTTP server on configured host and port.
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            this.sendJson(res, 500, makeErrorResponse(null, -32603, `Unhandled error: ${err.message}`))
          }
        })
      })

      this.server.on('error', reject)

      this.server.listen(this.port, this.host, () => {
        resolve(this.server)
      })
    })
  }

  /**
   * Stops the HTTP server gracefully.
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }
}
