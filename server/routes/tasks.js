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
    const { page = 1, pageSize = 20, status, batch_no, agent_id, start_date, end_date } = req.query
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const result = await Task.listBatches({
      userIds,
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      batch_no,
      agent_id: isAdmin && agent_id ? Number(agent_id) : undefined,
      start_date: isAdmin ? start_date : undefined,
      end_date: isAdmin ? end_date : undefined
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

// GET /api/tasks/supplements — 补单申请记录（仅管理员）
router.get('/supplements', async (req, res) => {
  try {
    const roles = req.user.roles || []
    if (!roles.includes('admin') && !roles.includes('super')) {
      return res.status(403).json({ code: 403, message: '无权访问' })
    }
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

// GET /api/tasks/supplements/by-batch — 按批次分组的补单记录（仅管理员）
router.get('/supplements/by-batch', async (req, res) => {
  try {
    const roles = req.user.roles || []
    if (!roles.includes('admin') && !roles.includes('super')) {
      return res.status(403).json({ code: 403, message: '无权访问' })
    }
    const userIds = await User.getVisibleUserIds(req.user)
    const { page = 1, pageSize = 10, status } = req.query
    const offset = (Number(page) - 1) * Number(pageSize)

    const base = () => {
      const q = db('order_replenishment_records as r')
        .join('order_batches as b', 'b.id', 'r.batch_id')
      if (Array.isArray(userIds)) q.whereIn('r.user_id', userIds)
      if (status) q.where('r.status', status)
      return q
    }

    const batchRows = await base()
      .select(
        'r.batch_id',
        'b.batch_no',
        'b.source_type',
        db.raw('COUNT(r.id) as total_count'),
        db.raw("SUM(CASE WHEN r.status IN ('pending','created') THEN 1 ELSE 0 END) as pending_count"),
        db.raw("SUM(CASE WHEN r.status = 'agent_approved' THEN 1 ELSE 0 END) as agent_approved_count"),
        db.raw("SUM(CASE WHEN r.status = 'processing' THEN 1 ELSE 0 END) as processing_count"),
        db.raw("SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count"),
        db.raw('SUM(r.shortage_quantity) as total_shortage'),
        db.raw('MIN(r.created_at) as earliest_at'),
        db.raw('MAX(r.created_at) as latest_at')
      )
      .groupBy('r.batch_id', 'b.batch_no', 'b.source_type')
      .orderBy('latest_at', 'desc')
      .limit(Number(pageSize)).offset(offset)

    const [{ cnt }] = await base()
      .countDistinct('r.batch_id as cnt')

    // lookup user info for each batch
    const batchIds = batchRows.map(r => r.batch_id)
    let userMap = {}
    if (batchIds.length) {
      const users = await db('order_replenishment_records as r')
        .join('users as u', 'u.id', 'r.user_id')
        .whereIn('r.batch_id', batchIds)
        .select('r.batch_id', 'u.username', 'u.nickname')
        .groupBy('r.batch_id', 'u.username', 'u.nickname')
      for (const u of users) {
        userMap[u.batch_id] = { username: u.username, nickname: u.nickname }
      }
    }

    const rows = batchRows.map(r => ({
      ...r,
      total_count: Number(r.total_count),
      pending_count: Number(r.pending_count),
      agent_approved_count: Number(r.agent_approved_count),
      processing_count: Number(r.processing_count),
      rejected_count: Number(r.rejected_count),
      total_shortage: Number(r.total_shortage),
      username: userMap[r.batch_id]?.username || '',
      nickname: userMap[r.batch_id]?.nickname || ''
    }))

    res.json({ code: 0, data: { rows, total: Number(cnt) } })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// GET /api/tasks/supplements/batch/:batchId — 某批次下的补单明细（仅管理员）
router.get('/supplements/batch/:batchId', async (req, res) => {
  try {
    const roles = req.user.roles || []
    if (!roles.includes('admin') && !roles.includes('super')) {
      return res.status(403).json({ code: 403, message: '无权访问' })
    }
    const userIds = await User.getVisibleUserIds(req.user)
    const batchId = Number(req.params.batchId)

    const q = db('order_replenishment_records as r')
      .leftJoin('users', 'r.user_id', 'users.id')
      .leftJoin('orders', 'orders.id', 'r.order_id')
      .leftJoin('products', 'products.id', 'orders.product_id')
      .where('r.batch_id', batchId)
    if (Array.isArray(userIds)) q.whereIn('r.user_id', userIds)

    const rows = await q.select(
      'r.*',
      'users.username', 'users.nickname',
      'products.name as product_name',
      'orders.title as order_title',
      'orders.author_name',
      'orders.avatar_url',
      'orders.note_url as order_note_url'
    ).orderBy('r.created_at', 'asc')

    res.json({ code: 0, data: rows })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 统计 ==========

// GET /api/tasks/stats — 统计数据
router.get('/stats', async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const { agent_id, start_date, end_date } = req.query
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const stats = await Task.getStats(userIds, {
      agent_id: isAdmin && agent_id ? Number(agent_id) : undefined,
      start_date: isAdmin ? start_date : undefined,
      end_date: isAdmin ? end_date : undefined
    })
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
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // 所有查询并行执行
    const [
      stats,
      recharges,
      doneOrders,
      doneBatches,
      pendingReps,
      adminAdj,
      recentOrders,
      recentRecords,
      recentBatches,
      dailyStats,
      commissions
    ] = await Promise.all([
      Task.getStats(userIds),
      db('account_records').where({ user_id: myId, record_type: 'recharge' }).orderBy('created_at', 'desc').limit(5),
      isAdmin ? db('orders').leftJoin('products', 'products.id', 'orders.product_id').where('orders.user_id', myId).whereIn('orders.order_status', ['completed', 'failed']).select('orders.*', 'products.name as product_name').orderBy('orders.updated_at', 'desc').limit(5) : Promise.resolve([]),
      isAdmin
        ? db('order_batches').where({ user_id: myId }).whereIn('status', ['completed', 'partial_completed', 'failed']).orderBy('updated_at', 'desc').limit(3)
        : db('order_batches').where({ user_id: myId }).orderBy('created_at', 'desc').limit(5),
      isAdmin ? db('order_replenishment_records as r').leftJoin('users', 'r.user_id', 'users.id').whereIn('r.status', ['pending', 'created']).select('r.*', 'users.username').orderBy('r.created_at', 'desc').limit(5) : Promise.resolve([]),
      db('account_records').where({ user_id: myId }).whereIn('record_type', ['admin_add', 'admin_deduct']).orderBy('created_at', 'desc').limit(3),
      Task.listOrders({ userIds, page: 1, pageSize: 5 }),
      Task.listAccountRecords({ userIds: [myId], page: 1, pageSize: 10 }),
      Task.listBatches({ userIds, page: 1, pageSize: 5 }),
      Task.getDailyStats(userIds, 7),
      db('account_records').where({ user_id: myId, record_type: 'agent_commission' }).orderBy('created_at', 'desc').limit(5)
    ])

    // 组装通知
    const notifications = []
    for (const r of recharges) {
      notifications.push({ id: `recharge-${r.id}`, type: 'recharge', title: `充值成功 ¥${parseFloat(r.actual_paid_amount || 0).toFixed(2)}`, desc: `余额 ¥${parseFloat(r.after_available_amount || 0).toFixed(2)}`, time: r.created_at })
    }
    if (isAdmin) {
      for (const o of doneOrders) {
        const ok = o.order_status === 'completed'
        const typeName = o.product_name ? o.product_name.replace(/^小红书/, '') : (typeLabels[o.target_type] || o.target_type)
        notifications.push({ id: `order-${o.id}`, type: ok ? 'order_ok' : 'order_fail', title: `${ok ? '订单完成' : '订单失败'} ${o.order_no}`, desc: `${typeName} · ${o.completed_quantity || 0}/${o.ordered_quantity}`, time: o.updated_at })
      }
      for (const b of doneBatches) {
        const label = b.status === 'completed' ? '批次完成' : b.status === 'failed' ? '批次失败' : '批次部分完成'
        notifications.push({ id: `batch-${b.id}`, type: b.status === 'completed' ? 'batch_ok' : 'batch_fail', title: `${label} ${b.batch_no}`, desc: `成功 ${b.succeeded_count || 0} / 失败 ${b.failed_count || 0}`, time: b.updated_at })
      }
    } else {
      for (const b of doneBatches) {
        notifications.push({ id: `batch-${b.id}`, type: 'batch_ok', title: `已提交批次 ${b.batch_no}`, desc: `共 ${b.order_count || 0} 个订单`, time: b.created_at })
      }
    }
    for (const r of pendingReps) {
      notifications.push({ id: `rep-${r.id}`, type: 'admin_supplement', title: `补单申请待审核`, desc: `${r.username || ''} · ${r.order_no} · 差额 ${r.shortage_quantity}`, time: r.created_at })
    }
    for (const r of adminAdj) {
      const isAdd = r.record_type === 'admin_add'
      notifications.push({ id: `adj-${r.id}`, type: isAdd ? 'recharge' : 'order_fail', title: `管理员${isAdd ? '加款' : '扣款'} ¥${parseFloat(r.actual_paid_amount || 0).toFixed(2)}`, desc: r.reason_message || '', time: r.created_at })
    }
    for (const r of commissions) {
      notifications.push({ id: `comm-${r.id}`, type: 'recharge', title: `下级下单分润 +¥${parseFloat(r.net_amount || 0).toFixed(2)}`, desc: `余额 ¥${parseFloat(r.after_available_amount || 0).toFixed(2)}`, time: r.created_at })
    }
    notifications.sort((a, b) => new Date(b.time) - new Date(a.time))

    res.json({
      code: 0,
      data: {
        stats,
        notifications: notifications.slice(0, 15),
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
