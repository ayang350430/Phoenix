import nodemailer from 'nodemailer'
import config from '../config/index.js'

let transporter = null

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    })
  }
  return transporter
}

/**
 * 发送密码重置验证码邮件
 */
export async function sendVerificationCodeEmail(toEmail, code) {
  const text = `您的验证码是：${code}，有效期30分钟。如非本人操作请忽略。`
  const html = `
    <div style="max-width:420px;margin:0 auto;font-family:sans-serif;padding:24px;">
      <h2 style="color:#152033;font-size:18px;margin:0 0 16px;">密码重置验证码</h2>
      <p style="color:#425066;font-size:14px;line-height:1.6;margin:0 0 20px;">您正在重置密码，验证码如下：</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;padding:12px 32px;background:#f4f7fb;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:6px;color:#152033;">${code}</span>
      </div>
      <p style="color:#647184;font-size:13px;margin:0;">验证码有效期为 30 分钟，如非本人操作请忽略此邮件。</p>
    </div>
  `

  return getTransporter().sendMail({
    from: config.smtp.from,
    to: toEmail,
    subject: '密码重置验证码',
    text,
    html
  })
}
