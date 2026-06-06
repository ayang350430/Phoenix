import { describe, it, expect } from 'vitest'
import { pickOrderCharge, hasRefundFor } from '../../server/utils/orderCharge.js'
import { calcRefundAmount } from '../../server/utils/refundAmount.js'

// 用线上 order_id=28（截图那笔点赞·下单10）的真实数据建模：
//   #60/#61 是 5/30 另一笔订单(下单500)遗留的孤儿行，被 order_id 复用串了进来
//   #167 才是本订单真实扣费行(下单10, 实付50)
const ORDER_28 = { id: 28, order_no: 'ORDER-1780479138210-0001', ordered_quantity: 10, completed_quantity: 0 }
const RECORDS_28 = [
  { id: 60, record_type: 'order_charge', order_no: 'ORDER-1780134816642-0001', status: 'success', ordered_quantity: 500, actual_paid_amount: 250 },
  { id: 61, record_type: 'refund', order_no: 'ORDER-1780134816642-0001', status: 'success', ordered_quantity: 500, actual_paid_amount: 250 },
  { id: 167, record_type: 'order_charge', order_no: 'ORDER-1780479138210-0001', status: 'success', ordered_quantity: 10, actual_paid_amount: 50 },
  { id: 168, record_type: 'agent_commission', order_no: 'ORDER-1780479138210-0001', status: 'success', ordered_quantity: 10, actual_paid_amount: 49.8 }
]

describe('pickOrderCharge — 按 order_no 排除孤儿账务行', () => {
  it('只取 order_no 匹配的扣费行，忽略被 order_id 串进来的孤儿行', () => {
    const charge = pickOrderCharge(RECORDS_28, ORDER_28)
    expect(charge).not.toBeNull()
    expect(charge.id).toBe(167)
    expect(Number(charge.actual_paid_amount)).toBe(50)
  })

  it('据此算出的退款是真实实付而非孤儿大额，杜绝超额退款', () => {
    const charge = pickOrderCharge(RECORDS_28, ORDER_28)
    // 全额退（未完成10/10）应为 50，而不是孤儿行的 250
    const refund = calcRefundAmount(charge, 10, 10)
    expect(refund).toBe(50)
  })

  it('同一 order_no 有多条 order_charge 时取 id 最大（最新）', () => {
    const recs = [
      { id: 5, record_type: 'order_charge', order_no: 'X-1', status: 'success', actual_paid_amount: 11 },
      { id: 9, record_type: 'order_charge', order_no: 'X-1', status: 'success', actual_paid_amount: 22 }
    ]
    expect(pickOrderCharge(recs, { order_no: 'X-1' }).id).toBe(9)
  })

  it('无匹配扣费行 / 缺 order_no 时返回 null', () => {
    expect(pickOrderCharge(RECORDS_28, { order_no: 'NOPE' })).toBeNull()
    expect(pickOrderCharge(RECORDS_28, {})).toBeNull()
    expect(pickOrderCharge(null, ORDER_28)).toBeNull()
  })
})

describe('hasRefundFor — 退款幂等校验，防止多入口重复退款', () => {
  // 复刻线上 ORDER-1780482760162-0001 的双退场景
  const ORDER = { order_no: 'ORDER-1780482760162-0001' }
  const AFTER_FIRST_REFUND = [
    { record_type: 'order_charge', order_no: 'ORDER-1780482760162-0001', status: 'success' },
    { record_type: 'refund', order_no: 'ORDER-1780482760162-0001', status: 'success' }, // 第一次「未派发直接退」
  ]

  it('已存在成功退款流水时返回 true（审批退款应据此跳过，不再打第二笔）', () => {
    expect(hasRefundFor(AFTER_FIRST_REFUND, ORDER)).toBe(true)
  })

  it('只有扣款、尚无退款时返回 false（允许首次退款）', () => {
    const onlyCharge = [{ record_type: 'order_charge', order_no: ORDER.order_no, status: 'success' }]
    expect(hasRefundFor(onlyCharge, ORDER)).toBe(false)
  })

  it('退款流水属于别的 order_no（孤儿）时不算已退', () => {
    const orphanRefund = [{ record_type: 'refund', order_no: 'OTHER-1', status: 'success' }]
    expect(hasRefundFor(orphanRefund, ORDER)).toBe(false)
  })
})
