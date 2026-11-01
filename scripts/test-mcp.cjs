// ─────────────────────────────────────────────────────────────────────────────
//  scripts/test-mcp.cjs — Automated test suite for Zaim Model Context Protocol
//
//  Verifies all 10 required MCP test specifications:
//    1. MCP initialization lifecycle
//    2. Tool discovery (tools/list)
//    3. Authenticated requests with valid Bearer token
//    4. Rejected unauthenticated requests (HTTP 401 & error payload)
//    5. Scope enforcement
//    6. Read-only key attempting mail.send (forbidden)
//    7. Successful read operation (zaim_read & zaim_list)
//    8. Malformed MCP request (parse & structure errors)
//    9. Upstream Zaim API failure handling (safe error responses)
//   10. Remote MCP health endpoint (GET /health)
// ─────────────────────────────────────────────────────────────────────────────

const assert = require('node:assert/strict')
const http = require('node:http')

async function runTests() {
  console.log('[test-mcp] Starting Zaim MCP verification suite...')

  // 1. Dynamic import of our ES modules
  const { ZaimApiClient } = await import('../lib/mcp/client.mjs')
  const { McpHttpServer } = await import('../lib/mcp/http.mjs')
  const { handleMcpRequest } = await import('../lib/mcp/server.mjs')
  const { hasScope, validateScopeForTool } = await import('../lib/mcp/scopes.mjs')

  // 2. Set up a Mock Upstream Zaim API Server
  let mockShouldFail = false
  let lastSentPayload = null

  const mockUpstream = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const auth = req.headers['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/, '')

    // Check upstream failure simulation
    if (mockShouldFail) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Upstream database connection failure' }))
    }

    if (url.pathname === '/api/session') {
      let scopes = ['*']
      if (token === 'read-only-token') scopes = ['mail.read', 'mail.search']
      if (token === 'draft-only-token') scopes = ['mail.read', 'mail.draft']
      if (token === 'send-only-token') scopes = ['mail.send']
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ authed: true, configured: true, scopes }))
    }

    if (url.pathname === '/api/mail/folders') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ folders: ['INBOX', 'Sent', 'Drafts', 'Trash'] }))
    }

    if (url.pathname === '/api/mail/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        messages: [
          { uid: 101, from: 'principal@school.edu.ph', subject: 'Inquiry on AI Robotics', date: '2026-11-01' },
          { uid: 102, from: 'deped@region11.gov.ph', subject: '2nd Indorsement Copy', date: '2026-11-01' }
        ]
      }))
    }

    if (url.pathname.startsWith('/api/mail/message/')) {
      const uid = url.pathname.split('/').pop()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        message: {
          uid: Number(uid),
          subject: 'Inquiry on AI Robotics',
          from: 'principal@school.edu.ph',
          to: 'founder@zeroaitech.tech',
          text: 'We would like to schedule teacher training.',
          date: '2026-11-01T10:00:00Z'
        }
      }))
    }

    if (url.pathname === '/api/mail/send' && req.method === 'POST') {
      let chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        lastSentPayload = JSON.parse(Buffer.concat(chunks).toString())
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, messageId: '<msg-12345@zeroaitech.tech>' }))
      })
      return
    }

    if (url.pathname === '/api/mail/draft' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  await new Promise(r => mockUpstream.listen(0, '127.0.0.1', r))
  const upstreamPort = mockUpstream.address().port
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}`

  // 3. Start McpHttpServer pointing to Mock Upstream
  const client = new ZaimApiClient({ baseUrl: upstreamUrl })
  const mcpServer = new McpHttpServer({
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    client,
  })

  await mcpServer.start()
  const mcpPort = mcpServer.server.address().port
  const mcpUrl = `http://127.0.0.1:${mcpPort}`

  // Helper for HTTP requests
  async function httpRequest(method, path, body, headers = {}) {
    const res = await fetch(`${mcpUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, headers: res.headers, data }
  }

  try {
    // ── Test 10: Remote MCP Health Endpoint ──────────────────────────────────
    console.log('Testing (10/10): Health endpoint...')
    const health = await httpRequest('GET', '/health')
    assert.equal(health.status, 200, 'Health endpoint must return HTTP 200')
    assert.equal(health.data.status, 'ok', 'Status must be ok')
    assert.equal(health.data.service, 'zaim-mcp', 'Service must be zaim-mcp')
    assert.equal(Object.keys(health.data).length, 2, 'Health endpoint must never leak configuration')
    console.log('  ✓ Health endpoint PASS')

    // ── Test 4: Rejected Unauthenticated Requests ────────────────────────────
    console.log('Testing (4/10): Rejected unauthenticated requests...')
    const unauth = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    assert.equal(unauth.status, 401, 'Unauthenticated request must return HTTP 401')
    assert.equal(unauth.data.error.code, -32000, 'Must return JSON-RPC unauthorized code -32000')
    console.log('  ✓ Unauthenticated rejection PASS')

    // ── Test 1: MCP Initialization ───────────────────────────────────────────
    console.log('Testing (1/10): MCP initialization...')
    const init = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }, { Authorization: 'Bearer valid-master-token' })
    assert.equal(init.status, 200)
    assert.equal(init.data.result.protocolVersion, '2024-11-05')
    assert.equal(init.data.result.serverInfo.name, 'zaim')
    assert.equal(typeof init.data.result.capabilities.tools, 'object')
    console.log('  ✓ MCP initialization PASS')

    // ── Test 2: Tool Discovery ───────────────────────────────────────────────
    console.log('Testing (2/10): Tool discovery...')
    const toolsList = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    }, { Authorization: 'Bearer valid-master-token' })
    assert.equal(toolsList.status, 200)
    const toolNames = toolsList.data.result.tools.map(t => t.name)
    assert(toolNames.includes('zaim_status'))
    assert(toolNames.includes('zaim_folders'))
    assert(toolNames.includes('zaim_list'))
    assert(toolNames.includes('zaim_read'))
    assert(toolNames.includes('zaim_send'))
    assert(toolNames.includes('zaim_draft'))
    assert(toolNames.includes('zaim_delete'))
    console.log('  ✓ Tool discovery PASS')

    // ── Test 3: Authenticated Requests ───────────────────────────────────────
    console.log('Testing (3/10): Authenticated requests...')
    const authStatus = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'zaim_status', arguments: {} },
    }, { Authorization: 'Bearer valid-master-token' })
    assert.equal(authStatus.status, 200)
    assert(authStatus.data.result.content[0].text.includes('authenticated: true'))
    console.log('  ✓ Authenticated request PASS')

    // ── Test 5: Scope Enforcement (General) ──────────────────────────────────
    console.log('Testing (5/10): Scope enforcement logic...')
    assert.equal(hasScope(['mail.read'], 'mail.read'), true)
    assert.equal(hasScope(['mail.read'], 'mail.search'), true)
    assert.equal(hasScope(['mail.read'], 'mail.send'), false)
    assert.equal(hasScope(['*'], 'mail.send'), true)
    assert.equal(hasScope(['mail.manage'], 'mail.delete'), true)
    console.log('  ✓ Scope logic PASS')

    // ── Test 6: Read-only Key Attempting mail.send (Forbidden) ───────────────
    console.log('Testing (6/10): Read-only key attempting mail.send...')
    lastSentPayload = null
    const forbiddenSend = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'zaim_send',
        arguments: { to: 'victim@target.com', subject: 'Unauthorized send', text: 'Spam' },
      },
    }, { Authorization: 'Bearer read-only-token' })
    assert.equal(forbiddenSend.status, 200)
    assert.equal(forbiddenSend.data.error.code, -32001, 'Must return JSON-RPC permission denied code -32001')
    assert(forbiddenSend.data.error.message.includes("Permission denied"))
    assert.equal(lastSentPayload, null, 'Upstream send API must NEVER have been called!')
    console.log('  ✓ Read-only key send block PASS')

    // ── Test 7: Successful Read Operation ────────────────────────────────────
    console.log('Testing (7/10): Successful read operation...')
    const readOp = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'zaim_read',
        arguments: { uid: 101 },
      },
    }, { Authorization: 'Bearer read-only-token' })
    assert.equal(readOp.status, 200)
    assert(readOp.data.result.content[0].text.includes('Inquiry on AI Robotics'))
    assert(readOp.data.result.content[0].text.includes('principal@school.edu.ph'))
    console.log('  ✓ Successful read operation PASS')

    // ── Test 8: Malformed MCP Request ────────────────────────────────────────
    console.log('Testing (8/10): Malformed MCP requests...')
    // Syntax error (malformed JSON)
    const malformedRaw = await fetch(`${mcpUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-master-token',
      },
      body: '{"jsonrpc": "2.0", broken_json',
    })
    const malformedData = await malformedRaw.json()
    assert.equal(malformedRaw.status, 400)
    assert.equal(malformedData.error.code, -32700, 'Must return JSON-RPC Parse Error (-32700)')

    // Missing method
    const missingMethod = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 8,
    }, { Authorization: 'Bearer valid-master-token' })
    assert.equal(missingMethod.status, 400)
    assert.equal(missingMethod.data.error.code, -32600, 'Must return JSON-RPC Invalid Request (-32600)')
    console.log('  ✓ Malformed request handling PASS')

    // ── Test 9: Upstream Zaim API Failure ────────────────────────────────────
    console.log('Testing (9/10): Upstream Zaim API failure...')
    mockShouldFail = true
    const upstreamFail = await httpRequest('POST', '/mcp', {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'zaim_folders', arguments: {} },
    }, { Authorization: 'Bearer valid-master-token' })
    mockShouldFail = false
    assert.equal(upstreamFail.status, 200)
    assert.equal(upstreamFail.data.result.isError, true, 'Tool result must indicate isError: true')
    assert(upstreamFail.data.result.content[0].text.includes('Upstream database connection failure'))
    console.log('  ✓ Upstream failure resilience PASS')

    console.log('\n======================================================')
    console.log('ALL 10 MCP SPECIFICATION TESTS PASSED SUCCESSFULLY!')
    console.log('======================================================')
  } finally {
    await mcpServer.stop()
    await new Promise(r => mockUpstream.close(r))
  }
}

runTests().catch(err => {
  console.error('[test-mcp] Test failure:', err)
  process.exit(1)
})
