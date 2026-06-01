import { describe, expect, it } from 'vitest'
import { filterLookupOrders } from '../../server/services/orderLookupPolicy.js'

describe('order lookup policy', () => {
  it('excludes refunded orders from lookup results', () => {
    const orders = [
      { id: 1, order_status: 'refunded' },
      { id: 2, order_status: 'processing' },
      { id: 3, order_status: 'completed' }
    ]

    expect(filterLookupOrders(orders).map(o => o.id)).toEqual([2, 3])
  })
})
