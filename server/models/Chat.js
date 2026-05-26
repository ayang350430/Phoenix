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
      const [id] = await db('chat_conversations').insert({ user_id: userId })
      conv = await db('chat_conversations').where({ id }).first()
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
    // 非管理员只看自己归属的会话
    if (!isAdmin && staffUserId) {
      q.where('chat_conversations.owner_id', staffUserId)
    }
    return q
  },

  async markRead(conversationId) {
    await ensureTable()
    return db('chat_conversations')
      .where({ id: conversationId }).update({ unread_count: 0 })
  },

  async getConversation(id) {
    await ensureTable()
    return db('chat_conversations').where({ id }).first()
  },

  async getConversationByUser(userId) {
    await ensureTable()
    return db('chat_conversations')
      .where({ user_id: userId, status: 'open' }).first()
  }
}

export default Chat
