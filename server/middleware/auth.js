import jwt from 'jsonwebtoken'
import config from '../config/index.js'
import db from '../db.js'

export function generateToken(user) {
  const roles = (user.roles || []).map(r => r.code || r)
  return jwt.sign(
    { id: user.id, username: user.username, roles, tv: user.token_version || 1 },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  )
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录' })
  }
  try {
    const token = header.slice(7)
    const decoded = jwt.verify(token, config.jwt.secret)
    const row = await db('users').where({ id: decoded.id }).select('token_version', 'status').first()
    if (!row) {
      return res.status(401).json({ code: 401, message: '用户不存在' })
    }
    if (row.status === 'disabled') {
      return res.status(403).json({ code: 403, message: '账户已被禁用' })
    }
    // tv 为空的旧 Token 也必须校验版本号（强制失效）
    if (decoded.tv == null || row.token_version !== Number(decoded.tv)) {
      return res.status(401).json({ code: 4011, message: '登录已过期，请重新登录' })
    }
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ code: 401, message: '登录已过期' })
  }
}

/**
 * 角色检查中间件工厂
 * roleRequired('admin')          — 只允许管理员
 * roleRequired('admin', 'agent') — 管理员 或 代理
 */
export function roleRequired(...allowedRoles) {
  return (req, res, next) => {
    const roles = req.user?.roles || []
    // super 拥有所有权限
    if (roles.includes('super')) return next()
    const hasRole = allowedRoles.some(r => roles.includes(r))
    if (!hasRole) {
      return res.status(403).json({ code: 403, message: '权限不足' })
    }
    next()
  }
}

// 快捷方式
export function adminRequired(req, res, next) {
  return roleRequired('admin')(req, res, next)
}
