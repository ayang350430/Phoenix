import db from '../db.js'

let tableReady = false
async function ensureTable() {
  if (tableReady) return

  if (!(await db.schema.hasTable('chat_conversations'))) {
    await db.schema.createTable('chat_conversations', t => {
      t.increments('id')
      t.integer('user_id').unsigned().notNullable()
      t.string('status', 20).defaultTo('open')
      t.integer('assigned_to').unsigned().nullable()
      t.integer('owner_id').unsigned().nullable()
      t.string('last_message', 100).nullable()
      t.integer('unread_count').unsigned().defaultTo(0)
      t.timestamp('last_message_at').defaultTo(db.fn.now())
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
  } else {
    if (!(await db.schema.hasColumn('chat_conversations', 'owner_id'))) {
      await db.schema.alterTable('chat_conversations', t => {
        t.integer('owner_id').unsigned().nullable().after('assigned_to')
      })
      console.log('[migrate] added owner_id column to chat_conversations')
    }
  }

  if (!(await db.schema.hasTable('chat_messages'))) {
    await db.schema.createTable('chat_messages', t => {
      t.increments('id')
      t.integer('conversation_id').unsigned().notNullable()
      t.integer('sender_id').unsigned().notNullable()
      t.string('sender_role', 20).notNullable()
      t.string('type', 20).defaultTo('text')
      t.text('content', 'mediumtext').notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.index('conversation_id')
    })
  }

  tableReady = true
}

const Chat = {
  async getOrCreateConversation(userId) {
    await ensureTable()
    let conv = await db('chat_conversations')
      .where({ user_id: userId, status: 'open' }).first()
    if (!conv) {
      const ownerId = await this._resolveOwnerId(userId)
      const [id] = await db('chat_conversations').insert({ user_id: userId, owner_id: ownerId })
      conv = await db('chat_conversations').where({ id }).first()
    } else if (conv.owner_id == null) {
      const ownerId = await this._resolveOwnerId(userId)
      if (ownerId) {
        await db('chat_conversations').where({ id: conv.id }).update({ owner_id: ownerId })
        conv.owner_id = ownerId
      }
    }
    return conv
  },

  async sendMessage(conversationId, senderId, senderRole, type, content) {
    await ensureTable()
    const [id] = await db('chat_messages').insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      type,
      content
    })
    const summary = type === 'image' ? '[图片]' : type === 'audio' ? '[语音]' : content.substring(0, 80)
    const update = { last_message: summary, last_message_at: db.fn.now() }
    if (senderRole === 'user') update.unread_count = db.raw('unread_count + 1')
    await db('chat_conversations').where({ id: conversationId }).update(update)
    return id
  },

  async getMessages(conversationId, since) {
    await ensureTable()
    let q = db('chat_messages').where({ conversation_id: conversationId })
    if (since) q = q.where('id', '>', since)
    return q.orderBy('id', 'asc')
  },

  async listConversations(staffUserId, isAdmin) {
    await ensureTable()
    const q = db('chat_conversations')
      .leftJoin('users', 'users.id', 'chat_conversations.user_id')
      .select(
        'chat_conversations.*',
        'users.username', 'users.nickname', 'users.real_name'
      )
      .where('chat_conversations.last_message_at', '>=', db.raw("NOW() - INTERVAL 5 MINUTE"))
      .orderBy('chat_conversations.last_message_at', 'desc')
    // 重新检查 owner_id：上级角色可能已变更
    const openConvs = await db('chat_conversations').where('status', 'open').select('id', 'user_id', 'owner_id')
    for (const conv of openConvs) {
      const newOwnerId = await this._resolveOwnerId(conv.user_id)
      if ((newOwnerId || null) !== (conv.owner_id || null)) {
        await db('chat_conversations').where({ id: conv.id }).update({ owner_id: newOwnerId })
      }
    }
    if (isAdmin) {
      q.where(function () {
        this.whereNull('chat_conversations.owner_id')
      })
    } else if (staffUserId) {
      q.where('chat_conversations.owner_id', staffUserId)
    }
    const rows = await q
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
    if (userIds.length > 0) {
      const roleRows = await db('user_roles')
        .join('roles', 'roles.id', 'user_roles.role_id')
        .whereIn('user_roles.user_id', userIds)
        .select('user_roles.user_id', 'roles.code')
      const roleMap = {}
      for (const r of roleRows) {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = []
        roleMap[r.user_id].push(r.code)
      }
      for (const row of rows) {
        row.user_roles = roleMap[row.user_id] || ['user']
      }
    }
    return rows
  },

  async markRead(conversationId) {
    await ensureTable()
    return db('chat_conversations')
      .where({ id: conversationId }).update({ unread_count: 0 })
  },

  async listAllConversations({ page = 1, pageSize = 20, keyword, status } = {}) {
    await ensureTable()
    await db('chat_conversations')
      .where('status', 'open')
      .where('last_message_at', '<', db.raw("NOW() - INTERVAL 5 MINUTE"))
      .update({ status: 'closed' })
    const offset = (page - 1) * pageSize
    const q = db('chat_conversations')
      .leftJoin('users', 'users.id', 'chat_conversations.user_id')
      .select(
        'chat_conversations.*',
        'users.username', 'users.nickname', 'users.real_name'
      )
    if (status) q.where('chat_conversations.status', status)
    if (keyword) {
      q.where(function () {
        this.where('users.username', 'like', `%${keyword}%`)
          .orWhere('users.nickname', 'like', `%${keyword}%`)
          .orWhere('chat_conversations.last_message', 'like', `%${keyword}%`)
      })
    }
    const rows = await q.clone()
      .orderBy('chat_conversations.last_message_at', 'desc')
      .limit(pageSize).offset(offset)
    const [{ total }] = await q.clone().clearSelect().count('chat_conversations.id as total')

    // 附加每个会话的消息数
    if (rows.length > 0) {
      const convIds = rows.map(r => r.id)
      const counts = await db('chat_messages')
        .whereIn('conversation_id', convIds)
        .select('conversation_id')
        .count('id as msg_count')
        .groupBy('conversation_id')
      const countMap = Object.fromEntries(counts.map(c => [c.conversation_id, Number(c.msg_count)]))
      for (const row of rows) {
        row.msg_count = countMap[row.id] || 0
      }
    }
    return { rows, total }
  },

  async getConversation(id) {
    await ensureTable()
    return db('chat_conversations').where({ id }).first()
  },

  async getConversationByUser(userId) {
    await ensureTable()
    return db('chat_conversations')
      .where({ user_id: userId, status: 'open' }).first()
  },

  async _resolveOwnerId(userId) {
    const user = await db('users').where({ id: userId }).select('referred_by').first()
    if (!user?.referred_by) return null
    const agentRoles = await db('roles')
      .join('user_roles', 'roles.id', 'user_roles.role_id')
      .where('user_roles.user_id', user.referred_by)
      .select('roles.code')
    const hasSupport = agentRoles.some(r => r.code === 'support')
    return hasSupport ? user.referred_by : null
  }
}

export default Chat
