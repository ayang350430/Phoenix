import db from '../db.js'
import { fetchSnapshot } from './noteApi.js'

/**
 * 自动验证调度器
 * 订单完成 5 分钟后自动采集验证快照，比对下单前后的数值差异
 */

const POLL_INTERVAL = 60_000          // 轮询间隔 60 秒
const DELAY_MINUTES = 5               // 订单完成后等待 5 分钟
const BATCH_LIMIT   = 20              // 每轮最多处理 20 条
const TERMINAL_STATUSES = ['completed', 'partial_completed', 'failed', 'stopped']

let running = false

/**
 * 查找需要验证的订单:
 * - 订单状态为终态
 * - 类型非曝光
 * - 尚未验证
 * - updated_at 在 5 分钟之前（即完成后至少 5 分钟）
 */
async function findPendingOrders() {
  const cutoff = new Date(Date.now() - DELAY_MINUTES * 60_000)
  return db('orders')
    .whereIn('order_status', TERMINAL_STATUSES)
    .whereNot('target_type', 'impression')
    .whereNull('last_verified_at')
    .where('updated_at', '<=', cutoff)
    .orderBy('updated_at', 'asc')
    .limit(BATCH_LIMIT)
}

/**
 * 对单条订单执行验证快照
 */
async function verifyOne(order) {
  try {
    const snap = await fetchSnapshot(order.note_url, order.target_type)

    const updateData = {
      last_verified_at: new Date(),
      updated_at: new Date()
    }

    if (order.target_type === 'read' || order.target_type === 'view') {
      updateData.snapshot_verified_read_count = snap.view_count
      updateData.snapshot_verified_read_payload = snap.count_payload
    } else if (order.target_type === 'like') {
      updateData.snapshot_verified_like_count = snap.like_count
      updateData.snapshot_verified_like_payload = snap.count_payload
    }

    await db('orders').where({ id: order.id }).update(updateData)

    // 计算结果日志
    const baseLine = order.target_type === 'like'
      ? (order.like_count ?? 0)
      : (order.snapshot_current_read_count ?? 0)
    const verified = order.target_type === 'like'
      ? (snap.like_count ?? 0)
      : (snap.view_count ?? 0)
    const gain = Math.max(0, verified - baseLine)
    const shortage = Math.max(0, order.ordered_quantity - gain)

    console.log(
      `[verify-scheduler] ${order.order_no} | ${order.target_type} | ` +
      `base=${baseLine} verified=${verified} gain=${gain} shortage=${shortage}`
    )
  } catch (err) {
    console.error(`[verify-scheduler] ${order.order_no} 验证失败:`, err.message)
  }
}

/**
 * 单轮扫描 & 执行
 */
async function tick() {
  if (running) return
  running = true
  try {
    const orders = await findPendingOrders()
    if (orders.length === 0) return

    console.log(`[verify-scheduler] 发现 ${orders.length} 条待验证订单`)

    // 逐条执行，避免并发过多
    for (const order of orders) {
      await verifyOne(order)
    }
  } catch (err) {
    console.error('[verify-scheduler] tick error:', err.message)
  } finally {
    running = false
  }
}

/**
 * 启动调度器
 */
export function startVerifyScheduler() {
  console.log(`[verify-scheduler] 已启动 | 轮询间隔=${POLL_INTERVAL / 1000}s | 完成后延迟=${DELAY_MINUTES}min`)
  // 启动后 10 秒执行第一次，避免阻塞启动流程
  setTimeout(tick, 10_000)
  setInterval(tick, POLL_INTERVAL)
}
