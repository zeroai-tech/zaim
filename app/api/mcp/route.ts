import { ZaimApiClient, handleMcpRequest, makeErrorResponse } from '@/lib/mcp/index.mjs'
import { findByApiKey } from '@/lib/store'
import { apiKey } from '@/lib/auth'
import crypto from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function corsHeaders(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Accept',
    ...extra,
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  // Health check query
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ status: 'ok', service: 'zaim-mcp' }), {
      status: 200,
      headers: corsHeaders({ 'content-type': 'application/json' }),
    })
  }

  // SSE handshake
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${JSON.stringify({ endpoint: '/api/mcp' })}\n\n`))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: corsHeaders({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    }),
  })
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const token = bearer || url.searchParams.get('key') || url.searchParams.get('token') || url.searchParams.get('api_key') || ''

  if (!token) {
    return new Response(
      JSON.stringify(
        makeErrorResponse(null, -32000, 'Unauthorized: Missing `Authorization: Bearer <ZAIM_API_KEY>` header or `?key=<ZAIM_API_KEY>` parameter.')
      ),
      {
        status: 401,
        headers: corsHeaders({
          'content-type': 'application/json',
          'WWW-Authenticate': 'Bearer error="invalid_token", error_description="Missing API key"',
        }),
      }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify(makeErrorResponse(null, -32700, 'Parse error: Malformed JSON.')),
      { status: 400, headers: corsHeaders({ 'content-type': 'application/json' }) }
    )
  }

  if (!body || typeof body !== 'object' || !body.method) {
    return new Response(
      JSON.stringify(makeErrorResponse(body?.id ?? null, -32600, 'Invalid Request: Missing `method`.')),
      { status: 400, headers: corsHeaders({ 'content-type': 'application/json' }) }
    )
  }

  // Resolve scopes for this key
  let scopes: string[] | null = null
  const owner = await findByApiKey(token)
  if (owner) {
    scopes = owner.scopes
  } else {
    const serverKey = apiKey()
    if (serverKey && token.length === serverKey.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(serverKey))) {
      scopes = process.env.ZAIM_SCOPES ? process.env.ZAIM_SCOPES.split(',').map((s) => s.trim()).filter(Boolean) : null
    }
  }

  const client = new ZaimApiClient({
    baseUrl: `${url.protocol}//${url.host}`,
  })

  const context = {
    client,
    authToken: token,
    scopes,
  }

  try {
    const response = await handleMcpRequest(body, context)
    if (response == null) {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: corsHeaders({ 'content-type': 'application/json' }),
    })
  } catch (err: any) {
    return new Response(
      JSON.stringify(makeErrorResponse(body.id ?? null, -32603, `Internal server error: ${err.message}`)),
      { status: 500, headers: corsHeaders({ 'content-type': 'application/json' }) }
    )
  }
}
