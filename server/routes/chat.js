import { Router } from 'express'
import { authRequired } from '../middleware/auth.js'
import Chat from '../models/Chat.js'

const router = Router()
router.use(authRequired)

// ========== 用户端 ==========

router.post('/send', async (req, res) => {
  try {
    const { type = 'text', content } = req.body
    if (!content) return res.json({ code: 400, message: '消息不能为空' })
    const conv = await Chat.getOrCreateConversation(req.user.id)
    const msgId = await Chat.sendMessage(conv.id, req.user.id, 'user', type, content)
    res.json({ code: 0, data: { id: msgId, conversation_id: conv.id } })
  } catch (err) {
    console.error('[chat/send]', err.message)
    res.status(500).json({ code: 500, message: '发送失败' })
  }
})

router.get('/messages', async (req, res) => {
  try {
    const conv = await Chat.getConversationByUser(req.user.id)
    if (!conv) return res.json({ code: 0, data: { messages: [], conversation_id: null } })
    const since = req.query.since ? parseInt(req.query.since) : null
    const messages = await Chat.getMessages(conv.id, since)
    res.json({ code: 0, data: { messages, conversation_id: conv.id } })
  } catch (err) {
    console.error('[chat/messages]', err.message)
    res.status(500).json({ code: 500, message: '获取消息失败' })
  }
})

// ========== 管理/代理端 ==========

function staffRequired(req, res, next) {
  const roles = req.user?.roles || []
  if (roles.includes('admin') || roles.includes('super') || roles.includes('agent') || roles.includes('support')) return next()
  res.status(403).json({ code: 403, message: '需要客服权限' })
}

router.get('/conversations', staffRequired, async (req, res) => {
  try {
    const roles = req.user?.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    const list = await Chat.listConversations(req.user.id, isAdmin)
    res.json({ code: 0, data: list })
  } catch (err) {
    console.error('[chat/conversations]', err.message)
    res.status(500).json({ code: 500, message: '获取会话列表失败' })
  }
})

// 管理员：所有聊天记录（含历史）
router.get('/history', staffRequired, async (req, res) => {
  try {
    const roles = req.user?.roles || []
    const isAdmin = roles.includes('admin') || roles.includes('super')
    if (!isAdmin) return res.status(403).json({ code: 403, message: '需要管理员权限' })
    const { page = 1, pageSize = 20, keyword, status } = req.query
    const result = await Chat.listAllConversations({
      page: Number(page), pageSize: Number(pageSize), keyword, status
    })
    res.json({ code: 0, data: result })
  } catch (err) {
    console.error('[chat/history]', err.message)
    res.status(500).json({ code: 500, message: '获取聊天记录失败' })
  }
})

router.get('/conversations/:id/messages', staffRequired, async (req, res) => {
  try {
    const convId = parseInt(req.params.id)
    const since = req.query.since ? parseInt(req.query.since) : null
    const messages = await Chat.getMessages(convId, since)
    await Chat.markRead(convId)
    res.json({ code: 0, data: messages })
  } catch (err) {
    console.error('[chat/conv/messages]', err.message)
    res.status(500).json({ code: 500, message: '获取消息失败' })
  }
})

router.post('/conversations/:id/reply', staffRequired, async (req, res) => {
  try {
    const { type = 'text', content } = req.body
    if (!content) return res.json({ code: 400, message: '消息不能为空' })
    const convId = parseInt(req.params.id)
    const conv = await Chat.getConversation(convId)
    if (!conv) return res.json({ code: 404, message: '会话不存在' })
    const roles = req.user.roles || []
    const senderRole = roles.includes('admin') || roles.includes('super') ? 'admin' : 'agent'
    const msgId = await Chat.sendMessage(convId, req.user.id, senderRole, type, content)
    res.json({ code: 0, data: { id: msgId } })
  } catch (err) {
    console.error('[chat/reply]', err.message)
    res.status(500).json({ code: 500, message: '回复失败' })
  }
})

export default router
