import crypto from 'crypto'
import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import config from '../config/index.js'

const { apiUrl, safeKey } = config.tinydatapay

const proxyUrl = process.env.TINYDATAPAY_PROXY || ''
const clientOpts = {
  baseURL: apiUrl,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
  }
}

if (proxyUrl) {
  clientOpts.httpAgent = new HttpsProxyAgent(proxyUrl)
  clientOpts.httpsAgent = new HttpsProxyAgent(proxyUrl)
  clientOpts.proxy = false
  console.log(`[TINYDATAPAY] 使用代理: ${proxyUrl}`)
}

const client = axios.create(clientOpts)

/**
 * 带重试
 */
async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries - 1) throw err
      console.log(`[TINYDATAPAY] 重试 ${i + 1}/${retries - 1} (${err.message})`)
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

/**
 * 生成签名
 */
export function makeSign(params) {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== '' && v !== null && v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)

  const str = filtered.map(([k, v]) => `${k}=${v}`).join('&') + `&key=${safeKey}`
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase()
}

/**
 * 验证回调签名
 */
export function verifySign(params) {
  const expected = makeSign(params)
  return expected === params.sign
}

/**
 * 创建支付订单
 */
export async function createPayment({ merchantOrderId, amount, currency, productName, notifyUrl, redirectUrl }) {
  const body = {
    merchant_order_id: merchantOrderId,
    amount: String(amount),
    currency: currency || 'CNY',
    product_name: productName
  }
  if (notifyUrl) body.notify_url = notifyUrl
  if (redirectUrl) body.redirect_url = redirectUrl
  body.sign = makeSign(body)

  console.log('[TINYDATAPAY] 创建订单请求:', JSON.stringify(body))
  const { data } = await withRetry(() =>
    client.post('/api/v1/payment/create', body)
  )
  console.log('[TINYDATAPAY] 创建订单响应:', JSON.stringify(data))
  if (data.code !== 0) {
    throw new Error(data.message || '创建支付订单失败')
  }
  return data.data
}

/**
 * 查询订单状态
 */
export async function queryPayment(orderNo) {
  console.log('[TINYDATAPAY] 查询订单:', orderNo)
  const { data } = await withRetry(() =>
    client.get(`/api/v1/payment/status?order_no=${encodeURIComponent(orderNo)}`)
  )
  console.log('[TINYDATAPAY] 查询响应:', JSON.stringify(data))
  if (data.code !== 0) {
    throw new Error(data.message || '查询订单失败')
  }
  return data.data
}
