import { Router } from 'express'
import { authRequired } from '../middleware/auth.js'
import AgentPrice from '../models/AgentPrice.js'
import Product from '../models/Product.js'
import db from '../db.js'

const router = Router()
router.use(authRequired)

// 中间件：需要代理角色
function agentRequired(req, res, next) {
  const roles = req.user?.roles || []
  if (roles.includes('agent') || roles.includes('admin') || roles.includes('super')) {
    return next()
  }
  res.status(403).json({ code: 403, message: '需要代理权限' })
}

// ========== 代理默认售价 ==========

// GET /api/agent/prices — 获取代理自己的售价列表
router.get('/prices', agentRequired, async (req, res) => {
  try {
    const products = await Product.listAll()
    const agentPrices = await AgentPrice.listByAgent(req.user.id)
    const priceMap = new Map(agentPrices.map(a => [a.product_id, parseFloat(a.sell_price)]))

    const data = products.map(p => ({
      id: p.id,
      name: p.name,
      target_type: p.target_type,
      base_price: parseFloat(p.unit_price),
      sell_price: priceMap.get(p.id) ?? null,       // null = 未设置，用底价
      effective_price: priceMap.get(p.id) ?? parseFloat(p.unit_price),
      status: p.status,
      icon: p.icon,
      color: p.color
    }))

    res.json({ code: 0, data })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/agent/prices/:productId — 设置某商品售价
router.put('/prices/:productId', agentRequired, async (req, res) => {
  try {
    const productId = Number(req.params.productId)
    const { sell_price } = req.body

    if (sell_price === undefined || sell_price === null) {
      return res.status(400).json({ code: 400, message: '缺少 sell_price' })
    }

    const price = parseFloat(sell_price)
    const product = await Product.getById(productId)
    if (!product) {
      return res.status(404).json({ code: 404, message: '商品不存在' })
    }

    // 价格击穿检查
    const basePrice = parseFloat(product.unit_price)
    if (price < basePrice) {
      return res.status(400).json({ code: 400, message: `售价不能低于底价 ¥${basePrice.toFixed(4)}` })
    }

    await AgentPrice.set(req.user.id, productId, price)
    res.json({ code: 0, message: '设置成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// DELETE /api/agent/prices/:productId — 移除定制售价（回退到底价）
router.delete('/prices/:productId', agentRequired, async (req, res) => {
  try {
    await AgentPrice.remove(req.user.id, Number(req.params.productId))
    res.json({ code: 0, message: '已恢复底价' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 单用户定制价 ==========

// GET /api/agent/user-prices — 获取代理设置的所有用户定制价
router.get('/user-prices', agentRequired, async (req, res) => {
  try {
    const rows = await AgentPrice.listUserPrices(req.user.id)
    res.json({ code: 0, data: rows })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/agent/users — 获取代理下级用户列表（用于选择）
router.get('/users', agentRequired, async (req, res) => {
  try {
    const users = await db('users')
      .where({ referred_by: req.user.id })
      .select('id', 'username', 'nickname', 'real_name', 'status')
      .orderBy('id', 'asc')
    res.json({ code: 0, data: users })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// POST /api/agent/transfer — 代理给下级划款（从代理余额划入下级余额）
// body: { user_id, amount }；金额必须 > 0 且 <= 代理可用余额；余额为 0 不允许划款
router.post('/transfer', agentRequired, async (req, res) => {
  try {
    const agentId = req.user.id
    const userId = Number(req.body.user_id)
    const amount = Math.round((parseFloat(req.body.amount) || 0) * 100) / 100

    if (!userId) return res.status(400).json({ code: 400, message: '请选择下级用户' })
    if (!amount || amount <= 0) return res.status(400).json({ code: 400, message: '划款金额必须大于 0' })
    if (userId === agentId) return res.status(400).json({ code: 400, message: '不能给自己划款' })

    // 目标必须是本代理的直接下级
    const target = await db('users').where({ id: userId, referred_by: agentId })
      .select('id', 'username', 'nickname').first()
    if (!target) return res.status(403).json({ code: 403, message: '该用户不是您的下级' })
    const targetLabel = target.nickname || target.username || ('用户' + userId)

    const result = await db.transaction(async (trx) => {
      // 锁代理余额，校验充足（余额为 0 或不足都拒绝）
      const agentBal = await trx('balance_accounts').where({ user_id: agentId }).forUpdate().first()
      const agentBefore = parseFloat(agentBal?.available_amount) || 0
      if (agentBefore <= 0) { const e = new Error('余额为 0，无法划款'); e.httpCode = 400; throw e }
      if (amount > agentBefore) { const e = new Error(`划款金额不能超过可用余额 ¥${agentBefore.toFixed(2)}`); e.httpCode = 400; throw e }
      const agentAfter = Math.round((agentBefore - amount) * 10000) / 10000

      // 锁下级余额
      const userBal = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
      const userBefore = parseFloat(userBal?.available_amount) || 0
      const userAfter = Math.round((userBefore + amount) * 10000) / 10000

      const now = new Date()
      const ts = Date.now()

      // 代理：扣款流水 + 扣余额
      await trx('account_records').insert({
        record_no: `XFEROUT-${ts}-${agentId}`,
        user_id: agentId, record_type: 'agent_transfer_out', direction: 'out', status: 'success',
        original_total_amount: amount, payable_amount: amount, actual_paid_amount: amount, refund_amount: 0,
        net_amount: -amount, before_available_amount: agentBefore, after_available_amount: agentAfter,
        reason_message: `划款给下级（${targetLabel}）`, remark: `划款给下级（${targetLabel}）`, created_at: now
      })
      await trx('balance_accounts').where({ user_id: agentId }).update({ available_amount: agentAfter, updated_at: now })

      // 下级：入账流水 + 加余额
      await trx('account_records').insert({
        record_no: `XFERIN-${ts}-${userId}`,
        user_id: userId, record_type: 'agent_transfer_in', direction: 'in', status: 'success',
        original_total_amount: amount, payable_amount: amount, actual_paid_amount: amount, refund_amount: 0,
        net_amount: amount, before_available_amount: userBefore, after_available_amount: userAfter,
        reason_message: '上级代理划款', remark: '上级代理划款', created_at: now
      })
      if (userBal) {
        await trx('balance_accounts').where({ user_id: userId }).update({ available_amount: userAfter, updated_at: now })
      } else {
        await trx('balance_accounts').insert({ user_id: userId, available_amount: userAfter, created_at: now, updated_at: now })
      }

      return { agentAfter, userAfter }
    })

    res.json({ code: 0, message: `已向 ${targetLabel} 划款 ¥${amount.toFixed(2)}`, data: { agent_balance: result.agentAfter } })
  } catch (err) {
    if (err.httpCode === 400) return res.status(400).json({ code: 400, message: err.message })
    console.error('[agent/transfer]', err.message)
    res.status(500).json({ code: 500, message: '划款失败: ' + err.message })
  }
})

// PUT /api/agent/user-prices/:userId/:productId — 设置某用户某商品售价
router.put('/user-prices/:userId/:productId', agentRequired, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const productId = Number(req.params.productId)
    const { sell_price } = req.body

    if (sell_price === undefined || sell_price === null) {
      return res.status(400).json({ code: 400, message: '缺少 sell_price' })
    }

    const price = parseFloat(sell_price)

    // 检查用户是否为代理的下级
    const user = await db('users').where({ id: userId, referred_by: req.user.id }).first()
    if (!user) {
      return res.status(403).json({ code: 403, message: '该用户不是您的下级' })
    }

    const product = await Product.getById(productId)
    if (!product) {
      return res.status(404).json({ code: 404, message: '商品不存在' })
    }

    // 价格击穿检查
    const basePrice = parseFloat(product.unit_price)
    if (price < basePrice) {
      return res.status(400).json({ code: 400, message: `售价不能低于底价 ¥${basePrice.toFixed(4)}` })
    }

    await AgentPrice.setForUser(req.user.id, userId, productId, price)
    res.json({ code: 0, message: '设置成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// DELETE /api/agent/user-prices/:userId/:productId — 删除用户定制价
router.delete('/user-prices/:userId/:productId', agentRequired, async (req, res) => {
  try {
    const userId = Number(req.params.userId)
    const productId = Number(req.params.productId)

    // 检查是否为下级
    const user = await db('users').where({ id: userId, referred_by: req.user.id }).first()
    if (!user) {
      return res.status(403).json({ code: 403, message: '该用户不是您的下级' })
    }

    await AgentPrice.removeForUser(userId, productId)
    res.json({ code: 0, message: '已恢复默认价' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
