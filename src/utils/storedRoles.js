function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  if (typeof atob === 'function') return atob(padded)
  if (typeof Buffer !== 'undefined') return Buffer.from(padded, 'base64').toString('utf-8')
  return ''
}

function getTokenRoles(storage) {
  const token = storage?.getItem?.('token')
  const payload = token?.split('.')?.[1]
  if (!payload) return []
  const decoded = safeJsonParse(decodeBase64Url(payload))
  return Array.isArray(decoded?.roles) ? decoded.roles : []
}

function getCachedUserRoles(storage) {
  const user = safeJsonParse(storage?.getItem?.('user') || '')
  return Array.isArray(user?.roles) ? user.roles : []
}

export function getStoredRoles(storage = globalThis.localStorage) {
  const userRoles = getCachedUserRoles(storage)
  if (userRoles.length) return userRoles
  return getTokenRoles(storage)
}

export function hasAdminRole(roles = []) {
  return roles.includes('admin') || roles.includes('super')
}

export function isRegularUserRoleSet(roles = []) {
  return !roles.includes('admin') &&
    !roles.includes('super') &&
    !roles.includes('agent') &&
    !roles.includes('support')
}
