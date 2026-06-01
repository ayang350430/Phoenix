import { Router } from 'express'
import crypto from 'crypto'
import { authRequired, adminRequired } from '../middleware/auth.js'
import Config from '../models/Config.js'
import Product from '../models/Product.js'
import AgentPrice from '../models/AgentPrice.js'
import { collectSnapshots, fetchSnapshot, fetchNoteId, fetchNoteBasic } from '../services/noteApi.js'
import { cancelTask } from '../services/xhsApi.js'
import { filterLookupOrders } from '../services/orderLookupPolicy.js'
import { creditAgentCommission, clawbackAgentCommission } from '../services/agentCommission.js'
import db from '../db.js'

const router = Router()

const SNAPSHOT_RETRY_DELAY = 2 * 60_000

async function retryMissingSnapshots(batchDbId, targetType, dataSource = 'realtime') {
  try {
    const query = db('orders').where({ batch_id: batchDbId })

    if (targetType === 'like') {
      query.whereNull('like_count')
    } else {
      query.whereNull('snapshot_current_read_count')
    }

    const orders = await query

    if (!orders.length) return

    console.log(`[snapshot-retry] 批次 ${batchDbId}: ${orders.length} 条缺少快照，重试中`)

    for (const order of orders) {
      try {
        const snap = await fetchSnapshot(order.note_url, targetType, order.data_source || dataSource)

        const updateData = { updated_at: new Date() }
        if (!order.note_id && snap.note_id) updateData.note_id = snap.note_id
        if (!order.title && snap.title) updateData.title = snap.title
        if (!order.author_id && snap.author_id) updateData.author_id = snap.author_id
        if (!order.author_name && snap.author_name) updateData.author_name = snap.author_name
        if (!order.avatar_url && snap.avatar_url) updateData.avatar_url = snap.avatar_url

        if (targetType === 'like') {
          if (snap.like_count != null) updateData.like_count = snap.like_count
          if (snap.count_payload) updateData.snapshot_current_like_payload = snap.count_payload
        } else {
          if (snap.view_count != null) updateData.snapshot_current_read_count = snap.view_count
          if (snap.count_payload) updateData.snapshot_current_read_payload = snap.count_payload
        }

        await db('orders').where({ id: order.id }).update(updateData)
        console.log(`[snapshot-retry] ${order.order_no} 快照补录成功`)
      } catch (err) {
        console.warn(`[snapshot-retry] ${order.order_no} 仍失败: ${err.message}`)
      }
    }
  } catch (err) {
    console.error('[snapshot-retry] 异常:', err.message)
  }
}

// 自动迁移：orders 表添加 product_id 列
;(async () => {
  try {
    if (await db.schema.hasTable('orders') && !(await db.schema.hasColumn('orders', 'product_id'))) {
      await db.schema.alterTable('orders', t => {
        t.integer('product_id').unsigned().nullable().after('target_type')
      })
      console.log('[batch] orders 表已添加 product_id 列')
    }
    // data_source：快照数据源 realtime=实时 pgy=蒲公英
    if (await db.schema.hasTable('orders') && !(await db.schema.hasColumn('orders', 'data_source'))) {
      await db.schema.alterTable('orders', t => {
        t.string('data_source', 20).nullable().defaultTo('realtime')
      })
      console.log('[batch] orders 表已添加 data_source 列')
    }
    if (await db.schema.hasTable('order_batches') && !(await db.schema.hasColumn('order_batches', 'data_source'))) {
      await db.schema.alterTable('order_batches', t => {
        t.string('data_source', 20).nullable().defaultTo('realtime')
      })
      console.log('[batch] order_batches 表已添加 data_source 列')
    }
  } catch (e) { console.warn('[batch] 列迁移跳过:', e.message) }
})()

const DEFAULT_CONFIG = {
  unit_price: 0.01,
  min_quantity: 10,
  types: [
    { key: 'read', label: '阅读', enabled: true },
    { key: 'like', label: '点赞', enabled: true },
    { key: 'impression', label: '曝光', enabled: true }
  ]
}

// ========== 配置 ==========

// GET /api/batch/config
router.get('/config', authRequired, async (req, res) => {
  try {
    const cfg = await Config.get('batch_config', DEFAULT_CONFIG)
    res.json({ code: 0, data: cfg })
  } catch (err) {
    console.error('[batch/config GET]', err.message)
    res.status(500).json({ code: 500, message: '获取配置失败' })
  }
})

// PUT /api/batch/config（仅管理员）
router.put('/config', authRequired, adminRequired, async (req, res) => {
  try {
    const current = await Config.get('batch_config', DEFAULT_CONFIG)
    const { types } = req.body
    if (Array.isArray(types)) {
      current.types = current.types.map(t => {
        const incoming = types.find(it => it.key === t.key)
        if (incoming && typeof incoming.enabled === 'boolean') {
          return { ...t, enabled: incoming.enabled }
        }
        return t
      })
    }
    await Config.set('batch_config', current)
    res.json({ code: 0, message: '配置已更新', data: current })
  } catch (err) {
    console.error('[batch/config PUT]', err.message)
    res.status(500).json({ code: 500, message: '更新配置失败' })
  }
})

// ========== 预校验 ==========

const XHS_PATTERN = /^https?:\/\/(www\.)?(xhslink\.com|xiaohongshu\.com)\//

async function validateBatchUrls(urls) {
  const seen = new Set()
  const results = urls.map(url => {
    const trimmed = (url || '').trim()
    if (!trimmed) return { url: trimmed, valid: false, message: '链接为空' }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return { url: trimmed, valid: false, message: '链接格式无效' }
    }
    if (!XHS_PATTERN.test(trimmed)) {
      return { url: trimmed, valid: false, message: '非小红书链接' }
    }
    if (seen.has(trimmed)) {
      return { url: trimmed, valid: false, message: '重复链接' }
    }
    seen.add(trimmed)
    return { url: trimmed, valid: true }
  })

  // 检查已有活跃订单冲突
  const validUrls = results.filter(r => r.valid).map(r => r.url)
  if (validUrls.length > 0) {
    const activeStatuses = ['pending', 'running', 'processing']
    const conflicts = await db('orders')
      .whereIn('note_url', validUrls)
      .whereIn('order_status', activeStatuses)
      .select('note_url')
    const conflictSet = new Set(conflicts.map(c => c.note_url))
    for (const r of results) {
      if (r.valid && conflictSet.has(r.url)) {
        r.valid = false
        r.message = '该链接已有进行中的订单'
      }
    }
  }

  // 解析 note_id 和博主信息 — 获取不到则不通过
  const toResolve = results.filter(r => r.valid)
  if (toResolve.length > 0) {
    const CONCURRENCY = 10
    for (let i = 0; i < toResolve.length; i += CONCURRENCY) {
      const chunk = toResolve.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map(async (r) => {
        try {
          const noteId = await fetchNoteId(r.url)
          if (!noteId) {
            r.valid = false
            r.message = '无法解析笔记ID'
            return
          }
          r.note_id = noteId

          const basic = await fetchNoteBasic(noteId)
          if (!basic || !basic.author_id) {
            r.valid = false
            r.message = '无法获取博主信息'
            return
          }
          r.author_id = basic.author_id
          r.author_name = basic.author_name || ''
          r.title = basic.title || ''
          r.avatar_url = basic.avatar_url || ''
        } catch {
          r.valid = false
          r.message = '链接信息获取失败'
        }
      }))
    }
  }

  return results
}

// POST /api/batch/prevalidate
router.post('/prevalidate', authRequired, async (req, res) => {
  try {
    const { urls, type } = req.body
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供链接列表' })
    }

    const results = await validateBatchUrls(urls)

    res.json({ code: 0, data: { results } })
  } catch (err) {
    console.error('[batch/prevalidate]', err.message)
    res.status(500).json({ code: 500, message: '校验失败' })
  }
})

// ========== 提交 ==========

// POST /api/batch/submit
router.post('/submit', authRequired, async (req, res) => {
  const conn = await db.client.pool.acquire().promise
  try {
    const { type, product_id, lines, data_source: reqDataSource } = req.body
    const userId = req.user.id

    if (!type || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ code: 400, message: '参数不完整' })
    }

    // 检查商品是否上架（优先用 product_id，兼容旧的 type）
    let product
    if (product_id) {
      product = await db('products').where({ id: product_id, status: 'on' }).first()
    }
    if (!product) {
      product = await Product.getByType(type)
    }
    if (!product) {
      return res.status(403).json({ code: 403, message: '该商品已下架，无法下单' })
    }

    // 解析当前用户的实际价格（多级定价）
    const unitPrice = await AgentPrice.resolvePrice(userId, product.id, product.unit_price)
    const minQuantity = product.min_quantity || 10
    // 数据源：realtime=实时（/realtime），pgy=蒲公英（/pgy）—— 决定查快照走哪个接口
    // 商品配置 data_source（realtime/pgy/both）决定允许范围；前端选择须在范围内，否则取第一个允许的
    const allowedSources = product.data_source === 'both'
      ? ['realtime', 'pgy']
      : (product.data_source === 'pgy' ? ['pgy'] : ['realtime'])
    const dataSource = allowedSources.includes(reqDataSource) ? reqDataSource : allowedSources[0]

    // 校验行（含 quantity 类型和上限校验）
    const validLines = lines.filter(l => {
      const qty = parseInt(l.quantity, 10)
      return l.url && Number.isFinite(qty) && qty >= minQuantity && qty <= 1_000_000
    }).map(l => ({ ...l, quantity: parseInt(l.quantity, 10) }))
    if (validLines.length === 0) {
      return res.status(400).json({ code: 400, message: '没有有效的提交行' })
    }
    if (validLines.length !== lines.length) {
      return res.status(400).json({ code: 400, message: '存在无效提交行，请修正后重新校验' })
    }

    const prevalidateResults = await validateBatchUrls(validLines.map(l => l.url))
    const failedPrevalidate = prevalidateResults.find(r => !r.valid)
    if (failedPrevalidate) {
      return res.status(400).json({
        code: 400,
        message: `预校验未通过：${failedPrevalidate.message || '链接无效'}`,
        data: { results: prevalidateResults }
      })
    }

    const totalQuantity = validLines.reduce((s, l) => s + l.quantity, 0)
    const totalCost = Math.round(totalQuantity * unitPrice * 10000) / 10000
    console.log(`[batch/submit] userId=${userId} product=${product.id} basePrice=${product.unit_price} resolvedPrice=${unitPrice} qty=${totalQuantity} totalCost=${totalCost}`)

    // 采集快照（曝光除外）—— 按数据源走对应接口
    let snapshots = new Map()
    if (type !== 'impression') {
      try {
        snapshots = await collectSnapshots(validLines, type, dataSource)
      } catch (e) {
        console.warn('[batch/submit] 快照采集失败，继续提交:', e.message)
      }
    }

    // ---- 事务 ----
    const trx = await db.transaction()
    try {
      // 事务内加行锁检查余额（防止并发超扣）
      const balRow = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
      const available = balRow ? parseFloat(balRow.available_amount) : 0
      console.log(`[batch/submit] balance=${available} totalCost=${totalCost} sufficient=${available >= totalCost}`)
      if (available < totalCost) {
        await trx.rollback()
        return res.status(400).json({ code: 400, message: '余额不足' })
      }

      const now = new Date()
      const ts = Date.now().toString(36).toUpperCase()
      const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
      const batchNo = `BATCH-${ts}-${hex}`
      const batchId = crypto.randomUUID()

      // 1. 创建批次
      const [insertId] = await trx('order_batches').insert({
        batch_id: batchId,
        batch_no: batchNo,
        user_id: userId,
        source_type: type,
        data_source: dataSource,
        submit_mode: 'batch',
        raw_content: validLines.map(l => `${l.url} ${l.quantity}`).join('\n'),
        estimated_amount: totalCost,
        status: 'pending',
        total_count: validLines.length,
        pending_count: validLines.length,
        processing_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        retryable_count: 0,
        submitted_at: now,
        created_at: now,
        updated_at: now
      })

      // 2. 创建订单
      let runningBalance = available
      const createdOrders = []
      for (let i = 0; i < validLines.length; i++) {
        const line = validLines[i]
        const orderTs = Date.now()
        const orderNo = `ORDER-${orderTs}-${String(i + 1).padStart(4, '0')}`
        const itemCost = Math.round(line.quantity * unitPrice * 10000) / 10000

        // 快照数据；快照失败时，沿用提交前预校验已经解析到的笔记元数据
        const snap = snapshots.get(i) || {}
        const prevalidated = prevalidateResults[i] || {}

        const [orderId] = await trx('orders').insert({
          order_no: orderNo,
          user_id: userId,
          batch_id: insertId,
          batch_item_id: i + 1,
          note_id: snap.note_id || prevalidated.note_id || null,
          note_url: line.url,
          target_type: type,
          product_id: product.id,
          data_source: dataSource,
          title: snap.title || prevalidated.title || null,
          author_id: snap.author_id || prevalidated.author_id || null,
          author_name: snap.author_name || prevalidated.author_name || null,
          avatar_url: snap.avatar_url || prevalidated.avatar_url || null,
          like_count: snap.like_count ?? null,
          ordered_quantity: line.quantity,
          completed_quantity: 0,
          refunded_quantity: 0,
          order_status: 'pending',
          snapshot_current_read_count: snap.view_count ?? null,
          snapshot_current_read_payload: type === 'read' ? snap.count_payload : null,
          snapshot_current_like_payload: type === 'like' ? snap.count_payload : null,
          created_at: now,
          updated_at: now
        })

        // 3. 账务记录
        const recNo = `REC-${orderTs}-${String(i + 1).padStart(4, '0')}`
        const afterBalance = Math.round((runningBalance - itemCost) * 10000) / 10000

        await trx('account_records').insert({
          record_no: recNo,
          user_id: userId,
          record_type: 'order_charge',
          direction: 'debit',
          order_id: orderId,
          order_no: orderNo,
          status: 'success',
          ordered_quantity: line.quantity,
          original_unit_price: unitPrice,
          original_total_amount: itemCost,
          discount_rate: 1,
          discounted_unit_price: unitPrice,
          discount_amount: 0,
          payable_amount: itemCost,
          actual_paid_amount: itemCost,
          refund_amount: 0,
          net_amount: -itemCost,
          before_available_amount: runningBalance,
          after_available_amount: afterBalance,
          reason_message: '批量下单扣费',
          created_at: now
        })

        runningBalance = afterBalance
        createdOrders.push({ orderId, orderNo, quantity: line.quantity })
      }

      // 4. 扣余额
      await trx('balance_accounts').where({ user_id: userId }).update({
        available_amount: runningBalance,
        updated_at: now
      })

      // 5. 代理分润：下级下单 → 把（实付单价 − 底价）划入上级代理余额并提示
      //    与扣费同事务，保证原子一致；失败则整单回滚
      const submitter = await trx('users').where({ id: userId })
        .select('referred_by', 'username', 'nickname').first()
      if (submitter?.referred_by && submitter.referred_by !== userId) {
        await creditAgentCommission(trx, {
          agentId: submitter.referred_by,
          basePrice: parseFloat(product.unit_price),
          unitPrice,
          orders: createdOrders,
          fromLabel: submitter.nickname || submitter.username || ('用户' + userId),
          batchNo
        })
      }

      await trx.commit()

      if (type !== 'impression') {
        setTimeout(() => retryMissingSnapshots(insertId, type, dataSource), SNAPSHOT_RETRY_DELAY)
      }

      res.json({
        code: 0,
        data: {
          batch_no: batchNo,
          total: validLines.length,
          cost: totalCost
        }
      })
    } catch (e) {
      await trx.rollback()
      throw e
    }
  } catch (err) {
    console.error('[batch/submit]', err.message)
    res.status(500).json({ code: 500, message: '提交失败：' + err.message })
  }
})

// ========== 批次订单明细 ==========

// GET /api/batch/:id/orders
router.get('/:id/orders', authRequired, async (req, res) => {
  try {
    const batchDbId = Number(req.params.id)
    const userId = req.user.id
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')

    // 权限校验
    const batch = await db('order_batches').where({ id: batchDbId }).first()
    if (!batch) return res.status(404).json({ code: 404, message: '批次不存在' })
    const isAgent = roles.includes('agent')
    if (!isAdmin && batch.user_id !== userId) {
      if (isAgent) {
        const referred = await db('users').where({ referred_by: userId }).select('id')
        const referredIds = referred.map(u => u.id)
        if (!referredIds.includes(batch.user_id)) {
          return res.status(403).json({ code: 403, message: '无权访问' })
        }
      } else {
        return res.status(403).json({ code: 403, message: '无权访问' })
      }
    }

    const chargeSummary = db('account_records')
      .where('record_type', 'order_charge')
      .where('status', 'success')
      .select('order_id')
      .max('actual_paid_amount as actual_paid_amount')
      .max('payable_amount as payable_amount')
      .max('discount_rate as discount_rate')
      .max('status as charge_status')
      .groupBy('order_id')

    const orders = await db('orders')
      .leftJoin(chargeSummary.as('charge_summary'), 'charge_summary.order_id', 'orders.id')
      .leftJoin('products', 'products.id', 'orders.product_id')
      .where('orders.batch_id', batchDbId)
      .select(
        'orders.*',
        'charge_summary.actual_paid_amount',
        'charge_summary.payable_amount',
        'charge_summary.discount_rate',
        'charge_summary.charge_status',
        'products.name as product_name',
        'products.api_endpoint as product_api_endpoint'
      )
      .orderBy('orders.batch_item_id', 'asc')

    res.json({ code: 0, data: { batch, orders } })
  } catch (err) {
    console.error('[batch/:id/orders]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 批量查询订单 ==========

// POST /api/batch/orders/lookup — 根据订单ID或链接批量查询订单详情（含上游状态）
router.post('/orders/lookup', authRequired, async (req, res) => {
  try {
    const { ids, urls, batch_nos } = req.body
    const hasIds = Array.isArray(ids) && ids.length > 0
    const hasUrls = Array.isArray(urls) && urls.length > 0
    const hasBatchNos = Array.isArray(batch_nos) && batch_nos.length > 0
    if (!hasIds && !hasUrls && !hasBatchNos) {
      return res.status(400).json({ code: 400, message: '请提供订单ID、链接或批次号' })
    }

    const userId = req.user.id
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const isAgent = roles.includes('agent')

    const lookupIds = hasIds ? ids.slice(0, 200).map(Number).filter(n => n > 0) : []
    const lookupUrls = hasUrls ? urls.slice(0, 200).map(u => u.trim()).filter(Boolean) : []
    const allNos = hasBatchNos ? batch_nos.slice(0, 50).map(s => s.trim()).filter(Boolean) : []
    // 自动区分批次号和订单号
    const lookupBatchNos = allNos.filter(s => /^BATCH-/i.test(s))
    const lookupOrderNos = allNos.filter(s => /^ORDER-/i.test(s))
    // 既不是BATCH-也不是ORDER-的，两边都查
    const ambiguousNos = allNos.filter(s => !/^BATCH-/i.test(s) && !/^ORDER-/i.test(s))

    if (lookupIds.length === 0 && lookupUrls.length === 0 && allNos.length === 0) {
      return res.status(400).json({ code: 400, message: '没有有效的查询条件' })
    }

    const hasProductId = await db.schema.hasColumn('orders', 'product_id')
    const joinCondition = hasProductId
      ? db.raw('(`products`.`id` = `orders`.`product_id` OR (`orders`.`product_id` IS NULL AND `products`.`target_type` COLLATE utf8mb4_unicode_ci = `orders`.`target_type` COLLATE utf8mb4_unicode_ci AND `products`.`api_endpoint` IS NOT NULL))')
      : db.raw('`products`.`target_type` COLLATE utf8mb4_unicode_ci = `orders`.`target_type` COLLATE utf8mb4_unicode_ci AND `products`.`api_endpoint` IS NOT NULL')

    const selectCols = [
      'orders.id', 'orders.order_no', 'orders.note_url', 'orders.target_type',
      'orders.ordered_quantity', 'orders.completed_quantity',
      'orders.order_status', 'orders.external_task_id', 'orders.external_status',
      'orders.external_progress', 'orders.external_completed_quantity',
      'orders.external_last_synced_at', 'orders.user_id',
      'orders.reason_message',
      'orders.created_at', 'orders.updated_at',
      'products.name as product_name',
      'products.api_endpoint'
    ]
    if (hasProductId) selectCols.splice(4, 0, 'orders.product_id')

    let q = db('orders')
      .leftJoin('products', joinCondition)

    // 批次号查询需要 join order_batches
    const needBatchJoin = lookupBatchNos.length > 0 || ambiguousNos.length > 0
    if (needBatchJoin) {
      q = q.leftJoin('order_batches', 'order_batches.id', 'orders.batch_id')
    }

    q = q.select(selectCols)

    // 按 ID / URL / 批次号 / 订单号 查询
    const conditions = []
    if (lookupIds.length > 0) conditions.push(function () { this.whereIn('orders.id', lookupIds) })
    if (lookupUrls.length > 0) conditions.push(function () { this.whereIn('orders.note_url', lookupUrls) })
    if (lookupBatchNos.length > 0) conditions.push(function () { this.whereIn('order_batches.batch_no', lookupBatchNos) })
    if (lookupOrderNos.length > 0) conditions.push(function () { this.whereIn('orders.order_no', lookupOrderNos) })
    if (ambiguousNos.length > 0) {
      // 不确定的编号，同时查 batch_no 和 order_no
      conditions.push(function () {
        this.whereIn('order_batches.batch_no', ambiguousNos)
            .orWhereIn('orders.order_no', ambiguousNos)
      })
    }

    if (conditions.length === 1) {
      q = q.where(conditions[0])
    } else if (conditions.length > 1) {
      q = q.where(function () {
        this.where(conditions[0])
        for (let i = 1; i < conditions.length; i++) {
          this.orWhere(conditions[i])
        }
      })
    }

    // 权限过滤
    if (!isAdmin) {
      if (isAgent) {
        const subIds = await db('users').where({ referred_by: userId }).pluck('id')
        subIds.push(userId)
        q = q.whereIn('orders.user_id', subIds)
      } else {
        q = q.where('orders.user_id', userId)
      }
    }

    const orders = filterLookupOrders(await q)

    // 标记未找到
    const foundIds = new Set(orders.map(o => o.id))
    const foundUrls = new Set(orders.map(o => o.note_url))
    const notFoundIds = lookupIds.filter(id => !foundIds.has(id))
    const notFoundUrls = lookupUrls.filter(u => !foundUrls.has(u))

    const data = orders.map(o => {
      const progress = o.ordered_quantity > 0
        ? Math.min(100, Math.round((o.completed_quantity || 0) / o.ordered_quantity * 100))
        : 0
      return {
        id: o.id,
        order_no: o.order_no,
        note_url: o.note_url,
        target_type: o.target_type,
        product_name: o.product_name || null,
        ordered_quantity: o.ordered_quantity,
        completed_quantity: o.completed_quantity,
        progress,
        order_status: o.order_status,
        reason_message: o.reason_message || null,
        external_task_id: o.external_task_id || null,
        external_status: o.external_status || null,
        external_progress: o.external_progress || 0,
        external_completed_quantity: o.external_completed_quantity || 0,
        external_last_synced_at: o.external_last_synced_at || null,
        has_upstream: !!o.api_endpoint,
        created_at: o.created_at,
        updated_at: o.updated_at
      }
    })

    res.json({ code: 0, data: { orders: data, not_found_ids: notFoundIds, not_found_urls: notFoundUrls } })
  } catch (err) {
    console.error('[batch/orders/lookup]', err.message)
    res.status(500).json({ code: 500, message: '查询失败: ' + err.message })
  }
})

// ========== 批次退款 ==========

// POST /api/batch/:id/refund — 用户提交退款申请
router.post('/:id/refund', authRequired, async (req, res) => {
  try {
    const batchId = Number(req.params.id)
    const userId = req.user.id
    const reason = req.body.reason || ''

    const batch = await db('order_batches').where({ id: batchId }).first()
    if (!batch) return res.status(404).json({ code: 404, message: '批次不存在' })
    if (batch.user_id !== userId) return res.status(403).json({ code: 403, message: '无权操作' })

    if (['refunded', 'cancelled'].includes(batch.status)) {
      return res.status(400).json({ code: 400, message: '该批次已退款或已取消' })
    }

    const orders = await db('orders').where({ batch_id: batchId })
      .whereNotIn('order_status', ['refunded', 'cancelled'])

    if (orders.length === 0) {
      // 所有订单已退款，同步批次状态
      await db('order_batches').where({ id: batchId }).update({ status: 'refunded', updated_at: new Date() })
      return res.status(400).json({ code: 400, message: '没有可退款的订单' })
    }

    // ===== 待处理批次：还没派发到上游，直接退款 =====
    if (batch.status === 'pending') {
      const trx = await db.transaction()
      try {
        const now = new Date()
        const ts = Date.now()
        let totalRefund = 0

        for (let i = 0; i < orders.length; i++) {
          const order = orders[i]
          const chargeRec = await trx('account_records')
            .where({ order_id: order.id, record_type: 'order_charge' }).first()
          if (!chargeRec) continue

          const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
          const orderedQty = order.ordered_quantity || 0
          const refundQty = Math.max(0, orderedQty - (order.completed_quantity || 0))
          if (refundQty === 0) continue

          const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000

          await trx('orders').where({ id: order.id }).update({
            order_status: 'refunded', refunded_quantity: refundQty, updated_at: now
          })

          const balAcc = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
          const beforeBal = parseFloat(balAcc?.available_amount) || 0
          const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

          await trx('account_records').insert({
            record_no: `REFUND-${ts}-${String(i + 1).padStart(4, '0')}`,
            user_id: userId,
            record_type: 'refund',
            direction: 'credit',
            order_id: order.id,
            order_no: order.order_no,
            status: 'success',
            ordered_quantity: orderedQty,
            original_unit_price: unitPrice,
            original_total_amount: refundAmount,
            discount_rate: 1,
            discounted_unit_price: unitPrice,
            discount_amount: 0,
            payable_amount: refundAmount,
            actual_paid_amount: refundAmount,
            refund_amount: refundAmount,
            net_amount: refundAmount,
            before_available_amount: beforeBal,
            after_available_amount: afterBal,
            reason_message: '退款(未派发直接退)',
            created_at: now
          })

          await trx('balance_accounts').where({ user_id: userId }).update({
            available_amount: afterBal, updated_at: now
          })

          // 退款 → 扣回已划给上级代理的分润
          await clawbackAgentCommission(trx, order, refundQty)

          totalRefund += refundAmount
        }

        await trx('order_batches').where({ id: batchId }).update({ status: 'refunded', updated_at: now })
        await trx.commit()
        return res.json({ code: 0, message: `退款成功，共退还 ¥${totalRefund.toFixed(2)}`, refunded: true })
      } catch (err) {
        await trx.rollback()
        console.error('[batch/refund/direct]', err.message)
        return res.status(500).json({ code: 500, message: '退款失败: ' + err.message })
      }
    }

    // ===== 已派发到上游的批次：停止上游 + 走审批 =====
    if (!(await db.schema.hasTable('refund_requests'))) {
      return res.status(500).json({ code: 500, message: '退款功能未初始化，请稍后重试' })
    }
    const existing = await db('refund_requests')
      .where({ batch_id: batchId, status: 'pending' }).whereNull('order_id').first()
    if (existing) return res.status(400).json({ code: 400, message: '该批次已有待处理的退款申请' })

    let estimatedRefund = 0
    for (const order of orders) {
      const chargeRec = await db('account_records')
        .where({ order_id: order.id, record_type: 'order_charge' }).first()
      if (!chargeRec) continue
      const unitPrice = parseFloat(chargeRec.original_unit_price) || 0
      const refundQty = Math.max(0, (order.ordered_quantity || 0) - (order.completed_quantity || 0))
      estimatedRefund += Math.round(refundQty * unitPrice * 10000) / 10000
    }

    if (estimatedRefund <= 0) {
      return res.status(400).json({ code: 400, message: '没有可退款的订单' })
    }

    // 向上游发起停止任务请求并更新状态
    const toCancel = orders.filter(o => o.external_task_id && ['running', 'pending'].includes(o.order_status))
    const stopResults = await Promise.allSettled(
      toCancel.map(async o => {
        const prod = await db('products').where({ target_type: o.target_type }).whereNotNull('api_endpoint').first()
        const result = await cancelTask(o.target_type, o.external_task_id, prod?.api_endpoint)
        console.log(`[batch/refund] 停止上游任务 order=${o.id} task=${o.external_task_id}:`, result)
        return result
      })
    )
    if (toCancel.length > 0) {
      await db('orders').whereIn('id', toCancel.map(o => o.id)).update({ external_status: 'cancelled', order_status: 'refunding', updated_at: new Date() })
    }
    console.log(`[batch/refund] 批次${batchId} 停止上游任务: ${stopResults.length}条`)

    await db('refund_requests').insert({
      batch_id: batchId,
      user_id: userId,
      refund_amount: estimatedRefund,
      reason,
      status: 'pending'
    })

    res.json({ code: 0, message: '退款申请已提交，等待审批' })
  } catch (err) {
    console.error('[batch/refund]', err.message)
    res.status(500).json({ code: 500, message: '提交失败: ' + err.message })
  }
})

// POST /api/batch/orders/:id/refund — 单条订单申请退款
router.post('/orders/:id/refund', authRequired, async (req, res) => {
  try {
    const orderId = Number(req.params.id)
    const userId = req.user.id

    const order = await db('orders').where({ id: orderId }).first()
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' })

    const batch = await db('order_batches').where({ id: order.batch_id }).first()
    if (!batch || batch.user_id !== userId) return res.status(403).json({ code: 403, message: '无权操作' })

    if (['refunded', 'cancelled', 'completed'].includes(order.order_status)) {
      return res.status(400).json({ code: 400, message: '该订单不可退款' })
    }

    const chargeRec = await db('account_records')
      .where({ order_id: orderId, record_type: 'order_charge' }).first()
    const unitPrice = parseFloat(chargeRec?.original_unit_price) || 0
    const refundQty = Math.max(0, (order.ordered_quantity || 0) - (order.completed_quantity || 0))
    const refundAmount = Math.round(refundQty * unitPrice * 10000) / 10000

    if (refundAmount <= 0) {
      return res.status(400).json({ code: 400, message: '没有可退款金额' })
    }

    // ===== 未派发到上游的订单：直接退款 =====
    if (!order.external_task_id) {
      const trx = await db.transaction()
      try {
        const now = new Date()
        const ts = Date.now()

        await trx('orders').where({ id: orderId }).update({
          order_status: 'refunded', refunded_quantity: refundQty, updated_at: now
        })

        const balAcc = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
        const beforeBal = parseFloat(balAcc?.available_amount) || 0
        const afterBal = Math.round((beforeBal + refundAmount) * 10000) / 10000

        await trx('account_records').insert({
          record_no: `REFUND-${ts}-0001`,
          user_id: userId,
          record_type: 'refund',
          direction: 'credit',
          order_id: orderId,
          order_no: order.order_no,
          status: 'success',
          ordered_quantity: order.ordered_quantity || 0,
          original_unit_price: unitPrice,
          original_total_amount: refundAmount,
          discount_rate: 1,
          discounted_unit_price: unitPrice,
          discount_amount: 0,
          payable_amount: refundAmount,
          actual_paid_amount: refundAmount,
          refund_amount: refundAmount,
          net_amount: refundAmount,
          before_available_amount: beforeBal,
          after_available_amount: afterBal,
          reason_message: '退款(未派发直接退)',
          created_at: now
        })

        await trx('balance_accounts').where({ user_id: userId }).update({
          available_amount: afterBal, updated_at: now
        })

        // 退款 → 扣回已划给上级代理的分润
        await clawbackAgentCommission(trx, order, refundQty)

        // 检查批次内是否全部退完
        const remaining = await trx('orders').where({ batch_id: order.batch_id })
          .whereNotIn('order_status', ['refunded', 'cancelled', 'completed', 'partial_completed']).first()
        if (!remaining) {
          await trx('order_batches').where({ id: order.batch_id }).update({ status: 'refunded', updated_at: now })
        }

        await trx.commit()
        return res.json({ code: 0, message: `退款成功，退还 ¥${refundAmount.toFixed(2)}`, refunded: true })
      } catch (err) {
        await trx.rollback()
        console.error('[order/refund/direct]', err.message)
        return res.status(500).json({ code: 500, message: '退款失败: ' + err.message })
      }
    }

    // ===== 已派发到上游的订单：停止上游 + 走审批 =====
    if (!(await db.schema.hasTable('refund_requests'))) {
      return res.status(500).json({ code: 500, message: '退款功能未初始化' })
    }
    const existing = await db('refund_requests')
      .where({ order_id: orderId, status: 'pending' }).first()
    if (existing) return res.status(400).json({ code: 400, message: '该订单已有待处理的退款申请' })

    // 向上游发起停止任务请求并更新状态
    if (['running', 'pending'].includes(order.order_status)) {
      const prod = await db('products').where({ target_type: order.target_type }).whereNotNull('api_endpoint').first()
      const result = await cancelTask(order.target_type, order.external_task_id, prod?.api_endpoint)
      await db('orders').where({ id: orderId }).update({ external_status: 'cancelled', order_status: 'refunding', updated_at: new Date() })
      console.log(`[order/refund] 停止上游任务 order=${orderId} task=${order.external_task_id}:`, result)
    }

    await db('refund_requests').insert({
      batch_id: order.batch_id,
      order_id: orderId,
      user_id: userId,
      refund_amount: refundAmount,
      reason: req.body.reason || '',
      status: 'pending'
    })

    res.json({ code: 0, message: '退款申请已提交，等待审批' })
  } catch (err) {
    console.error('[order/refund]', err.message)
    res.status(500).json({ code: 500, message: '提交失败: ' + err.message })
  }
})

// ========== 申请补单 ==========

// POST /api/batch/orders/:id/request-supplement — 用户申请补单
router.post('/orders/:id/request-supplement', authRequired, async (req, res) => {
  try {
    const order = await db('orders').where({ id: Number(req.params.id) }).first()
    if (!order) return res.status(404).json({ code: 404, message: '订单不存在' })

    const userId = req.user.id
    if (order.user_id !== userId) {
      return res.status(403).json({ code: 403, message: '无权操作' })
    }

    res.status(400).json({ code: 400, message: '补单由上游完成后的自动快照验证触发' })
  } catch (err) {
    console.error('[batch/request-supplement]', err.message)
    res.status(500).json({ code: 500, message: '申请失败：' + err.message })
  }
})

// ========== 审批补单（仅管理员） ==========

// PUT /api/batch/supplement/:id/approve
router.put('/supplement/:id/approve', authRequired, async (req, res) => {
  try {
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    if (!isAdmin) {
      return res.status(403).json({ code: 403, message: '无审批权限' })
    }

    const record = await db('order_replenishment_records').where({ id: Number(req.params.id) }).first()
    if (!record) return res.status(404).json({ code: 404, message: '记录不存在' })

    if (record.status !== 'pending' && record.status !== 'agent_approved') {
      return res.status(400).json({ code: 400, message: `当前状态为 ${record.status}，无法审批` })
    }

    await db('order_replenishment_records').where({ id: record.id }).update({
      status: 'processing',
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      updated_at: new Date()
    })

    res.json({ code: 0, message: '已批准，补单处理中' })
  } catch (err) {
    console.error('[supplement/approve]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// PUT /api/batch/supplement/:id/reject
router.put('/supplement/:id/reject', authRequired, async (req, res) => {
  try {
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    if (!isAdmin) {
      return res.status(403).json({ code: 403, message: '无审批权限' })
    }

    const record = await db('order_replenishment_records').where({ id: Number(req.params.id) }).first()
    if (!record) return res.status(404).json({ code: 404, message: '记录不存在' })

    if (record.status !== 'pending' && record.status !== 'agent_approved') {
      return res.status(400).json({ code: 400, message: `当前状态为 ${record.status}，无法操作` })
    }

    await db('order_replenishment_records').where({ id: record.id }).update({
      status: 'rejected',
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      reason_message: req.body.reason || record.reason_message,
      updated_at: new Date()
    })

    res.json({ code: 0, message: '已驳回补单申请' })
  } catch (err) {
    console.error('[supplement/reject]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 问题订单导出（仅管理员） ==========

// GET /api/batch/problem-orders?start=2025-01-01&end=2025-01-31&target_type=read
router.get('/problem-orders', authRequired, adminRequired, async (req, res) => {
  try {
    const { start, end, target_type } = req.query

    const query = db('orders')
      .leftJoin('order_batches', 'order_batches.id', 'orders.batch_id')
      .leftJoin('account_records', function () {
        this.on('account_records.order_id', '=', 'orders.id')
          .andOn('account_records.record_type', '=', db.raw("'order_charge'"))
      })
      .where(function () {
        this.where('orders.order_status', 'failed')
          .orWhere(function () {
            this.where('orders.order_status', 'pending')
              .whereNull('orders.external_task_id')
          })
      })

    // 时间筛选
    if (start) query.where('orders.created_at', '>=', `${start} 00:00:00`)
    if (end) query.where('orders.created_at', '<=', `${end} 23:59:59`)
    // 类型筛选
    if (target_type) query.where('orders.target_type', target_type)

    const orders = await query
      .select(
        'orders.id', 'orders.order_no', 'orders.note_url', 'orders.target_type',
        'orders.ordered_quantity', 'orders.completed_quantity', 'orders.order_status',
        'orders.reason_message', 'orders.created_at',
        'order_batches.batch_no',
        'account_records.actual_paid_amount'
      )
      .orderBy('orders.created_at', 'desc')
      .limit(5000)

    res.json({ code: 0, data: orders })
  } catch (err) {
    console.error('[batch/problem-orders]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

// ========== 批次手动验证快照 ==========

// POST /api/batch/:id/verify
// 1. 手动验证当前批次可验证订单
// 2. 验证快照，达标则标记完成；手动验证不创建补单
// 3. 更新批次状态
router.post('/:id/verify', authRequired, async (req, res) => {
  try {
    const batchId = Number(req.params.id)
    const roles = req.user.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    if (!isAdmin) return res.status(403).json({ code: 403, message: '仅管理员可操作' })

    const batch = await db('order_batches').where({ id: batchId }).first()
    if (!batch) return res.status(404).json({ code: 404, message: '批次不存在' })

    const { fetchNoteCounts, fetchNoteId } = await import('../services/noteApi.js')

    let verified = 0
    let completedCount = 0

    // ---- 第一步：手动「获取快照」——处理订单快照、更新完成进度，但绝不创建补单 ----
    // 适用范围：派单失败 / 未派发 / 无上游 / 进行中等订单都可手动获取快照。
    // 排除「已完成」：已完成订单由后端自动验证处理；且只有「已派发到上游且上游已完成」的订单
    //   才可能进入补单（唯一来源，见 verifyScheduler）。手动验证若碰已完成单会写 last_verified_at
    //   抢先于自动验证，破坏补单流程，故排除。
    const verifyOrders = await db('orders')
      .where({ batch_id: batchId })
      .whereNotIn('order_status', ['refunded', 'refunding', 'cancelled', 'completed'])
      .whereNot('target_type', 'impression')

    for (const order of verifyOrders) {
      try {
        // 如果有 note_url 但没有 note_id，先解析
        let noteId = order.note_id
        if (!noteId && order.note_url) {
          noteId = await fetchNoteId(order.note_url)
          if (noteId) {
            await db('orders').where({ id: order.id }).update({ note_id: noteId, updated_at: new Date() })
          }
        }
        if (!noteId) continue

        // 按数据源拿全量快照：realtime=/realtime，pgy=/pgy
        const counts = await fetchNoteCounts(noteId, order.data_source || 'realtime')
        const payload = counts.payload

        // 按类型取对应的指标：viewNum / likedCount / collectCount / commentCount / shareCount
        const countMap = {
          read: counts.view_count,
          view: counts.view_count,
          like: counts.like_count,
          collect: counts.collect_count,
          comment: counts.comment_count,
          share: counts.share_count
        }
        const currentCount = countMap[order.target_type] ?? null

        // 真的取不到 → 标记已验证但无快照，清掉旧验证数据
        if (currentCount == null) {
          await db('orders').where({ id: order.id }).update({
            last_verified_at: new Date(),
            order_status: 'processing',
            completed_quantity: 0,
            snapshot_verified_read_count: null,
            snapshot_verified_read_payload: null,
            snapshot_verified_like_count: null,
            snapshot_verified_like_payload: null,
            updated_at: new Date()
          })
          verified++
          console.log(`[batch/verify] ${order.order_no} 类型=${order.target_type} 获取不到快照数据`)
          continue
        }

        const updateData = {
          last_verified_at: new Date(),
          updated_at: new Date()
        }

        let initialCount
        if (order.target_type === 'like') {
          updateData.snapshot_verified_like_count = currentCount
          if (payload) updateData.snapshot_verified_like_payload = JSON.stringify(payload).slice(0, 8000)
          initialCount = parseFloat(order.like_count) || 0
        } else {
          updateData.snapshot_verified_read_count = currentCount
          if (payload) updateData.snapshot_verified_read_payload = JSON.stringify(payload).slice(0, 8000)
          initialCount = parseFloat(order.snapshot_current_read_count) || 0
        }

        // 增量 = 当前快照 - 下单时快照，记录为完成数
        const gain = Math.max(0, currentCount - initialCount)
        updateData.completed_quantity = Math.min(gain, order.ordered_quantity)

        const target = initialCount + (order.ordered_quantity || 0)
        if (currentCount >= target) {
          updateData.order_status = 'completed'
          completedCount++
          console.log(`[batch/verify] ${order.order_no} 达标: ${currentCount} >= ${target}, 完成=${gain}`)
        } else {
          updateData.order_status = 'processing'
          console.log(`[batch/verify] ${order.order_no} 未达标: ${currentCount} < ${target} (增量=${gain}, 差${target - currentCount})`)
        }

        await db('orders').where({ id: order.id }).update(updateData)

        verified++
      } catch (err) {
        console.warn(`[batch/verify] order ${order.id} 验证失败:`, err.message)
      }
    }

    // ---- 第三步：更新批次状态 ----
    const allOrders = await db('orders').where({ batch_id: batchId })
    const totalCount = allOrders.length
    const allCompleted = allOrders.every(o => ['completed', 'refunded'].includes(o.order_status))
    const pendingCount = allOrders.filter(o => o.order_status === 'pending').length
    const processingCount = allOrders.filter(o => ['running', 'processing'].includes(o.order_status)).length
    const succeededCount = allOrders.filter(o => o.order_status === 'completed').length
    const failedCount = allOrders.filter(o => o.order_status === 'failed').length

    if (allCompleted && totalCount > 0) {
      await db('order_batches').where({ id: batchId }).update({
        status: 'completed',
        pending_count: pendingCount,
        processing_count: processingCount,
        succeeded_count: succeededCount,
        failed_count: failedCount,
        updated_at: new Date()
      })
    } else {
      await db('order_batches').where({ id: batchId }).update({
        status: 'processing',
        pending_count: pendingCount,
        processing_count: processingCount,
        succeeded_count: succeededCount,
        failed_count: failedCount,
        updated_at: new Date()
      })
    }

    const parts = []
    if (completedCount > 0) parts.push(`${completedCount} 条达标`)
    if (verified - completedCount > 0) parts.push(`${verified - completedCount} 条未达标`)
    if (parts.length === 0) parts.push('没有可验证的订单')

    res.json({
      code: 0,
      message: allCompleted
        ? `全部 ${totalCount} 条订单已完成，批次已标记完成`
        : `${parts.join('，')}，批次处理中`,
      dispatched: 0,
      verified,
      completed: completedCount,
      batchStatus: allCompleted ? 'completed' : 'processing'
    })
  } catch (err) {
    console.error('[batch/verify]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
