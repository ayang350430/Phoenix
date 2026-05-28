import db from '../db.js'

/**
 * 给 query 应用用户可见性过滤
 * @param {Knex.QueryBuilder} query
 * @param {number[]|null} userIds — null 表示不过滤（管理员），数组表示限定范围
 * @param {string} column — 默认 'user_id'
 */
function applyUserFilter(query, userIds, column = 'user_id') {
  if (userIds === null) return query  // admin 看所有
  if (userIds.length === 1) return query.where({ [column]: userIds[0] })
  return query.whereIn(column, userIds)
}

const Task = {
  // ========== 订单批次 ==========

  async listBatches({ userIds, page = 1, pageSize = 20, status, batch_no }) {
    const offset = (page - 1) * pageSize
    const query = db('order_batches')
    applyUserFilter(query, userIds)
    if (status) query.andWhere({ status })
    if (batch_no) query.andWhere('batch_no', 'like', `%${batch_no}%`)

    const rows = await query.clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().count('id as total')

    // 补充 target_type 和实际消费
    if (rows.length > 0) {
      const batchIds = rows.map(r => r.id)
      const typeMap = await db('orders')
        .whereIn('batch_id', batchIds)
        .select('batch_id')
        .max('target_type as target_type')
        .max('product_id as product_id')
        .groupBy('batch_id')
      const amountMap = await db('account_records')
        .whereIn('order_id', function () {
          this.select('id').from('orders').whereIn('batch_id', batchIds)
        })
        .where('record_type', 'order_charge')
        .where('status', 'success')
        .select('orders.batch_id')
        .sum('account_records.actual_paid_amount as total_paid')
        .leftJoin('orders', 'orders.id', 'account_records.order_id')
        .groupBy('orders.batch_id')
      // 补充进度（completed_quantity / ordered_quantity）
      const progressMap = await db('orders')
        .whereIn('batch_id', batchIds)
        .select('batch_id')
        .sum('completed_quantity as total_completed')
        .sum('ordered_quantity as total_ordered')
        .groupBy('batch_id')

      // 查找产品名称 & 上游信息
      const pIds = [...new Set(typeMap.map(t => t.product_id).filter(Boolean))]
      const pTypes = [...new Set(typeMap.map(t => t.target_type).filter(Boolean))]
      const prodById = {}
      const prodByType = {}
      if (pIds.length > 0) {
        const prods = await db('products').whereIn('id', pIds).select('id', 'name', 'api_endpoint')
        for (const p of prods) prodById[p.id] = p
      }
      if (pTypes.length > 0) {
        const prods = await db('products').whereIn('target_type', pTypes).select('target_type', 'name', 'api_endpoint')
        for (const p of prods) if (!prodByType[p.target_type]) prodByType[p.target_type] = p
      }

      for (const row of rows) {
        const t = typeMap.find(x => x.batch_id === row.id)
        const a = amountMap.find(x => x.batch_id === row.id)
        const p = progressMap.find(x => x.batch_id === row.id)
        row.target_type = t?.target_type || row.source_type || null
        const matchedProd = (t?.product_id ? prodById[t.product_id] : null)
          || prodByType[row.target_type] || null
        row.product_name = matchedProd?.name || null
        row.has_upstream = !!matchedProd?.api_endpoint
        row.total_paid = a?.total_paid || 0
        row.total_completed = Number(p?.total_completed) || 0
        row.total_ordered = Number(p?.total_ordered) || 0
      }
    }

    return { rows, total }
  },

  async getBatch(id) {
    const batch = await db('order_batches').where({ id }).first()
    return batch || null
  },

  async getBatchByBatchId(batch_id) {
    return db('order_batches').where({ batch_id }).first()
  },

  // ========== 订单 ==========

  async listOrders({ userIds, page = 1, pageSize = 20, batch_id, order_status, target_type }) {
    const offset = (page - 1) * pageSize
    const query = db('orders')
      .leftJoin('products', 'products.id', 'orders.product_id')
    applyUserFilter(query, userIds, 'orders.user_id')
    if (batch_id) query.andWhere('orders.batch_id', batch_id)
    if (order_status) query.andWhere('orders.order_status', order_status)
    if (target_type) query.andWhere('orders.target_type', target_type)

    const rows = await query.clone()
      .select('orders.*', 'products.name as product_name')
      .orderBy('orders.created_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().count('orders.id as total')
    return { rows, total }
  },

  async getOrder(id) {
    return db('orders').where({ id }).first()
  },

  async getOrderByNo(order_no) {
    return db('orders').where({ order_no }).first()
  },

  // ========== 链接校验记录 ==========

  async listCheckRecords({ userIds, check_batch_no, page = 1, pageSize = 50 }) {
    const offset = (page - 1) * pageSize
    const query = db('batch_link_check_records')
    applyUserFilter(query, userIds)
    if (check_batch_no) query.andWhere({ check_batch_no })

    const rows = await query.clone()
      .orderBy('line_no', 'asc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().count('id as total')
    return { rows, total }
  },

  async listProblemRecords({ userIds, check_batch_no, page = 1, pageSize = 50 }) {
    const offset = (page - 1) * pageSize
    const query = db('batch_problem_link_records')
    applyUserFilter(query, userIds)
    if (check_batch_no) query.andWhere({ check_batch_no })

    const rows = await query.clone()
      .orderBy('id', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().count('id as total')
    return { rows, total }
  },

  // ========== 账务记录 ==========

  async listAccountRecords({ userIds, page = 1, pageSize = 20, record_type, direction }) {
    const offset = (page - 1) * pageSize
    const query = db('account_records')
    applyUserFilter(query, userIds)
    if (record_type) query.andWhere({ record_type })
    if (direction) query.andWhere({ direction })

    const rows = await query.clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().count('id as total')
    return { rows, total }
  },

  // ========== 每日趋势 ==========

  async getDailyStats(userIds, days = 7) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - (days - 1))
    startDate.setHours(0, 0, 0, 0)

    const query = db('orders')
    applyUserFilter(query, userIds)
    query.where('created_at', '>=', startDate)

    const rows = await query
      .select(db.raw("DATE_FORMAT(created_at, '%Y-%m-%d') as date"))
      .count('id as count')
      .groupBy(db.raw("DATE_FORMAT(created_at, '%Y-%m-%d')"))
      .orderBy('date', 'asc')

    // 补齐缺失日期为 0
    const result = []
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      const found = rows.find(r => r.date === dateStr)
      result.push({ date: dateStr, count: found ? Number(found.count) : 0 })
    }
    return result
  },

  // ========== 补单申请记录 ==========

  async listReplenishments({ userIds, page = 1, pageSize = 10, status, order_no }) {
    const offset = (page - 1) * pageSize

    const base = () => {
      const q = db('order_replenishment_records as r')
        .leftJoin('users', 'r.user_id', 'users.id')
        .leftJoin('orders', 'orders.id', 'r.order_id')
        .leftJoin('products', 'products.id', 'orders.product_id')
      applyUserFilter(q, userIds, 'r.user_id')
      if (status) q.where('r.status', status)
      if (order_no) q.where('r.order_no', 'like', `%${order_no}%`)
      return q
    }

    const rows = await base()
      .select(
        'r.*',
        'users.username',
        'users.nickname',
        'products.name as product_name'
      )
      .orderBy('r.created_at', 'desc')
      .limit(pageSize).offset(offset)

    const [{ total }] = await base().count('r.id as total')
    return { rows, total }
  },

  async getReplenishment(id) {
    return db('order_replenishment_records').where({ id }).first()
  },

  async getReplenishmentByOrderId(orderId) {
    return db('order_replenishment_records')
      .where({ order_id: orderId })
      .whereIn('status', ['created', 'pending', 'agent_approved', 'processing'])
      .first()
  },

  // ========== 统计 ==========

  async getStats(userIds) {
    const batchQuery = db('order_batches')
    applyUserFilter(batchQuery, userIds)
    const [batchCount] = await batchQuery.count('id as total')

    const orderQuery = db('orders')
    applyUserFilter(orderQuery, userIds)
    const [orderCount] = await orderQuery.clone().count('id as total')

    const typeStats = await orderQuery.clone()
      .select('target_type')
      .count('id as count')
      .groupBy('target_type')

    // 增加产品名称
    const ttList = typeStats.map(t => t.target_type).filter(Boolean)
    if (ttList.length > 0) {
      const prods = await db('products').whereIn('target_type', ttList).select('target_type', 'name')
      const pm = {}
      for (const p of prods) if (!pm[p.target_type]) pm[p.target_type] = p.name
      for (const t of typeStats) t.product_name = pm[t.target_type] || null
    }

    const statusQuery = db('orders')
    applyUserFilter(statusQuery, userIds)
    const statusStats = await statusQuery
      .select('order_status')
      .count('id as count')
      .groupBy('order_status')

    // 余额：如果是单用户就显示，否则显示汇总
    let balance = 0
    if (userIds && userIds.length === 1) {
      const b = await db('balance_accounts').where({ user_id: userIds[0] }).first()
      balance = b?.available_amount || 0
    }

    // 累计消费
    const spentQuery = db('order_batches')
    applyUserFilter(spentQuery, userIds)
    const [spentResult] = await spentQuery.sum('estimated_amount as total_spent')

    return {
      total_batches: batchCount.total,
      total_orders: orderCount.total,
      by_type: typeStats,
      by_status: statusStats,
      balance,
      total_spent: spentResult?.total_spent || 0
    }
  }
}

export default Task
