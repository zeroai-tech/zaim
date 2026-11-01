// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/server.mjs — MCP protocol engine (JSON-RPC 2.0 dispatch)
// ─────────────────────────────────────────────────────────────────────────────

import { MCP_TOOLS, executeTool } from './tools.mjs'

export const MCP_SERVER_NAME = 'zaim'
export const MCP_SERVER_VERSION = '0.3.0'
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05'

export function makeOkResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    result,
  }
}

export function makeErrorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  }
}

/**
 * Handles incoming JSON-RPC 2.0 requests according to the Model Context Protocol.
 */
export async function handleMcpRequest(request, context) {
  const { id, method, params } = request || {}
  const isNotification = id === undefined || id === null

  switch (method) {
    case 'initialize': {
      const clientProtocol = params?.protocolVersion || DEFAULT_PROTOCOL_VERSION
      return makeOkResponse(id, {
        protocolVersion: clientProtocol,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        instructions:
          'Zaim MCP provides secure access to your configured mailbox. Use zaim_status to verify connection and permissions.',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      // MCP notifications do not return responses
      return null

    case 'ping':
      return makeOkResponse(id, {})

    case 'tools/list':
      return makeOkResponse(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'tools/call': {
      if (!params || typeof params !== 'object') {
        return makeErrorResponse(id, -32602, 'Invalid params: expected object with `name` and optional `arguments`')
      }

      const toolName = params.name
      if (!toolName || typeof toolName !== 'string') {
        return makeErrorResponse(id, -32602, 'Missing tool name in `params.name`')
      }

      try {
        const result = await executeTool(toolName, params.arguments || {}, context)
        return makeOkResponse(id, result)
      } catch (err) {
        if (err.message?.startsWith('Permission denied:')) {
          return makeErrorResponse(id, -32001, err.message)
        }
        if (err.message?.startsWith('Unknown tool:')) {
          return makeErrorResponse(id, -32602, err.message)
        }
        return makeOkResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }],
          isError: true,
        })
      }
    }

    default:
      if (!isNotification) {
        return makeErrorResponse(id, -32601, `Method not found: ${method}`)
      }
      return null
  }
}
