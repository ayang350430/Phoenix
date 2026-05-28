# goosd_gw 项目测试报告

**测试日期：** 2026-05-28  
**项目版本：** 0.0.0  
**技术栈：** Vue3 + Element Plus + Express5 + MySQL (Knex)  
**测试范围：** 全栈代码审查（后端 11 个路由 + 前端 18 个组件）

---

## 一、测试概览

| 指标 | 数值 |
|------|------|
| 总 Bug 数 | **50** |
| 高危 | **11** |
| 中危 | **22** |
| 低危 | **17** |
| 后端 Bug | 26 |
| 前端 Bug | 24 |

---

## 二、后端 Bug 列表（26 个）

### 🔴 高危（6 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| BE-001 | config/index.js | 11 | 安全 | JWT 密钥硬编码默认值 `phoenix-secret-key-change-in-production`，未设环境变量时任何人可伪造 Token |
| BE-002 | routes/batch.js | 209-385 | 并发 | 余额检查与扣款之间存在 TOCTOU 竞态，高并发下可超额下单导致余额为负 |
| BE-003 | routes/users.js | 118-137 | 并发 | 管理员修改余额无行锁，并发时覆盖写导致余额计算错误 |
| BE-004 | routes/recharge.js | 95-159 | 并发/安全 | 充值回调幂等保护不足，并发回调可能重复入账 |
| BE-005 | routes/batch.js + refund.js | 550-598 | 并发 | 批次退款循环内无行锁（无 FOR UPDATE），并发时余额计算错误 |
| BE-006 | routes/widget.js | 40-67 | 安全 | 访客聊天接口无身份验证，visitor_id 可枚举读取他人对话历史 |

**BE-001 修复建议：**
```js
// server/config/index.js
secret: process.env.JWT_SECRET || (() => { throw new Error('JWT_SECRET must be set') })()
```

**BE-002 修复建议：**
```js
// 将余额检查移入事务，加行锁
const balRow = await trx('balance_accounts').where({ user_id: userId }).forUpdate().first()
if (balRow.available_amount < totalCost) {
  throw new Error('余额不足')
}
```

**BE-004 修复建议：**
```js
// 使用原子更新 + 受影响行数检查
const affected = await trx('recharge_orders')
  .where({ id: order.id, status: 'pending' })
  .update({ status: 'paid', ... })
if (affected === 0) return // 已处理，幂等返回
```

---

### 🟡 中危（11 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| BE-007 | routes/auth.js | 82-96 | 安全 | `/forgot-password` 邮箱不存在时返回 404，可枚举注册用户邮箱 |
| BE-008 | routes/auth.js | 53-78 | 安全 | 注册无密码强度校验，登录/注册无速率限制，可暴力破解 |
| BE-009 | middleware/auth.js | 23 | 逻辑 | `decoded.tv == null` 时 token_version 校验被跳过，旧 Token 永不失效 |
| BE-010 | routes/batch.js | 123-203 | 安全 | 预校验接口无 URL 数量上限，可被滥用为 DDoS 代理 |
| BE-011 | routes/batch.js | 236 | 逻辑 | quantity 无上限校验，传入超大数时 totalCost 溢出为 Infinity，余额检查失效 |
| BE-012 | routes/users.js | 89-104 | 逻辑 | 未阻止禁用 super 管理员账号，可导致系统锁死 |
| BE-013 | routes/refund.js | 186-192 | 安全 | 代理在特定数据异常下可自审自批退款 |
| BE-014 | routes/chat.js | 56-66 | 安全 | 客服可越权读取不属于自己的会话消息 |
| BE-015 | routes/chat.js | 69-84 | 安全 | 客服可越权回复不属于自己的会话 |
| BE-016 | services/verifyScheduler.js | 106-109 | 性能 | 同步 sleep(2min) 阻塞调度器，批量失败时整体停滞 40 分钟 |
| BE-017 | config/index.js | 47 | 配置 | 内网 IP `192.168.31.189` 硬编码，生产环境连接必然失败 |

---

### 🟢 低危（9 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| BE-018 | routes/auth.js | 113-115 | 逻辑 | 重置密码后验证码未确认单次失效 |
| BE-019 | routes/batch.js | 293-296 | 逻辑 | 不同批次同一毫秒提交时订单号可能碰撞 |
| BE-020 | routes/users.js | 141 | 逻辑 | `ADMIN_${Date.now()}` 记录号高并发下可能重复 |
| BE-021 | routes/batch.js | 63-72 | 逻辑 | 模块加载时 DDL 迁移无并发锁 |
| BE-022 | routes/tasks.js | 234-255 | 安全 | 补单明细未校验批次归属，存在信息泄露 |
| BE-023 | services/xhsApi.js | 35-36 | 安全 | 请求/响应体完整写入日志，含敏感信息 |
| BE-024 | routes/batch.js | 453-454 | 稳健性 | raw SQL 拼接依赖 MySQL 版本兼容性 |
| BE-025 | models/User.js | 34 | 性能 | `bcrypt.compareSync` 同步调用阻塞事件循环 |
| BE-026 | index.js | 29 | 安全 | `cors()` 允许所有来源，生产环境应限制域名 |

---

## 三、前端 Bug 列表（24 个）

### 🔴 高危（5 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| FE-001 | main.js | 10-29 | 逻辑 | `kickHandled` 不重置，首次触发后续强制下线全部失效 |
| FE-002 | router/index.js | 83-100 | 安全 | 路由守卫仅凭 `localStorage.token` 存在判断登录，可伪造绕过 |
| FE-003 | AdminPage.vue | 55-62 | 安全 | 管理员权限依赖 localStorage 中可伪造的 roles 字段 |
| FE-004 | WorkspaceLayout.vue | 288-290 | 权限 | 客服角色路由限制未在守卫层实现，地址栏可直接绕过 |
| FE-005 | CustomerServicePage.vue | 14 | 权限 | setup 顶层同步权限检查，inject 数据未就绪时全部用户被错误重定向 |

**FE-002 修复建议：**
```js
// src/router/index.js - 路由守卫增强
router.beforeEach(async (to, from, next) => {
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth) {
    if (!token) return next('/login')
    // 校验 token 有效性
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error()
      next()
    } catch {
      localStorage.removeItem('token')
      next('/login')
    }
  } else {
    next()
  }
})
```

---

### 🟡 中危（11 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| FE-006 | WorkspaceLayout.vue | 233-248 | 逻辑 | 充值轮询与 refreshKey 状态同步问题，子组件 unmount 后 refresh 丢失 |
| FE-007 | ChatWidget.vue | 22-24 | 逻辑 | 人工模式下本地 FAQ 回复与 polling 消息重复显示 |
| FE-008 | ChatWidget.vue | 546 | 崩溃 | `Math.max(...[])` 返回 `-Infinity`，导致 polling URL 异常 |
| FE-009 | WorkspaceLayout.vue | 120 | 崩溃 | fetchMessages 同样存在 `-Infinity` 问题 |
| FE-010 | RecordsPage.vue | 505-515 | UI | 硬编码 200ms 延迟在低性能设备上 DOM 查找失败 |
| FE-011 | RecordsPage.vue | 220-224 | 内存泄漏 | toast 定时器未在 unmount 时清理 |
| FE-012 | LoginPage.vue | 44-51 | 内存泄漏 | countdownTimer 未在 unmount 时清理 |
| FE-013 | DashboardPage.vue | 132-136 | UI | Tab 切换时 chartRef 为 null 导致图表不渲染 |
| FE-014 | ProductPage.vue | 129-137 | UX | 混用原生 confirm/alert，删除失败无错误提示 |
| FE-015 | BatchSubmitPage.vue | 160-161 | 逻辑 | balanceNotified 是模块级变量，组件重新 mount 不重置 |
| FE-016 | App.vue | 10 | UI | layout 切换闪烁，路由元数据短暂为空 |

---

### 🟢 低危（8 个）

| ID | 文件 | 行号 | 类型 | 问题描述 |
|----|------|------|------|----------|
| FE-017 | WorkspaceLayout.vue | 80-88 | 死代码 | activeNav 初始化逻辑被 computed 完全覆盖 |
| FE-018 | WorkspaceLayout.vue | 63-66 | UX | clipboard.writeText 无错误处理，非 HTTPS 下静默失败 |
| FE-019 | DashboardPage.vue | 343 | UI | 时间显示不更新，停留在页面加载时刻 |
| FE-020 | RecordsPage.vue | 391-400 | 兼容性 | revokeObjectURL 过早调用，Firefox 下可能中断下载 |
| FE-021 | EmbedGuidePage.vue | 29-44 | UX | embedToken 异步加载前代码片段含空 token |
| FE-022 | LoginPage.vue | 219 | 逻辑 | 注册流程未要求完成滑块验证 |
| FE-023 | CustomerServicePage.vue | 375-386 | 内存泄漏 | unmount 时未停止正在播放的语音 |
| FE-024 | WorkspaceLayout.vue | 374-375 | 安全 | 头像 URL 未做来源校验（当前无直接 XSS 风险） |

---

## 四、优先修复建议

### 🚨 必须立即修复（生产环境安全风险）

| 优先级 | Bug ID | 说明 |
|--------|--------|------|
| P0 | BE-001 | JWT 密钥硬编码，可伪造任意用户 Token |
| P0 | BE-004 | 充值回调可重放，导致余额重复入账 |
| P0 | BE-002 | 余额扣款竞态，高并发下可超额下单 |
| P0 | BE-006 | 访客聊天无认证，可读取他人对话 |
| P1 | FE-002 | 路由守卫可被伪造 token 绕过 |
| P1 | BE-011 | quantity 溢出可绕过余额检查 |

### ⚠️ 尽快修复（功能/稳定性）

| 优先级 | Bug ID | 说明 |
|--------|--------|------|
| P2 | FE-008/009 | Math.max 空数组导致 -Infinity，API 请求异常 |
| P2 | FE-001 | 强制下线机制首次触发后永久失效 |
| P2 | BE-008 | 无速率限制，可暴力破解密码 |
| P2 | BE-009 | 旧版 Token 永不失效 |
| P2 | FE-012 | 登录页定时器泄漏 |

### 📋 后续优化

- 所有低危 Bug 可排入下个迭代
- 建议添加单元测试覆盖核心余额计算逻辑
- 建议引入 `express-rate-limit` 中间件
- 建议生产环境配置严格的 CORS 白名单

---

## 五、总结

项目功能完整，但在 **并发安全** 和 **权限控制** 两个方面存在较多问题：

1. **余额相关操作** 普遍缺少数据库行锁（FOR UPDATE），高并发下存在资金风险
2. **前端权限** 完全依赖 localStorage，客户端可伪造绕过
3. **聊天模块** 存在未授权访问和消息越权问题
4. **内存泄漏** 多个组件定时器未在 unmount 时清理

建议先修复 6 个 P0 级 Bug，确保生产环境资金安全和数据隐私。
