import { Router } from 'express'
import { authRequired, adminRequired } from '../middleware/auth.js'
import Product from '../models/Product.js'
import AgentPrice from '../models/AgentPrice.js'

const router = Router()

// 所有接口需要登录
router.use(authRequired)

// ========== 用户端：可下单商品（含解析后价格） ==========

// GET /api/products — 批量下单可用商品（所有上架商品）
router.get('/', async (req, res) => {
  try {
    const rows = await Product.listActive()
    const userId = req.user.id
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // 管理员直接返回底价
    if (isAdmin) {
      const data = rows.map(p => ({ ...p, resolved_price: parseFloat(p.unit_price) }))
      return res.json({ code: 0, data })
    }

    // 普通用户 / 代理用户：解析多级价格
    const priceMap = await AgentPrice.resolvePrices(userId, rows)
    const data = rows.map(p => ({
      ...p,
      resolved_price: priceMap[p.id] ?? parseFloat(p.unit_price)
    }))

    res.json({ code: 0, data })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 管理端 ==========

// GET /api/products/all — 全部商品（含下架）
router.get('/all', adminRequired, async (req, res) => {
  try {
    const rows = await Product.listAll()
    res.json({ code: 0, data: rows })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// POST /api/products — 创建商品
router.post('/', adminRequired, async (req, res) => {
  try {
    const { name, target_type, unit_price } = req.body
    if (!name || !target_type || unit_price === undefined) {
      return res.status(400).json({ code: 400, message: '缺少必填字段' })
    }
    const id = await Product.create(req.body)
    res.json({ code: 0, data: { id }, message: '创建成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/products/:id — 更新商品
router.put('/:id', adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const product = await Product.getById(id)
    if (!product) {
      return res.status(404).json({ code: 404, message: '商品不存在' })
    }
    await Product.update(id, req.body)
    res.json({ code: 0, message: '更新成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PATCH /api/products/:id/toggle — 上下架切换
router.patch('/:id/toggle', adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const newStatus = await Product.toggleStatus(id)
    if (newStatus === null) {
      return res.status(404).json({ code: 404, message: '商品不存在' })
    }
    res.json({ code: 0, data: { status: newStatus }, message: newStatus === 'on' ? '已上架' : '已下架' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// DELETE /api/products/:id — 删除商品
router.delete('/:id', adminRequired, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const product = await Product.getById(id)
    if (!product) {
      return res.status(404).json({ code: 404, message: '商品不存在' })
    }
    await Product.remove(id)
    res.json({ code: 0, message: '删除成功' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
