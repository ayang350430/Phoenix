<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElNotification } from 'element-plus'

const route = useRoute()
const router = useRouter()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { isAdmin, balance, getToken, fetchBalance } = ws

// ========== 商品 & 类型选择 ==========
const products = ref([])
const types = computed(() =>
  products.value.map(p => ({ key: p.id, label: p.name, enabled: true, product: p }))
)
const activeProductId = ref(null)

// 兼容：activeType 返回当前选中商品的 target_type
const activeType = computed(() => {
  const t = types.value.find(t => t.key === activeProductId.value)
  return t ? t.product.target_type : ''
})

const activeTypeLabel = computed(() => {
  const t = types.value.find(t => t.key === activeProductId.value)
  return t ? t.label : '阅读'
})

const activeTypeDisabled = computed(() => {
  const t = types.value.find(t => t.key === activeProductId.value)
  return t ? !t.enabled : false
})

function selectType(key) {
  activeProductId.value = key
}

// ========== 批量输入 ==========
const batchText = ref('')

const parsedLines = computed(() => {
  const text = batchText.value.trim()
  if (!text) return []
  const lines = text.split('\n')
  return lines
    .map((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) return null
      const parts = trimmed.split(/[\s\t]+/)
      const url = parts[0] || ''
      const quantityStr = parts[1] || ''
      const quantity = parseInt(quantityStr, 10)
      const errors = []
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        errors.push('链接格式无效')
      }
      if (!quantityStr) {
        errors.push('缺少数量')
      } else if (isNaN(quantity) || quantity < 1) {
        errors.push('数量无效')
      } else if (quantity < minQuantity.value) {
        errors.push(`数量不能少于 ${minQuantity.value}`)
      }
      return {
        index: index + 1,
        raw: trimmed,
        url,
        quantity: isNaN(quantity) ? 0 : quantity,
        valid: errors.length === 0,
        error: errors.join('；')
      }
    })
    .filter(item => item !== null)
})

const validLines = computed(() => parsedLines.value.filter(l => l.valid))
const invalidLines = computed(() => parsedLines.value.filter(l => !l.valid))
const lineCount = computed(() => parsedLines.value.length)

// ========== 定价 & 余额（跟随当前选中商品） ==========
const activeProduct = computed(() => products.value.find(p => p.id === activeProductId.value) || null)
const unitPrice = computed(() => activeProduct.value ? parseFloat(activeProduct.value.resolved_price ?? activeProduct.value.unit_price) || 0.01 : 0.01)
const minQuantity = computed(() => activeProduct.value ? (activeProduct.value.min_quantity || 10) : 10)

const totalQuantity = computed(() => validLines.value.reduce((sum, l) => sum + l.quantity, 0))
const totalCost = computed(() => {
  const raw = validLines.value.reduce((sum, l) => sum + l.quantity * unitPrice.value, 0)
  return Math.round(raw * 10000) / 10000
})

// ========== 连接检测 ==========
const connectionOk = ref(false)
const connectionChecking = ref(false)

async function checkConnection() {
  connectionChecking.value = true
  try {
    const res = await fetch('/api/tasks/stats', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    connectionOk.value = data.code === 0
  } catch {
    connectionOk.value = false
  } finally {
    connectionChecking.value = false
  }
}

// ========== 获取上架商品 ==========
async function fetchProducts() {
  try {
    const res = await fetch('/api/products', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data.length > 0) {
      products.value = data.data
      // 如果 URL 指定了 type 且该商品上架中，则选中它
      const queryType = route.query.type
      const matchByType = queryType && data.data.find(p => p.target_type === queryType)
      if (matchByType) {
        activeProductId.value = matchByType.id
      } else {
        activeProductId.value = data.data[0].id
      }
    }
  } catch {
    // fallback
  }
}

// ========== 提交 ==========
const agreed = ref(false)
const submitting = ref(false)
const submitError = ref('')
const submitSuccess = ref('')

const canSubmit = computed(() => {
  return validLines.value.length > 0
    && agreed.value
    && connectionOk.value
    && balance.value >= totalCost.value
    && !submitting.value
    && !activeTypeDisabled.value
})

const submitBlockReason = computed(() => {
  if (activeTypeDisabled.value) return `${activeTypeLabel.value}下单功能已被系统关闭`
  if (validLines.value.length === 0) return '没有有效的输入行'
  if (!connectionOk.value) return '连接异常，请重新检测'
  if (!agreed.value) return '请先勾选确认公告'
  if (balance.value < totalCost.value) return '余额不足，请先充值'
  return ''
})

const balanceInsufficient = computed(() => totalCost.value > 0 && balance.value < totalCost.value)
let balanceNotified = false

watch(balanceInsufficient, (insufficient) => {
  if (insufficient && !balanceNotified) {
    balanceNotified = true
    const shortfall = (totalCost.value - balance.value).toFixed(2)
    ElNotification({
      title: '余额不足',
      message: `当前余额 ¥${balance.value.toFixed(2)}，预计扣费 ¥${totalCost.value.toFixed(2)}，还差 ¥${shortfall}，请先充值。`,
      type: 'warning',
      duration: 6000,
      position: 'top-right'
    })
  }
  if (!insufficient) balanceNotified = false
})

async function submitBatch() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  submitSuccess.value = ''
  try {
    const lines = validLines.value.map(l => ({
      url: l.url,
      quantity: l.quantity
    }))
    const res = await fetch('/api/batch/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        type: activeType.value,
        product_id: activeProductId.value,
        lines
      })
    })
    const data = await res.json()
    if (data.code === 0) {
      submitSuccess.value = `提交成功！批次号：${data.data?.batch_no || '-'}，共 ${lines.length} 条`
      batchText.value = ''
      agreed.value = false
      fetchBalance()
    } else {
      submitError.value = data.message || '提交失败，请重试'
    }
  } catch {
    submitError.value = '网络错误，请检查连接后重试'
  } finally {
    submitting.value = false
  }
}

// ========== 手动预校验 ==========
const prevalidating = ref(false)
const prevalidateResults = ref([])

async function prevalidate() {
  if (parsedLines.value.length === 0) return
  prevalidating.value = true
  prevalidateResults.value = []
  try {
    const urls = parsedLines.value.map(l => l.url)
    const res = await fetch('/api/batch/prevalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ urls })
    })
    const data = await res.json()
    if (data.code === 0 && data.data?.results) {
      prevalidateResults.value = data.data.results
    }
  } catch {
    // ignore
  } finally {
    prevalidating.value = false
  }
}

// ========== 填充示例 ==========
function fillExample() {
  const min = minQuantity.value || 100
  batchText.value = `https://xhslink.com/example1 ${min}\nhttps://xhslink.com/example2 ${min * 2}\nhttps://xhslink.com/example3 ${min}`
}

// ========== 删除问题链接 ==========
const removedLines = ref([])

// 合并格式错误 + 预校验不通过的链接
const allInvalidLines = computed(() => {
  // 1. 格式错误的行
  const formatBad = invalidLines.value
  // 2. 预校验不通过的 URL
  const pvBadUrls = new Set(
    prevalidateResults.value.filter(r => !r.valid).map(r => r.url)
  )
  // 3. 格式通过但预校验不通过的行
  const pvBad = pvBadUrls.size > 0
    ? parsedLines.value.filter(l => l.valid && pvBadUrls.has(l.url)).map(l => ({
        ...l,
        valid: false,
        error: prevalidateResults.value.find(r => r.url === l.url)?.message || '预校验不通过'
      }))
    : []
  return [...formatBad, ...pvBad]
})

function removeInvalidLines() {
  if (allInvalidLines.value.length === 0) return
  removedLines.value = [...allInvalidLines.value]
  const badUrls = new Set(allInvalidLines.value.map(l => l.url))
  const kept = parsedLines.value.filter(l => l.valid && !badUrls.has(l.url))
  batchText.value = kept.map(l => l.raw).join('\n')
  prevalidateResults.value = []
}

// ========== 清空 ==========
function clearInput() {
  batchText.value = ''
  prevalidateResults.value = []
  removedLines.value = []
  submitError.value = ''
  submitSuccess.value = ''
}

// ========== 批次数（展示用） ==========
const batchCount = ref(0)

async function fetchBatchCount() {
  try {
    const res = await fetch('/api/tasks/stats', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      batchCount.value = data.data?.total_batches || 0
    }
  } catch {
    // ignore
  }
}

// ========== 公告内容 ==========
const announcementText = ref('1. 请确保提交的链接为有效的小红书笔记链接，无效链接将被自动过滤。\n2. 每条链接的下单数量不得低于最低下单量，否则该行将被标记为无效。\n3. 提交后系统将自动处理订单，请勿重复提交相同链接。\n4. 如遇问题请联系客服处理，退款将在 1-3 个工作日内到账。')

// ========== 生命周期 ==========
onMounted(() => {
  checkConnection()
  fetchProducts()
  fetchBatchCount()
})
</script>

<template>
  <div class="batch-body">
    <!-- 主内容区 -->
    <main class="main-content">
      <!-- 连接状态卡片 -->
      <section class="card connection-card">
        <div class="connection-row">
          <div class="connection-info">
            <span class="connection-label">连接检测</span>
            <span class="connection-sep">&mdash;</span>
            <span :class="['connection-status', connectionOk ? 'ok' : 'fail']">
              <span class="conn-dot"></span>
              {{ connectionChecking ? '检测中...' : connectionOk ? '连接正常' : '连接异常' }}
            </span>
          </div>
          <button type="button" class="btn btn-outline btn-sm" @click="checkConnection" :disabled="connectionChecking">
            重新检测
          </button>
        </div>
      </section>

      <!-- 批量内容输入卡片 -->
      <section class="card input-card">
        <h2 class="card-heading">批量内容输入</h2>

        <!-- 类型标签 -->
        <div class="type-tabs">
          <button
            v-for="t in types"
            :key="t.key"
            type="button"
            :class="['type-tab', { active: activeProductId === t.key }]"
            @click="selectType(t.key)"
          >
            {{ t.label }}
            <span v-if="!t.enabled" class="red-dot"></span>
          </button>
        </div>

        <!-- 类型被关闭的警告 -->
        <div v-if="activeTypeDisabled" class="type-disabled-alert">
          <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <span>{{ activeTypeLabel }}下单功能已被系统全局关闭，所有用户均无法提交{{ activeTypeLabel }}订单。</span>
        </div>

        <!-- 格式说明 -->
        <p class="format-hint">格式：链接 + 数量，支持空格或 Tab 分隔。</p>

        <!-- 输入标签 -->
        <div class="textarea-label">
          <span>批量内容（{{ activeTypeLabel }}）</span>
          <span class="line-count">已输入 {{ lineCount }} 行</span>
        </div>

        <!-- 文本域 -->
        <textarea
          v-model="batchText"
          class="batch-textarea"
          :placeholder="`示例：https://xhslink.com/xxxxxx ${minQuantity}（仅${activeTypeLabel}下单）`"
          spellcheck="false"
        ></textarea>

        <!-- 预校验结果 -->
        <div v-if="prevalidateResults.length > 0" class="prevalidate-results">
          <h3>预校验结果（{{ prevalidateResults.filter(r => r.valid).length }}/{{ prevalidateResults.length }} 通过）</h3>
          <ul>
            <li v-for="(r, i) in prevalidateResults" :key="i" :class="r.valid ? 'valid' : 'invalid'">
              <img v-if="r.valid && r.avatar_url" class="pv-avatar" :src="r.avatar_url" alt="" />
              <span v-else class="pv-dot"></span>
              <div class="pv-body">
                <span class="pv-url">{{ r.url }}</span>
                <span v-if="r.valid && r.title" class="pv-info">{{ r.title }}<template v-if="r.author_name"> · {{ r.author_name }}</template></span>
              </div>
              <span class="pv-msg">{{ r.valid ? '通过' : (r.message || '无效') }}</span>
            </li>
          </ul>
        </div>

        <!-- 删除记录 -->
        <div v-if="removedLines.length > 0" class="removed-lines">
          <h3>已删除的问题链接（{{ removedLines.length }} 条）</h3>
          <ul>
            <li v-for="(r, i) in removedLines" :key="i">
              <span class="removed-url">{{ r.url }}</span>
              <span class="removed-reason">{{ r.error }}</span>
            </li>
          </ul>
        </div>

        <!-- 提交错误/成功消息 -->
        <p v-if="submitError" class="msg msg-error">{{ submitError }}</p>
        <p v-if="submitSuccess" class="msg msg-success">{{ submitSuccess }}</p>

        <!-- 操作按钮 -->
        <div class="action-row">
          <button type="button" class="btn btn-outline" @click="prevalidate" :disabled="prevalidating || lineCount === 0">
            {{ prevalidating ? '校验中...' : '手动预校验' }}
          </button>
          <button type="button" class="btn btn-outline" @click="fillExample">填充示例</button>
          <button type="button" class="btn btn-outline" @click="removeInvalidLines" :disabled="allInvalidLines.length === 0">
            一键删除问题链接并记录
          </button>
          <button type="button" class="btn btn-outline" @click="router.push('/records')">
            下单记录<span v-if="batchCount > 0" class="badge">{{ batchCount }}</span>
          </button>
          <button type="button" class="btn btn-outline" @click="clearInput">清空</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!canSubmit"
            @click="submitBatch"
          >
            {{ submitting ? '提交中...' : `确认提交${activeTypeLabel}` }}
          </button>
        </div>
      </section>

      <!-- 公告区域 -->
      <section class="card notice-card">
        <div class="notice-box">
          <div class="notice-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </div>
          <div class="notice-text">
            <p v-for="(line, i) in announcementText.split('\n')" :key="i">{{ line }}</p>
          </div>
        </div>
        <label class="agree-check">
          <input type="checkbox" v-model="agreed" />
          <span class="checkmark"></span>
          <span>我已阅读并确认上述公告内容</span>
        </label>
        <div :class="['submit-status', canSubmit ? 'ready' : 'blocked']">
          <span class="status-indicator"></span>
          {{ canSubmit ? '可以提交' : ('当前不可提交' + (submitBlockReason ? '：' + submitBlockReason : '')) }}
        </div>
      </section>
    </main>

    <!-- 右侧结算栏 -->
    <aside class="right-sidebar">
      <section class="card settle-card">
        <h2 class="card-heading">结算与余额</h2>

        <div class="settle-grid">
          <div class="settle-item accent">
            <span class="settle-label">预计扣费</span>
            <strong class="settle-value cost">¥{{ totalCost.toFixed(2) }}</strong>
          </div>
          <div class="settle-item">
            <span class="settle-label">总数</span>
            <strong class="settle-value">{{ totalQuantity }}</strong>
          </div>
        </div>

        <div class="settle-grid">
          <div class="settle-item valid">
            <span class="settle-label">有效行</span>
            <strong class="settle-value">{{ validLines.length }}</strong>
          </div>
          <div class="settle-item invalid">
            <span class="settle-label">失败行</span>
            <strong class="settle-value">{{ allInvalidLines.length }}</strong>
          </div>
        </div>

        <div class="settle-grid">
          <div class="settle-item">
            <span class="settle-label">可用余额</span>
            <strong class="settle-value balance-val">¥{{ balance.toFixed(2) }}</strong>
          </div>
          <div class="settle-item">
            <span class="settle-label">单价</span>
            <strong class="settle-value">¥{{ unitPrice.toFixed(4) }}</strong>
          </div>
        </div>

        <div class="settle-connection">
          <span class="settle-label">连接状态</span>
          <span :class="['conn-indicator', connectionOk ? 'ok' : 'fail']">
            <span class="conn-dot-sm"></span>
            {{ connectionOk ? '正常' : '异常' }}
          </span>
        </div>

        <!-- 余额不足提示 -->
        <div v-if="totalCost > 0 && balance < totalCost" class="settle-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          余额不足，请先充值
        </div>

        <!-- 解析详情 -->
        <div v-if="parsedLines.length > 0" class="parsed-detail">
          <h3>解析详情</h3>
          <ul class="parsed-list">
            <li v-for="line in parsedLines" :key="line.index" :class="line.valid ? 'ok' : 'err'">
              <span class="parsed-idx">#{{ line.index }}</span>
              <span class="parsed-url" :title="line.url">{{ line.url.length > 28 ? line.url.slice(0, 28) + '...' : line.url }}</span>
              <span v-if="line.valid" class="parsed-qty">{{ line.quantity }}</span>
              <span v-else class="parsed-err">{{ line.error }}</span>
            </li>
          </ul>
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
/* ========== 三栏布局 ========== */
.batch-body {
  display: flex;
  flex: 1;
  padding: 18px 16px 28px;
  gap: 18px;
  min-height: 0;
}

/* ========== 主内容区 ========== */
.main-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ========== 通用卡片 ========== */
.card {
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 26px rgba(21, 32, 51, 0.06);
  padding: 20px 22px;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.card:hover { box-shadow: 0 12px 30px rgba(21, 32, 51, 0.09); }

.card-heading {
  font-size: 17px;
  font-weight: 800;
  color: #152033;
  margin-bottom: 16px;
}

/* ========== 连接状态卡片 ========== */
.connection-card { padding: 14px 20px; }

.connection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.connection-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.connection-label { font-weight: 700; color: #425066; }
.connection-sep { color: #9aa5b5; }

.connection-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.connection-status.ok { color: #42c978; }
.connection-status.fail { color: #ff4d4f; }

.conn-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.connection-status.ok .conn-dot { background: #42c978; box-shadow: 0 0 8px rgba(66, 201, 120, 0.5); }
.connection-status.fail .conn-dot { background: #ff4d4f; box-shadow: 0 0 8px rgba(255, 77, 79, 0.5); }

/* ========== 按钮 ========== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 12px; }

.btn-outline {
  background: #fff;
  color: #425066;
  border: 1px solid #e8edf4;
}

.btn-outline:hover:not(:disabled) {
  border-color: #c4b8fd;
  background: #f9f7ff;
  color: #8b7bf7;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(139, 123, 247, 0.1);
}

.btn-outline:active:not(:disabled) { transform: scale(0.97); }

.btn-primary {
  background: linear-gradient(135deg, #ee4d7a 0%, #8b7bf7 52%, #5b8def 100%);
  color: #fff;
  box-shadow: 0 6px 18px rgba(139, 123, 247, 0.22);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(139, 123, 247, 0.32);
  filter: saturate(1.08);
}

.btn-primary:active:not(:disabled) { transform: scale(0.97); }

/* ========== 类型标签 ========== */
.type-tabs { display: flex; gap: 8px; margin-bottom: 14px; }

.type-tab {
  position: relative;
  padding: 7px 20px;
  border-radius: 999px;
  border: 1px solid #e8edf4;
  background: #fff;
  color: #647184;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.type-tab:hover:not(.disabled) { border-color: #c4b8fd; color: #8b7bf7; background: #f9f7ff; }

.type-tab.active {
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 14px rgba(139, 123, 247, 0.25);
}

.red-dot {
  position: absolute;
  top: 6px; right: 8px;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #ff4d4f;
}

.type-tab.active .red-dot { background: #fff; }

/* ========== 类型关闭警告 ========== */
.type-disabled-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #cf1322;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
  margin-bottom: 14px;
}

.type-disabled-alert .alert-icon {
  width: 20px; height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  color: #ff4d4f;
}

/* ========== 文本域 ========== */
.format-hint { font-size: 13px; color: #9aa5b5; margin-bottom: 10px; }

.textarea-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #425066;
}

.line-count { font-weight: 600; color: #8b7bf7; }

.batch-textarea {
  width: 100%;
  min-height: 200px;
  max-height: 440px;
  padding: 14px 16px;
  border: 2px solid #e8edf4;
  border-radius: 8px;
  font-size: 14px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  line-height: 1.7;
  color: #152033;
  background: #fafbfd;
  resize: vertical;
  outline: none;
  transition: border-color 240ms ease, box-shadow 240ms ease, background 240ms ease;
}

.batch-textarea:focus {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 4px rgba(139, 123, 247, 0.12);
  background: #fff;
}

.batch-textarea::placeholder { color: #c0c8d4; }

/* ========== 操作按钮行 ========== */
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
  align-items: center;
}

.action-row .btn-primary { margin-left: auto; }

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ee4d7a;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  margin-left: 4px;
}

/* ========== 预校验结果 ========== */
.prevalidate-results,
.removed-lines {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f6f8fc;
  border: 1px solid #e8edf4;
}

.prevalidate-results h3,
.removed-lines h3 {
  font-size: 13px;
  font-weight: 700;
  color: #425066;
  margin-bottom: 10px;
}

.prevalidate-results ul,
.removed-lines ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.prevalidate-results li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pv-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  align-self: flex-start;
  margin-top: 2px;
  border: 1px solid #e8edf4;
}

.pv-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; align-self: flex-start; margin-top: 7px; }
.prevalidate-results li.valid .pv-dot { background: #42c978; }
.prevalidate-results li.invalid .pv-dot { background: #ff4d4f; }

.pv-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pv-url {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #425066;
}

.pv-info {
  font-size: 12px;
  color: #9aa5b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-msg { flex-shrink: 0; font-weight: 600; align-self: flex-start; margin-top: 2px; }
.prevalidate-results li.valid .pv-msg { color: #42c978; }
.prevalidate-results li.invalid .pv-msg { color: #ff4d4f; }

.removed-lines li {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #647184;
}

.removed-url {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.removed-reason { flex-shrink: 0; color: #ff4d4f; font-size: 12px; }

/* ========== 消息提示 ========== */
.msg {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}

.msg-error { background: #fff1f0; color: #ff4d4f; border: 1px solid #ffccc7; }
.msg-success { background: #f0fff4; color: #42c978; border: 1px solid #b7ebc9; }

/* ========== 公告区域 ========== */
.notice-card { padding: 18px 22px; }

.notice-box {
  display: flex; gap: 12px;
  padding: 14px 16px;
  border-radius: 8px;
  background: #fef9f0;
  border: 1px solid #fde8c8;
  margin-bottom: 14px;
}

.notice-icon { flex-shrink: 0; margin-top: 2px; color: #f5a623; }
.notice-text { flex: 1; }
.notice-text p { font-size: 13px; color: #425066; line-height: 1.8; }

/* ========== 复选框 ========== */
.agree-check {
  display: flex; align-items: center; gap: 8px;
  cursor: pointer; user-select: none;
  font-size: 14px; color: #425066; font-weight: 600;
  margin-bottom: 12px;
}

.agree-check input[type="checkbox"] { display: none; }

.checkmark {
  width: 18px; height: 18px;
  border-radius: 4px;
  border: 2px solid #d0d7e2;
  background: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: all 160ms ease;
}

.agree-check input:checked + .checkmark {
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  border-color: transparent;
}

.agree-check input:checked + .checkmark::after {
  content: '';
  width: 10px; height: 6px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg);
  margin-top: -2px;
}

/* ========== 提交状态 ========== */
.submit-status {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700;
  padding: 8px 12px; border-radius: 6px;
}

.submit-status.ready { background: #f0fff4; color: #42c978; }
.submit-status.blocked { background: #fff7e6; color: #f5a623; }

.status-indicator { width: 8px; height: 8px; border-radius: 50%; }
.submit-status.ready .status-indicator { background: #42c978; box-shadow: 0 0 8px rgba(66, 201, 120, 0.5); }
.submit-status.blocked .status-indicator { background: #f5a623; box-shadow: 0 0 8px rgba(245, 166, 35, 0.4); }

/* ========== 右侧结算栏 ========== */
.right-sidebar {
  width: 300px;
  flex-shrink: 0;
  position: sticky;
  top: 90px;
  align-self: flex-start;
  max-height: calc(100vh - 110px);
  overflow-y: auto;
}

.settle-card { padding: 20px; }

.settle-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.settle-item {
  padding: 12px;
  border-radius: 8px;
  background: #f9fafc;
  text-align: center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.settle-item:hover { transform: translateY(-1px); }
.settle-item.accent { background: linear-gradient(135deg, #fff3f7, #fef0f6); }
.settle-item.valid { background: #f0fff4; }
.settle-item.invalid { background: #fff1f0; }

.settle-label { display: block; font-size: 12px; color: #9aa5b5; margin-bottom: 4px; }
.settle-value { display: block; font-size: 18px; color: #152033; line-height: 1.3; }
.settle-value.cost { color: #ee4d7a; }
.settle-value.balance-val { color: #8b7bf7; }

.settle-connection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f9fafc;
  margin-bottom: 14px;
}

.conn-indicator {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; font-weight: 700;
}

.conn-indicator.ok { color: #42c978; }
.conn-indicator.fail { color: #ff4d4f; }

.conn-dot-sm { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.conn-indicator.ok .conn-dot-sm { background: #42c978; box-shadow: 0 0 6px rgba(66, 201, 120, 0.5); }
.conn-indicator.fail .conn-dot-sm { background: #ff4d4f; box-shadow: 0 0 6px rgba(255, 77, 79, 0.5); }

/* ========== 余额不足警告 ========== */
.settle-warning {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px; border-radius: 6px;
  background: #fff1f0; color: #ff4d4f;
  font-size: 13px; font-weight: 700;
  margin-bottom: 14px;
  border: 1px solid #ffccc7;
}

/* ========== 解析详情 ========== */
.parsed-detail {
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid #e8edf4;
}

.parsed-detail h3 { font-size: 13px; font-weight: 700; color: #425066; margin-bottom: 10px; }

.parsed-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.parsed-list li {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 6px 8px; border-radius: 6px;
  transition: background 160ms ease;
}

.parsed-list li.ok { background: #f8fcf9; }
.parsed-list li.err { background: #fffaf9; }
.parsed-list li:hover { background: #f0f2f5; }

.parsed-idx { flex-shrink: 0; width: 28px; color: #9aa5b5; font-weight: 700; }

.parsed-url {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #425066;
}

.parsed-qty { flex-shrink: 0; font-weight: 800; color: #42c978; }
.parsed-err { flex-shrink: 0; font-weight: 600; color: #ff4d4f; font-size: 11px; }

/* ========== 响应式 ========== */

@media (max-width: 1100px) {
  .right-sidebar { width: 260px; }
}

@media (max-width: 960px) {
  .right-sidebar { width: 240px; }
}

@media (max-width: 768px) {
  .right-sidebar { display: none; }

  .batch-body {
    padding: 12px;
    flex-direction: column;
  }

  .main-content { gap: 14px; }
  .card { padding: 16px; }
  .type-tabs { flex-wrap: wrap; }
  .action-row { gap: 8px; }

  .action-row .btn { font-size: 12px; padding: 7px 12px; }

  .action-row .btn-primary {
    margin-left: 0;
    width: 100%;
    margin-top: 4px;
  }
}
</style>
