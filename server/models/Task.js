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

  async listBatches({ userIds, page = 1, pageSize = 20, status, batch_no, agent_id, start_date, end_date }) {
    const offset = (page - 1) * pageSize
    const query = db('order_batches')

    if (agent_id) {
      const subIds = await db('users').where({ referred_by: agent_id }).pluck('id')
      subIds.push(Number(agent_id))
      query.whereIn('user_id', subIds)
    } else {
      applyUserFilter(query, userIds)
    }
    if (status) query.andWhere({ status })
    if (batch_no) query.andWhere('batch_no', 'like', `%${batch_no}%`)
    if (start_date) query.where('created_at', '>=', `${start_date} 00:00:00`)
    if (end_date) query.where('created_at', '<=', `${end_date} 23:59:59`)

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

      const userIdSet = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
      const userMap = {}
      if (userIdSet.length > 0) {
        const users = await db('users').whereIn('id', userIdSet).select('id', 'username', 'nickname', 'referred_by')
        for (const u of users) userMap[u.id] = u
      }

      // 查找代理信息
      const agentIds = [...new Set(Object.values(userMap).map(u => u.referred_by).filter(Boolean))]
      const agentMap = {}
      if (agentIds.length > 0) {
        const agents = await db('users').whereIn('id', agentIds).select('id', 'username', 'nickname')
        for (const a of agents) agentMap[a.id] = a
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
        const u = userMap[row.user_id]
        row.username = u?.username || null
        row.nickname = u?.nickname || null
        if (u?.referred_by && agentMap[u.referred_by]) {
          row.agent_id = u.referred_by
          row.agent_name = agentMap[u.referred_by].nickname || agentMap[u.referred_by].username
        } else {
          row.agent_id = null
          row.agent_name = null
        }
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

  async listOrders({ userIds, page = 1, pageSize = 20, batch_id, order_status, target_type, order_no, start, end }) {
    const offset = (page - 1) * pageSize

    // 每个订单的实付金额（下单扣费）
    const chargeSummary = db('account_records')
      .where('record_type', 'order_charge')
      .select('order_id')
      .max('actual_paid_amount as actual_paid_amount')
      .groupBy('order_id')

    const query = db('orders')
      .leftJoin('products', 'products.id', 'orders.product_id')
      .leftJoin('order_batches', 'order_batches.id', 'orders.batch_id')
      .leftJoin(chargeSummary.as('charge'), 'charge.order_id', 'orders.id')
    applyUserFilter(query, userIds, 'orders.user_id')
    if (batch_id) query.andWhere('orders.batch_id', batch_id)
    if (order_status) query.andWhere('orders.order_status', order_status)
    if (target_type) query.andWhere('orders.target_type', target_type)
    if (order_no) query.andWhere('orders.order_no', 'like', `%${order_no}%`)
    if (start) query.andWhere('orders.created_at', '>=', `${start} 00:00:00`)
    if (end) query.andWhere('orders.created_at', '<=', `${end} 23:59:59`)

    const rows = await query.clone()
      .select(
        'orders.*',
        'products.name as product_name',
        'products.api_endpoint as product_api_endpoint',
        'order_batches.batch_no',
        'charge.actual_paid_amount'
      )
      .orderBy('orders.created_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await query.clone().countDistinct('orders.id as total')

    const data = rows.map(o => ({
      ...o,
      has_upstream: !!o.product_api_endpoint,
      progress: o.ordered_quantity > 0
        ? Math.min(100, Math.round((o.completed_quantity || 0) / o.ordered_quantity * 100))
        : 0
    }))
    return { rows: data, total: Number(total) || 0 }
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

  async listAccountRecords({ userIds, page = 1, pageSize = 20, record_type, direction, start, end, order_no }) {
    const offset = (page - 1) * pageSize
    const base = () => {
      const query = db('account_records as ar')
        .leftJoin('users as u', 'u.id', 'ar.user_id')
      applyUserFilter(query, userIds, 'ar.user_id')
      if (record_type) query.andWhere('ar.record_type', record_type)
      if (direction) query.andWhere('ar.direction', direction)
      if (order_no) query.andWhere('ar.order_no', 'like', `%${order_no}%`)
      if (start) query.andWhere('ar.created_at', '>=', start)
      if (end) {
        const endDt = new Date(end)
        if (!Number.isNaN(endDt.getTime())) {
          endDt.setHours(23, 59, 59, 999)
          query.andWhere('ar.created_at', '<=', endDt)
        }
      }
      return query
    }

    const rows = await base()
      .clone()
      .select('ar.*', 'u.username', 'u.nickname', 'u.real_name')
      .orderBy('ar.created_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await base().clone().count('ar.id as total')
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

  async getStats(userIds, { agent_id, start_date, end_date } = {}) {
    const applyFilters = (q, col = 'user_id') => {
      if (agent_id) {
        q._agentFilterApplied = true
      } else {
        applyUserFilter(q, userIds, col)
      }
      if (start_date) q.where('created_at', '>=', `${start_date} 00:00:00`)
      if (end_date) q.where('created_at', '<=', `${end_date} 23:59:59`)
      return q
    }

    let agentSubIds = null
    if (agent_id) {
      const subs = await db('users').where({ referred_by: agent_id }).pluck('id')
      subs.push(Number(agent_id))
      agentSubIds = subs
    }

    const batchQuery = db('order_batches')
    if (agentSubIds) batchQuery.whereIn('user_id', agentSubIds)
    else applyUserFilter(batchQuery, userIds)
    if (start_date) batchQuery.where('created_at', '>=', `${start_date} 00:00:00`)
    if (end_date) batchQuery.where('created_at', '<=', `${end_date} 23:59:59`)
    const [batchCount] = await batchQuery.clone().count('id as total')

    const orderQuery = db('orders')
    if (agentSubIds) orderQuery.whereIn('user_id', agentSubIds)
    else applyUserFilter(orderQuery, userIds)
    if (start_date) orderQuery.where('created_at', '>=', `${start_date} 00:00:00`)
    if (end_date) orderQuery.where('created_at', '<=', `${end_date} 23:59:59`)
    const [orderCount] = await orderQuery.clone().count('id as total')

    const typeStats = await orderQuery.clone()
      .select('target_type')
      .count('id as count')
      .groupBy('target_type')

    const ttList = typeStats.map(t => t.target_type).filter(Boolean)
    if (ttList.length > 0) {
      const prods = await db('products').whereIn('target_type', ttList).select('target_type', 'name')
      const pm = {}
      for (const p of prods) if (!pm[p.target_type]) pm[p.target_type] = p.name
      for (const t of typeStats) t.product_name = pm[t.target_type] || null
    }

    const statusQuery = db('orders')
    if (agentSubIds) statusQuery.whereIn('user_id', agentSubIds)
    else applyUserFilter(statusQuery, userIds)
    if (start_date) statusQuery.where('created_at', '>=', `${start_date} 00:00:00`)
    if (end_date) statusQuery.where('created_at', '<=', `${end_date} 23:59:59`)
    const statusStats = await statusQuery
      .select('order_status')
      .count('id as count')
      .groupBy('order_status')

    let balance = 0
    if (userIds && userIds.length === 1) {
      const b = await db('balance_accounts').where({ user_id: userIds[0] }).first()
      balance = b?.available_amount || 0
    }

    const spentQuery = db('order_batches')
    if (agentSubIds) spentQuery.whereIn('user_id', agentSubIds)
    else applyUserFilter(spentQuery, userIds)
    if (start_date) spentQuery.where('created_at', '>=', `${start_date} 00:00:00`)
    if (end_date) spentQuery.where('created_at', '<=', `${end_date} 23:59:59`)
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
