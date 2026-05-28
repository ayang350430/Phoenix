import { Router } from 'express'
import crypto from 'crypto'
import config from '../config/index.js'
import Chat from '../models/Chat.js'
import Config from '../models/Config.js'
import db from '../db.js'

const router = Router()

/* ========== 令牌验证 ========== */
function verifyEmbedToken(token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [uid, sig] = parts
  const expected = crypto.createHmac('sha256', config.jwt.secret).update(uid).digest('hex').slice(0, 16)
  if (sig !== expected) return null
  return parseInt(uid)
}

/* ========== visitor 签名：防止枚举他人 visitor_id ========== */
function signVisitorId(visitorId) {
  return crypto.createHmac('sha256', config.jwt.secret).update(visitorId).digest('hex').slice(0, 16)
}

function verifyVisitorToken(visitorId, visitorToken) {
  if (!visitorId || !visitorToken) return false
  return visitorToken === signVisitorId(visitorId)
}

/* ========== 确保 visitor 字段 ========== */
let migrated = false
async function ensureColumns() {
  if (migrated) return
  if (await db.schema.hasTable('chat_conversations')) {
    if (!(await db.schema.hasColumn('chat_conversations', 'visitor_id'))) {
      await db.schema.alterTable('chat_conversations', t => { t.string('visitor_id', 64).nullable().after('user_id') })
    }
    if (!(await db.schema.hasColumn('chat_conversations', 'visitor_name'))) {
      await db.schema.alterTable('chat_conversations', t => { t.string('visitor_name', 100).nullable().after('visitor_id') })
    }
    if (!(await db.schema.hasColumn('chat_conversations', 'owner_id'))) {
      await db.schema.alterTable('chat_conversations', t => { t.integer('owner_id').unsigned().nullable().after('assigned_to') })
    }
  }
  migrated = true
}

/* ========== 初始化会话 ========== */
router.post('/init', async (req, res) => {
  try {
    await ensureColumns()
    let { visitor_id, name, token } = req.body || {}
    if (!visitor_id) visitor_id = 'v_' + crypto.randomUUID()
    const ownerId = verifyEmbedToken(token)
    let conv = await db('chat_conversations').where({ visitor_id, status: 'open' }).first()
    if (!conv) {
      const [id] = await db('chat_conversations').insert({
        user_id: 0, visitor_id,
        visitor_name: name || `访客${visitor_id.slice(-6)}`,
        owner_id: ownerId,
        status: 'open'
      })
      conv = await db('chat_conversations').where({ id }).first()
    } else if (ownerId && !conv.owner_id) {
      await db('chat_conversations').where({ id: conv.id }).update({ owner_id: ownerId })
    }
    const messages = await db('chat_messages').where({ conversation_id: conv.id }).orderBy('id', 'asc')
    res.json({
      code: 0,
      data: {
        visitor_id, visitor_token: signVisitorId(visitor_id), conversation_id: conv.id,
        messages: messages.map(m => ({ id: m.id, sender_role: m.sender_role, type: m.type, content: m.content, created_at: m.created_at }))
      }
    })
  } catch (err) { console.error('[widget/init]', err.message); res.status(500).json({ code: 500, message: '初始化失败' }) }
})

/* ========== 发送消息 ========== */
router.post('/send', async (req, res) => {
  try {
    await ensureColumns()
    const { visitor_id, visitor_token, type, content } = req.body || {}
    if (!visitor_id || !content) return res.status(400).json({ code: 400, message: '参数缺失' })
    if (!verifyVisitorToken(visitor_id, visitor_token)) {
      return res.status(403).json({ code: 403, message: '身份验证失败' })
    }
    const conv = await db('chat_conversations').where({ visitor_id, status: 'open' }).first()
    if (!conv) return res.status(404).json({ code: 404, message: '会话不存在，请先初始化' })
    const msgType = type || 'text'
    const summary = msgType === 'image' ? '[图片]' : msgType === 'audio' ? '[语音]' : content.substring(0, 80)
    const [id] = await db('chat_messages').insert({ conversation_id: conv.id, sender_id: 0, sender_role: 'user', type: msgType, content })
    await db('chat_conversations').where({ id: conv.id }).update({ last_message: summary, last_message_at: db.fn.now(), unread_count: db.raw('unread_count + 1') })
    res.json({ code: 0, data: { id } })
  } catch (err) { console.error('[widget/send]', err.message); res.status(500).json({ code: 500, message: '发送失败' }) }
})

/* ========== 轮询消息 ========== */
router.get('/messages', async (req, res) => {
  try {
    await ensureColumns()
    const { visitor_id, visitor_token, since } = req.query
    if (!visitor_id) return res.status(400).json({ code: 400, message: '缺少visitor_id' })
    if (!verifyVisitorToken(visitor_id, visitor_token)) {
      return res.status(403).json({ code: 403, message: '身份验证失败' })
    }
    const conv = await db('chat_conversations').where({ visitor_id, status: 'open' }).first()
    if (!conv) return res.json({ code: 0, data: { messages: [] } })
    let q = db('chat_messages').where({ conversation_id: conv.id })
    if (since) q = q.where('id', '>', Number(since))
    const messages = await q.orderBy('id', 'asc')
    res.json({ code: 0, data: { messages: messages.map(m => ({ id: m.id, sender_role: m.sender_role, type: m.type, content: m.content, created_at: m.created_at })) } })
  } catch (err) { console.error('[widget/messages]', err.message); res.status(500).json({ code: 500, message: '查询失败' }) }
})

/* ========== 获取配置 ========== */
router.get('/config', async (_req, res) => {
  try {
    const cfg = await Config.get('cs_config', {})
    res.json({ code: 0, data: { welcomeText: cfg.welcomeText || '您好！有什么可以帮您？', quickQuestions: cfg.quickQuestions || [] } })
  } catch { res.json({ code: 0, data: { welcomeText: '您好！有什么可以帮您？', quickQuestions: [] } }) }
})

export default router
