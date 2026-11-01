export const SCOPE_MAIL_READ: string
export const SCOPE_MAIL_SEARCH: string
export const SCOPE_MAIL_DRAFT: string
export const SCOPE_MAIL_SEND: string
export const SCOPE_MAIL_DELETE: string
export const SCOPE_MAIL_MANAGE: string

export const ALL_SCOPES: readonly string[]
export const PRIVILEGED_SCOPES: readonly string[]
export const SCOPE_DESCRIPTIONS: Record<string, string>

export function hasScope(granted: string[] | null | undefined, required: string): boolean
export function validateScopeForTool(granted: string[] | null | undefined, toolName: string, requiredScope: string): void

export class ZaimApiClient {
  readonly baseUrl: string
  readonly defaultKey: string
  constructor(options?: { baseUrl?: string; defaultKey?: string; authResolver?: () => Promise<string>; timeoutMs?: number })
  getAuthHeader(explicitToken?: string): Promise<string>
  call<T = any>(path: string, init?: RequestInit, authToken?: string): Promise<T>
  getSession(token?: string): Promise<{ authed: boolean; configured: boolean; scopes?: string[] }>
  getFolders(token?: string): Promise<{ folders: any[] }>
  listMessages(params: { mailbox?: string; limit?: number; flagged?: boolean }, token?: string): Promise<{ messages: any[] }>
  readMessage(uid: number, mailbox?: string, token?: string): Promise<{ message: any }>
  sendMessage(payload: { to: string; subject: string; text?: string; html?: string; cc?: string; bcc?: string }, token?: string): Promise<{ ok: boolean; messageId: string; sentWarning?: string }>
  createDraft(payload: { to: string; subject: string; text?: string; html?: string; cc?: string; bcc?: string }, token?: string): Promise<{ ok: boolean }>
  deleteMessage(uid: number, mailbox?: string, trash?: string, token?: string): Promise<{ ok: boolean }>
}

export const MCP_TOOLS: any[]
export const MCP_TOOL_MAP: Record<string, any>
export function executeTool(toolName: string, args: Record<string, any>, ctx: any): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>

export function handleMcpRequest(request: any, context: any): Promise<any>
export function runStdioServer(options?: any): any

export class McpHttpServer {
  readonly host: string
  readonly port: number
  readonly path: string
  readonly client: ZaimApiClient
  readonly maxBodyBytes: number
  readonly allowAnonymous: boolean
  constructor(options?: { host?: string; port?: number; path?: string; client?: ZaimApiClient; maxBodyBytes?: number; allowAnonymous?: boolean })
  handleRequest(req: any, res: any): Promise<void>
  start(): Promise<any>
  stop(): Promise<void>
}
