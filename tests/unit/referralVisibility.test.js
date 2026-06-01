import { describe, expect, it } from 'vitest'
import { canShowReferralLink } from '../../src/utils/referralVisibility.js'

describe('referral link visibility', () => {
  it('only shows referral links to agents with a referral code', () => {
    expect(canShowReferralLink(['agent'], 'A2BE')).toBe(true)
    expect(canShowReferralLink(['user'], 'A2BE')).toBe(false)
    expect(canShowReferralLink(['admin'], 'A2BE')).toBe(false)
    expect(canShowReferralLink(['super'], 'A2BE')).toBe(false)
    expect(canShowReferralLink(['agent'], '')).toBe(false)
  })
})
