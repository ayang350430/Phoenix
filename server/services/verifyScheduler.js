import crypto from 'crypto'
import db from '../db.js'
import { fetchNoteViewCount, fetchNoteLikeCount } from './noteApi.js'

const POLL_INTERVAL = 60_000
const DELAY_MINUTES = 5
const RETRY_DELAY = 2 * 60_000
const BATCH_LIMIT = 20
const TERMINAL_STATUSES = ['completed', 'partial_completed', 'failed', 'stopped']

let running = false

async function findPendingOrders() {
  const cutoff = new Date(Date.now() - DELAY_MINUTES * 60_000)
  return db('orders')
    .whereIn('order_status', TERMINAL_STATUSES)
    .whereNot('target_type', 'impression')
    .whereNull('last_verified_at')
    .where('updated_at', '<=', cutoff)
    .whereNotNull('note_id')
    .orderBy('updated_at', 'asc')
    .limit(BATCH_LIMIT)
}

function calcShortage(order, verifiedCount) {
  const baseLine = order.target_type === 'like'
    ? (order.like_count ?? 0)
    : (order.snapshot_current_read_count ?? 0)
  const gain = Math.max(0, verifiedCount - baseLine)
  const shortage = Math.max(0, order.ordered_quantity - gain)
  return { baseLine, gain, shortage }
}

async function fetchVerifiedCount(order) {
  if (order.target_type === 'like') {
    const { like_count, payload } = await fetchNoteLikeCount(order.note_id)
    return { count: like_count, payload }
  }
  const { view_count, payload } = await fetchNoteViewCount(order.note_id)
  return { count: view_count, payload }
}

async function saveSnapshot(order, count, payload) {
  const updateData = {
    last_verified_at: new Date(),
    updated_at: new Date()
  }
  if (order.target_type === 'like') {
    updateData.snapshot_verified_like_count = count
    if (payload) updateData.snapshot_verified_like_payload = JSON.stringify(payload).slice(0, 8000)
  } else {
    updateData.snapshot_verified_read_count = count
    if (payload) updateData.snapshot_verified_read_payload = JSON.stringify(payload).slice(0, 8000)
  }
  await db('orders').where({ id: order.id }).update(updateData)
}

async function autoRequestSupplement(order, baseLine, verifiedCount, shortage) {
  const existing = await db('order_replenishment_records')
    .where({ order_id: order.id })
    .whereIn('status', ['pending', 'agent_approved', 'processing'])
    .first()
  if (existing) return

  const ts = Date.now().toString(36).toUpperCase()
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
  const now = new Date()

  await db('order_replenishment_records').insert({
    replenishment_no: `REP-${ts}-${hex}`,
    order_id: order.id,
    order_no: order.order_no,
    batch_id: order.batch_id,
    user_id: order.user_id,
    target_type: order.target_type,
    note_id: order.note_id || null,
    note_url: order.note_url,
    original_external_task_id: order.external_task_id || null,
    ordered_quantity: order.ordered_quantity,
    actual_quantity: Math.max(0, verifiedCount - baseLine),
    shortage_quantity: shortage,
    snapshot_before_count: baseLine,
    snapshot_after_count: verifiedCount,
    status: 'pending',
    reason_message: '系统自动验证未达标',
    requested_at: now,
    created_at: now,
    updated_at: now
  })

  console.log(`[verify-scheduler] ${order.order_no} 自动提交补单申请，差额=${shortage}`)
}

async function verifyOne(order) {
  let count = null
  let payload = null

  // 第一次采集
  try {
    const result = await fetchVerifiedCount(order)
    count = result.count
    payload = result.payload
  } catch (err) {
    console.warn(`[verify-scheduler] ${order.order_no} 第1次采集失败: ${err.message}`)
  }

  // 失败则 2 分钟后重试
  if (count == null) {
    await new Promise(r => setTimeout(r, RETRY_DELAY))
    try {
      const result = await fetchVerifiedCount(order)
      count = result.count
      payload = result.payload
    } catch (err) {
      console.error(`[verify-scheduler] ${order.order_no} 第2次采集仍失败: ${err.message}`)
      return
    }
  }

  if (count == null) return

  await saveSnapshot(order, count, payload)

  const { baseLine, gain, shortage } = calcShortage(order, count)

  console.log(
    `[verify-scheduler] ${order.order_no} | ${order.target_type} | ` +
    `base=${baseLine} verified=${count} gain=${gain} shortage=${shortage}`
  )

  if (shortage > 0) {
    await autoRequestSupplement(order, baseLine, count, shortage)
  }
}

async function tick() {
  if (running) return
  running = true
  try {
    const orders = await findPendingOrders()
    if (orders.length === 0) return

    console.log(`[verify-scheduler] 发现 ${orders.length} 条待验证订单`)

    for (const order of orders) {
      await verifyOne(order)
    }
  } catch (err) {
    console.error('[verify-scheduler] tick error:', err.message)
  } finally {
    running = false
  }
}

export function startVerifyScheduler() {
  console.log(`[verify-scheduler] 已启动 | 轮询间隔=${POLL_INTERVAL / 1000}s | 完成后延迟=${DELAY_MINUTES}min`)
  setTimeout(tick, 10_000)
  setInterval(tick, POLL_INTERVAL)
}
