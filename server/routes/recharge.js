import { Router } from 'express'
import db from '../db.js'
import config from '../config/index.js'
import { authRequired } from '../middleware/auth.js'
import { createPayment, queryPayment, verifySign } from '../utils/tinydatapay.js'
import User from '../models/User.js'

const router = Router()

const PAY_TYPE_LABELS = {
  WXPAY: '微信支付', ALIPAY: '支付宝', TRX: 'TRX', USDT: 'USDT'
}
function payTypeLabel(raw) {
  return PAY_TYPE_LABELS[raw] || raw || '在线支付'
}

/**
 * POST /api/recharge/create — 创建充值订单
 * body: { amount }
 */
router.post('/create', authRequired, async (req, res) => {
  try {
    const userId = req.user.id
    const { amount } = req.body
    const num = parseFloat(amount)
    if (!num || num < 1) {
      return res.status(400).json({ code: 400, message: '充值金额至少 1 元' })
    }

    // 生成商户订单号
    const merchantOrderId = `RC${Date.now()}${userId}`

    // 回调地址用公网地址（部署后配 NOTIFY_BASE_URL），跳转用前端地址
    const notifyUrl = `${config.notifyBaseUrl}/api/recharge/callback`
    // 重定向带上 recharge 参数：支付返回后前端据此识别并轮询，跨域重定向也能带回
    const redirectUrl = `${config.frontendUrl}/dashboard?recharge=${encodeURIComponent(merchantOrderId)}`

    // 调用 TinyDataPay 创建订单
    const payResult = await createPayment({
      merchantOrderId,
      amount: num.toFixed(2),
      currency: 'CNY',
      productName: 'Phoenix 余额充值',
      notifyUrl,
      redirectUrl
    })

    // 存入数据库
    await db('recharge_orders').insert({
      user_id: userId,
      merchant_order_id: merchantOrderId,
      order_no: payResult.order_no,
      amount: num.toFixed(2),
      currency: 'CNY',
      status: 'pending',
      payment_url: payResult.payment_url,
      expired_at: payResult.expired_at,
      created_at: new Date()
    })

    res.json({
      code: 0,
      data: {
        merchant_order_id: merchantOrderId,
        order_no: payResult.order_no,
        amount: num.toFixed(2),
        payment_url: payResult.payment_url,
        expired_at: payResult.expired_at
      }
    })
  } catch (err) {
    console.error('[RECHARGE CREATE]', err.message)
    res.status(500).json({ code: 500, message: err.message })
  }
})

/**
 * GET /api/recharge/callback — TinyDataPay 异步回调
 * 参数通过 query string 传入
 */
router.get('/callback', async (req, res) => {
  try {
    const { order_no, merchant_order_id, amount, status, pay_type, sign } = req.query

    // 验签
    if (!verifySign(req.query)) {
      console.error('[RECHARGE CALLBACK] 签名验证失败', req.query)
      return res.type('text').send('fail')
    }

    if (status !== 'paid') {
      return res.type('text').send('success')
    }

    // 幂等：查找订单
    const order = await db('recharge_orders')
      .where({ merchant_order_id })
      .first()

    if (!order) {
      console.error('[RECHARGE CALLBACK] 订单不存在:', merchant_order_id)
      return res.type('text').send('fail')
    }

    // 已处理过
    if (order.status === 'paid') {
      return res.type('text').send('success')
    }

    // 校验金额
    if (parseFloat(order.amount) !== parseFloat(amount)) {
      console.error('[RECHARGE CALLBACK] 金额不匹配:', order.amount, amount)
      return res.type('text').send('fail')
    }

    // 事务：原子更新防止并发重复入账
    await db.transaction(async (trx) => {
      // 原子更新：只有 status='pending' 的记录才会被更新，返回受影响行数
      const affected = await trx('recharge_orders')
        .where({ id: order.id, status: 'pending' })
        .update({
          status: 'paid',
          pay_type: pay_type || null,
          paid_at: new Date(),
          updated_at: new Date()
        })

      // 已被其他请求处理过，幂等返回
      if (affected === 0) return

      // 行锁读取余额，防止并发写入
      const balance = await trx('balance_accounts')
        .where({ user_id: order.user_id })
        .forUpdate()
        .first()

      const oldAmount = balance ? parseFloat(balance.available_amount) : 0
      const creditAmount = parseFloat(amount)
      const newAmount = Math.round((oldAmount + creditAmount) * 10000) / 10000

      if (balance) {
        await trx('balance_accounts')
          .where({ user_id: order.user_id })
          .update({ available_amount: newAmount, updated_at: new Date() })
      } else {
        await trx('balance_accounts').insert({
          user_id: order.user_id,
          available_amount: newAmount,
          created_at: new Date(),
          updated_at: new Date()
        })
      }

      await trx('account_records').insert({
        record_no: `RECHARGE_${Date.now()}_${order.id}`,
        user_id: order.user_id,
        record_type: 'recharge',
        direction: 'in',
        actual_paid_amount: creditAmount,
        before_available_amount: oldAmount,
        after_available_amount: newAmount,
        remark: `充值 ¥${amount}（${payTypeLabel(pay_type)}）`,
        created_at: new Date()
      })
    })

    console.log('[RECHARGE CALLBACK] 充值成功:', merchant_order_id, amount)
    res.type('text').send('success')
  } catch (err) {
    console.error('[RECHARGE CALLBACK] 异常:', err.message)
    res.type('text').send('fail')
  }
})

/**
 * GET /api/recharge/status?order_no=xxx — 前端轮询订单状态
 */
router.get('/status', authRequired, async (req, res) => {
  try {
    const { order_no, merchant_order_id } = req.query
    if (!order_no && !merchant_order_id) {
      return res.status(400).json({ code: 400, message: '缺少 order_no' })
    }

    // 先查本地（支持按 order_no 或 merchant_order_id 查询）
    const lookup = order_no ? { order_no } : { merchant_order_id }
    const order = await db('recharge_orders')
      .where({ ...lookup, user_id: req.user.id })
      .first()

    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在' })
    }

    // 如果本地已经是 paid，直接返回
    if (order.status === 'paid') {
      return res.json({ code: 0, data: { status: 'paid', amount: order.amount, pay_type: order.pay_type } })
    }

    // 否则主动查询 TinyDataPay
    try {
      const remote = await queryPayment(order.order_no)
      if (remote.status === 'paid' && order.status !== 'paid') {
        await db.transaction(async (trx) => {
          // 原子更新：只有 status='pending' 的记录才会被更新
          const affected = await trx('recharge_orders')
            .where({ id: order.id, status: 'pending' })
            .update({ status: 'paid', pay_type: remote.pay_type || null, paid_at: new Date(), updated_at: new Date() })

          // 已被 callback 或其他轮询处理过，幂等跳过
          if (affected === 0) return

          const balance = await trx('balance_accounts').where({ user_id: order.user_id }).forUpdate().first()
          const oldAmount = balance ? parseFloat(balance.available_amount) : 0
          const creditAmount = parseFloat(order.amount)
          const newAmount = Math.round((oldAmount + creditAmount) * 10000) / 10000

          if (balance) {
            await trx('balance_accounts')
              .where({ user_id: order.user_id })
              .update({ available_amount: newAmount, updated_at: new Date() })
          } else {
            await trx('balance_accounts').insert({
              user_id: order.user_id, available_amount: newAmount,
              created_at: new Date(), updated_at: new Date()
            })
          }

          await trx('account_records').insert({
            record_no: `RECHARGE_${Date.now()}_${order.id}`,
            user_id: order.user_id, record_type: 'recharge', direction: 'in',
            actual_paid_amount: creditAmount,
            before_available_amount: oldAmount,
            after_available_amount: newAmount,
            remark: `充值 ¥${order.amount}（${payTypeLabel(remote.pay_type)}）`,
            created_at: new Date()
          })
        })
        return res.json({ code: 0, data: { status: 'paid', amount: order.amount, pay_type: remote.pay_type } })
      }

      // 同步状态
      if (remote.status !== order.status) {
        await db('recharge_orders').where({ id: order.id }).update({ status: remote.status, updated_at: new Date() })
      }
      return res.json({ code: 0, data: { status: remote.status, amount: order.amount } })
    } catch (queryErr) {
      console.error('[RECHARGE STATUS] 查询 TinyDataPay 失败:', queryErr.message)
      // 查询失败则返回本地状态
      return res.json({ code: 0, data: { status: order.status, amount: order.amount } })
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

/**
 * GET /api/recharge/records — 充值记录（按角色过滤）
 * admin 看所有，agent 看自己+下级，user 看自己
 */
router.get('/records', authRequired, async (req, res) => {
  try {
    const userIds = await User.getVisibleUserIds(req.user)
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 20
    const offset = (page - 1) * pageSize

    const query = db('recharge_orders')
    if (userIds !== null) {
      if (userIds.length === 1) query.where({ user_id: userIds[0] })
      else query.whereIn('user_id', userIds)
    }

    const rows = await query.clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize).offset(offset)

    const [{ total }] = await query.clone().count('id as total')

    // 当前用户余额（始终显示自己的）
    const balance = await db('balance_accounts').where({ user_id: req.user.id }).first()

    res.json({
      code: 0,
      data: {
        rows,
        total,
        balance: balance?.available_amount || 0
      }
    })
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message })
  }
})

export default router
