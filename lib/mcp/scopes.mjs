// ─────────────────────────────────────────────────────────────────────────────
//  lib/mcp/scopes.mjs — Permission scopes checking & server-side enforcement
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCOPE_MAIL_READ,
  SCOPE_MAIL_SEARCH,
  SCOPE_MAIL_MANAGE,
} from './types.mjs'

/**
 * Checks whether the granted scopes satisfy the required permission scope.
 * 
 * - If granted is null or undefined, defaults to true (unconstrained key).
 * - Wildcards ('*', 'all', 'mail.manage') satisfy all scopes.
 * - 'mail.read' and 'mail.search' mutually satisfy inspection operations.
 */
export function hasScope(granted, required) {
  if (granted == null) return true // unconstrained key
  if (!Array.isArray(granted)) return false

  const normalized = granted.map((s) => String(s).trim().toLowerCase())
  if (
    normalized.includes('*') ||
    normalized.includes('all') ||
    normalized.includes(SCOPE_MAIL_MANAGE)
  ) {
    return true
  }

  const req = String(required).trim().toLowerCase()
  if (normalized.includes(req)) return true

  // Interoperability: search allows read, read allows search
  if (req === SCOPE_MAIL_SEARCH && normalized.includes(SCOPE_MAIL_READ)) return true
  if (req === SCOPE_MAIL_READ && normalized.includes(SCOPE_MAIL_SEARCH)) return true

  return false
}

/**
 * Validates scope authorization server-side for a specific tool.
 * Throws an Error if unauthorized.
 */
export function validateScopeForTool(granted, toolName, requiredScope) {
  if (!hasScope(granted, requiredScope)) {
    const grantedStr = granted && granted.length ? granted.join(', ') : 'none'
    throw new Error(
      `Permission denied: Key scopes [${grantedStr}] do not include required scope '${requiredScope}' for tool '${toolName}'.`
    )
  }
}
