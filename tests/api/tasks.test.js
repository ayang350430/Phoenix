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
  pluck: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue([{ total: 0 }])
}

vi.mock('../../server/db.js', () => ({
  default: vi.fn(() => ({ ...mockDbChain }))
}))

vi.mock('../../server/config/index.js', () => ({
  default: { jwt: { secret: TEST_SECRET, expiresIn: '7d' } }
}))

vi.mock('../../server/models/User.js', () => ({
  default: {
    getVisibleUserIds: vi.fn().mockResolvedValue([1])
  }
}))

vi.mock('../../server/models/Task.js', () => ({
  default: {
    listBatches: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getBatch: vi.fn(),
    listOrders: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getOrder: vi.fn(),
    listCheckRecords: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    listProblemRecords: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    listAccountRecords: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    getStats: vi.fn().mockResolvedValue({}),
    getDailyStats: vi.fn().mockResolvedValue([]),
    listReplenishments: vi.fn().mockResolvedValue({ rows: [], total: 0 })
  }
}))

const { default: Task } = await import('../../server/models/Task.js')
const { default: User } = await import('../../server/models/User.js')
const { default: taskRoutes } = await import('../../server/routes/tasks.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tasks', taskRoutes)
  return app
}

describe('Tasks API - Authentication', () => {
  it('should return 401 for all endpoints without auth', async () => {
    const app = createApp()
    const endpoints = [
      { method: 'get', path: '/api/tasks/batches' },
      { method: 'get', path: '/api/tasks/orders' },
      { method: 'get', path: '/api/tasks/stats' },
      { method: 'get', path: '/api/tasks/dashboard' },
      { method: 'get', path: '/api/tasks/account-records' }
    ]

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.path)
      expect(res.status).toBe(401)
    }
  })
})

describe('GET /api/tasks/batches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return batch list', async () => {
    Task.listBatches.mockResolvedValue({
      rows: [{ id: 1, batch_no: 'BATCH-001', status: 'pending' }],
      total: 1
    })

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/batches')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.rows).toHaveLength(1)
    expect(res.body.data.total).toBe(1)
  })

  it('should pass pagination params', async () => {
    Task.listBatches.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    await request(app)
      .get('/api/tasks/batches?page=2&pageSize=10&status=pending')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(Task.listBatches).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        status: 'pending'
      })
    )
  })

  it('should filter by user visibility', async () => {
    User.getVisibleUserIds.mockResolvedValue([1, 2, 3])
    Task.listBatches.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    await request(app)
      .get('/api/tasks/batches')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(Task.listBatches).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [1, 2, 3] })
    )
  })
})

describe('GET /api/tasks/batches/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 404 when batch not found', async () => {
    Task.getBatch.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/batches/999')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(404)
    expect(res.body.message).toContain('不存在')
  })

  it('should return 403 when user has no access to batch', async () => {
    Task.getBatch.mockResolvedValue({ id: 1, user_id: 99 })
    User.getVisibleUserIds.mockResolvedValue([1])

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/batches/1')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(403)
  })

  it('should return batch details when authorized', async () => {
    Task.getBatch.mockResolvedValue({ id: 1, user_id: 1, batch_no: 'BATCH-001' })
    User.getVisibleUserIds.mockResolvedValue([1])

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/batches/1')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data.batch_no).toBe('BATCH-001')
  })

  it('admin should see any batch (getVisibleUserIds returns null)', async () => {
    Task.getBatch.mockResolvedValue({ id: 1, user_id: 99, batch_no: 'BATCH-001' })
    User.getVisibleUserIds.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/batches/1')
      .set('Authorization', `Bearer ${makeToken({ roles: ['admin'] })}`)

    expect(res.status).toBe(200)
  })
})

describe('GET /api/tasks/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return order list', async () => {
    Task.listOrders.mockResolvedValue({
      rows: [{ id: 1, order_no: 'ORDER-001', order_status: 'pending' }],
      total: 1
    })

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/orders')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data.rows).toHaveLength(1)
  })

  it('should pass filter params', async () => {
    Task.listOrders.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    await request(app)
      .get('/api/tasks/orders?batch_id=5&order_status=completed&target_type=read')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(Task.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        batch_id: '5',
        order_status: 'completed',
        target_type: 'read'
      })
    )
  })

  it('limits regular user order list to their own visible user id', async () => {
    User.getVisibleUserIds.mockResolvedValue([42])
    Task.listOrders.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    await request(app)
      .get('/api/tasks/orders')
      .set('Authorization', `Bearer ${makeToken({ id: 42, roles: ['user'] })}`)

    expect(User.getVisibleUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, roles: ['user'] })
    )
    expect(Task.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [42] })
    )
  })
})

describe('GET /api/tasks/orders/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 404 when order not found', async () => {
    Task.getOrder.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/orders/999')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(404)
  })

  it('should return 403 for unauthorized access', async () => {
    Task.getOrder.mockResolvedValue({ id: 1, user_id: 99 })
    User.getVisibleUserIds.mockResolvedValue([1])

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/orders/1')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/tasks/supplements (admin only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
  })

  it('should return 403 for non-admin users', async () => {
    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/supplements')
      .set('Authorization', `Bearer ${makeToken({ roles: ['user'] })}`)

    expect(res.status).toBe(403)
  })

  it('should allow admin access', async () => {
    Task.listReplenishments.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/supplements')
      .set('Authorization', `Bearer ${makeToken({ roles: ['admin'] })}`)

    expect(res.status).toBe(200)
  })

  it('should allow super role access', async () => {
    Task.listReplenishments.mockResolvedValue({ rows: [], total: 0 })

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/supplements')
      .set('Authorization', `Bearer ${makeToken({ roles: ['super'] })}`)

    expect(res.status).toBe(200)
  })
})

describe('GET /api/tasks/dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.first.mockResolvedValue(mockDbChainResult)
    mockDbChain.select.mockReturnValue({
      ...mockDbChain,
      then: vi.fn(cb => Promise.resolve([]).then(cb)),
      [Symbol.iterator]: function* () {}
    })
    Task.getStats.mockResolvedValue({ total_orders: 0 })
    Task.listOrders.mockResolvedValue({ rows: [], total: 0 })
    Task.listAccountRecords.mockResolvedValue({ rows: [], total: 0 })
    Task.listBatches.mockResolvedValue({ rows: [], total: 0 })
    Task.getDailyStats.mockResolvedValue([])
  })

  it('should return dashboard data', async () => {
    const db = (await import('../../server/db.js')).default
    const dashChain = {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      then: vi.fn(cb => Promise.resolve([]).then(cb)),
      [Symbol.iterator]: function* () {}
    }
    db.mockImplementation((table) => {
      if (table === 'users') {
        return { ...mockDbChain, first: vi.fn().mockResolvedValue(mockDbChainResult) }
      }
      return dashChain
    })

    const app = createApp()
    const res = await request(app)
      .get('/api/tasks/dashboard')
      .set('Authorization', `Bearer ${makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveProperty('stats')
    expect(res.body.data).toHaveProperty('notifications')
  })
})
