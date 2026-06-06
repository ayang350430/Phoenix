/**
 * 订单「权威」扣费记录的统一取数。
 *
 * 背景 / 为什么按 order_no 而不是 order_id：
 *   orders 表若被重置过（自增 id 被重排，例如测试期 truncate/reseed），旧订单遗留在
 *   account_records 里的扣费行会按被复用的 order_id 串到新订单上（孤儿行）。
 *   但每条账务行都带着自己原始且唯一的 order_no，而真实扣费行的 order_no 必然等于其
 *   订单的 order_no（下单时同时写入）。所以用 order_no 匹配可天然排除孤儿行，
 *   无需删除任何历史数据。
 *
 * 历史上「实付/付款」「应退」在 5 个地方各算各的（MAX-success / MAX-无status /
 * SUM / .first() / 不 join），孤儿行一进来就互相对不上、甚至超额退款。本模块把
 * 取数口径统一到这里。
 */

/**
 * 从一组 account_records 中挑出订单的扣费行（纯函数，便于测试）。
 * 同一 order_no 有多条 order_charge 时取 id 最大（最新）的一条。
 * @param {Array<object>} records
 * @param {{order_no?: string}} order
 * @returns {object|null}
 */
export function pickOrderCharge(records, order) {
  if (!order || !order.order_no || !Array.isArray(records)) return null
  const matches = records.filter(
    r => r.record_type === 'order_charge' && r.order_no === order.order_no
  )
  if (matches.length === 0) return null
  return matches.reduce((best, cur) => (Number(cur.id) > Number(best.id) ? cur : best))
}

/**
 * 查询订单的权威扣费行（按 order_no 唯一匹配，排除孤儿行）。
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb  db 或事务
 * @param {{order_no?: string}} order
 * @returns {Promise<object|null>}
 */
export async function getOrderChargeRecord(qb, order) {
  if (!order || !order.order_no) return null
  return qb('account_records')
    .where({ order_no: order.order_no, record_type: 'order_charge' })
    .orderBy('id', 'desc')
    .first()
}

/**
 * 判断一组账务记录中，该订单是否已有成功退款（纯函数，便于测试）。
 * @param {Array<object>} records
 * @param {{order_no?: string}} order
 * @returns {boolean}
 */
export function hasRefundFor(records, order) {
  if (!order || !order.order_no || !Array.isArray(records)) return false
  return records.some(
    r => r.record_type === 'refund' && r.status === 'success' && r.order_no === order.order_no
  )
}

/**
 * 退款幂等校验：该订单是否已存在成功的退款流水（按 order_no）。
 * 退款是一次性的（一次退掉全部未完成数量），故只要已有退款流水即视为已退、不可重复退。
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb
 * @param {{order_no?: string}} order
 * @returns {Promise<boolean>}
 */
export async function hasSuccessfulRefund(qb, order) {
  if (!order || !order.order_no) return false
  const row = await qb('account_records')
    .where({ order_no: order.order_no, record_type: 'refund', status: 'success' })
    .first()
  return !!row
}
