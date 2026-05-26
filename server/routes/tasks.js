import { Router } from 'express'
import Task from '../models/Task.js'
import User from '../models/User.js'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
const typeLabels = { read: '阅读', like: '点赞', impression: '曝光' }

// 所有任务接口需要登录
router.use(authRequired)

// ========== 订单批次 ==========

// GET /api/tasks/batches — 批次列表
router.get('/batches', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 20, status, batch_no } = req.query
    const result = await Task.listBatches({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      batch_no
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/tasks/batches/:id — 批次详情
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = await Task.getBatch(Number(req.params.id))
    if (!batch) {
      return res.status(404).json({ code: 404, message: '批次不存在' })
    }
    // 权限校验
    const userIds = await User.getVisibleUserIds(req.user)
    if (userIds !== null && !userIds.includes(batch.user_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该批次' })
    }
    res.json({ code: 0, data: batch })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 订单 ==========

// GET /api/tasks/orders — 订单列表
router.get('/orders', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 20, batch_id, order_status, target_type } = req.query
    const result = await Task.listOrders({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      batch_id,
      order_status,
      target_type
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/tasks/orders/:id — 订单详情
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await Task.getOrder(Number(req.params.id))
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在' })
    }
    const userIds = await User.getVisibleUserIds(req.user)
    if (userIds !== null && !userIds.includes(order.user_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该订单' })
    }
    res.json({ code: 0, data: order })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 链接校验记录 ==========

// GET /api/tasks/check-records — 链接校验记录
router.get('/check-records', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 50, check_batch_no } = req.query
    const result = await Task.listCheckRecords({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      check_batch_no
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/tasks/problem-records — 问题链接记录
router.get('/problem-records', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 50, check_batch_no } = req.query
    const result = await Task.listProblemRecords({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      check_batch_no
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 账务记录 ==========

// GET /api/tasks/account-records — 账务记录
router.get('/account-records', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 20, record_type, direction } = req.query
    const result = await Task.listAccountRecords({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      record_type,
      direction
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 补单记录 ==========

// GET /api/tasks/supplements — 补单申请记录
router.get('/supplements', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 10, status, order_no } = req.query
    const result = await Task.listReplenishments({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      order_no
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 统计 ==========

// GET /api/tasks/stats — 统计数据
router.get('/stats', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const stats = await Task.getStats(userIds)
    res.json({ code: 0, data: stats })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 仪表盘汇总 ==========

// GET /api/tasks/dashboard — 首页看板数据
router.get('/dashboard', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const myId = req.user.id

    // 1. 统计数据（按权限看全局或个人）
    const stats = await Task.getStats(userIds)

    // 2. 通知 — 动态生成
    const notifications = []
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // 2a. 充值成功通知（本人）
    const recharges = await db('account_records')
      .where({ user_id: myId, record_type: 'recharge' })
      .orderBy('created_at', 'desc')
      .limit(5)
    for (const r of recharges) {
      notifications.push({
        id: `recharge-${r.id}`,
        type: 'recharge',
        title: `充值成功 ¥${parseFloat(r.actual_paid_amount || 0).toFixed(2)}`,
        desc: `余额 ¥${parseFloat(r.after_available_amount || 0).toFixed(2)}`,
        time: r.created_at
      })
    }

    // 2b. 订单完成/失败通知（本人）
    const doneOrders = await db('orders')
      .leftJoin('products', 'products.id', 'orders.product_id')
      .where('orders.user_id', myId)
      .whereIn('orders.order_status', ['completed', 'failed'])
      .select('orders.*', 'products.name as product_name')
      .orderBy('orders.updated_at', 'desc')
      .limit(5)
    for (const o of doneOrders) {
      const ok = o.order_status === 'completed'
      const typeName = o.product_name
        ? o.product_name.replace(/^小红书/, '')
        : (typeLabels[o.target_type] || o.target_type)
      notifications.push({
        id: `order-${o.id}`,
        type: ok ? 'order_ok' : 'order_fail',
        title: `${ok ? '订单完成' : '订单失败'} ${o.order_no}`,
        desc: `${typeName} · ${o.completed_quantity || 0}/${o.ordered_quantity}`,
        time: o.updated_at
      })
    }

    // 2c. 批次完成通知（本人）
    const doneBatches = await db('order_batches')
      .where({ user_id: myId })
      .whereIn('status', ['completed', 'partial_completed', 'failed'])
      .orderBy('updated_at', 'desc')
      .limit(3)
    for (const b of doneBatches) {
      const label = b.status === 'completed' ? '批次完成' : b.status === 'failed' ? '批次失败' : '批次部分完成'
      notifications.push({
        id: `batch-${b.id}`,
        type: b.status === 'completed' ? 'batch_ok' : 'batch_fail',
        title: `${label} ${b.batch_no}`,
        desc: `成功 ${b.succeeded_count || 0} / 失败 ${b.failed_count || 0}`,
        time: b.updated_at
      })
    }

    // 2d. 管理员：补单申请待审核
    if (isAdmin) {
      const pendingReps = await db('order_replenishment_records as r')
        .leftJoin('users', 'r.user_id', 'users.id')
        .whereIn('r.status', ['pending', 'created'])
        .select('r.*', 'users.username')
        .orderBy('r.created_at', 'desc')
        .limit(5)
      for (const r of pendingReps) {
        notifications.push({
          id: `rep-${r.id}`,
          type: 'admin_supplement',
          title: `补单申请待审核`,
          desc: `${r.username || ''} · ${r.order_no} · 差额 ${r.shortage_quantity}`,
          time: r.created_at
        })
      }
    }

    // 2e. 管理员余额调整通知
    const adminAdj = await db('account_records')
      .where({ user_id: myId })
      .whereIn('record_type', ['admin_add', 'admin_deduct'])
      .orderBy('created_at', 'desc')
      .limit(3)
    for (const r of adminAdj) {
      const isAdd = r.record_type === 'admin_add'
      notifications.push({
        id: `adj-${r.id}`,
        type: isAdd ? 'recharge' : 'order_fail',
        title: `管理员${isAdd ? '加款' : '扣款'} ¥${parseFloat(r.actual_paid_amount || 0).toFixed(2)}`,
        desc: r.reason_message || '',
        time: r.created_at
      })
    }

    // 按时间排序，取最新15条
    notifications.sort((a, b) => new Date(b.time) - new Date(a.time))
    const finalNotifications = notifications.slice(0, 15)

    // 3. 最近订单（按权限）
    const recentOrders = await Task.listOrders({
      userIds,
      page: 1,
      pageSize: 5
    })

    // 4. 最近账务记录（按权限）
    const recentRecords = await Task.listAccountRecords({
      userIds,
      page: 1,
      pageSize: 5
    })

    // 5. 最近批次（按权限）
    const recentBatches = await Task.listBatches({
      userIds,
      page: 1,
      pageSize: 5
    })

    // 6. 每日订单趋势（最近7天）
    const dailyStats = await Task.getDailyStats(userIds, 7)

    res.json({
      code: 0,
      data: {
        stats,
        notifications: finalNotifications,
        recent_orders: recentOrders.rows,
        recent_records: recentRecords.rows,
        recent_batches: recentBatches.rows,
        total_orders: recentOrders.total,
        total_batches: recentBatches.total,
        daily_stats: dailyStats
      }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
