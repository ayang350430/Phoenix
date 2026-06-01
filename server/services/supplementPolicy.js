const SNAPSHOT_TYPES = ['read', 'view', 'like', 'collect', 'comment', 'share']

export function getSnapshotShortage(order) {
  const isLike = order.target_type === 'like'
  const baseLine = isLike
    ? Number(order.like_count ?? 0)
    : Number(order.snapshot_current_read_count ?? 0)
  const actualCount = isLike
    ? Number(order.snapshot_verified_like_count ?? 0)
    : Number(order.snapshot_verified_read_count ?? 0)
  const actualGain = Math.max(0, actualCount - baseLine)
  const shortage = Math.max(0, Number(order.ordered_quantity ?? 0) - actualGain)

  return { baseLine, actualCount, actualGain, shortage }
}

export function isUpstreamCompleted(order) {
  return Boolean(order.external_task_id) && order.external_status === 'completed'
}

export function canTriggerSnapshotSupplement(order, { trigger } = {}) {
  if (trigger !== 'upstream_completed_verify') {
    return { allowed: false, reason: 'upstream_completed_verify_required' }
  }

  if (!SNAPSHOT_TYPES.includes(order.target_type)) {
    return { allowed: false, reason: 'unsupported_snapshot_type' }
  }

  if (!isUpstreamCompleted(order)) {
    return { allowed: false, reason: 'upstream_not_completed' }
  }

  const shortageInfo = getSnapshotShortage(order)
  if (shortageInfo.shortage <= 0) {
    return { allowed: false, reason: 'no_shortage', ...shortageInfo }
  }

  return { allowed: true, reason: 'shortage', ...shortageInfo }
}
