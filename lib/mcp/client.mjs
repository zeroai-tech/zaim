// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/client.mjs — Zaim API client for local & remote MCP tool execution
// ─────────────────────────────────────────────────────────────────────────────

export class ZaimApiClient {
  constructor(options) {
    this.baseUrl = (options?.baseUrl || process.env.ZAIM_URL || 'http://localhost:3000').replace(/\/$/, '')
    this.defaultKey = options?.defaultKey || process.env.ZAIM_API_KEY || ''
    this.authResolver = options?.authResolver
    this.timeoutMs = options?.timeoutMs || 25000
  }

  async getAuthHeader(explicitToken) {
    if (explicitToken) {
      return explicitToken.startsWith('Bearer ') ? explicitToken : `Bearer ${explicitToken}`
    }
    if (this.authResolver) {
      try {
        const header = await this.authResolver()
        if (header) return header
      } catch {
        /* fall through to default key */
      }
    }
    if (this.defaultKey) {
      return this.defaultKey.startsWith('Bearer ') ? this.defaultKey : `Bearer ${this.defaultKey}`
    }
    throw new Error('Unauthorized: No Zaim API key provided in request or environment.')
  }

  async call(path, init, authToken) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const auth = await this.getAuthHeader(authToken)
      const res = await fetch(this.baseUrl + path, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: auth,
          ...(init?.headers || {}),
        },
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Zaim API error: ${res.status} ${res.statusText}`)
      }
      return body
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Upstream Zaim API request timed out after ${this.timeoutMs}ms`)
      }
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  qs(params) {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '')
    if (!entries.length) return ''
    return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  }

  async getSession(token) {
    return this.call('/api/session', {}, token)
  }

  async getFolders(token) {
    return this.call('/api/mail/folders', {}, token)
  }

  async listMessages(params, token) {
    const query = this.qs({
      mailbox: params.mailbox || 'INBOX',
      limit: params.limit || 40,
      flagged: params.flagged ? '1' : undefined,
    })
    return this.call('/api/mail/list' + query, {}, token)
  }

  async readMessage(uid, mailbox, token) {
    const query = this.qs({ mailbox: mailbox || 'INBOX' })
    return this.call(`/api/mail/message/${uid}` + query, {}, token)
  }

  async sendMessage(payload, token) {
    return this.call(
      '/api/mail/send',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    )
  }

  async createDraft(payload, token) {
    return this.call(
      '/api/mail/draft',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    )
  }

  async deleteMessage(uid, mailbox, trash, token) {
    const mb = mailbox || 'INBOX'
    const query = this.qs({
      mailbox: mb,
      to: trash && trash !== mb ? trash : undefined,
    })
    return this.call(
      `/api/mail/message/${uid}` + query,
      { method: 'DELETE' },
      token
    )
  }
}
