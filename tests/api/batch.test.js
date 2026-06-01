import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const TEST_SECRET = 'test-secret-key-for-testing-only'

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 1, username: 'testuser', roles: ['user'], tv: 1, ...payload },
    TEST_SECRET
  )
}

const mockDbChainResult = { token_version: 1, status: 'active' }
const mockDbChain = {
  where: vi.fn().mockReturnThis(),
  whereIn: vi.fn().mockReturnThis(),
  whereNotIn: vi.fn().mockReturnThis(),
  whereNull: vi.fn().mockReturnThis(),
  whereNotNull: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(mockDbChainResult),
  insert: vi.fn().mockResolvedValue([1]),
  update: vi.fn().mockResolvedValue(1),
  increment: vi.fn().mockResolvedValue(1),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  join: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  forUpdate: vi.fn().mockReturnThis(),
  pluck: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue([{ total: 0 }]),
  then: vi.fn((cb) => Promise.resolve([]).then(cb))
}

const mockDb = vi.fn(() => ({ ...mockDbChain }))
mockDb.schema = {
  hasTable: vi.fn().mockResolvedValue(true),
  hasColumn: vi.fn().mockResolvedValue(true),
  alterTable: vi.fn().mockResolvedValue(undefined)
}
mockDb.raw = vi.fn((str) => str)
mockDb.transaction = vi.fn()
mockDb.client = { pool: { acquire: vi.fn().mockReturnValue({ promise: Promise.resolve({}) }) } }

vi.mock('../../server/db.js', () => ({ default: mockDb }))
vi.mock('../../server/config/index.js', () => ({
  default: { jwt: { secret: TEST_SECRET, expiresIn: '7d' } }
}))

vi.mock('../../server/models/Config.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      unit_price: 0.01,
      min_quantity: 10,
      types: [
        { key: 'read', label: '阅读', enabled: true },
        { key: 'like', label: '点赞', enabled: true },
        { key: 'impression', label: '曝光', enabled: true }
      ]
    }),
    set: vi.fn().mockResolvedValue(true)
  }
}))

vi.mock('../../server/models/Product.js', () => ({
  default: {
    getByType: vi.fn().mockResolvedValue({
      id: 1,
      name: '小红书阅读',
      target_type: 'read',
      unit_price: 0.01,
      min_quantity: 10,
      status: 'on'
    })
  }
}))

vi.mock('../../server/models/AgentPrice.js', () => ({
  default: {
    resolvePrice: vi.fn().mockResolvedValue(0.01)
  }
}))

vi.mock('../../server/models/Task.js', () => ({
  default: {
    getReplenishmentByOrderId: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('../../server/services/noteApi.js', () => ({
  collectSnapshots: vi.fn().mockResolvedValue(new Map()),
  fetchSnapshot: vi.fn().mockResolvedValue({}),
  fetchNoteId: vi.fn().mockResolvedValue('note123'),
  fetchNoteBasic: vi.fn().mockResolvedValue({
    author_id: 'author1',
    author_name: 'Author',
    title: 'Test Note',
    avatar_url: ''
  })
}))

vi.mock('../../server/services/xhsApi.js', () => ({
  cancelTask: vi.fn().mockResolvedValue({ success: true })
}))

const { default: batchRoutes } = await import('../../server/routes/batch.js')
const noteApi = await import('../../server/services/noteApi.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/batch', batchRoutes)
  return app
}

function makeTransaction({ balance = 100 } = {}) {
  const inserts = {
    order_batches: [],
    orders: [],
    account_records: []
  }

  function trx(table) {
    const chain = {
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(table === 'balance_accounts'
        ? { available_amount: balance }
        : null),
      insert: vi.fn(async (row) => {
        if (inserts[table]) inserts[table].push(row)
        return [inserts[table]?.length || 1]
      }),
      update: vi.fn().mockResolvedValue(1)
    }
    return chain
  }

  trx.commit = vi.fn().mockResolvedValue(undefined)
  trx.rollback = vi.fn().mockResolvedValue(undefined)
  trx.inserts = inserts
  return trx
}

describe('GET /api/batch/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 401 without auth token', async () => {
    const app = createApp()
    const res = await request(app).get('/api/batch/config')

    expect(res.status).toBe(401)
  })

  it('should return batch config with valid token', async () => {
    const app = createApp()
    const res = await request(app)
      .get('/api/batch/config')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.types).toBeDefined()
    expect(res.body.data.types).toHaveLength(3)
  })
})

describe('POST /api/batch/prevalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
    mockDbChain.select.mockReturnValue({ ...mockDbChain, then: vi.fn((cb) => Promise.resolve([]).then(cb)) })
  })

  it('should return 401 without auth', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .send({ urls: ['https://www.xiaohongshu.com/note/123'], type: 'read' })

    expect(res.status).toBe(401)
  })

  it('should return 400 when urls is empty', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: [], type: 'read' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('链接')
  })

  it('should return 400 when urls is not an array', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: 'not-an-array', type: 'read' })

    expect(res.status).toBe(400)
  })

  it('should reject non-XHS URLs', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: ['https://google.com/test'], type: 'read' })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].valid).toBe(false)
    expect(res.body.data.results[0].message).toContain('小红书')
  })

  it('should reject empty URLs', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: ['', '  '], type: 'read' })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].valid).toBe(false)
    expect(res.body.data.results[1].valid).toBe(false)
  })

  it('should reject URLs without http(s) protocol', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: ['ftp://xiaohongshu.com/test'], type: 'read' })

    expect(res.status).toBe(200)
    expect(res.body.data.results[0].valid).toBe(false)
    expect(res.body.data.results[0].message).toContain('格式')
  })

  it('should detect duplicate URLs', async () => {
    const url = 'https://www.xiaohongshu.com/note/123'
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/prevalidate')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ urls: [url, url], type: 'read' })

    expect(res.status).toBe(200)
    const results = res.body.data.results
    expect(results[1].valid).toBe(false)
    expect(results[1].message).toContain('重复')
  })
})

describe('POST /api/batch/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 401 without auth', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .send({
        type: 'read',
        lines: [{ url: 'https://www.xiaohongshu.com/note/123', quantity: 100 }]
      })

    expect(res.status).toBe(401)
  })

  it('should return 400 when type is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ lines: [{ url: 'https://www.xiaohongshu.com/note/123', quantity: 100 }] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('参数')
  })

  it('should return 400 when lines is empty', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ type: 'read', lines: [] })

    expect(res.status).toBe(400)
  })

  it('should return 400 when lines is not array', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ type: 'read', lines: 'not-array' })

    expect(res.status).toBe(400)
  })

  it('should reject submit when backend prevalidation fails', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        type: 'read',
        lines: [{ url: 'https://google.com/test', quantity: 100 }]
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('预校验')
    expect(mockDb.transaction).not.toHaveBeenCalled()
  })

  it('should save note metadata resolved during backend prevalidation', async () => {
    const trx = makeTransaction()
    mockDb.transaction.mockResolvedValueOnce(trx)
    noteApi.collectSnapshots.mockResolvedValueOnce(new Map())

    const app = createApp()
    const res = await request(app)
      .post('/api/batch/submit')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        type: 'read',
        lines: [{ url: 'https://www.xiaohongshu.com/note/123', quantity: 100 }]
      })

    expect(res.status).toBe(200)
    expect(trx.inserts.orders[0]).toMatchObject({
      note_id: 'note123',
      author_id: 'author1',
      author_name: 'Author',
      title: 'Test Note'
    })
  })
})

describe('PUT /api/batch/config (admin only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 403 for non-admin user', async () => {
    const app = createApp()
    const res = await request(app)
      .put('/api/batch/config')
      .set('Authorization', `Bearer ${makeToken({ roles: ['user'] })}`)
      .send({ types: [{ key: 'read', enabled: false }] })

    expect(res.status).toBe(403)
  })

  it('should allow admin to update config', async () => {
    const app = createApp()
    const res = await request(app)
      .put('/api/batch/config')
      .set('Authorization', `Bearer ${makeToken({ roles: ['admin'] })}`)
      .send({ types: [{ key: 'read', enabled: false }] })

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
  })
})
