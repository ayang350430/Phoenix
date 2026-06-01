import { describe, expect, it } from 'vitest'
import {
  canTriggerSnapshotSupplement,
  getSnapshotShortage
} from '../../server/services/supplementPolicy.js'

describe('supplement policy', () => {
  const baseOrder = {
    target_type: 'read',
    external_task_id: 'upstream-1',
    external_status: 'completed',
    ordered_quantity: 100,
    snapshot_current_read_count: 1000,
    snapshot_verified_read_count: 1050
  }

  it('allows supplement only from upstream-completed snapshot verification', () => {
    const result = canTriggerSnapshotSupplement(baseOrder, { trigger: 'upstream_completed_verify' })

    expect(result.allowed).toBe(true)
    expect(result.shortage).toBe(50)
  })

  it('blocks manual snapshot verification from creating supplements', () => {
    const result = canTriggerSnapshotSupplement(baseOrder, { trigger: 'manual_verify' })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('upstream_completed_verify_required')
  })

  it('blocks manual verification before upstream completion', () => {
    const result = canTriggerSnapshotSupplement({
      ...baseOrder,
      external_status: 'running'
    }, { trigger: 'upstream_completed_verify' })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('upstream_not_completed')
  })

  it('does not create supplement when the verified snapshot reaches the target', () => {
    const result = canTriggerSnapshotSupplement({
      ...baseOrder,
      snapshot_verified_read_count: 1120
    }, { trigger: 'upstream_completed_verify' })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no_shortage')
  })

  it('calculates like shortage from the order-time like snapshot', () => {
    const result = getSnapshotShortage({
      target_type: 'like',
      like_count: 200,
      snapshot_verified_like_count: 260,
      ordered_quantity: 100
    })

    expect(result).toEqual({ baseLine: 200, actualCount: 260, actualGain: 60, shortage: 40 })
  })
})
