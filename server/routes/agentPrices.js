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
