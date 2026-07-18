// Legacy single-account mode: one shared API key (ZAIM_API_KEY) gates the
// server's env-configured mailbox. Multi-user mode instead resolves identity
// per-request — see resolveForRequest() in lib/resolve.ts, which checks a
// per-user vault key first and falls back to this env key for single-account
// deployments.
export function apiKey(): string {
  return process.env.ZAIM_API_KEY || ''
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
