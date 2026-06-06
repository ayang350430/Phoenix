import { Router } from 'express'
import db from '../db.js'
import config from '../config/index.js'
import User from '../models/User.js'
import { generateToken } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { sendVerificationCodeEmail } from '../utils/mailer.js'
import { generateCode, saveCode, verifyCode } from '../utils/resetCodes.js'
import { uniqueCode } from '../utils/idGen.js'

const router = Router()

// 用户名规则：仅允许英文字母与数字（禁止中文/空格/符号），长度 3-20
const USERNAME_RE = /^[A-Za-z0-9]{3,20}$/

// ========== 简易速率限制（内存，按 IP） ==========
const loginAttempts = new Map()  // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW = 15 * 60 * 1000  // 15 分钟
const RATE_LIMIT_MAX = 10  // 最多 10 次

function checkRateLimit(ip) {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

// 定期清理过期条目（每 10 分钟）
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip)
  }
}, 10 * 60 * 1000)

// POST /api/auth/login
router.post('/login', validate({ body: ['username', 'password'] }), async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ code: 429, message: '登录尝试过于频繁，请 15 分钟后重试' })
  }
  try {
    const { username, password } = req.body
    const user = await User.findByUsername(username)
    if (!user || !await User.verifyPassword(user, password)) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误' })
    }
    if (user.status !== 'active') {
      return res.status(403).json({ code: 403, message: '账户已被禁用' })
    }
    await db('users').where({ id: user.id }).increment('token_version', 1)
    user.token_version = (user.token_version || 0) + 1
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
    // 用户名只允许英文字母+数字（禁止中文等），长度 3-20
    if (!USERNAME_RE.test(username || '')) {
      return res.status(400).json({ code: 400, message: '用户名只能包含英文字母和数字，长度 3-20 位' })
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ code: 400, message: '密码至少需要 6 位' })
    }
    const exists = await User.findByUsername(username)
    if (exists) {
      return res.status(409).json({ code: 409, message: '用户名已存在' })
    }
    // 邀请码必填且必须有效，否则不允许注册
    const code = (refCode || '').trim()
    if (!code) {
      return res.status(400).json({ code: 400, message: '请输入邀请码' })
    }
    const inviter = await User.findByReferralCode(code)
    if (!inviter) {
      return res.status(400).json({ code: 400, message: '邀请码无效' })
    }
    const user = await User.create({ username, password, real_name, nickname, refCode: code })

    // 注册奖励：如果该用户有上级代理且代理配置了注册奖励，自动发放
    if (user.referred_by) {
      try {
        const hasTable = await db.schema.hasTable('agent_register_bonus')
        if (hasTable) {
          const bonusCfg = await db('agent_register_bonus').where({ agent_id: user.referred_by }).first()
          if (bonusCfg && parseFloat(bonusCfg.bonus_amount) > 0) {
            const bonusAmount = parseFloat(bonusCfg.bonus_amount)
            const now = new Date()
            const bal = await db('balance_accounts').where({ user_id: user.id }).first()
            const oldBal = bal ? parseFloat(bal.available_amount) : 0
            const newBal = Math.round((oldBal + bonusAmount) * 10000) / 10000
            if (bal) {
              await db('balance_accounts').where({ user_id: user.id }).update({ available_amount: newBal, updated_at: now })
            } else {
              await db('balance_accounts').insert({ user_id: user.id, available_amount: newBal, created_at: now, updated_at: now })
            }
            await db('account_records').insert({
              record_no: await uniqueCode(db, 'account_records', 'record_no'),
              user_id: user.id,
              record_type: 'register_bonus',
              direction: 'in',
              actual_paid_amount: bonusAmount,
              before_available_amount: oldBal,
              after_available_amount: newBal,
              remark: '新用户注册奖励',
              created_at: now
            })
          }
        }
      } catch (e) {
        console.warn('[auth/register] 注册奖励发放失败:', e.message)
      }
    }

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
