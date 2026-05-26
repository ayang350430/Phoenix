/**
 * 运行角色&推荐迁移
 * 用法: node server/migrations/run_roles_migration.js
 */
import knex from 'knex'
import knexConfig from '../knexfile.js'

const db = knex(knexConfig)

async function run() {
  console.log('[MIGRATION] 开始执行角色权限迁移...\n')

  // 1. 检查并添加 referral_code 列
  const hasReferralCode = await db.schema.hasColumn('users', 'referral_code')
  if (!hasReferralCode) {
    await db.schema.alterTable('users', (t) => {
      t.string('referral_code', 16).unique().nullable()
    })
    console.log('[OK] users 表添加 referral_code 列')
  } else {
    console.log('[SKIP] referral_code 列已存在')
  }

  // 2. 检查并添加 referred_by 列
  const hasReferredBy = await db.schema.hasColumn('users', 'referred_by')
  if (!hasReferredBy) {
    await db.schema.alterTable('users', (t) => {
      t.integer('referred_by').unsigned().nullable()
    })
    console.log('[OK] users 表添加 referred_by 列')
  } else {
    console.log('[SKIP] referred_by 列已存在')
  }

  // 3. 确保三个角色存在
  const rolesToEnsure = [
    { code: 'admin',   name: '管理员' },
    { code: 'agent',   name: '代理' },
    { code: 'support', name: '客服' },
    { code: 'user',    name: '普通用户' }
  ]

  for (const role of rolesToEnsure) {
    const exists = await db('roles').where({ code: role.code }).first()
    if (!exists) {
      await db('roles').insert(role)
      console.log(`[OK] 创建角色: ${role.name} (${role.code})`)
    } else {
      console.log(`[SKIP] 角色已存在: ${role.name} (${role.code})`)
    }
  }

  // 4. 没有角色的用户自动分配 '普通用户'
  const userRole = await db('roles').where({ code: 'user' }).first()
  if (userRole) {
    const usersWithoutRole = await db('users')
      .whereNotExists(function () {
        this.select('*').from('user_roles').whereRaw('user_roles.user_id = users.id')
      })
      .select('id')

    for (const u of usersWithoutRole) {
      await db('user_roles').insert({ user_id: u.id, role_id: userRole.id })
    }
    if (usersWithoutRole.length > 0) {
      console.log(`[OK] 为 ${usersWithoutRole.length} 个用户分配了 '普通用户' 角色`)
    }
  }

  // 5. 给没有 referral_code 的用户补全
  const crypto = await import('crypto')
  const usersNoCode = await db('users').whereNull('referral_code').select('id')
  for (const u of usersNoCode) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    await db('users').where({ id: u.id }).update({ referral_code: code })
  }
  if (usersNoCode.length > 0) {
    console.log(`[OK] 为 ${usersNoCode.length} 个用户生成了 referral_code`)
  }

  // 6. 确保 admin 用户有 admin 角色
  const adminRole = await db('roles').where({ code: 'admin' }).first()
  const adminUser = await db('users').where({ username: 'admin' }).first()
  if (adminRole && adminUser) {
    const hasAdminRole = await db('user_roles')
      .where({ user_id: adminUser.id, role_id: adminRole.id })
      .first()
    if (!hasAdminRole) {
      await db('user_roles').insert({ user_id: adminUser.id, role_id: adminRole.id })
      console.log('[OK] admin 用户已分配管理员角色')
    } else {
      console.log('[SKIP] admin 用户已有管理员角色')
    }
  }

  console.log('\n[MIGRATION] 迁移完成!')
  process.exit(0)
}

run().catch(err => {
  console.error('[MIGRATION ERROR]', err.message)
  process.exit(1)
})
