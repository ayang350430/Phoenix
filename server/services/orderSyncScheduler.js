import db from '../db.js'
import { createTask, getTaskStatus, buildTaskPayload } from './xhsApi.js'
import { fetchNoteId, fetchNoteBasic, fetchNoteViewCount, fetchNoteLikeCount } from './noteApi.js'
import { clawbackAgentCommission } from './agentCommission.js'

/**
 * 订单同步调度器
 *
 * 1. 派单 — pending 且无 external_task_id 的订单 → 发给上游 → 改为 running
 * 2. 同步 — running 且有 external_task_id 的订单 → 查上游状态 → 完成/失败
 * 3. 汇总 — 更新批次统计与状态
 */

const POLL_INTERVAL = 10_000          // 10 秒
const DISPATCH_LIMIT = 30            // 每轮最多派 30 单
const SYNC_LIMIT = 100                // 每轮最多同步 100 单

let running = false

// ========== 自动退款 ==========

async function autoRefundOrder(order, reason) {
  const trx = await db.transaction()
  try {
    const now = new Date()
    const chargeRec = await trx('account_records')
      .where({ order_id: order.id, record_type: 'order_charge' }).first()

    if (!chargeRec) {
      await trx('orders').where({ id: order.id }).update({
        order_status: 'failed', reason_message: reason, updated_at: now
      })
      await trx.commit()
      console.log(`[order-sync] ${order.order_no} 无扣费记录，仅标记失败`)
      return
    }

    const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
    const refundQty = Math.max(0, (order.ordered_quantity || 0) - (order.completed_quantity || 0))
    if (refundQty === 0) { await trx.commit(); return }

    const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000

    await trx('orders').where({ id: order.id }).update({
      order_status: 'refunded', refunded_quantity: refundQty,
      reason_message: reason, updated_at: now
    })

    const balAcc = await trx('balance_accounts').where({ user_id: order.user_id }).forUpdate().first()
    const beforeBal = parseFloat(balAcc?.available_amount) || 0
    const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

    await trx('account_records').insert({
      record_no: `AUTOREFUND-${Date.now()}-${order.id}`,
      user_id: order.user_id,
      record_type: 'refund',
      direction: 'credit',
      order_id: order.id,
      order_no: order.order_no,
      status: 'success',
      ordered_quantity: order.ordered_quantity,
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
      reason_message: '自动退款(派单失败)',
      created_at: now
    })

    await trx('balance_accounts').where({ user_id: order.user_id }).update({
      available_amount: afterBal, updated_at: now
    })

    // 退款 → 扣回已划给上级代理的分润
    await clawbackAgentCommission(trx, order, refundQty)

    await trx.commit()
    console.log(`[order-sync] ${order.order_no} 自动退款 ¥${refundAmount.toFixed(2)}`)
  } catch (err) {
    await trx.rollback()
    console.error(`[order-sync] ${order.order_no} 自动退款失败:`, err.message)
    await db('orders').where({ id: order.id }).update({
      order_status: 'failed', reason_message: reason, updated_at: new Date()
    })
  }
}

// ========== 1. 派单 ==========

async function dispatchOneOrder(order) {
  let product
  if (order.product_id) {
    product = await db('products').where({ id: order.product_id }).first()
  }
  if (!product) {
    product = await db('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
  }
  if (!product || !product.api_endpoint) return false

  let noteId = order.note_id
  let authorId = order.author_id

  if (!noteId && !order.note_url) return false

  if (!noteId) {
    noteId = await fetchNoteId(order.note_url)
    if (!noteId) {
      console.warn(`[order-sync] ${order.order_no} 无法解析 note_id，跳过`)
      return false
    }
  }

  if (!authorId) {
    const basic = await fetchNoteBasic(noteId)
    if (!basic || !basic.author_id) {
      console.warn(`[order-sync] ${order.order_no} 无法获取 author_id，跳过`)
      return false
    }
    authorId = basic.author_id
    await db('orders').where({ id: order.id }).update({
      note_id: noteId,
      author_id: authorId,
      author_name: basic.author_name || null,
      title: basic.title || null,
      avatar_url: basic.avatar_url || null,
      updated_at: new Date()
    })
  }

  const snapUpdate = {}
  if (order.target_type === 'like' && order.like_count == null) {
    try {
      const { like_count, payload: lp } = await fetchNoteLikeCount(noteId)
      if (like_count != null) snapUpdate.like_count = like_count
      if (lp) snapUpdate.snapshot_current_like_payload = JSON.stringify(lp).slice(0, 8000)
    } catch { /* 快照非关键，不阻塞派单 */ }
  } else if (order.target_type !== 'impression' && order.snapshot_current_read_count == null) {
    try {
      const { view_count, payload: vp } = await fetchNoteViewCount(noteId)
      if (view_count != null) snapUpdate.snapshot_current_read_count = view_count
      if (vp) snapUpdate.snapshot_current_read_payload = JSON.stringify(vp).slice(0, 8000)
    } catch { /* 快照非关键，不阻塞派单 */ }
  }

  const payload = buildTaskPayload(order, noteId, authorId)
  const taskId = await createTask(order.target_type, payload, product.api_endpoint)

  await db('orders').where({ id: order.id }).update({
    note_id: noteId,
    external_task_id: taskId,
    external_status: 'accepted',
    order_status: 'running',
    last_dispatch_at: new Date(),
    updated_at: new Date(),
    ...snapUpdate
  })

  console.log(`[order-sync] 派单 ${order.order_no} → task_id=${taskId}`)
  return true
}

async function dispatchPendingOrders() {
  const orders = await db('orders')
    .where('order_status', 'pending')
    .whereNull('external_task_id')
    .orderBy('created_at', 'asc')
    .limit(DISPATCH_LIMIT)

  if (!orders.length) return 0

  const results = await Promise.allSettled(
    orders.map(async order => {
      try {
        return await dispatchOneOrder(order)
      } catch (err) {
        console.error(`[order-sync] 派单失败 ${order.order_no}:`, err.message)
        if (err.message.includes('上游创建任务失败') || err.message.includes('上游返回无效')) {
          await db('orders').where({ id: order.id }).update({
            order_status: 'failed',
            reason_message: '派单失败，请下载订单文件联系客服处理',
            updated_at: new Date()
          })
        }
        return false
      }
    })
  )

  return results.filter(r => r.status === 'fulfilled' && r.value === true).length
}

// ========== 2. 同步 running 订单状态 ==========

async function syncOneOrder(order) {
  let prod
  if (order.product_id) {
    prod = await db('products').where({ id: order.product_id }).first()
  }
  if (!prod) {
    prod = await db('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
  }
  const result = await getTaskStatus(order.target_type, order.external_task_id, prod?.api_endpoint)
  const now = new Date()

  const updateData = {
    external_last_synced_at: now,
    updated_at: now
  }

  if (result.failed) {
    updateData.order_status = 'failed'
    updateData.external_status = 'failed'
    updateData.reason_message = '上游任务失败'
  } else {
    const progress = result.totalCount > 0
      ? Math.min(1, result.currentCount / result.totalCount)
      : 0

    updateData.external_progress = progress
    updateData.external_completed_quantity = result.currentCount

    if (result.status === 2) {
      updateData.order_status = 'completed'
      updateData.external_status = 'completed'
      updateData.completed_quantity = Math.min(result.currentCount, order.ordered_quantity)
    } else {
      updateData.external_status = 'running'
      updateData.completed_quantity = Math.min(result.currentCount, order.ordered_quantity)
    }
  }

  await db('orders').where({ id: order.id }).update(updateData)

  const statusLabel = result.failed ? 'failed' : (result.status === 2 ? 'completed' : 'running')
  console.log(
    `[order-sync] ${order.order_no} | ${statusLabel} | ` +
    `${result.currentCount}/${result.totalCount}`
  )
  return true
}

async function syncRunningOrders() {
  const orders = await db('orders')
    .where('order_status', 'running')
    .whereNotNull('external_task_id')
    .where('external_status', '!=', 'cancelled')
    .orderBy('external_last_synced_at', 'asc')
    .limit(SYNC_LIMIT)

  if (!orders.length) return 0

  const results = await Promise.allSettled(
    orders.map(async order => {
      try {
        return await syncOneOrder(order)
      } catch (err) {
        console.error(`[order-sync] 同步失败 ${order.order_no}:`, err.message)
        return false
      }
    })
  )

  return results.filter(r => r.status === 'fulfilled' && r.value === true).length
}

// ========== 3. 汇总批次状态 ==========

async function refreshBatchStatuses() {
  // 找出仍在进行中的批次
  const batches = await db('order_batches')
    .whereIn('status', ['pending', 'processing'])
    .limit(100)

  for (const batch of batches) {
    try {
      // 统计该批次下所有订单的状态分布
      const stats = await db('orders')
        .where({ batch_id: batch.id })
        .select(db.raw(`
          COUNT(*) as total,
          SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN order_status IN ('running','processing') THEN 1 ELSE 0 END) as processing_count,
          SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END) as succeeded_count,
          SUM(CASE WHEN order_status = 'failed' THEN 1 ELSE 0 END) as failed_count,
          SUM(CASE WHEN order_status = 'refunded' THEN 1 ELSE 0 END) as refunded_count
        `))
        .first()

      if (!stats || stats.total === 0) continue

      const total = Number(stats.total)
      const succeeded = Number(stats.succeeded_count)
      const failed = Number(stats.failed_count)
      const refunded = Number(stats.refunded_count)
      const pending = Number(stats.pending_count)
      const processing = Number(stats.processing_count)
      const finished = succeeded + failed + refunded

      let newStatus = batch.status
      if (finished >= total) {
        if (refunded === total) newStatus = 'refunded'
        else if (failed + refunded === total) newStatus = 'failed'
        else if (failed > 0 || refunded > 0) newStatus = 'partial_completed'
        else newStatus = 'completed'
      } else if (processing > 0 || succeeded > 0) {
        newStatus = 'processing'
      }

      await db('order_batches').where({ id: batch.id }).update({
        status: newStatus,
        pending_count: pending,
        processing_count: processing,
        succeeded_count: succeeded,
        failed_count: failed,
        updated_at: new Date()
      })
    } catch (err) {
      console.error(`[order-sync] 批次汇总失败 batch_id=${batch.id}:`, err.message)
    }
  }
}

// ========== 主循环 ==========

async function tick() {
  if (running) return
  running = true
  try {
    const dispatched = await dispatchPendingOrders()
    const synced = await syncRunningOrders()
    await refreshBatchStatuses()

    if (dispatched > 0 || synced > 0) {
      console.log(`[order-sync] 本轮: 派单=${dispatched}, 同步=${synced}`)
    }
  } catch (err) {
    console.error('[order-sync] tick error:', err.message)
  } finally {
    running = false
  }
}

/**
 * 启动调度器
 */
export { dispatchOneOrder }

export function startOrderSyncScheduler() {
  console.log(`[order-sync] 已启动 | 轮询间隔=${POLL_INTERVAL / 1000}s`)
  // 启动 15 秒后执行第一次
  setTimeout(tick, 15_000)
  setInterval(tick, POLL_INTERVAL)
}
