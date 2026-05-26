import { Router } from 'express'
import crypto from 'crypto'
import { authRequired, adminRequired } from '../middleware/auth.js'
import Config from '../models/Config.js'
import Product from '../models/Product.js'
import AgentPrice from '../models/AgentPrice.js'
import Task from '../models/Task.js'
import { collectSnapshots, fetchNoteId, fetchNoteBasic } from '../services/noteApi.js'
import { cancelTask } from '../services/xhsApi.js'
import db from '../db.js'

const router = Router()

// 自动迁移：orders 表添加 product_id 列
;(async () => {
  try {
    if (await db.schema.hasTable('orders') && !(await db.schema.hasColumn('orders', 'product_id'))) {
      await db.schema.alterTable('orders', t => {
        t.integer('product_id').unsigned().nullable().after('target_type')
      })
      console.log('[batch] orders 表已添加 product_id 列')
    }
  } catch (e) { console.warn('[batch] product_id 迁移跳过:', e.message) }
})()

const DEFAULT_CONFIG = {
  unit_price: 0.01,
  min_quantity: 10,
  types: [
    { key: 'read', label: '阅读', enabled: true },
    { key: 'like', label: '点赞', enabled: true },
    { key: 'impression', label: '曝光', enabled: true }
  ]
}

// ========== 配置 ==========

// GET /api/batch/config
router.get('/config', authRequired, async (req, res) => {
  try {
    const cfg = await Config.get('batch_config', DEFAULT_CONFIG)
    res.json({ code: 0, data: cfg })
  } catch (err) {
    console.error('[batch/config GET]', err.message)
    res.status(500).json({ code: 500, message: '获取配置失败' })
  }
})

// PUT /api/batch/config（仅管理员）
router.put('/config', authRequired, adminRequired, async (req, res) => {
  try {
    const current = await Config.get('batch_config', DEFAULT_CONFIG)
    const { types } = req.body
    if (Array.isArray(types)) {
      current.types = current.types.map(t => {
        const incoming = types.find(it => it.key === t.key)
        if (incoming && typeof incoming.enabled === 'boolean') {
          return { ...t, enabled: incoming.enabled }
        }
        return t
      })
    }
    await Config.set('batch_config', current)
    res.json({ code: 0, message: '配置已更新', data: current })
  } catch (err) {
    console.error('[batch/config PUT]', err.message)
    res.status(500).json({ code: 500, message: '更新配置失败' })
  }
})

// ========== 预校验 ==========

const XHS_PATTERN = /^https?:\/\/(www\.)?(xhslink\.com|xiaohongshu\.com)\//

// POST /api/batch/prevalidate
router.post('/prevalidate', authRequired, async (req, res) => {
  try {
    const { urls, type } = req.body
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供链接列表' })
    }

    const seen = new Set()
    const results = urls.map(url => {
      const trimmed = (url || '').trim()
      if (!trimmed) return { url: trimmed, valid: false, message: '链接为空' }
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return { url: trimmed, valid: false, message: '链接格式无效' }
      }
      if (!XHS_PATTERN.test(trimmed)) {
        return { url: trimmed, valid: false, message: '非小红书链接' }
      }
      if (seen.has(trimmed)) {
        return { url: trimmed, valid: false, message: '重复链接' }
      }
      seen.add(trimmed)
      return { url: trimmed, valid: true }
    })

    // 检查已有活跃订单冲突
    const validUrls = results.filter(r => r.valid).map(r => r.url)
    if (validUrls.length > 0) {
      const activeStatuses = ['pending', 'running', 'processing']
      const conflicts = await db('orders')
        .whereIn('note_url', validUrls)
        .whereIn('order_status', activeStatuses)
        .select('note_url')
      const conflictSet = new Set(conflicts.map(c => c.note_url))
      for (const r of results) {
        if (r.valid && conflictSet.has(r.url)) {
          r.valid = false
          r.message = '该链接已有进行中的订单'
        }
      }
    }

    // 解析 note_id 和博主信息 — 获取不到则不通过
    const toResolve = results.filter(r => r.valid)
    if (toResolve.length > 0) {
      const CONCURRENCY = 10
      for (let i = 0; i < toResolve.length; i += CONCURRENCY) {
        const chunk = toResolve.slice(i, i + CONCURRENCY)
        await Promise.all(chunk.map(async (r) => {
          try {
            const noteId = await fetchNoteId(r.url)
            if (!noteId) {
              r.valid = false
              r.message = '无法解析笔记ID'
              return
            }
            r.note_id = noteId

            const basic = await fetchNoteBasic(noteId)
            if (!basic || !basic.author_id) {
              r.valid = false
              r.message = '无法获取博主信息'
              return
            }
            r.author_id = basic.author_id
            r.author_name = basic.author_name || ''
            r.title = basic.title || ''
            r.avatar_url = basic.avatar_url || ''
          } catch {
            r.valid = false
            r.message = '链接信息获取失败'
          }
        }))
      }
    }

    res.json({ code: 0, data: { results } })
  } catch (err) {
    console.error('[batch/prevalidate]', err.message)
    res.status(500).json({ code: 500, message: '校验失败' })
  }
})

// ========== 提交 ==========

// POST /api/batch/submit
router.post('/submit', authRequired, async (req, res) => {
  const conn = await db.client.pool.acquire().promise
  try {
    const { type, product_id, lines } = req.body
    const userId = req.user.id

    if (!type || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ code: 400, message: '参数不完整' })
    }

    // 检查商品是否上架（优先用 product_id，兼容旧的 type）
    let product
    if (product_id) {
      product = await db('products').where({ id: product_id, status: 'on' }).first()
    }
    if (!product) {
      product = await Product.getByType(type)
    }
    if (!product) {
      return res.status(403).json({ code: 403, message: '该商品已下架，无法下单' })
    }

    // 解析当前用户的实际价格（多级定价）
    const unitPrice = await AgentPrice.resolvePrice(userId, product.id, product.unit_price)
    const minQuantity = product.min_quantity || 10

    // 校验行
    const validLines = lines.filter(l => l.url && l.quantity >= minQuantity)
    if (validLines.length === 0) {
      return res.status(400).json({ code: 400, message: '没有有效的提交行' })
    }

    const totalQuantity = validLines.reduce((s, l) => s + l.quantity, 0)
    const totalCost = Math.round(totalQuantity * unitPrice * 10000) / 10000

    // 检查余额
    const balRow = await db('balance_accounts').where({ user_id: userId }).first()
    const available = balRow ? parseFloat(balRow.available_amount) : 0
    if (available < totalCost) {
      return res.status(400).json({ code: 400, message: '余额不足' })
    }

    // 采集快照（曝光除外）
    let snapshots = new Map()
    if (type !== 'impression') {
      try {
        snapshots = await collectSnapshots(validLines, type)
      } catch (e) {
        console.warn('[batch/submit] 快照采集失败，继续提交:', e.message)
      }
    }

    // ---- 事务 ----
    const trx = await db.transaction()
    try {
      const now = new Date()
      const ts = Date.now().toString(36).toUpperCase()
      const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
      const batchNo = `BATCH-${ts}-${hex}`
      const batchId = crypto.randomUUID()

      // 1. 创建批次
      const [insertId] = await trx('order_batches').insert({
        batch_id: batchId,
        batch_no: batchNo,
        user_id: userId,
        source_type: type,
        submit_mode: 'batch',
        raw_content: validLines.map(l => `${l.url} ${l.quantity}`).join('\n'),
        estimated_amount: totalCost,
        status: 'pending',
        total_count: validLines.length,
        pending_count: validLines.length,
        processing_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        retryable_count: 0,
        submitted_at: now,
        created_at: now,
        updated_at: now
      })

      // 2. 创建订单
      let runningBalance = available
      for (let i = 0; i < validLines.length; i++) {
        const line = validLines[i]
        const orderTs = Date.now()
        const orderNo = `ORDER-${orderTs}-${String(i + 1).padStart(4, '0')}`
        const itemCost = Math.round(line.quantity * unitPrice * 10000) / 10000

        // 快照数据
        const snap = snapshots.get(i) || {}

        const [orderId] = await trx('orders').insert({
          order_no: orderNo,
          user_id: userId,
          batch_id: insertId,
          batch_item_id: i + 1,
          note_id: snap.note_id || null,
          note_url: line.url,
          target_type: type,
          product_id: product.id,
          title: snap.title || null,
          author_id: snap.author_id || null,
          author_name: snap.author_name || null,
          avatar_url: snap.avatar_url || null,
          like_count: snap.like_count ?? null,
          ordered_quantity: line.quantity,
          completed_quantity: 0,
          refunded_quantity: 0,
          order_status: 'pending',
          snapshot_current_read_count: snap.view_count ?? null,
          snapshot_current_read_payload: type === 'read' ? snap.count_payload : null,
          snapshot_current_like_payload: type === 'like' ? snap.count_payload : null,
          created_at: now,
          updated_at: now
        })

        // 3. 账务记录
        const recNo = `REC-${orderTs}-${String(i + 1).padStart(4, '0')}`
        const afterBalance = Math.round((runningBalance - itemCost) * 10000) / 10000

        await trx('account_records').insert({
          record_no: recNo,
          user_id: userId,
          record_type: 'order_charge',
          direction: 'debit',
          order_id: orderId,
          order_no: orderNo,
          status: 'success',
          ordered_quantity: line.quantity,
          original_unit_price: unitPrice,
          original_total_amount: itemCost,
          discount_rate: 1,
          discounted_unit_price: unitPrice,
          discount_amount: 0,
          payable_amount: itemCost,
          actual_paid_amount: itemCost,
          refund_amount: 0,
          net_amount: -itemCost,
          before_available_amount: runningBalance,
          after_available_amount: afterBalance,
          reason_message: '批量下单扣费',
          created_at: now
        })

        runningBalance = afterBalance
      }

      // 4. 扣余额
      await trx('balance_accounts').where({ user_id: userId }).update({
        available_amount: runningBalance,
        updated_at: now
      })

      await trx.commit()

      res.json({
        code: 0,
        data: {
          batch_no: batchNo,
          total: validLines.length,
          cost: totalCost
        }
      })
    } catch (e) {
      await trx.rollback()
      throw e
    }
  } catch (err) {
    console.error('[batch/submit]', err.message)
    res.status(500).json({ code: 500, message: '提交失败：' + err.message })
  }
})

// ========== 批次订单明细 ==========

// GET /api/batch/:id/orders
router.get('/:id/orders', authRequired, async (req, res) => {
  try {
    const batchDbId = Number(req.params.id)
    const userId = req.user.id
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // 权限校验
    const batch = await db('order_batches').where({ id: batchDbId }).first()
    if (!batch) return res.status(404).json({ code: 404, message: '批次不存在' })
    if (!isAdmin && batch.user_id !== userId) {
      return res.status(403).json({ code: 403, message: '无权访问' })
    }

    const orders = await db('orders')
      .leftJoin('account_records', function () {
        this.on('account_records.order_id', '=', 'orders.id')
          .andOn('account_records.record_type', '=', db.raw("'order_charge'"))
      })
      .leftJoin('products', 'products.id', 'orders.product_id')
      .where('orders.batch_id', batchDbId)
      .select(
        'orders.*',
        'account_records.actual_paid_amount',
        'account_records.payable_amount',
        'account_records.discount_rate',
        'account_records.status as charge_status',
        'products.name as product_name',
        'products.api_endpoint as product_api_endpoint'
      )
      .orderBy('orders.batch_item_id', 'asc')

    res.json({ code: 0, data: { batch, orders } })
  } catch (err) {
    console.error('[batch/:id/orders]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 批量查询订单 ==========

// POST /api/batch/orders/lookup — 根据订单ID批量查询订单详情（含上游状态）
router.post('/orders/lookup', authRequired, async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供订单ID列表' })
    }

    const userId = req.user.id
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const isAgent = roles.includes('agent')

    // 最多查 200 条
    const lookupIds = ids.slice(0, 200).map(Number).filter(n => n > 0)
    if (lookupIds.length === 0) {
      return res.status(400).json({ code: 400, message: '没有有效的订单ID' })
    }

    const hasProductId = await db.schema.hasColumn('orders', 'product_id')
    const joinCondition = hasProductId
      ? db.raw('(`products`.`id` = `orders`.`product_id` OR (`orders`.`product_id` IS NULL AND `products`.`target_type` COLLATE utf8mb4_unicode_ci = `orders`.`target_type` COLLATE utf8mb4_unicode_ci AND `products`.`api_endpoint` IS NOT NULL))')
      : db.raw('`products`.`target_type` COLLATE utf8mb4_unicode_ci = `orders`.`target_type` COLLATE utf8mb4_unicode_ci AND `products`.`api_endpoint` IS NOT NULL')

    const selectCols = [
      'orders.id', 'orders.order_no', 'orders.note_url', 'orders.target_type',
      'orders.ordered_quantity', 'orders.completed_quantity',
      'orders.order_status', 'orders.external_task_id', 'orders.external_status',
      'orders.external_progress', 'orders.external_completed_quantity',
      'orders.external_last_synced_at', 'orders.user_id',
      'orders.created_at', 'orders.updated_at',
      'products.name as product_name',
      'products.api_endpoint'
    ]
    if (hasProductId) selectCols.splice(4, 0, 'orders.product_id')

    let q = db('orders')
      .leftJoin('products', joinCondition)
      .whereIn('orders.id', lookupIds)
      .select(selectCols)

    // 权限过滤：代理可查下级，普通用户只查自己
    if (!isAdmin) {
      if (isAgent) {
        const subIds = await db('users').where({ referred_by: userId }).pluck('id')
        subIds.push(userId)
        q = q.whereIn('orders.user_id', subIds)
      } else {
        q = q.where('orders.user_id', userId)
      }
    }

    const orders = await q

    // 标记哪些ID未找到
    const foundIds = new Set(orders.map(o => o.id))
    const notFound = lookupIds.filter(id => !foundIds.has(id))

    const data = orders.map(o => ({
      id: o.id,
      order_no: o.order_no,
      note_url: o.note_url,
      target_type: o.target_type,
      product_name: o.product_name || null,
      ordered_quantity: o.ordered_quantity,
      completed_quantity: o.completed_quantity,
      order_status: o.order_status,
      external_task_id: o.external_task_id || null,
      external_status: o.external_status || null,
      external_progress: o.external_progress || 0,
      external_completed_quantity: o.external_completed_quantity || 0,
      external_last_synced_at: o.external_last_synced_at || null,
      has_upstream: !!o.api_endpoint,
      created_at: o.created_at,
      updated_at: o.updated_at
    }))

    res.json({ code: 0, data: { orders: data, not_found: notFound } })
  } catch (err) {
    console.error('[batch/orders/lookup]', err.message)
    res.status(500).json({ code: 500, message: '查询失败: ' + err.message })
  }
})

// ========== 批次退款 ==========

// POST /api/batch/:id/refund — 用户提交退款申请
router.post('/:id/refund', authRequired, async (req, res) => {
  try {
    const batchId = Number(req.params.id)
    const userId = req.user.id
    const reason = req.body.reason || ''

    const batch = await db('order_batches').where({ id: batchId }).first()
    if (!batch) return res.status(404).json({ code: 404, message: '批次不存在' })
    if (batch.user_id !== userId) return res.status(403).json({ code: 403, message: '无权操作' })

    if (['refunded', 'cancelled'].includes(batch.status)) {
      return res.status(400).json({ code: 400, message: '该批次已退款或已取消' })
    }

    const orders = await db('orders').where({ batch_id: batchId })
      .whereNotIn('order_status', ['refunded', 'cancelled'])

    if (orders.length === 0) {
      // 所有订单已退款，同步批次状态
      await db('order_batches').where({ id: batchId }).update({ status: 'refunded', updated_at: new Date() })
      return res.status(400).json({ code: 400, message: '没有可退款的订单' })
    }

    // ===== 待处理批次：还没派发到上游，直接退款 =====
    if (batch.status === 'pending') {
      const trx = await db.transaction()
      try {
        const now = new Date()
        const ts = Date.now()
        let totalRefund = 0

        for (let i = 0; i < orders.length; i++) {
          const order = orders[i]
          const chargeRec = await trx('account_records')
            .where({ order_id: order.id, record_type: 'order_charge' }).first()
          if (!chargeRec) continue

          const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
          const orderedQty = order.ordered_quantity || 0
          const refundQty = Math.max(0, orderedQty - (order.completed_quantity || 0))
          if (refundQty === 0) continue

          const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000

          await trx('orders').where({ id: order.id }).update({
            order_status: 'refunded', refunded_quantity: refundQty, updated_at: now
          })

          const balAcc = await trx('balance_accounts').where({ user_id: userId }).first()
          const beforeBal = parseFloat(balAcc?.available_amount) || 0
          const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

          await trx('account_records').insert({
            record_no: `REFUND-${ts}-${String(i + 1).padStart(4, '0')}`,
            user_id: userId,
            record_type: 'refund',
            direction: 'credit',
            order_id: order.id,
            order_no: order.order_no,
            status: 'success',
            ordered_quantity: orderedQty,
            original_unit_price: unitPrice,
            original_total_amount: refundAmount,
            discount_rate: 1,
            discounted_unit_price: unitPrice,
            discount_amount: 0,
            payable_amount: refundAmount,
            actual_paid_amount: refundAmount,
            refund_amount: refundAmount,
            net_amount: refundAmount,
            before_available_amount: beforeBal,
            after_available_amount: afterBal,
            reason_message: '退款(未派发直接退)',
            created_at: now
          })

          await trx('balance_accounts').where({ user_id: userId }).update({
            available_amount: afterBal, updated_at: now
          })

          totalRefund += refundAmount
        }

        await trx('order_batches').where({ id: batchId }).update({ status: 'refunded', updated_at: now })
        await trx.commit()
        return res.json({ code: 0, message: `退款成功，共退还 ¥${totalRefund.toFixed(2)}`, refunded: true })
      } catch (err) {
        await trx.rollback()
        console.error('[batch/refund/direct]', err.message)
        return res.status(500).json({ code: 500, message: '退款失败: ' + err.message })
      }
    }

    // ===== 已派发到上游的批次：停止上游 + 走审批 =====
    if (!(await db.schema.hasTable('refund_requests'))) {
      return res.status(500).json({ code: 500, message: '退款功能未初始化，请稍后重试' })
    }
    const existing = await db('refund_requests')
      .where({ batch_id: batchId, status: 'pending' }).whereNull('order_id').first()
    if (existing) return res.status(400).json({ code: 400, message: '该批次已有待处理的退款申请' })

    let estimatedRefund = 0
    for (const order of orders) {
      const chargeRec = await db('account_records')
        .where({ order_id: order.id, record_type: 'order_charge' }).first()
      if (!chargeRec) continue
      const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
      const refundQty = Math.max(0, (order.ordered_quantity || 0) - (order.completed_quantity || 0))
      estimatedRefund += Math.round(refundQty * unitPrice * 10000) / 10000
    }

    if (estimatedRefund <= 0) {
      return res.status(400).json({ code: 400, message: '没有可退款的订单' })
    }

    // 向上游发起停止任务请求并更新状态
    const toCancel = orders.filter(o => o.external_task_id && ['running', 'pending'].includes(o.order_status))
    const stopResults = await Promise.allSettled(
      toCancel.map(async o => {
        const prod = await db('products').where({ target_type: o.target_type }).whereNotNull('api_endpoint').first()
        const result = await cancelTask(o.target_type, o.external_task_id, prod?.api_endpoint)
        console.log(`[batch/refund] 停止上游任务 order=${o.id} task=${o.external_task_id}:`, result)
        return result
      })
    )
    if (toCancel.length > 0) {
      await db('orders').whereIn('id', toCancel.map(o => o.id)).update({ external_status: 'cancelled' })
    }
    console.log(`[batch/refund] 批次${batchId} 停止上游任务: ${stopResults.length}条`)

    await db('refund_requests').insert({
      batch_id: batchId,
      user_id: userId,
      refund_amount: estimatedRefund,
      reason,
      status: 'pending'
    })

    res.json({ code: 0, message: '退款申请已提交，等待审批' })
  } catch (err) {
    console.error('[batch/refund]', err.message)
    res.status(500).json({ code: 500, message: '提交失败: ' + err.message })
  }
})

// POST /api/batch/orders/:id/refund — 单条订单申请退款
router.post('/orders/:id/refund', authRequired, async (req, res) => {
  try {
    const orderId = Number(req.params.id)
    const userId = req.user.id

    const order = await db('orders').where({ id: orderId }).first()
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' })

    const batch = await db('order_batches').where({ id: order.batch_id }).first()
    if (!batch || batch.user_id !== userId) return res.status(403).json({ code: 403, message: '无权操作' })

    if (['refunded', 'cancelled', 'completed'].includes(order.order_status)) {
      return res.status(400).json({ code: 400, message: '该订单不可退款' })
    }

    const chargeRec = await db('account_records')
      .where({ order_id: orderId, record_type: 'order_charge' }).first()
    const unitPrice = parseFloat(chargeRec?.original_unit_price) || 0
    const refundQty = Math.max(0, (order.ordered_quantity || 0) - (order.completed_quantity || 0))
    const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000

    if (refundAmount <= 0) {
      return res.status(400).json({ code: 400, message: '没有可退款金额' })
    }

    // ===== 未派发到上游的订单：直接退款 =====
    if (!order.external_task_id) {
      const trx = await db.transaction()
      try {
        const now = new Date()
        const ts = Date.now()

        await trx('orders').where({ id: orderId }).update({
          order_status: 'refunded', refunded_quantity: refundQty, updated_at: now
        })

        const balAcc = await trx('balance_accounts').where({ user_id: userId }).first()
        const beforeBal = parseFloat(balAcc?.available_amount) || 0
        const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

        await trx('account_records').insert({
          record_no: `REFUND-${ts}-0001`,
          user_id: userId,
          record_type: 'refund',
          direction: 'credit',
          order_id: orderId,
          order_no: order.order_no,
          status: 'success',
          ordered_quantity: order.ordered_quantity || 0,
          original_unit_price: unitPrice,
          original_total_amount: refundAmount,
          discount_rate: 1,
          discounted_unit_price: unitPrice,
          discount_amount: 0,
          payable_amount: refundAmount,
          actual_paid_amount: refundAmount,
          refund_amount: refundAmount,
          net_amount: refundAmount,
          before_available_amount: beforeBal,
          after_available_amount: afterBal,
          reason_message: '退款(未派发直接退)',
          created_at: now
        })

        await trx('balance_accounts').where({ user_id: userId }).update({
          available_amount: afterBal, updated_at: now
        })

        // 检查批次内是否全部退完
        const remaining = await trx('orders').where({ batch_id: order.batch_id })
          .whereNotIn('order_status', ['refunded', 'cancelled', 'completed', 'partial_completed']).first()
        if (!remaining) {
          await trx('order_batches').where({ id: order.batch_id }).update({ status: 'refunded', updated_at: now })
        }

        await trx.commit()
        return res.json({ code: 0, message: `退款成功，退还 ¥${refundAmount.toFixed(2)}`, refunded: true })
      } catch (err) {
        await trx.rollback()
        console.error('[order/refund/direct]', err.message)
        return res.status(500).json({ code: 500, message: '退款失败: ' + err.message })
      }
    }

    // ===== 已派发到上游的订单：停止上游 + 走审批 =====
    if (!(await db.schema.hasTable('refund_requests'))) {
      return res.status(500).json({ code: 500, message: '退款功能未初始化' })
    }
    const existing = await db('refund_requests')
      .where({ order_id: orderId, status: 'pending' }).first()
    if (existing) return res.status(400).json({ code: 400, message: '该订单已有待处理的退款申请' })

    // 向上游发起停止任务请求并更新状态
    if (['running', 'pending'].includes(order.order_status)) {
      const prod = await db('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
      const result = await cancelTask(order.target_type, order.external_task_id, prod?.api_endpoint)
      await db('orders').where({ id: orderId }).update({ external_status: 'cancelled' })
      console.log(`[order/refund] 停止上游任务 order=${orderId} task=${order.external_task_id}:`, result)
    }

    await db('refund_requests').insert({
      batch_id: order.batch_id,
      order_id: orderId,
      user_id: userId,
      refund_amount: refundAmount,
      reason: req.body.reason || '',
      status: 'pending'
    })

    res.json({ code: 0, message: '退款申请已提交，等待审批' })
  } catch (err) {
    console.error('[order/refund]', err.message)
    res.status(500).json({ code: 500, message: '提交失败: ' + err.message })
  }
})

// ========== 申请补单 ==========

// POST /api/batch/orders/:id/request-supplement — 用户申请补单
router.post('/orders/:id/request-supplement', authRequired, async (req, res) => {
  try {
    const order = await db('orders').where({ id: Number(req.params.id) }).first()
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' })

    const userId = req.user.id
    if (order.user_id !== userId) {
      return res.status(403).json({ code: 403, message: '无权操作' })
    }

    // 检查是否已有未处理的补单申请
    const existing = await Task.getReplenishmentByOrderId(order.id)
    if (existing) {
      return res.status(400).json({ code: 400, message: '该订单已有待处理的补单申请' })
    }

    // 必须先验证过
    if (!order.last_verified_at) {
      return res.status(400).json({ code: 400, message: '请先验证订单快照' })
    }

    // 计算缺量
    let actualCount = 0
    let baseLine = 0
    if (order.target_type === 'like') {
      baseLine = order.like_count ?? 0
      actualCount = order.snapshot_verified_like_count ?? 0
    } else {
      baseLine = order.snapshot_current_read_count ?? 0
      actualCount = order.snapshot_verified_read_count ?? 0
    }
    const actualGain = Math.max(0, actualCount - baseLine)
    const shortage = Math.max(0, order.ordered_quantity - actualGain)

    if (shortage <= 0) {
      return res.status(400).json({ code: 400, message: '订单已达标，无需补单' })
    }

    // 创建补单申请
    const now = new Date()
    const ts = Date.now().toString(36).toUpperCase()
    const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
    const repNo = `REP-${ts}-${hex}`

    await db('order_replenishment_records').insert({
      replenishment_no: repNo,
      order_id: order.id,
      order_no: order.order_no,
      batch_id: order.batch_id,
      user_id: userId,
      target_type: order.target_type,
      note_id: order.note_id || null,
      note_url: order.note_url,
      original_external_task_id: order.external_task_id || null,
      ordered_quantity: order.ordered_quantity,
      actual_quantity: actualGain,
      shortage_quantity: shortage,
      snapshot_before_count: baseLine,
      snapshot_after_count: actualCount,
      status: 'pending',
      reason_message: req.body.reason || '验证未达标，申请补单',
      requested_at: now,
      created_at: now,
      updated_at: now
    })

    res.json({ code: 0, message: '补单申请已提交，等待管理员审核' })
  } catch (err) {
    console.error('[batch/request-supplement]', err.message)
    res.status(500).json({ code: 500, message: '申请失败：' + err.message })
  }
})

// ========== 管理员审批补单 ==========

// PUT /api/batch/supplement/:id/approve
router.put('/supplement/:id/approve', authRequired, adminRequired, async (req, res) => {
  try {
    const record = await db('order_replenishment_records').where({ id: Number(req.params.id) }).first()
    if (!record) return res.status(404).json({ code: 404, message: '记录不存在' })
    if (record.status !== 'pending') {
      return res.status(400).json({ code: 400, message: `当前状态为 ${record.status}，无法审批` })
    }

    await db('order_replenishment_records').where({ id: record.id }).update({
      status: 'approved',
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      updated_at: new Date()
    })

    res.json({ code: 0, message: '已批准补单申请' })
  } catch (err) {
    console.error('[supplement/approve]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/batch/supplement/:id/reject
router.put('/supplement/:id/reject', authRequired, adminRequired, async (req, res) => {
  try {
    const record = await db('order_replenishment_records').where({ id: Number(req.params.id) }).first()
    if (!record) return res.status(404).json({ code: 404, message: '记录不存在' })
    if (record.status !== 'pending') {
      return res.status(400).json({ code: 400, message: `当前状态为 ${record.status}，无法操作` })
    }

    await db('order_replenishment_records').where({ id: record.id }).update({
      status: 'rejected',
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      reason_message: req.body.reason || record.reason_message,
      updated_at: new Date()
    })

    res.json({ code: 0, message: '已驳回补单申请' })
  } catch (err) {
    console.error('[supplement/reject]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
