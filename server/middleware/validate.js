/**
 * 简单请求校验中间件
 * 用法: validate({ body: ['username', 'password'] })
 */
export function validate({ body: requiredFields = [] }) {
  return (req, res, next) => {
    const missing = requiredFields.filter(f => !req.body?.[f])
    if (missing.length > 0) {
      return res.status(400).json({
        code: 400,
        message: `缺少必填字段: ${missing.join(', ')}`
      })
    }
    next()
  }
}
