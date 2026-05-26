import { Router } from 'express'
import { authRequired } from '../middleware/auth.js'
import Config from '../models/Config.js'

const router = Router()

const CS_CONFIG_KEY = 'cs_config'

const DEFAULT_CONFIG = {
  telegram: '',
  welcomeText: '您好！我是AI客服助手，可以为您解答常见问题。\n如需人工服务，请点击「联系人工客服」。',
  quickQuestions: [
    { question: '订单怎么申请退款？', answer: '' },
    { question: '我的订单什么时间能到？', answer: '' },
    { question: '余额怎么充值？', answer: '' },
    { question: '如何批量下单？', answer: '' },
    { question: '怎么查看订单状态？', answer: '' },
    { question: '添加飞机号', answer: '' },
    { question: '联系人工客服', answer: '' }
  ]
}

router.get('/public', async (_req, res) => {
  try {
    const cfg = await Config.get(CS_CONFIG_KEY, DEFAULT_CONFIG)
    res.json({ code: 0, data: cfg })
  } catch (err) {
    console.error('[csConfig/public]', err.message)
    res.status(500).json({ code: 500, message: '获取配置失败' })
  }
})

router.use(authRequired)

function adminRequired(req, res, next) {
  const roles = req.user?.roles || []
  if (roles.includes('admin') || roles.includes('super')) return next()
  res.status(403).json({ code: 403, message: '需要管理员权限' })
}

router.get('/', adminRequired, async (_req, res) => {
  try {
    const cfg = await Config.get(CS_CONFIG_KEY, DEFAULT_CONFIG)
    res.json({ code: 0, data: cfg })
  } catch (err) {
    console.error('[csConfig/get]', err.message)
    res.status(500).json({ code: 500, message: '获取配置失败' })
  }
})

router.put('/', adminRequired, async (req, res) => {
  try {
    const { telegram, welcomeText, quickQuestions } = req.body
    const current = await Config.get(CS_CONFIG_KEY, DEFAULT_CONFIG)
    const updated = {
      ...current,
      ...(telegram !== undefined && { telegram }),
      ...(welcomeText !== undefined && { welcomeText }),
      ...(quickQuestions !== undefined && { quickQuestions })
    }
    await Config.set(CS_CONFIG_KEY, updated)
    res.json({ code: 0, data: updated })
  } catch (err) {
    console.error('[csConfig/put]', err.message)
    res.status(500).json({ code: 500, message: '保存配置失败' })
  }
})

export default router
