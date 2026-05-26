import db from '../db.js'

// 自动建表
let tableReady = false
async function ensureTable() {
  if (tableReady) return
  const exists = await db.schema.hasTable('products')
  if (!exists) {
    await db.schema.createTable('products', t => {
      t.increments('id')
      t.string('name', 100).notNullable().comment('商品名称')
      t.string('target_type', 30).notNullable().comment('任务类型 read/like/impression')
      t.decimal('unit_price', 10, 4).notNullable().defaultTo(0.01).comment('单价')
      t.integer('min_quantity').notNullable().defaultTo(100).comment('最小下单量')
      t.integer('max_quantity').notNullable().defaultTo(100000).comment('最大下单量')
      t.integer('step_quantity').notNullable().defaultTo(100).comment('步进量')
      t.string('status', 20).notNullable().defaultTo('on').comment('on=上架 off=下架')
      t.string('description', 500).defaultTo('').comment('商品描述')
      t.string('icon', 20).defaultTo('').comment('图标文字')
      t.string('color', 30).defaultTo('').comment('图标颜色')
      t.integer('sort_order').notNullable().defaultTo(0).comment('排序 越小越前')
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    // 插入默认商品
    await db('products').insert([
      { name: '小红书阅读', target_type: 'read', unit_price: 0.01, min_quantity: 100, max_quantity: 100000, step_quantity: 100, icon: '阅', color: '#5b8def', sort_order: 1 },
      { name: '小红书点赞', target_type: 'like', unit_price: 0.02, min_quantity: 50, max_quantity: 50000, step_quantity: 50, icon: '赞', color: '#8b7bf7', sort_order: 2 },
      { name: '小红书曝光', target_type: 'impression', unit_price: 0.005, min_quantity: 500, max_quantity: 500000, step_quantity: 500, icon: '曝', color: '#22c2d6', sort_order: 3 }
    ])
  }
  // 自动添加 api_endpoint 列
  if (!(await db.schema.hasColumn('products', 'api_endpoint'))) {
    await db.schema.alterTable('products', t => {
      t.string('api_endpoint', 255).nullable().comment('上游API接口路径')
    })
    // 为已有商品填充已知接口
    await db('products').where({ target_type: 'impression' }).update({ api_endpoint: '/api/v2/impression' })
    await db('products').where({ target_type: 'like' }).update({ api_endpoint: '/api/v2/note_likes' })
    await db('products').whereIn('target_type', ['read', 'view']).update({ api_endpoint: '/api/v2/note_views' })
  }
  tableReady = true
}

const Product = {
  /** 所有上架商品（用户端） */
  async listActive() {
    await ensureTable()
    return db('products').where({ status: 'on' }).orderBy('sort_order', 'asc')
  },

  /** 全部商品（管理端） */
  async listAll() {
    await ensureTable()
    return db('products').orderBy('sort_order', 'asc')
  },

  /** 获取单个 */
  async getById(id) {
    await ensureTable()
    return db('products').where({ id }).first()
  },

  /** 按类型获取上架商品 */
  async getByType(targetType) {
    await ensureTable()
    return db('products').where({ target_type: targetType, status: 'on' }).first()
  },

  /** 创建 */
  async create(data) {
    await ensureTable()
    const [id] = await db('products').insert({
      name: data.name,
      target_type: data.target_type,
      unit_price: data.unit_price,
      min_quantity: data.min_quantity || 100,
      max_quantity: data.max_quantity || 100000,
      step_quantity: data.step_quantity || 100,
      status: data.status || 'on',
      description: data.description || '',
      icon: data.icon || '',
      color: data.color || '',
      sort_order: data.sort_order || 0,
      api_endpoint: data.api_endpoint || null
    })
    return id
  },

  /** 更新 */
  async update(id, data) {
    await ensureTable()
    const allowed = ['name', 'target_type', 'unit_price', 'min_quantity', 'max_quantity',
      'step_quantity', 'status', 'description', 'icon', 'color', 'sort_order', 'api_endpoint']
    const fields = {}
    for (const k of allowed) {
      if (data[k] !== undefined) fields[k] = data[k]
    }
    fields.updated_at = db.fn.now()
    return db('products').where({ id }).update(fields)
  },

  /** 删除 */
  async remove(id) {
    await ensureTable()
    return db('products').where({ id }).del()
  },

  /** 切换上下架 */
  async toggleStatus(id) {
    await ensureTable()
    const row = await db('products').where({ id }).first()
    if (!row) return null
    const newStatus = row.status === 'on' ? 'off' : 'on'
    await db('products').where({ id }).update({ status: newStatus, updated_at: db.fn.now() })
    return newStatus
  }
}

export default Product
