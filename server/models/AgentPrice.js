import db from '../db.js'

// ========== 自动建表 ==========
let tableReady = false
async function ensureTable() {
  if (tableReady) return

  // 代理默认售价表
  if (!(await db.schema.hasTable('agent_prices'))) {
    await db.schema.createTable('agent_prices', t => {
      t.increments('id')
      t.integer('agent_id').unsigned().notNullable().comment('代理用户ID')
      t.integer('product_id').unsigned().notNullable().comment('商品ID')
      t.decimal('sell_price', 10, 4).notNullable().comment('代理售价（必须 >= 商品底价）')
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
      t.unique(['agent_id', 'product_id'])
    })
  }

  // 代理→单用户 定制价表
  if (!(await db.schema.hasTable('user_prices'))) {
    await db.schema.createTable('user_prices', t => {
      t.increments('id')
      t.integer('agent_id').unsigned().notNullable().comment('设置者（代理）')
      t.integer('user_id').unsigned().notNullable().comment('目标用户')
      t.integer('product_id').unsigned().notNullable().comment('商品ID')
      t.decimal('sell_price', 10, 4).notNullable().comment('该用户专属售价')
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
      t.unique(['user_id', 'product_id'])
    })
  }

  tableReady = true
}

const AgentPrice = {

  // ======================== 代理默认售价 ========================

  /** 获取代理所有商品的售价 */
  async listByAgent(agentId) {
    await ensureTable()
    return db('agent_prices').where({ agent_id: agentId })
  },

  /** 设置 / 更新代理某商品售价 */
  async set(agentId, productId, sellPrice) {
    await ensureTable()
    const existing = await db('agent_prices')
      .where({ agent_id: agentId, product_id: productId }).first()
    if (existing) {
      await db('agent_prices').where({ id: existing.id })
        .update({ sell_price: sellPrice, updated_at: db.fn.now() })
      return existing.id
    }
    const [id] = await db('agent_prices').insert({
      agent_id: agentId, product_id: productId, sell_price: sellPrice
    })
    return id
  },

  /** 删除代理某商品售价（回退到底价） */
  async remove(agentId, productId) {
    await ensureTable()
    return db('agent_prices')
      .where({ agent_id: agentId, product_id: productId }).del()
  },

  // ======================== 单用户定制价 ========================

  /** 获取代理设置的所有用户定制价 */
  async listUserPrices(agentId) {
    await ensureTable()
    return db('user_prices')
      .where({ agent_id: agentId })
      .join('users', 'users.id', 'user_prices.user_id')
      .select(
        'user_prices.*',
        'users.username', 'users.nickname', 'users.real_name'
      )
  },

  /** 设置单用户某商品售价 */
  async setForUser(agentId, userId, productId, sellPrice) {
    await ensureTable()
    const existing = await db('user_prices')
      .where({ user_id: userId, product_id: productId }).first()
    if (existing) {
      await db('user_prices').where({ id: existing.id })
        .update({ sell_price: sellPrice, updated_at: db.fn.now() })
      return existing.id
    }
    const [id] = await db('user_prices').insert({
      agent_id: agentId, user_id: userId, product_id: productId, sell_price: sellPrice
    })
    return id
  },

  /** 删除单用户定制价（回退到代理默认售价） */
  async removeForUser(userId, productId) {
    await ensureTable()
    return db('user_prices')
      .where({ user_id: userId, product_id: productId }).del()
  },

  // ======================== 价格解析 ========================

  /**
   * 解析某用户某商品的实际价格
   * 优先级：user_prices > agent_prices > product.unit_price
   */
  async resolvePrice(userId, productId, basePrice) {
    await ensureTable()

    // 1. 是否有单用户定制价
    const userPrice = await db('user_prices')
      .where({ user_id: userId, product_id: productId }).first()
    if (userPrice) return parseFloat(userPrice.sell_price)

    // 2. 是否有代理默认售价（通过 referred_by 找代理）
    const user = await db('users').where({ id: userId }).select('referred_by').first()
    if (user?.referred_by) {
      const agentPrice = await db('agent_prices')
        .where({ agent_id: user.referred_by, product_id: productId }).first()
      if (agentPrice) return parseFloat(agentPrice.sell_price)
    }

    // 3. 回退到商品底价
    return parseFloat(basePrice)
  },

  /**
   * 批量解析：返回 { [productId]: resolvedPrice }
   */
  async resolvePrices(userId, products) {
    await ensureTable()

    const productIds = products.map(p => p.id)
    const result = {}

    // 1. 批量查用户定制价
    const userPrices = await db('user_prices')
      .where({ user_id: userId })
      .whereIn('product_id', productIds)
    const userPriceMap = new Map(userPrices.map(r => [r.product_id, parseFloat(r.sell_price)]))

    // 2. 查代理默认售价
    const user = await db('users').where({ id: userId }).select('referred_by').first()
    let agentPriceMap = new Map()
    if (user?.referred_by) {
      const agentPrices = await db('agent_prices')
        .where({ agent_id: user.referred_by })
        .whereIn('product_id', productIds)
      agentPriceMap = new Map(agentPrices.map(r => [r.product_id, parseFloat(r.sell_price)]))
    }

    // 3. 解析
    for (const p of products) {
      if (userPriceMap.has(p.id)) {
        result[p.id] = userPriceMap.get(p.id)
      } else if (agentPriceMap.has(p.id)) {
        result[p.id] = agentPriceMap.get(p.id)
      } else {
        result[p.id] = parseFloat(p.unit_price)
      }
    }

    return result
  }
}

export default AgentPrice
