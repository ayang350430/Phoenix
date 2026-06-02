import db from '../db.js'

export async function refreshBatchStatus(batchId) {
  const stats = await db('orders')
    .where({ batch_id: batchId })
    .select(db.raw(`
      COUNT(*) as total,
      SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN order_status IN ('running','processing') THEN 1 ELSE 0 END) as processing_count,
      SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END) as succeeded_count,
      SUM(CASE WHEN order_status = 'failed' THEN 1 ELSE 0 END) as failed_count,
      SUM(CASE WHEN order_status = 'refunded' THEN 1 ELSE 0 END) as refunded_count
    `))
    .first()
  if (!stats || Number(stats.total) === 0) return
  const total = Number(stats.total)
  const succeeded = Number(stats.succeeded_count)
  const failed = Number(stats.failed_count)
  const refunded = Number(stats.refunded_count)
  const finished = succeeded + failed + refunded
  let newStatus
  if (finished >= total) {
    if (refunded === total) newStatus = 'refunded'
    else if (failed + refunded === total) newStatus = 'failed'
    else if (failed > 0 || refunded > 0) newStatus = 'partial_completed'
    else newStatus = 'completed'
  } else if (Number(stats.processing_count) > 0 || succeeded > 0) {
    newStatus = 'processing'
  } else {
    newStatus = 'pending'
  }
  await db('order_batches').where({ id: batchId }).update({
    status: newStatus,
    pending_count: Number(stats.pending_count),
    processing_count: Number(stats.processing_count),
    succeeded_count: succeeded,
    failed_count: failed,
    updated_at: new Date()
  })
}
