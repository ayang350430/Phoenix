import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const TEST_SECRET = 'test-secret-key-for-testing-only'

const mockUser = {
  id: 1,
  username: 'testuser',
  real_name: 'Test',
  nickname: 'Tester',
  password_hash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012',
  status: 'active',
  token_version: 1,
  referral_code: 'ABCD1234',
  roles: [{ code: 'user', id: 1, name: '普通用户' }],
  permissions: [{ code: 'order.create' }],
  order_view_enabled: true,
  order_like_enabled: true,
  order_impression_enabled: true
}

const mockDbChain = {
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  insert: vi.fn().mockResolvedValue([1]),
  update: vi.fn().mockResolvedValue(1),
  increment: vi.fn().mockResolvedValue(1)
}

vi.mock('../../server/db.js', () => ({
  default: vi.fn(() => ({ ...mockDbChain }))
}))

vi.mock('../../server/config/index.js', () => ({
  default: { jwt: { secret: TEST_SECRET, expiresIn: '7d' } }
}))

vi.mock('../../server/models/User.js', () => ({
  default: {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    verifyPassword: vi.fn(),
    create: vi.fn(),
    getBalance: vi.fn()
  }
}))

vi.mock('../../server/utils/mailer.js', () => ({
  sendVerificationCodeEmail: vi.fn().mockResolvedValue(true)
}))

vi.mock('../../server/utils/resetCodes.js', () => ({
  generateCode: vi.fn().mockReturnValue('123456'),
  saveCode: vi.fn(),
  verifyCode: vi.fn().mockReturnValue({ valid: true })
}))

const { default: User } = await import('../../server/models/User.js')
const { default: authRoutes } = await import('../../server/routes/auth.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  return app
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when username is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: '123456' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.message).toContain('username')
  })

  it('should return 400 when password is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
    expect(res.body.message).toContain('password')
  })

  it('should return 401 when user does not exist', async () => {
    User.findByUsername.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: '123456' })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('用户名或密码错误')
  })

  it('should return 401 when password is wrong', async () => {
    User.findByUsername.mockResolvedValue({ ...mockUser })
    User.verifyPassword.mockResolvedValue(false)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrongpwd' })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('用户名或密码错误')
  })

  it('should return 403 when user is disabled', async () => {
    User.findByUsername.mockResolvedValue({ ...mockUser, status: 'disabled' })
    User.verifyPassword.mockResolvedValue(true)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: '123456' })

    expect(res.status).toBe(403)
    expect(res.body.message).toBe('账户已被禁用')
  })

  it('should return token on successful login', async () => {
    User.findByUsername.mockResolvedValue({ ...mockUser })
    User.verifyPassword.mockResolvedValue(true)
    User.getBalance.mockResolvedValue({ available_amount: '100.00' })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: '123456' })

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.token).toBeDefined()
    expect(res.body.data.user.username).toBe('testuser')
    expect(res.body.data.user.roles).toEqual(['user'])

    const decoded = jwt.verify(res.body.data.token, TEST_SECRET)
    expect(decoded.id).toBe(1)
    expect(decoded.tv).toBe(2)
  })

  it('should increment token_version on login', async () => {
    User.findByUsername.mockResolvedValue({ ...mockUser, token_version: 5 })
    User.verifyPassword.mockResolvedValue(true)
    User.getBalance.mockResolvedValue({ available_amount: '0' })

    const app = createApp()
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: '123456' })

    const db = (await import('../../server/db.js')).default
    expect(db).toHaveBeenCalledWith('users')
  })
})

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when username is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: '123456' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('username')
  })

  it('should return 400 when password is too short', async () => {
    User.findByUsername.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: '123' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('6')
  })

  it('should reject Chinese username (only letters and digits allowed)', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: '啊扬', password: '123456', ref: 'ABCD1234' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('英文')
  })

  it('should reject username with spaces or symbols', async () => {
    const app = createApp()
    for (const bad of ['ab', 'user name', 'user@1', 'a'.repeat(21)]) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: bad, password: '123456', ref: 'ABCD1234' })
      expect(res.status).toBe(400)
    }
  })

  it('should return 409 when username already exists', async () => {
    User.findByUsername.mockResolvedValue({ id: 1, username: 'taken' })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: '123456' })

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('已存在')
  })

  it('should register successfully with valid data', async () => {
    User.findByUsername.mockResolvedValue(null)
    User.create.mockResolvedValue({
      ...mockUser,
      id: 2,
      username: 'newuser',
      roles: [{ code: 'user' }]
    })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: '123456', real_name: 'New User' })

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.token).toBeDefined()
    expect(res.body.data.user.username).toBe('newuser')
  })

  it('should accept referral code', async () => {
    User.findByUsername.mockResolvedValue(null)
    User.create.mockResolvedValue({
      ...mockUser,
      id: 3,
      username: 'referred',
      roles: [{ code: 'user' }]
    })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'referred', password: '123456', ref: 'ABCD1234' })

    expect(res.status).toBe(200)
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({ refCode: 'ABCD1234' })
    )
  })
})

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when email is missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('email')
  })

  it('should return 404 when email not found', async () => {
    User.findByEmail.mockResolvedValue(null)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.com' })

    expect(res.status).toBe(404)
  })

  it('should send verification code for valid email', async () => {
    User.findByEmail.mockResolvedValue({ id: 1, email: 'user@test.com' })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'user@test.com' })

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
  })
})

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when fields are missing', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'user@test.com' })

    expect(res.status).toBe(400)
  })

  it('should return 400 when verification code is invalid', async () => {
    const { verifyCode } = await import('../../server/utils/resetCodes.js')
    verifyCode.mockReturnValue({ valid: false, message: '验证码错误' })

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'user@test.com', code: '000000', password: 'newpass123' })

    expect(res.status).toBe(400)
  })

  it('should reset password with valid code', async () => {
    const { verifyCode } = await import('../../server/utils/resetCodes.js')
    verifyCode.mockReturnValue({ valid: true })
    User.findByEmail.mockResolvedValue({ id: 1, email: 'user@test.com' })
    User.updatePassword = vi.fn().mockResolvedValue(1)

    const app = createApp()
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: 'user@test.com', code: '123456', password: 'newpass123' })

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('成功')
  })
})

describe('Rate limiting', () => {
  it('should allow requests under the limit', async () => {
    User.findByUsername.mockResolvedValue(null)

    const app = createApp()
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'test' })
      expect(res.status).not.toBe(429)
    }
  })
})
