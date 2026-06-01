import { describe, expect, it } from 'vitest'
import { getUserOrderStatusDisplay } from '../../src/utils/orderStatusDisplay.js'

describe('user order status display', () => {
  it('collapses detailed statuses into only processing, completed, and refunded', () => {
    expect(getUserOrderStatusDisplay('processing').label).toBe('处理中')
    expect(getUserOrderStatusDisplay('failed').label).toBe('处理中')
    expect(getUserOrderStatusDisplay('refund_requested').label).toBe('处理中')
    expect(getUserOrderStatusDisplay('completed').label).toBe('已完成')
    expect(getUserOrderStatusDisplay('refunded').label).toBe('已退款')
  })
})
