/**
 * 计算应退金额 —— 以「实付金额」为准（用户实际被扣的钱），未完成/未退部分按比例退。
 *
 * 为什么不用 original_unit_price 重算：历史/异常的扣费记录里 original_unit_price
 * 可能与真实实付不一致（例如记成了底价），用它重算会少退或多退。actual_paid_amount
 * 是下单时实际扣减余额的金额，按它退才能保证「退多少 = 当初扣多少」。
 *
 * @param {object} chargeRec  order_charge 账务记录（含 actual_paid_amount / ordered_quantity 等）
 * @param {number} refundQty  本次退款数量
 * @param {number} [orderedQty] 该订单的下单总量（默认取 chargeRec.ordered_quantity）
 * @returns {number} 应退金额（4 位小数）
 */
export function calcRefundAmount(chargeRec, refundQty, orderedQty) {
  if (!chargeRec || !refundQty || refundQty <= 0) return 0

  let paidTotal = parseFloat(chargeRec.actual_paid_amount)
  if (!Number.isFinite(paidTotal)) paidTotal = parseFloat(chargeRec.payable_amount)
  if (!Number.isFinite(paidTotal) || paidTotal <= 0) return 0

  const total = Number(orderedQty) || Number(chargeRec.ordered_quantity) || 0
  if (total <= 0) return 0

  const q = Math.min(refundQty, total)            // 不超过下单总量
  const amount = Math.round((paidTotal * q / total) * 10000) / 10000
  return Math.min(amount, paidTotal)              // 不超过实付总额
}
