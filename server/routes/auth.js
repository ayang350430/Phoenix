import { Router } from 'express'
import db from '../db.js'
import config from '../config/index.js'
import User from '../models/User.js'
import { generateToken } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { sendVerificationCodeEmail } from '../utils/mailer.js'
import { generateCode, saveCode, verifyCode } from '../utils/resetCodes.js'

const router = Router()

// POST /api/auth/login
router.post('/login', validate({ body: ['username', 'password'] }), async (req, res) => {
  try {
    const { username, password } = req.body
    const user = await User.findByUsername(username)
    if (!user || !await User.verifyPassword(user, password)) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' })
    }
    if (user.status !== 'active') {
      return res.status(403).json({ code: 403, message: '账户已被禁用' })
    }
    const token = generateToken(user)
    const balance = await User.getBalance(user.id)
    res.json({
      code: 0,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          real_name: user.real_name,
          nickname: user.nickname,
          roles: user.roles.map(r => r.code),
          permissions: user.permissions.map(p => p.code),
          balance: balance?.available_amount || 0,
          referral_code: user.referral_code,
          order_view_enabled: user.order_view_enabled,
          order_like_enabled: user.order_like_enabled,
          order_impression_enabled: user.order_impression_enabled
        }
      }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// POST /api/auth/register
// body: { username, password, real_name?, nickname?, ref? }
router.post('/register', validate({ body: ['username', 'password'] }), async (req, res) => {
  try {
    const { username, password, real_name, nickname, ref: refCode } = req.body
    const exists = await User.findByUsername(username)
    if (exists) {
      return res.status(409).json({ code: 409, message: '用户名已存在' })
    }
    const user = await User.create({ username, password, real_name, nickname, refCode })
    const token = generateToken(user)
    res.json({
      code: 0,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          real_name: user.real_name,
          nickname: user.nickname,
          roles: user.roles.map(r => r.code),
          referral_code: user.referral_code
        }
      }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

// POST /api/auth/forgot-password
router.post('/forgot-password', validate({ body: ['email'] }), async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findByEmail(email)
    if (!user) {
      return res.status(404).json({ code: 404, message: '该邮箱未绑定任何账号' })
    }
    const code = generateCode()
    saveCode(email, code)
    await sendVerificationCodeEmail(email, code)
    res.json({ code: 0, message: '验证码已发送到您的邮箱' })
  } catch (err) {
    console.error('[FORGOT-PASSWORD]', err.message)
    res.status(500).json({ code: 500, message: '邮件发送失败，请稍后重试' })
  }
})

// POST /api/auth/reset-password
router.post('/reset-password', validate({ body: ['email', 'code', 'password'] }), async (req, res) => {
  try {
    const { email, code, password } = req.body
    const result = verifyCode(email, code)
    if (!result.valid) {
      return res.status(400).json({ code: 400, message: result.message })
    }
    const user = await User.findByEmail(email)
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }
    await User.updatePassword(user.id, password)
    res.json({ code: 0, message: '密码重置成功，请使用新密码登录' })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
