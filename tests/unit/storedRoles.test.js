import { describe, expect, it } from 'vitest'
import { getStoredRoles, hasAdminRole, isRegularUserRoleSet } from '../../src/utils/storedRoles.js'

function makeStorage(values = {}) {
  return {
    getItem(key) {
      return values[key] ?? null
    }
  }
}

describe('stored roles', () => {
  it('uses cached user roles when token role parsing is unavailable', () => {
    const storage = makeStorage({
      user: JSON.stringify({ roles: ['admin'] }),
      token: 'invalid-token'
    })

    expect(getStoredRoles(storage)).toEqual(['admin'])
    expect(hasAdminRole(getStoredRoles(storage))).toBe(true)
  })

  it('identifies only non-privileged users as regular users', () => {
    expect(isRegularUserRoleSet(['user'])).toBe(true)
    expect(isRegularUserRoleSet([])).toBe(true)
    expect(isRegularUserRoleSet(['admin'])).toBe(false)
    expect(isRegularUserRoleSet(['super'])).toBe(false)
    expect(isRegularUserRoleSet(['agent'])).toBe(false)
    expect(isRegularUserRoleSet(['support'])).toBe(false)
  })
})
