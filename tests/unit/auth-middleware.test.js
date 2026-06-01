import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { createMockReq, createMockRes, createMockNext, createMockDbChain } from '../helpers.js'

const TEST_SECRET = 'test-secret-key-for-testing-only'

const mockDbChain = createMockDbChain()
vi.mock('../../server/db.js', () => ({ default: vi.fn(() => mockDbChain) }))
vi.mock('../../server/config/index.js', () => ({
  default: { jwt: { secret: TEST_SECRET, expiresIn: '7d' } }
}))

const { authRequired, roleRequired, generateToken } = await import('../../server/middleware/auth.js')

describe('authRequired middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no Authorization header', async () => {
    const req = createMockReq({ headers: {} })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(401)
    expect(res.body.message).toBe('未登录')
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 when Authorization header has no Bearer prefix', async () => {
    const req = createMockReq({ headers: { authorization: 'Token abc' } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 when token is invalid', async () => {
    const req = createMockReq({ headers: { authorization: 'Bearer invalid.token.here' } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.message).toBe('登录已过期')
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 when user not found in database', async () => {
    const token = jwt.sign({ id: 999, username: 'ghost', roles: ['user'], tv: 1 }, TEST_SECRET)
    mockDbChain.first.mockResolvedValueOnce(null)

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.message).toBe('用户不存在')
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 403 when user is disabled', async () => {
    const token = jwt.sign({ id: 1, username: 'banned', roles: ['user'], tv: 1 }, TEST_SECRET)
    mockDbChain.first.mockResolvedValueOnce({ token_version: 1, status: 'disabled' })

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.message).toBe('账户已被禁用')
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 (code 4011) when token version mismatch', async () => {
    const token = jwt.sign({ id: 1, username: 'test', roles: ['user'], tv: 1 }, TEST_SECRET)
    mockDbChain.first.mockResolvedValueOnce({ token_version: 2, status: 'active' })

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(4011)
    expect(res.body.message).toContain('重新登录')
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 when token has no tv field (old token)', async () => {
    const token = jwt.sign({ id: 1, username: 'test', roles: ['user'] }, TEST_SECRET)
    mockDbChain.first.mockResolvedValueOnce({ token_version: 1, status: 'active' })

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe(4011)
    expect(next).not.toHaveBeenCalled()
  })

  it('should call next() and set req.user on valid token', async () => {
    const payload = { id: 1, username: 'testuser', roles: ['user'], tv: 1 }
    const token = jwt.sign(payload, TEST_SECRET)
    mockDbChain.first.mockResolvedValueOnce({ token_version: 1, status: 'active' })

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toBeDefined()
    expect(req.user.id).toBe(1)
    expect(req.user.username).toBe('testuser')
    expect(req.user.roles).toEqual(['user'])
  })

  it('should return 401 when token is expired', async () => {
    const token = jwt.sign({ id: 1, username: 'test', roles: ['user'], tv: 1 }, TEST_SECRET, { expiresIn: '-1s' })

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 401 when token signed with wrong secret', async () => {
    const token = jwt.sign({ id: 1, username: 'test', roles: ['user'], tv: 1 }, 'wrong-secret')

    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } })
    const res = createMockRes()
    const next = createMockNext()

    await authRequired(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('roleRequired middleware', () => {
  it('should pass when user has required role', () => {
    const middleware = roleRequired('admin')
    const req = createMockReq({ user: { roles: ['admin'] } })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('should pass when user has one of the allowed roles', () => {
    const middleware = roleRequired('admin', 'agent')
    const req = createMockReq({ user: { roles: ['agent'] } })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('should return 403 when user lacks required role', () => {
    const middleware = roleRequired('admin')
    const req = createMockReq({ user: { roles: ['user'] } })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.message).toBe('权限不足')
    expect(next).not.toHaveBeenCalled()
  })

  it('should pass for super role regardless of required roles', () => {
    const middleware = roleRequired('admin')
    const req = createMockReq({ user: { roles: ['super'] } })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('should return 403 when user has no roles', () => {
    const middleware = roleRequired('admin')
    const req = createMockReq({ user: { roles: [] } })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('should return 403 when user object has no roles property', () => {
    const middleware = roleRequired('admin')
    const req = createMockReq({ user: {} })
    const res = createMockRes()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('generateToken', () => {
  it('should generate a valid JWT token', () => {
    const user = { id: 1, username: 'test', roles: [{ code: 'user' }], token_version: 1 }
    const token = generateToken(user)

    const decoded = jwt.verify(token, TEST_SECRET)
    expect(decoded.id).toBe(1)
    expect(decoded.username).toBe('test')
    expect(decoded.roles).toEqual(['user'])
    expect(decoded.tv).toBe(1)
  })

  it('should handle roles as string array', () => {
    const user = { id: 2, username: 'admin', roles: ['admin', 'user'], token_version: 3 }
    const token = generateToken(user)

    const decoded = jwt.verify(token, TEST_SECRET)
    expect(decoded.roles).toEqual(['admin', 'user'])
    expect(decoded.tv).toBe(3)
  })

  it('should default token_version to 1', () => {
    const user = { id: 1, username: 'test', roles: [] }
    const token = generateToken(user)

    const decoded = jwt.verify(token, TEST_SECRET)
    expect(decoded.tv).toBe(1)
  })
})
