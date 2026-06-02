import { Router } from 'express'
import { authRequired, roleRequired } from '../middleware/auth.js'
import { cancelTask } from '../services/xhsApi.js'
import { clawbackAgentCommission } from '../services/agentCommission.js'
import { refreshBatchStatus } from '../services/batchStatus.js'
import db from '../db.js'

const router = Router()

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  if (!(await db.schema.hasTable('refund_requests'))) {
    await db.schema.createTable('refund_requests', t => {
      t.increments('id')
      t.integer('batch_id').unsigned().notNullable()
      t.integer('order_id').unsigned().nullable().comment('单条订单退款时填写')
      t.integer('user_id').unsigned().notNullable().comment('申请人')
      t.decimal('refund_amount', 14, 4).defaultTo(0).comment('预估退款金额')
      t.string('status', 20).defaultTo('pending').comment('pending/approved/rejected')
      t.text('reason').nullable().comment('申请理由')
      t.integer('reviewed_by').unsigned().nullable()
      t.text('review_remark').nullable()
      t.timestamp('reviewed_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.index('user_id')
      t.index('batch_id')
      t.index('status')
    })
  } else {
    if (!(await db.schema.hasColumn('refund_requests', 'order_id'))) {
      await db.schema.alterTable('refund_requests', t => {
        t.integer('order_id').unsigned().nullable().after('batch_id')
      })
    }
  }
  tableReady = true
}

// GET /api/refund/check/:batchId — 用户检查批次/订单的待处理退款
router.get('/check/:batchId', authRequired, async (req, res) => {
  await ensureTable()
  try {    
    const batchId = Number(req.params.batchId)
    // 批次级别检查
    const batchPending = await db('refund_requests')
      .where({ batch_id: batchId, user_id: req.user.id, status: 'pending' })
      .whereNull('order_id').first()
    // 订单级别：返回有待处理退款的订单 id 列表
    const orderPendings = await db('refund_requests')
      .where({ batch_id: batchId, user_id: req.user.id, status: 'pending' })
      .whereNotNull('order_id')
      .pluck('order_id')
    res.json({ code: 0, data: { pending: !!batchPending, pendingOrderIds: orderPendings } })
  } catch {
    res.json({ code: 0, data: { pending: false, pendingOrderIds: [] } })
  }
})        

// GET /api/refund — 退款申请列表
router.get('/', authRequired, roleRequired('admin'), async (req, res) => {
  await ensureTable()
  try {
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(50, parseInt(req.query.pageSize) || 15)
    const status = req.query.status || ''

    let q = db('refund_requests as r')
      .join('users as u', 'u.id', 'r.user_id')
      .join('order_batches as b', 'b.id', 'r.batch_id')
      .leftJoin('users as rv', 'rv.id', 'r.reviewed_by')

    if (!isAdmin) {
      const subordinateIds = await db('users')
        .where({ referred_by: req.user.id })
        .pluck('id')
      subordinateIds.push(req.user.id)
      q = q.whereIn('r.user_id', subordinateIds)
    }

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      q = q.where('r.status', status)
    }

    const batchId = parseInt(req.query.batchId)
    if (batchId) q = q.where('r.batch_id', batchId)

    const countQ = q.clone().count('r.id as cnt').first()
    const listQ = q.clone()
      .select(
        'r.*',
        'u.username', 'u.nickname', 'u.real_name',
        'b.batch_no', 'b.status as batch_status', 'b.total_count', 'b.estimated_amount',
        'rv.username as reviewer_name'
      )
      .orderBy('r.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const [{ cnt }, list] = await Promise.all([countQ, listQ])

    res.json({ code: 0, data: { list, total: cnt, page, pageSize } })
  } catch (err) {
    console.error('[refund/list]', err.message)
    res.status(500).json({ code: 500, message: '查询失败' })
  }
})

// 退款单条订单的核心逻辑（事务内调用）
// fullRefund=true 时全额退款，不扣除已完成部分
async function refundSingleOrder(trx, order, userId, ts, idx, fullRefund = false) {
  const chargeRec = await trx('account_records')
    .where({ order_id: order.id, record_type: 'order_charge' }).first()
  if (!chargeRec) return 0

  const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
  const orderedQty = order.ordered_quantity || 0
  const refundQty = fullRefund ? orderedQty : Math.max(0, orderedQty - (order.completed_quantity || 0))
  if (refundQty === 0) return 0

  // 先尝试取消上游任务
  if (order.external_task_id && ['running', 'pending'].includes(order.order_status)) {
    const prod = await trx('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
    await cancelTask(order.target_type, order.external_task_id, prod?.api_endpoint)
  }

  const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000
  const completedQty = order.completed_quantity || 0
  const newStatus = completedQty > 0 ? 'partial_completed' : 'refunded'
  const now = new Date()

  const orderUpdate = { order_status: newStatus, refunded_quantity: refundQty, updated_at: now }
  if (order.external_task_id) orderUpdate.external_status = 'cancelled'
  await trx('orders').where({ id: order.id }).update(orderUpdate)

  const balAcc = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
  const beforeBal = parseFloat(balAcc?.available_amount) || 0
  const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

  await trx('account_records').insert({
    record_no: `REFUND-${ts}-${String(idx).padStart(4, '0')}`,
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
    reason_message: '退款(审批通过)',
    created_at: now
  })

  await trx('balance_accounts').where({ user_id: userId }).update({
    available_amount: afterBal, updated_at: now
  })

  // 退款 → 扣回已划给上级代理的分润
  await clawbackAgentCommission(trx, order, refundQty)

  return refundAmount
}

// PUT /api/refund/:id/approve — 审批通过
router.put('/:id/approve', authRequired, roleRequired('admin'), async (req, res) => {
  await ensureTable()
  const trx = await db.transaction()
  try {
    const requestId = Number(req.params.id)
    const remark = req.body.remark || ''
    const fullRefund = !!req.body.fullRefund
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    const request = await trx('refund_requests').where({ id: requestId }).first()
    if (!request) { await trx.rollback(); return res.status(404).json({ code: 404, message: '申请不存在' }) }
    if (request.status !== 'pending') { await trx.rollback(); return res.status(400).json({ code: 400, message: '该申请已处理' }) }

    if (!isAdmin) {
      const applicant = await trx('users').where({ id: request.user_id }).select('referred_by').first()
      if (!applicant || applicant.referred_by !== req.user.id) {
        await trx.rollback()
        return res.status(403).json({ code: 403, message: '无权审批此申请' })
      }
    }

    const batch = await trx('order_batches').where({ id: request.batch_id }).first()
    if (!batch) { await trx.rollback(); return res.status(404).json({ code: 404, message: '批次不存在' }) }

    const now = new Date()
    const ts = Date.now()
    let totalRefund = 0

    if (request.order_id) {
      // 单条订单退款
      const order = await trx('orders').where({ id: request.order_id }).first()
      if (!order || ['refunded', 'cancelled', 'completed'].includes(order.order_status)) {
        await trx('refund_requests').where({ id: requestId }).update({
          status: 'rejected', review_remark: '订单不可退款', reviewed_by: req.user.id, reviewed_at: now
        })
        await trx.commit()
        return res.json({ code: 0, message: '订单已完成或已退款，自动驳回' })
      }
      totalRefund = await refundSingleOrder(trx, order, batch.user_id, ts, 1, fullRefund)
    } else {
      // 批次退款
      if (['refunded', 'cancelled'].includes(batch.status)) {
        await trx('refund_requests').where({ id: requestId }).update({
          status: 'rejected', review_remark: '批次已退款或已取消', reviewed_by: req.user.id, reviewed_at: now
        })
        await trx.commit()
        return res.json({ code: 0, message: '批次已退款/取消，申请自动驳回' })
      }

      // 全额退款时包含已完成的订单
      const orders = fullRefund
        ? await trx('orders').where({ batch_id: request.batch_id }).whereNotIn('order_status', ['refunded', 'cancelled'])
        : await trx('orders').where({ batch_id: request.batch_id }).whereNotIn('order_status', ['refunded', 'cancelled', 'completed'])

      for (let i = 0; i < orders.length; i++) {
        totalRefund += await refundSingleOrder(trx, orders[i], batch.user_id, ts, i + 1, fullRefund)
      }

    }

    await trx('refund_requests').where({ id: requestId }).update({
      status: 'approved', refund_amount: totalRefund, review_remark: remark,
      reviewed_by: req.user.id, reviewed_at: now
    })

    await trx.commit()
    await refreshBatchStatus(request.batch_id)
    res.json({ code: 0, message: `退款成功，共退还 ¥${totalRefund.toFixed(2)}` })
  } catch (err) {
    await trx.rollback()
    console.error('[refund/approve]', err.message)
    res.status(500).json({ code: 500, message: '审批失败: ' + err.message })
  }
})

// PUT /api/refund/approve-all — 一键同意所有待处理退款
router.put('/approve-all', authRequired, roleRequired('admin'), async (req, res) => {
  await ensureTable()
  try {
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // Debug: count all records by status
    const allStatuses = await db('refund_requests').select('status').groupBy('status')
      .count('* as cnt').then(rows => rows.map(r => `${r.status}:${r.cnt}`).join(', '))
    console.log(`[refund/approve-all] user=${req.user.id} roles=${JSON.stringify(roles)} isAdmin=${isAdmin} allStatuses=[${allStatuses}]`)

    let q = db('refund_requests').where('status', 'pending')
    if (!isAdmin) {
      const subIds = await db('users').where({ referred_by: req.user.id }).pluck('id')
      subIds.push(req.user.id)
      q = q.whereIn('user_id', subIds)
    }
    const pendings = await q
    console.log(`[refund/approve-all] found ${pendings.length} pending records: ids=[${pendings.map(p => p.id).join(',')}]`)

    let approved = 0
    let totalRefund = 0

    for (const request of pendings) {
      const trx = await db.transaction()
      try {
        const batch = await trx('order_batches').where({ id: request.batch_id }).first()
        if (!batch) { await trx.rollback(); continue }

        const now = new Date()
        const ts = Date.now()
        let refund = 0

        if (request.order_id) {
          const order = await trx('orders').where({ id: request.order_id }).first()
          if (!order || ['refunded', 'cancelled', 'completed'].includes(order.order_status)) {
            await trx('refund_requests').where({ id: request.id }).update({
              status: 'rejected', review_remark: '订单不可退款', reviewed_by: req.user.id, reviewed_at: now
            })
            await trx.commit(); continue
          }
          refund = await refundSingleOrder(trx, order, batch.user_id, ts, 1)
        } else {
          if (['refunded', 'cancelled'].includes(batch.status)) {
            await trx('refund_requests').where({ id: request.id }).update({
              status: 'rejected', review_remark: '批次已退款', reviewed_by: req.user.id, reviewed_at: now
            })
            await trx.commit(); continue
          }
          const orders = await trx('orders').where({ batch_id: request.batch_id })
            .whereNotIn('order_status', ['refunded', 'cancelled', 'completed'])
          for (let i = 0; i < orders.length; i++) {
            refund += await refundSingleOrder(trx, orders[i], batch.user_id, ts, i + 1)
          }
        }

        await trx('refund_requests').where({ id: request.id }).update({
          status: 'approved', refund_amount: refund, reviewed_by: req.user.id, reviewed_at: now
        })
        await trx.commit()
        await refreshBatchStatus(request.batch_id)
        approved++
        totalRefund += refund
      } catch (err) {
        await trx.rollback()
        console.error(`[refund/approve-all] id=${request.id}:`, err.message)
      }
    }

    res.json({ code: 0, message: `已处理 ${approved} 条，共退还 ¥${totalRefund.toFixed(2)}` })
  } catch (err) {
    console.error('[refund/approve-all]', err.message)
    res.status(500).json({ code: 500, message: '操作失败' })
  }
})

// PUT /api/refund/:id/reject — 驳回
router.put('/:id/reject', authRequired, roleRequired('admin'), async (req, res) => {
  await ensureTable()
  try {
    const requestId = Number(req.params.id)
    const remark = req.body.remark || ''
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    const request = await db('refund_requests').where({ id: requestId }).first()
    if (!request) return res.status(404).json({ code: 404, message: '申请不存在' })
    if (request.status !== 'pending') return res.status(400).json({ code: 400, message: '该申请已处理' })

    if (!isAdmin) {
      const applicant = await db('users').where({ id: request.user_id }).select('referred_by').first()
      if (!applicant || applicant.referred_by !== req.user.id) {
        return res.status(403).json({ code: 403, message: '无权审批此申请' })
      }
    }

    await db('refund_requests').where({ id: requestId }).update({
      status: 'rejected',
      review_remark: remark,
      reviewed_by: req.user.id,
      reviewed_at: new Date()
    })

    res.json({ code: 0, message: '已驳回' })
  } catch (err) {
    console.error('[refund/reject]', err.message)
    res.status(500).json({ code: 500, message: '操作失败' })
  }
})

export default router
