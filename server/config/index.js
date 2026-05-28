import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

if (!process.env.JWT_SECRET) {
  console.error('\n  [FATAL] 环境变量 JWT_SECRET 未设置！请在 .env 中配置 JWT_SECRET\n')
  process.exit(1)
}

export default {
  port: process.env.PORT || 3000,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '7d'
  },
  db: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'phoenix',
      charset: 'utf8mb4'
    },
    pool: { min: 2, max: 10 }
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  tinydatapay: {
    apiUrl: process.env.TINYDATAPAY_API_URL || 'https://pay.tinydata.cc',
    safeKey: process.env.TINYDATAPAY_SAFE_KEY || ''
  },
  notifyBaseUrl: process.env.NOTIFY_BASE_URL || 'http://localhost:3001',
  noteApi: {
    baseUrl: process.env.NOTE_API_BASE || 'http://192.168.31.189:9110/api/v1/note',
    timeout: Number(process.env.NOTE_API_TIMEOUT) || 10000,
    concurrency: Number(process.env.NOTE_API_CONCURRENCY) || 100,
    proxyLine: process.env.NOTE_API_PROXY_LINE || 'line_1086'
  },
  xhsApi: {
    baseUrl: process.env.XHS_API_BASE_URL || 'http://185.213.63.243:9101',
    token: process.env.XHS_API_TOKEN || '',
    timeout: Number(process.env.XHS_API_TIMEOUT_MS) || 60000
  }
}
