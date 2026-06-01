import crypto from 'crypto'

/**
 * 代理分润
 *
 * 模型：单层代理。普通用户的实付单价 = 上级代理设置的售价（或单用户定制价），
 * 商品底价 = products.unit_price。代理利润 = 用户实付单价 − 底价。
 *
 * - 下级用户下单时：把（实付单价 − 底价）× 数量 划入其上级代理（users.referred_by）余额，
 *   并写一条 account_records（record_type='agent_commission', direction='in'）作为提示。
 * - 下级订单退款/失败时：按退款数量从代理余额扣回对应分润
 *   （record_type='agent_commission_refund', direction='out'）。
 *
 * 所有操作都在调用方的事务（trx）内完成，保证与扣费/退款原子一致。
 */

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000

function recNo(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

async function getBalance(trx, userId) {
  const row = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
  return { row, amount: parseFloat(row?.available_amount) || 0 }
}

async function setBalance(trx, userId, existedRow, newAmount) {
  if (existedRow) {
    await trx('balance_accounts').where({ user_id: userId }).update({ available_amount: newAmount, updated_at: new Date() })
  } else {
    await trx('balance_accounts').insert({ user_id: userId, available_amount: newAmount, created_at: new Date(), updated_at: new Date() })
  }
}

/**
 * 下级下单 → 给上级代理入账分润
 * @param {object} trx knex 事务
 * @param {object} opts
 * @param {number} opts.agentId    上级代理用户ID（users.referred_by）
 * @param {number} opts.basePrice  商品底价
 * @param {number} opts.unitPrice  下级用户实付单价
 * @param {{orderId:number, orderNo:string, quantity:number}[]} opts.orders 本次创建的订单
 * @param {string} [opts.fromLabel] 下级用户展示名（用于备注）
 * @param {string} [opts.batchNo]   批次号（用于备注）
 * @returns {Promise<number>} 划入的总分润
 */
export async function creditAgentCommission(trx, { agentId, basePrice, unitPrice, orders, fromLabel, batchNo }) {
  const unitProfit = round4((parseFloat(unitPrice) || 0) - (parseFloat(basePrice) || 0))
  if (!agentId || unitProfit <= 0 || !Array.isArray(orders) || orders.length === 0) return 0

  const { row, amount } = await getBalance(trx, agentId)
  let running = amount
  let total = 0

  for (const o of orders) {
    const commission = round4((o.quantity || 0) * unitProfit)
    if (commission <= 0) continue
    const before = running
    running = round4(running + commission)
    await trx('account_records').insert({
      record_no: recNo('AGENTCOMM'),
      user_id: agentId,
      record_type: 'agent_commission',
      direction: 'in',
      order_id: o.orderId,
      order_no: o.orderNo,
      status: 'success',
      ordered_quantity: o.quantity,
      original_unit_price: unitProfit,
      original_total_amount: commission,
      payable_amount: commission,
      actual_paid_amount: commission,
      net_amount: commission,
      before_available_amount: before,
      after_available_amount: running,
      reason_message: batchNo ? `下级下单分润 · 批次 ${batchNo}` : '下级下单分润',
      remark: `下级下单分润${fromLabel ? '（' + fromLabel + '）' : ''}`,
      created_at: new Date()
    })
    total = round4(total + commission)
  }

  if (total > 0) await setBalance(trx, agentId, row, running)
  return total
}

/**
 * 下级订单退款/失败 → 从代理余额按比例扣回分润
 * @param {object} trx knex 事务
 * @param {object} order orders 行（至少含 id, order_no）
 * @param {number} refundQty 本次退款数量
 * @returns {Promise<number>} 扣回金额
 */
export async function clawbackAgentCommission(trx, order, refundQty) {
  if (!order || !refundQty || refundQty <= 0) return 0

  const comm = await trx('account_records')
    .where({ order_id: order.id, record_type: 'agent_commission' }).first()
  if (!comm) return 0

  const agentId = comm.user_id
  const commQty = comm.ordered_quantity || 0
  const commAmount = parseFloat(comm.net_amount) || 0
  if (!agentId || commQty <= 0 || commAmount <= 0) return 0

  // 该订单已扣回的累计金额，避免重复扣
  const clawedAgg = await trx('account_records')
    .where({ order_id: order.id, record_type: 'agent_commission_refund' })
    .sum({ s: 'refund_amount' }).first()
  const alreadyClawed = parseFloat(clawedAgg?.s) || 0

  const unitComm = commAmount / commQty
  let clawback = round4(unitComm * refundQty)
  const remaining = round4(commAmount - alreadyClawed)
  if (clawback > remaining) clawback = remaining
  if (clawback <= 0) return 0

  const { row, amount: before } = await getBalance(trx, agentId)
  const after = round4(before - clawback)

  await trx('account_records').insert({
    record_no: recNo('AGENTREF'),
    user_id: agentId,
    record_type: 'agent_commission_refund',
    direction: 'out',
    order_id: order.id,
    order_no: order.order_no,
    status: 'success',
    ordered_quantity: refundQty,
    original_unit_price: unitComm,
    original_total_amount: clawback,
    actual_paid_amount: clawback,
    refund_amount: clawback,
    net_amount: -clawback,
    before_available_amount: before,
    after_available_amount: after,
    reason_message: '下级订单退款，扣回分润',
    remark: '下级退款扣回分润',
    created_at: new Date()
  })

  await setBalance(trx, agentId, row, after)
  return clawback
}
