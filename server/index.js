import { fileURLToPath } from 'url'
import path from 'path'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import config from './config/index.js'
import User from './models/User.js'
import { authRequired } from './middleware/auth.js'
import { startVerifyScheduler } from './services/verifyScheduler.js'
import { startOrderSyncScheduler } from './services/orderSyncScheduler.js'
import { ensureSchema } from './schema.js'

// Routes
import authRoutes from './routes/auth.js'
import taskRoutes from './routes/tasks.js'
import userRoutes from './routes/users.js'
import rechargeRoutes from './routes/recharge.js'
import batchRoutes from './routes/batch.js'
import productRoutes from './routes/products.js'
import agentPriceRoutes from './routes/agentPrices.js'
import chatRoutes from './routes/chat.js'
import csConfigRoutes from './routes/csConfig.js'
import refundRoutes from './routes/refund.js'
import widgetRoutes from './routes/widget.js'

const app = express()

// 中间件
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// 路由
app.use('/api/auth', authRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/users', userRoutes)
app.use('/api/recharge', rechargeRoutes)
app.use('/api/batch', batchRoutes)
app.use('/api/products', productRoutes)
app.use('/api/agent', agentPriceRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/cs-config', csConfigRoutes)
app.use('/api/refund', refundRoutes)
app.use('/api/widget', widgetRoutes)

// 嵌入令牌
app.get('/api/embed-token', authRequired, (req, res) => {
  const uid = String(req.user.id)
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(uid).digest('hex').slice(0, 16)
  res.json({ code: 0, data: { token: uid + '.' + sig } })
})

// 健康检查
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// 静态文件映射（前端构建产物）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

// 全局错误处理
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message)
  res.status(500).json({ code: 500, message: '服务器内部错误' })
})

// 启动
app.listen(config.port, async () => {
  console.log(`\n  Phoenix API running at http://localhost:${config.port}`)
  console.log(`  Database: ${config.db.connection.database}@${config.db.connection.host}`)
  console.log(`  Health check: http://localhost:${config.port}/api/health\n`)

  // 启动时自动建表
  try {
    await ensureSchema()
  } catch (e) { console.error('[SCHEMA] 建表失败:', e.message) }

  // 启动时确保必要角色存在
  try {
    const db = (await import('./db.js')).default
    const requiredRoles = [
      { code: 'admin', name: '管理员' },
      { code: 'agent', name: '代理' },
      { code: 'support', name: '客服' },
      { code: 'user', name: '普通用户' }
    ]
    for (const role of requiredRoles) {
      const exists = await db('roles').where({ code: role.code }).first()
      if (!exists) {
        await db('roles').insert(role)
        console.log(`  [INIT] 创建角色: ${role.name} (${role.code})`)
      }
    }
  } catch (e) { console.error('[INIT] 角色初始化失败:', e.message) }

  // 启动时补全缺失的 referral_code
  try { await User.ensureReferralCodes() } catch {}

  // 启动后台调度器
  startOrderSyncScheduler()   // 派单 + 同步上游状态（5分钟）
  startVerifyScheduler()      // 完成后验证快照（1分钟）
})
