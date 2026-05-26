// 密码重置验证码 — 内存存储
const store = new Map()

/** 生成 6 位数字验证码 */
export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** 保存验证码（30 分钟有效） */
export function saveCode(email, code) {
  store.set(email.toLowerCase(), {
    code,
    expiresAt: Date.now() + 30 * 60 * 1000,
    attempts: 0
  })
}

/** 校验验证码 */
export function verifyCode(email, code) {
  const key = email.toLowerCase()
  const entry = store.get(key)
  if (!entry) return { valid: false, message: '请先获取验证码' }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return { valid: false, message: '验证码已过期，请重新获取' }
  }
  entry.attempts++
  if (entry.attempts > 5) {
    store.delete(key)
    return { valid: false, message: '错误次数过多，请重新获取验证码' }
  }
  if (entry.code !== code) {
    return { valid: false, message: '验证码错误' }
  }
  store.delete(key)
  return { valid: true }
}

// 定时清理过期验证码
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key)
  }
}, 5 * 60 * 1000)
