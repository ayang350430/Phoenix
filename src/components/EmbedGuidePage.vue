<script setup>
import { ref, inject, onMounted } from 'vue'

const { getToken } = inject('workspace')
const widgetUrl = ref('')
const copied = ref('')
const embedToken = ref('')
const tokenError = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/embed-token', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data?.token) {
      embedToken.value = data.data.token
    } else {
      tokenError.value = data.message || '获取 Token 失败'
    }
  } catch (err) {
    tokenError.value = '网络错误: ' + err.message
  }
})

function detectUrl() {
  widgetUrl.value = widgetUrl.value.trim().replace(/\/+$/, '')
}

const steps = [
  { title: '部署 Widget 服务', desc: '将 chat-widget 项目部署到你的服务器并启动。' },
  { title: '复制嵌入代码', desc: '将下方生成的代码粘贴到目标网站的 HTML 中。' },
  { title: '完成', desc: '刷新目标网站，右下角出现客服气泡即成功。' }
]

function getEmbedCode() {
  const base = widgetUrl.value || location.origin
  const tk = embedToken.value
  return `<script src="${base}/chat-widget.js" data-server="${base}" data-token="${tk}"><\/script>`
}

function getEmbedCodeColor() {
  const base = widgetUrl.value || location.origin
  const tk = embedToken.value
  return `<script src="${base}/chat-widget.js" data-server="${base}" data-token="${tk}" data-color="#ff6600"><\/script>`
}

function getEmbedCodeLeft() {
  const base = widgetUrl.value || location.origin
  const tk = embedToken.value
  return `<script src="${base}/chat-widget.js" data-server="${base}" data-token="${tk}" data-position="left"><\/script>`
}

function copyCode(text, key) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      copied.value = key
      setTimeout(() => { copied.value = '' }, 2000)
    }).catch(() => fallbackCopy(text, key))
  } else {
    fallbackCopy(text, key)
  }
}

function fallbackCopy(text, key) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    copied.value = key
    setTimeout(() => { copied.value = '' }, 2000)
  } catch { /* ignore */ }
  document.body.removeChild(ta)
}
</script>

<template>
  <div class="eg-page">
    <div class="eg-card">
      <div class="eg-header">
        <div class="eg-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
        </div>
        <div>
          <h1>嵌入在线客服</h1>
          <p class="eg-sub">只需一行代码，让任意网站拥有在线客服聊天功能</p>
        </div>
      </div>

      <!-- 步骤 -->
      <div class="eg-steps">
        <div v-for="(s, i) in steps" :key="i" class="eg-step">
          <div class="step-num">{{ i + 1 }}</div>
          <div class="step-body">
            <strong>{{ s.title }}</strong>
            <span>{{ s.desc }}</span>
          </div>
        </div>
      </div>

      <!-- 服务地址输入 -->
      <div class="eg-section">
        <label class="eg-label">Widget 服务地址</label>
        <p class="eg-hint">输入你部署的 chat-widget 服务地址（含端口），代码将自动生成</p>
        <div class="eg-url-row">
          <input v-model="widgetUrl" type="text" placeholder="例如 https://cs.yourdomain.com" @input="detectUrl" />
        </div>
      </div>

      <!-- 你的 Token -->
      <div class="eg-section">
        <label class="eg-label">你的 Data Token</label>
        <p class="eg-hint">每个账号唯一，嵌入代码中的 data-token 值</p>
        <div v-if="embedToken" class="eg-token-box">
          <code class="eg-token-value">{{ embedToken }}</code>
          <button class="eg-token-copy" :class="{ ok: copied === 'token' }" @click="copyCode(embedToken, 'token')">
            {{ copied === 'token' ? '已复制' : '复制' }}
          </button>
        </div>
        <div v-else-if="tokenError" class="eg-token-error">{{ tokenError }}</div>
        <div v-else class="eg-token-loading">加载中...</div>
      </div>

      <!-- 基础嵌入 -->
      <div class="eg-section">
        <label class="eg-label">基础嵌入代码</label>
        <p class="eg-hint">复制以下代码，粘贴到网站 HTML 的 &lt;/body&gt; 前即可</p>
        <div class="eg-code-block">
          <pre><code>{{ getEmbedCode() }}</code></pre>
          <button class="eg-copy" @click="copyCode(getEmbedCode(), 'basic')">
            {{ copied === 'basic' ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <!-- 自定义颜色 -->
      <div class="eg-section">
        <label class="eg-label">自定义主题色</label>
        <p class="eg-hint">通过 data-color 属性修改客服按钮和窗口的主题颜色</p>
        <div class="eg-code-block">
          <pre><code>{{ getEmbedCodeColor() }}</code></pre>
          <button class="eg-copy" @click="copyCode(getEmbedCodeColor(), 'color')">
            {{ copied === 'color' ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <!-- 左侧定位 -->
      <div class="eg-section">
        <label class="eg-label">按钮放左边</label>
        <p class="eg-hint">通过 data-position="left" 将聊天按钮放在页面左下角</p>
        <div class="eg-code-block">
          <pre><code>{{ getEmbedCodeLeft() }}</code></pre>
          <button class="eg-copy" @click="copyCode(getEmbedCodeLeft(), 'left')">
            {{ copied === 'left' ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <!-- 参数说明 -->
      <div class="eg-section">
        <label class="eg-label">可用参数一览</label>
        <div class="eg-table-wrap">
          <table class="eg-table">
            <thead>
              <tr>
                <th>属性</th>
                <th>说明</th>
                <th>默认值</th>
                <th>示例</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>data-server</code></td>
                <td>Widget API 服务地址</td>
                <td>当前页面域名</td>
                <td><code>https://cs.example.com</code></td>
              </tr>
              <tr>
                <td><code>data-token</code></td>
                <td>归属令牌（会话归属到你的账号）</td>
                <td>无</td>
                <td><code>{{ embedToken || '自动生成' }}</code></td>
              </tr>
              <tr>
                <td><code>data-color</code></td>
                <td>主题色（HEX）</td>
                <td><code>#2563eb</code></td>
                <td><code>#ff6600</code></td>
              </tr>
              <tr>
                <td><code>data-position</code></td>
                <td>按钮位置</td>
                <td><code>right</code></td>
                <td><code>left</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 功能列表 -->
      <div class="eg-section">
        <label class="eg-label">内置功能</label>
        <div class="eg-features">
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>实时文字聊天</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            <span>表情面板</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>图片发送</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            <span>语音消息播放</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>新消息未读提醒</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <span>手机自适应全屏</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span>快捷问题（客服配置）</span>
          </div>
          <div class="eg-feat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>无依赖纯 JS</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.eg-page {
  max-width: 780px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.eg-card {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04);
  padding: 32px;
}

/* 顶栏 */
.eg-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 28px;
}
.eg-icon {
  width: 52px; height: 52px; border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.eg-header h1 {
  font-size: 22px; font-weight: 800; color: #1e293b; margin: 0;
}
.eg-sub {
  font-size: 14px; color: #64748b; margin: 4px 0 0;
}

/* 步骤 */
.eg-steps {
  display: flex; gap: 12px; margin-bottom: 32px;
}
.eg-step {
  flex: 1; display: flex; align-items: flex-start; gap: 10px;
  padding: 14px; border-radius: 12px; background: #f8fafc;
  border: 1px solid #f1f5f9;
}
.step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: #2563eb; color: #fff; font-size: 13px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.step-body {
  display: flex; flex-direction: column; gap: 2px;
}
.step-body strong {
  font-size: 14px; color: #1e293b;
}
.step-body span {
  font-size: 12px; color: #94a3b8; line-height: 1.4;
}

/* 通用 section */
.eg-section {
  margin-bottom: 24px;
}
.eg-label {
  display: block; font-size: 15px; font-weight: 700; color: #1e293b;
  margin-bottom: 4px;
}
.eg-hint {
  font-size: 13px; color: #94a3b8; margin: 0 0 10px;
}

/* URL 输入 */
.eg-url-row {
  display: flex; gap: 8px;
}
.eg-url-row input {
  flex: 1; padding: 10px 14px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; font-size: 14px; color: #1e293b;
  outline: none; transition: border-color .2s, box-shadow .2s;
  background: #f8fafc;
}
.eg-url-row input:focus {
  border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.08);
  background: #fff;
}

/* Token 展示 */
.eg-token-box {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 10px;
  background: #f0f4ff; border: 1.5px solid #c7d7fe;
}
.eg-token-value {
  flex: 1; font-family: 'SF Mono', Consolas, monospace;
  font-size: 15px; font-weight: 700; color: #2563eb;
  word-break: break-all; user-select: all;
}
.eg-token-copy {
  padding: 6px 16px; border-radius: 8px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer;
  background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff;
  transition: filter .15s, transform .15s;
}
.eg-token-copy:hover { filter: brightness(1.08); }
.eg-token-copy:active { transform: scale(0.97); }
.eg-token-copy.ok { background: linear-gradient(135deg, #42c978, #2fb86e); }
.eg-token-error { color: #ef4444; font-size: 13px; padding: 8px 0; }
.eg-token-loading { color: #94a3b8; font-size: 13px; padding: 8px 0; }

/* 代码块 */
.eg-code-block {
  position: relative;
  background: #1e293b; border-radius: 10px;
  padding: 16px 18px; overflow-x: auto;
}
.eg-code-block pre {
  margin: 0; white-space: pre-wrap; word-break: break-all;
}
.eg-code-block code {
  font-family: 'SF Mono', Consolas, 'Courier New', monospace;
  font-size: 13px; color: #e2e8f0; line-height: 1.6;
}
.eg-copy {
  position: absolute; top: 10px; right: 10px;
  padding: 4px 12px; border-radius: 6px;
  border: none; font-size: 11px; font-weight: 700;
  background: rgba(255,255,255,.12); color: #94a3b8;
  cursor: pointer; transition: all .15s;
}
.eg-copy:hover {
  background: rgba(255,255,255,.2); color: #fff;
}

/* 参数表格 */
.eg-table-wrap {
  overflow-x: auto; border-radius: 10px;
  border: 1px solid #f1f5f9;
}
.eg-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px;
}
.eg-table th {
  background: #f8fafc; color: #64748b; font-weight: 700;
  padding: 10px 14px; text-align: left; border-bottom: 1px solid #f1f5f9;
}
.eg-table td {
  padding: 10px 14px; color: #1e293b; border-bottom: 1px solid #f8fafc;
}
.eg-table code {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
  color: #7c3aed;
}

/* 功能列表 */
.eg-features {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}
.eg-feat {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: #f8fafc; border: 1px solid #f1f5f9;
  font-size: 13px; color: #475569; font-weight: 600;
}

/* 手机 */
@media (max-width: 600px) {
  .eg-page { padding: 12px 8px 32px; }
  .eg-card { padding: 20px 16px; border-radius: 12px; }
  .eg-steps { flex-direction: column; }
  .eg-features { grid-template-columns: 1fr 1fr; }
  .eg-header h1 { font-size: 18px; }
}
</style>
