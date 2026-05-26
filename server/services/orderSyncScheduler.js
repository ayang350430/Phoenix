import db from '../db.js'
import { createTask, getTaskStatus, buildTaskPayload } from './xhsApi.js'
import { fetchNoteId, fetchNoteBasic } from './noteApi.js'

/**
 * 订单同步调度器
 *
 * 1. 派单 — pending 且无 external_task_id 的订单 → 发给上游 → 改为 running
 * 2. 同步 — running 且有 external_task_id 的订单 → 查上游状态 → 完成/失败
 * 3. 汇总 — 更新批次统计与状态
 */

const POLL_INTERVAL = 5 * 60_000     // 5 分钟
const DISPATCH_LIMIT = 30            // 每轮最多派 30 单
const SYNC_LIMIT = 50                // 每轮最多同步 50 单

let running = false

// ========== 1. 派单 ==========

async function dispatchPendingOrders() {
  const orders = await db('orders')
    .where('order_status', 'pending')
    .whereNull('external_task_id')
    .orderBy('created_at', 'asc')
    .limit(DISPATCH_LIMIT)

  if (!orders.length) return 0

  let dispatched = 0

  for (const order of orders) {
    try {
      // 查找商品获取上游接口（优先 product_id，兼容旧数据）
      let product
      if (order.product_id) {
        product = await db('products').where({ id: order.product_id }).first()
      }
      if (!product) {
        product = await db('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
      }

      // 没有上游接口的商品，不派发，保持 pending
      if (!product || !product.api_endpoint) {
        continue
      }

      // 确保有 note_id 和 author_id
      let noteId = order.note_id
      let authorId = order.author_id

      if (!noteId) {
        noteId = await fetchNoteId(order.note_url)
        if (!noteId) {
          console.warn(`[order-sync] ${order.order_no} 无法解析 note_id，跳过`)
          continue
        }
      }

      if (!authorId) {
        const basic = await fetchNoteBasic(noteId)
        if (!basic || !basic.author_id) {
          console.warn(`[order-sync] ${order.order_no} 无法获取 author_id，跳过`)
          continue
        }
        authorId = basic.author_id
        // 顺便补全基础信息
        await db('orders').where({ id: order.id }).update({
          note_id: noteId,
          author_id: authorId,
          author_name: basic.author_name || null,
          title: basic.title || null,
          avatar_url: basic.avatar_url || null,
          updated_at: new Date()
        })
      }

      // 构建载荷 & 创建上游任务
      const payload = buildTaskPayload(order, noteId, authorId)
      const taskId = await createTask(order.target_type, payload, product.api_endpoint)

      // 更新订单
      await db('orders').where({ id: order.id }).update({
        note_id: noteId,
        external_task_id: taskId,
        external_status: 'accepted',
        order_status: 'running',
        last_dispatch_at: new Date(),
        updated_at: new Date()
      })

      dispatched++
      console.log(`[order-sync] 派单 ${order.order_no} → task_id=${taskId}`)
    } catch (err) {
      console.error(`[order-sync] 派单失败 ${order.order_no}:`, err.message)
      // 网络临时错误不标记失败，下轮重试
      // 只有上游明确拒绝才标记
      if (err.message.includes('上游创建任务失败') || err.message.includes('上游返回无效')) {
        await db('orders').where({ id: order.id }).update({
          order_status: 'failed',
          reason_message: '派单失败: ' + err.message.slice(0, 200),
          updated_at: new Date()
        })
      }
    }
  }

  return dispatched
}

// ========== 2. 同步 running 订单状态 ==========

async function syncRunningOrders() {
  const orders = await db('orders')
    .where('order_status', 'running')
    .whereNotNull('external_task_id')
    .orderBy('external_last_synced_at', 'asc')
    .limit(SYNC_LIMIT)

  if (!orders.length) return 0

  let updated = 0

  for (const order of orders) {
    try {
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
        // 上游返回失败
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
          // 上游已完成
          updateData.order_status = 'completed'
          updateData.external_status = 'completed'
          updateData.completed_quantity = Math.min(result.currentCount, order.ordered_quantity)
        } else {
          // 仍在运行
          updateData.external_status = 'running'
          updateData.completed_quantity = Math.min(result.currentCount, order.ordered_quantity)
        }
      }

      await db('orders').where({ id: order.id }).update(updateData)
      updated++

      const statusLabel = result.failed ? 'failed' : (result.status === 2 ? 'completed' : 'running')
      console.log(
        `[order-sync] ${order.order_no} | ${statusLabel} | ` +
        `${result.currentCount}/${result.totalCount}`
      )
    } catch (err) {
      // 网络错误不更新状态，下轮重试
      console.error(`[order-sync] 同步失败 ${order.order_no}:`, err.message)
    }
  }

  return updated
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
          SUM(CASE WHEN order_status = 'failed' THEN 1 ELSE 0 END) as failed_count
        `))
        .first()

      if (!stats || stats.total === 0) continue

      const total = Number(stats.total)
      const succeeded = Number(stats.succeeded_count)
      const failed = Number(stats.failed_count)
      const pending = Number(stats.pending_count)
      const processing = Number(stats.processing_count)
      const finished = succeeded + failed

      let newStatus = batch.status
      if (finished >= total) {
        // 全部结束
        if (failed === total) newStatus = 'failed'
        else if (failed > 0) newStatus = 'partial_completed'
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
export function startOrderSyncScheduler() {
  console.log(`[order-sync] 已启动 | 轮询间隔=${POLL_INTERVAL / 1000}s`)
  // 启动 15 秒后执行第一次
  setTimeout(tick, 15_000)
  setInterval(tick, POLL_INTERVAL)
}
