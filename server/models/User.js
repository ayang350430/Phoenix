import crypto from 'crypto'
import db from '../db.js'
import bcrypt from 'bcryptjs'

const User = {
  async findById(id) {
    const user = await db('users').where({ id }).first()
    if (!user) return null
    user.roles = await this._getRoles(id)
    user.permissions = await this._getPermissions(user.roles)
    return user
  },

  async findByUsername(username) {
    const user = await db('users').where({ username }).first()
    if (!user) return null
    user.roles = await this._getRoles(user.id)
    user.permissions = await this._getPermissions(user.roles)
    return user
  },

  async findByEmail(email) {
    const user = await db('users').where({ email }).first()
    if (!user) return null
    user.roles = await this._getRoles(user.id)
    user.permissions = await this._getPermissions(user.roles)
    return user
  },

  async findByReferralCode(code) {
    return db('users').where({ referral_code: code }).first()
  },

  async verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash)
  },

  /**
   * 创建用户
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.password
   * @param {string} [params.real_name]
   * @param {string} [params.nickname]
   * @param {string} [params.refCode] — 推荐码，注册时传入
   */
  async create({ username, password, real_name, nickname, refCode }) {
    const password_hash = bcrypt.hashSync(password, 10)
    const referral_code = this._generateReferralCode()

    // 查找推荐人
    let referred_by = null
    if (refCode) {
      const agent = await this.findByReferralCode(refCode)
      if (agent) referred_by = agent.id
    }

    const [id] = await db('users').insert({
      username,
      password_hash,
      real_name: real_name || username,
      nickname: nickname || username,
      referral_code,
      referred_by,
      status: 'active',
      created_at: new Date()
    })

    // 自动分配 '用户' 角色
    const userRole = await db('roles').where({ code: 'user' }).first()
    if (userRole) {
      await db('user_roles').insert({
        user_id: id,
        role_id: userRole.id
      })
    }

    return this.findById(id)
  },

  async updatePassword(id, newPassword) {
    const password_hash = bcrypt.hashSync(newPassword, 10)
    return db('users').where({ id }).update({ password_hash })
  },

  async list({ page = 1, pageSize = 20, keyword }) {
    const offset = (page - 1) * pageSize
    // baseQuery 只存条件，不带 select —— 防止 clone + count 时触发 ONLY_FULL_GROUP_BY
    const baseQuery = db('users')

    if (keyword) {
      baseQuery.where(function () {
        this.where('username', 'like', `%${keyword}%`)
          .orWhere('real_name', 'like', `%${keyword}%`)
          .orWhere('nickname', 'like', `%${keyword}%`)
          .orWhere('referral_code', 'like', `%${keyword}%`)
      })
    }

    const rows = await baseQuery.clone()
      .select('id', 'username', 'real_name', 'nickname', 'email', 'status', 'referral_code', 'referred_by', 'created_at')
      .limit(pageSize).offset(offset).orderBy('id', 'desc')

    // 附加每个用户的角色和余额
    for (const row of rows) {
      const roles = await this._getRoles(row.id)
      row.roles = roles.map(r => r.code)
      const bal = await db('balance_accounts').where({ user_id: row.id }).first()
      row.balance = bal ? parseFloat(bal.available_amount) : 0
    }

    const [{ total }] = await baseQuery.clone().count('id as total')
    return { rows, total }
  },

  async getBalance(userId) {
    return db('balance_accounts').where({ user_id: userId }).first()
  },

  /**
   * 给用户分配角色
   */
  async assignRole(userId, roleCode) {
    const role = await db('roles').where({ code: roleCode }).first()
    if (!role) throw new Error(`角色 ${roleCode} 不存在`)
    // 避免重复
    const exists = await db('user_roles').where({ user_id: userId, role_id: role.id }).first()
    if (!exists) {
      await db('user_roles').insert({ user_id: userId, role_id: role.id })
    }
  },

  /**
   * 移除用户角色
   */
  async removeRole(userId, roleCode) {
    const role = await db('roles').where({ code: roleCode }).first()
    if (!role) return
    await db('user_roles').where({ user_id: userId, role_id: role.id }).del()
  },

  /**
   * 设置用户角色（替换所有现有角色）
   */
  async setRoles(userId, roleCodes) {
    await db('user_roles').where({ user_id: userId }).del()
    for (const code of roleCodes) {
      await this.assignRole(userId, code)
    }
  },

  /**
   * 根据当前用户角色，返回可见的 user_id 列表
   * - admin  → null（表示不过滤，看所有）
   * - agent  → 自己 + 通过自己推荐注册的用户
   * - user   → 只有自己
   */
  async getVisibleUserIds(reqUser) {
    const roles = reqUser.roles || []
    if (roles.includes('admin') || roles.includes('super')) return null

    if (roles.includes('agent')) {
      const referred = await db('users')
        .where({ referred_by: reqUser.id })
        .select('id')
      return [reqUser.id, ...referred.map(u => u.id)]
    }

    return [reqUser.id]
  },

  /**
   * 获取代理的下级用户列表
   */
  async getReferredUsers(agentId, { page = 1, pageSize = 20 } = {}) {
    const offset = (page - 1) * pageSize
    const rows = await db('users')
      .where({ referred_by: agentId })
      .select('id', 'username', 'real_name', 'nickname', 'status', 'created_at')
      .limit(pageSize).offset(offset).orderBy('id', 'desc')
    const [{ total }] = await db('users')
      .where({ referred_by: agentId })
      .count('id as total')
    return { rows, total }
  },

  /**
   * 补全没有 referral_code 的用户
   */
  async ensureReferralCodes() {
    const users = await db('users').whereNull('referral_code').select('id')
    for (const u of users) {
      const code = this._generateReferralCode()
      await db('users').where({ id: u.id }).update({ referral_code: code })
    }
    if (users.length > 0) {
      console.log(`[USER] 已为 ${users.length} 个用户补全 referral_code`)
    }
  },

  // ---- 内部方法 ----

  _generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase()  // 8位随机码
  },

  async _getRoles(userId) {
    return db('roles')
      .join('user_roles', 'roles.id', 'user_roles.role_id')
      .where('user_roles.user_id', userId)
      .select('roles.id', 'roles.code', 'roles.name')
  },

  async _getPermissions(roles) {
    if (!roles || roles.length === 0) return []
    const roleIds = roles.map(r => r.id)
    const perms = await db('permissions')
      .join('role_permissions', 'permissions.id', 'role_permissions.permission_id')
      .whereIn('role_permissions.role_id', roleIds)
      .select('permissions.code', 'permissions.name')
    // 去重
    return [...new Map(perms.map(p => [p.code, p])).values()]
  }
}

export default User
