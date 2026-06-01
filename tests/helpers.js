import { vi } from 'vitest'
import jwt from 'jsonwebtoken'

const TEST_JWT_SECRET = 'test-secret-key-for-testing-only'

export function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(data) {
      res.body = data
      return res
    },
    type() { return res },
    send(data) { res.body = data; return res }
  }
  return res
}

export function createMockReq(overrides = {}) {
  return {
    headers: {},
    body: {},
    query: {},
    params: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    user: null,
    ...overrides
  }
}

export function createMockNext() {
  return vi.fn()
}

export function generateTestToken(payload = {}, secret = TEST_JWT_SECRET) {
  const defaults = {
    id: 1,
    username: 'testuser',
    roles: ['user'],
    tv: 1
  }
  return jwt.sign({ ...defaults, ...payload }, secret, { expiresIn: '1h' })
}

export function generateAdminToken(payload = {}) {
  return generateTestToken({ roles: ['admin'], ...payload })
}

export function createMockDbChain(resolveValue = null) {
  const chain = {}
  const methods = [
    'where', 'whereIn', 'whereNotIn', 'whereNull', 'whereNotNull',
    'andWhere', 'orWhere', 'select', 'limit', 'offset', 'orderBy',
    'join', 'leftJoin', 'groupBy', 'forUpdate', 'clone',
    'countDistinct', 'on', 'andOn'
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.first = vi.fn().mockResolvedValue(resolveValue)
  chain.insert = vi.fn().mockResolvedValue([1])
  chain.update = vi.fn().mockResolvedValue(1)
  chain.del = vi.fn().mockResolvedValue(1)
  chain.increment = vi.fn().mockResolvedValue(1)
  chain.count = vi.fn().mockResolvedValue([{ total: 0 }])
  chain.pluck = vi.fn().mockResolvedValue([])
  chain.then = vi.fn((resolve) => Promise.resolve(resolveValue).then(resolve))
  chain[Symbol.iterator] = function* () { if (resolveValue) yield resolveValue }
  return chain
}

export function createMockDb() {
  const chains = new Map()

  const db = vi.fn((table) => {
    if (chains.has(table)) return chains.get(table)
    return createMockDbChain()
  })

  db._chains = chains
  db.configureTable = (table, resolveValue) => {
    chains.set(table, createMockDbChain(resolveValue))
    return chains.get(table)
  }
  db.schema = {
    hasTable: vi.fn().mockResolvedValue(true),
    hasColumn: vi.fn().mockResolvedValue(true),
    alterTable: vi.fn().mockResolvedValue(undefined)
  }
  db.raw = vi.fn((str) => str)
  db.transaction = vi.fn().mockResolvedValue({
    commit: vi.fn(),
    rollback: vi.fn()
  })
  db.client = { pool: { acquire: vi.fn().mockReturnValue({ promise: Promise.resolve({}) }) } }

  return db
}
