import db from '../db.js'

// 自动建表
let tableReady = false
async function ensureTable() {
  if (tableReady) return
  const exists = await db.schema.hasTable('system_configs')
  if (exists) {
    // 兼容迁移：json → longtext，避免 mysql2 序列化问题
    try {
      await db.raw('ALTER TABLE system_configs MODIFY config_value LONGTEXT')
    } catch { /* 已经是 text 则忽略 */ }
  } else {
    await db.schema.createTable('system_configs', t => {
      t.increments('id')
      t.string('config_key', 100).unique().notNullable()
      t.text('config_value', 'longtext')
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
  }
  tableReady = true
}

const Config = {
  async get(key, defaultValue = null) {
    await ensureTable()
    const row = await db('system_configs').where({ config_key: key }).first()
    if (!row) return defaultValue
    try {
      return typeof row.config_value === 'string'
        ? JSON.parse(row.config_value)
        : row.config_value
    } catch {
      return row.config_value
    }
  },

  async set(key, value) {
    await ensureTable()
    const json = JSON.stringify(value)
    const exists = await db('system_configs').where({ config_key: key }).first()
    if (exists) {
      await db('system_configs').where({ config_key: key }).update({
        config_value: json,
        updated_at: db.fn.now()
      })
    } else {
      await db('system_configs').insert({
        config_key: key,
        config_value: json,
        config_group: 'system',
        updated_at: db.fn.now()
      })
    }
  }
}

export default Config
