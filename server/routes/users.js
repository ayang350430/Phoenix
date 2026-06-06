import { Router } from 'express'
import db from '../db.js'
import User from '../models/User.js'
import { authRequired, adminRequired, roleRequired } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { uniqueCode } from '../utils/idGen.js'

const router = Router()

router.use(authRequired)

// GET /api/users/me — 当前用户信息
router.get('/me', async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' })
    const balance = await User.getBalance(user.id)
    res.json({
      code: 0,
      data: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        nickname: user.nickname,
        roles: user.roles.map(r => r.code),
        permissions: user.permissions.map(p => p.code),
        balance: balance?.available_amount || 0,
        referral_code: user.referral_code,
        order_view_enabled: user.order_view_enabled,
        order_like_enabled: user.order_like_enabled,
        order_impression_enabled: user.order_impression_enabled
      }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/users/password — 修改密码
router.put('/password', validate({ body: ['oldPassword', 'newPassword'] }), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' })
    if (!await User.verifyPassword(user, oldPassword)) {
      return res.status(401).json({ code: 401, message: '原密码错误' })
    }
    await User.updatePassword(user.id, newPassword)
    res.json({ code: 0, message: '密码修改成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/users — 用户列表（管理员），带余额
router.get('/', adminRequired, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword } = req.query
    const result = await User.list({
      page: Number(page),
      pageSize: Number(pageSize),
      keyword
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/users/:id/roles — 管理员设置用户角色
router.put('/:id/roles', adminRequired, validate({ body: ['roles'] }), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    const { roles } = req.body
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ code: 400, message: '至少需要一个角色' })
    }
    await User.setRoles(userId, roles)
    const user = await User.findById(userId)
    res.json({
      code: 0,
      data: { id: user.id, username: user.username, roles: user.roles.map(r => r.code) }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/users/:id/status — 管理员 启用/禁用 用户
router.put('/:id/status', adminRequired, validate({ body: ['status'] }), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    const { status } = req.body   // 'active' | 'disabled'
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ code: 400, message: '状态只能是 active 或 disabled' })
    }
    // 不能禁用自己
    if (userId === req.user.id) {
      return res.status(400).json({ code: 400, message: '不能禁用自己' })
    }
    await db('users').where({ id: userId }).update({ status })
    res.json({ code: 0, message: status === 'active' ? '已启用' : '已禁用' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/users/:id/balance — 管理员修改余额
router.put('/:id/balance', adminRequired, validate({ body: ['amount', 'remark'] }), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    const { amount, remark } = req.body
    const num = parseFloat(amount)
    if (isNaN(num) || !Number.isFinite(num)) {
      return res.status(400).json({ code: 400, message: '金额无效' })
    }

    // 事务 + 行锁，防止并发覆盖写
    const result = await db.transaction(async (trx) => {
      const balance = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
      const oldAmount = balance ? parseFloat(balance.available_amount) : 0
      const newAmount = Math.round((oldAmount + num) * 10000) / 10000

      if (newAmount < 0) {
        throw Object.assign(new Error(`余额不足，当前 ¥${oldAmount.toFixed(2)}`), { statusCode: 400 })
      }

      const now = new Date()
      if (balance) {
        await trx('balance_accounts')
          .where({ user_id: userId })
          .update({ available_amount: newAmount, updated_at: now })
      } else {
        await trx('balance_accounts').insert({
          user_id: userId,
          available_amount: newAmount,
          created_at: now,
          updated_at: now
        })
      }

      // 记录流水（短编号，事务内查重保证唯一）
      await trx('account_records').insert({
        record_no: await uniqueCode(trx, 'account_records', 'record_no'),
        user_id: userId,
        record_type: num >= 0 ? 'admin_add' : 'admin_deduct',
        direction: num >= 0 ? 'in' : 'out',
        actual_paid_amount: Math.abs(num),
        before_available_amount: oldAmount,
        after_available_amount: newAmount,
        remark: remark || (num >= 0 ? '管理员充值' : '管理员扣款'),
        created_at: now
      })

      return { oldAmount, newAmount }
    })

    res.json({
      code: 0,
      message: `余额已调整 ${num >= 0 ? '+' : ''}${num.toFixed(2)}`,
      data: { balance: result.newAmount }
    })
  } catch (err) {
    const status = err.statusCode || 500
    res.status(status).json({ code: status, message: err.message })
  }
})

// PUT /api/users/:id/reset-password — 管理员重置用户密码
router.put('/:id/reset-password', adminRequired, validate({ body: ['password'] }), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    const { password } = req.body
    if (!password || password.length < 6) {
      return res.status(400).json({ code: 400, message: '密码至少 6 位' })
    }
    await User.updatePassword(userId, password)
    res.json({ code: 0, message: '密码已重置' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/users/referred — 代理查看自己的下级用户
router.get('/referred', roleRequired('admin', 'agent'), async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query
    const result = await User.getReferredUsers(req.user.id, {
      page: Number(page),
      pageSize: Number(pageSize)
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/users/agents — 管理员获取代理列表（用于筛选下拉）
router.get('/agents', adminRequired, async (req, res) => {
  try {
    const agents = await db('users')
      .join('user_roles', 'users.id', 'user_roles.user_id')
      .join('roles', 'roles.id', 'user_roles.role_id')
      .where('roles.code', 'agent')
      .select('users.id', 'users.username', 'users.nickname')
      .orderBy('users.id', 'asc')
    const result = []
    for (const a of agents) {
      const subCount = await db('users').where({ referred_by: a.id }).count('id as cnt').first()
      result.push({ ...a, sub_count: Number(subCount?.cnt) || 0 })
    }
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 注册奖励配置 ==========

// GET /api/users/register-bonus — 管理员获取所有代理的注册奖励配置
router.get('/register-bonus', adminRequired, async (req, res) => {
  try {
    if (!(await db.schema.hasTable('agent_register_bonus'))) {
      await db.schema.createTable('agent_register_bonus', t => {
        t.increments('id')
        t.integer('agent_id').unsigned().notNullable().unique()
        t.decimal('bonus_amount', 12, 2).notNullable().defaultTo(0)
        t.timestamp('updated_at').defaultTo(db.fn.now())
      })
    }
    const bonuses = await db('agent_register_bonus')
      .join('users', 'users.id', 'agent_register_bonus.agent_id')
      .select('agent_register_bonus.*', 'users.username', 'users.nickname')
      .orderBy('agent_register_bonus.agent_id', 'asc')
    res.json({ code: 0, data: bonuses })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/users/register-bonus/:agentId — 管理员设置某代理的注册奖励
router.put('/register-bonus/:agentId', adminRequired, async (req, res) => {
  try {
    const agentId = Number(req.params.agentId)
    const { bonus_amount } = req.body
    const amount = parseFloat(bonus_amount)
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ code: 400, message: '金额无效' })
    }
    if (!(await db.schema.hasTable('agent_register_bonus'))) {
      await db.schema.createTable('agent_register_bonus', t => {
        t.increments('id')
        t.integer('agent_id').unsigned().notNullable().unique()
        t.decimal('bonus_amount', 12, 2).notNullable().defaultTo(0)
        t.timestamp('updated_at').defaultTo(db.fn.now())
      })
    }
    const existing = await db('agent_register_bonus').where({ agent_id: agentId }).first()
    if (existing) {
      await db('agent_register_bonus').where({ agent_id: agentId }).update({ bonus_amount: amount, updated_at: new Date() })
    } else {
      await db('agent_register_bonus').insert({ agent_id: agentId, bonus_amount: amount })
    }
    res.json({ code: 0, message: `注册奖励已设置为 ¥${amount.toFixed(2)}` })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
