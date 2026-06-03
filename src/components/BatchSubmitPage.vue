<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElNotification } from 'element-plus'
import 'element-plus/es/components/notification/style/css'
import { canSubmitBatch, getBatchInputSignature, isBatchPrevalidationPassed } from '../utils/batchSubmitGate.js'
import { getBatchProblemLines, removeBatchProblemLines } from '../utils/batchProblemLines.js'

const route = useRoute()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { balance, getToken, fetchBalance } = ws

// ========== 商品 / 类型 / 数据源 ==========
const products = ref([])

const DATA_SOURCE_LABELS = { realtime: '实时数据', pgy: '蒲公英数据' }
const DATA_SOURCE_DESC = {
  realtime: '常规实时同步快照',
  pgy: '蒲公英平台快照 · 支持全部分类'
}
const DATA_SOURCE_ORDER = ['realtime', 'pgy']

// 商品支持的数据源由商品配置 data_source 决定：realtime / pgy / both
function productSources(p) {
  const ds = p?.data_source
  if (ds === 'both') return ['realtime', 'pgy']
  if (ds === 'pgy') return ['pgy']
  return ['realtime']
}

// 按 target_type 分组：每个类型取代表商品（决定单价/最低量/派单 + 可选数据源）
const groupedTypes = computed(() => {
  const map = new Map()
  for (const p of products.value) {
    const key = p.target_type
    if (!map.has(key)) map.set(key, { target_type: key, products: [] })
    map.get(key).products.push(p)
  }
  return [...map.values()].map(g => {
    const rep = g.products[0]
    const sources = productSources(rep)
    return { ...g, label: rep.name, product: rep, sources, defaultSource: sources[0] }
  })
})

const activeTargetType = ref(null)
const activeDataSource = ref('realtime')

const activeGroup = computed(() => groupedTypes.value.find(g => g.target_type === activeTargetType.value) || null)

// 当前类型支持的数据源（按商品配置）
const availableSources = computed(() => activeGroup.value?.sources || ['realtime'])
function sourceAvailable(src) { return availableSources.value.includes(src) }

const activeProduct = computed(() => activeGroup.value?.product || null)
const activeProductId = computed(() => activeProduct.value?.id ?? null)
const activeType = computed(() => activeProduct.value?.target_type || '')
const activeTypeLabel = computed(() => activeGroup.value?.label || '阅读')
const activeTypeDisabled = computed(() => false)
const activeDataSourceLabel = computed(() => DATA_SOURCE_LABELS[activeDataSource.value] || '实时数据')

function selectType(targetType) {
  activeTargetType.value = targetType
  // 若当前数据源在新类型下不支持，切换到该类型的默认数据源
  const g = groupedTypes.value.find(x => x.target_type === targetType)
  if (g && !g.sources.includes(activeDataSource.value)) {
    activeDataSource.value = g.defaultSource
  }
}
function selectDataSource(src) {
  if (sourceAvailable(src)) activeDataSource.value = src
}

// ========== 分步向导 ==========
const currentStep = ref(1)
const STEPS = [
  { no: 1, title: '选择类型', desc: '类型与数据源' },
  { no: 2, title: '输入内容', desc: '链接、数量与预校验' },
  { no: 3, title: '确认下单', desc: '结算与余额' }
]

const canGoStep2 = computed(() => !!activeProduct.value && !activeTypeDisabled.value)

const stepperProgress = computed(() => {
  if (currentStep.value <= 1) return '0%'
  if (currentStep.value === 2) return '50%'
  return '100%'
})

function goStep(n) {
  if (n === currentStep.value) return
  // 往回走总是允许
  if (n < currentStep.value) { currentStep.value = n; return }
  // 往前走需逐级通过闸门
  if (n >= 2 && !canGoStep2.value) return
  if (n >= 3 && !prevalidationPassed.value) return
  currentStep.value = n
  if (n === 3) fetchBalance()
}
function nextStep() { goStep(currentStep.value + 1) }
function prevStep() { goStep(currentStep.value - 1) }

// ========== 批量输入 ==========
const inputMode = ref('single')
const batchText = ref('')
const singleUrl = ref('')
const singleQuantity = ref('')

function parseContentLine(raw, lineIndex, minQty) {
  const trimmed = raw.trim()
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
  } else if (quantity < minQty) {
    errors.push(`数量不能少于 ${minQty}`)
  }
  return {
    index: lineIndex,
    raw: trimmed,
    url,
    quantity: isNaN(quantity) ? 0 : quantity,
    valid: errors.length === 0,
    error: errors.join('；')
  }
}

const parsedLines = computed(() => {
  const minQty = minQuantity.value
  if (inputMode.value === 'single') {
    const url = singleUrl.value.trim()
    const qty = String(singleQuantity.value ?? '').trim()
    if (!url && !qty) return []
    const raw = qty ? `${url} ${qty}` : url
    const item = parseContentLine(raw, 1, minQty)
    return item ? [item] : []
  }
  const text = batchText.value.trim()
  if (!text) return []
  return text.split('\n')
    .map((line, index) => parseContentLine(line, index + 1, minQty))
    .filter(item => item !== null)
})

const validLines = computed(() => parsedLines.value.filter(l => l.valid))
const invalidLines = computed(() => parsedLines.value.filter(l => !l.valid))
const lineCount = computed(() => parsedLines.value.length)
const currentInputSignature = computed(() => getBatchInputSignature(parsedLines.value))

// ========== 定价 & 余额（跟随当前选中商品） ==========
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
      const queryType = route.query.type
      const groups = groupedTypes.value
      const matchGroup = (queryType && groups.find(g => g.target_type === queryType)) || groups[0]
      if (matchGroup) {
        activeTargetType.value = matchGroup.target_type
        activeDataSource.value = matchGroup.defaultSource
      }
    }
  } catch {
    // fallback
  }
}

// ========== 提交 ==========
const agreed = ref(false)
const submitting = ref(false)
const prevalidating = ref(false)
const prevalidateResults = ref([])
const prevalidateSignature = ref('')

const prevalidationPassed = computed(() => isBatchPrevalidationPassed({
  parsedLines: parsedLines.value,
  validLines: validLines.value,
  prevalidateResults: prevalidateResults.value,
  prevalidateSignature: prevalidateSignature.value,
  currentSignature: currentInputSignature.value
}))

const canSubmit = computed(() => {
  return canSubmitBatch({
    parsedLines: parsedLines.value,
    validLines: validLines.value,
    prevalidateResults: prevalidateResults.value,
    prevalidateSignature: prevalidateSignature.value,
    currentSignature: currentInputSignature.value,
    agreed: agreed.value,
    connectionOk: connectionOk.value,
    balance: balance.value,
    totalCost: totalCost.value,
    submitting: submitting.value,
    activeTypeDisabled: activeTypeDisabled.value
  })
})

const submitBlockReason = computed(() => {
  if (activeTypeDisabled.value) return `${activeTypeLabel.value}下单功能已被系统关闭`
  if (parsedLines.value.length === 0) return '没有输入内容'
  if (validLines.value.length === 0) return '没有有效的输入行'
  if (validLines.value.length !== parsedLines.value.length) return '存在格式或数量错误，请修正后重新校验'
  if (prevalidating.value) return '正在预校验'
  if (!prevalidateSignature.value || prevalidateSignature.value !== currentInputSignature.value) return '请先完成预校验'
  if (!prevalidationPassed.value) return '预校验未全部通过'
  if (!connectionOk.value) return '连接异常，请重新检测'
  if (!agreed.value) return '请先勾选确认公告'
  if (balance.value < totalCost.value) return '余额不足，请先充值'
  return ''
})

// 第二步「下一步」闸门提示
const step2BlockReason = computed(() => {
  if (parsedLines.value.length === 0) return '请先输入链接和数量'
  if (validLines.value.length === 0) return '没有有效的输入行'
  if (validLines.value.length !== parsedLines.value.length) return '存在格式或数量错误，请修正后重试'
  return ''
})

const canTryStep3 = computed(() => {
  if (prevalidating.value) return false
  if (parsedLines.value.length === 0) return false
  if (validLines.value.length !== parsedLines.value.length) return false
  return true
})

async function handleStep2Next() {
  if (!canTryStep3.value) return
  if (!prevalidationPassed.value) {
    await prevalidate()
  }
  if (!prevalidationPassed.value) {
    const failed = prevalidateResults.value.filter(r => !r.valid).length
    ElNotification({
      title: '预校验未通过',
      message: failed > 0
        ? `${failed} 条链接未通过，请查看预校验结果并修正后重试`
        : '预校验未通过，请修正后重试',
      type: 'warning',
      duration: 5000
    })
    return
  }
  goStep(3)
}

const balanceInsufficient = computed(() => totalCost.value > 0 && balance.value < totalCost.value)
function showBalanceNotification() {
  if (!balanceInsufficient.value) return
  const shortfall = (totalCost.value - balance.value).toFixed(2)
  ElNotification({
    title: '余额不足',
    message: `当前余额 ¥${balance.value.toFixed(2)}，预计扣费 ¥${totalCost.value.toFixed(2)}，还差 ¥${shortfall}，请先充值。`,
    type: 'warning',
    duration: 6000,
    position: 'top-right'
  })
}

async function submitBatch() {
  if (!canSubmit.value) return
  submitting.value = true
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
        data_source: activeDataSource.value,
        lines
      })
    })
    const data = await res.json()
    if (data.code === 0) {
      ElNotification({
        title: '提交成功',
        message: `批次号：${data.data?.batch_no || '-'}，共 ${lines.length} 条订单已提交。\n请保存好批次号，可到「查询订单」页面输入批次号查询进度。`,
        type: 'success',
        duration: 8000
      })
      batchText.value = ''
      singleUrl.value = ''
      singleQuantity.value = ''
      agreed.value = false
      prevalidateResults.value = []
      prevalidateSignature.value = ''
      removedLines.value = []
      currentStep.value = 1
      fetchBalance()
    } else {
      ElNotification({ title: '提交失败', message: data.message || '提交失败，请重试', type: 'error', duration: 5000 })
    }
  } catch {
    ElNotification({ title: '提交失败', message: '网络错误，请检查连接后重试', type: 'error', duration: 5000 })
  } finally {
    submitting.value = false
  }
}

async function prevalidate() {
  if (parsedLines.value.length === 0) return
  prevalidating.value = true
  prevalidateResults.value = []
  prevalidateSignature.value = ''
  try {
    await fetchBalance()
    const urls = parsedLines.value.map(l => l.url)
    const res = await fetch('/api/batch/prevalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ urls, type: activeType.value })
    })
    const data = await res.json()
    if (data.code === 0 && data.data?.results) {
      prevalidateResults.value = data.data.results
      prevalidateSignature.value = currentInputSignature.value
    } else {
      ElNotification({
        title: '预校验失败',
        message: data.message || '预校验请求失败，请稍后重试',
        type: 'error',
        duration: 5000
      })
    }
    showBalanceNotification()
  } catch {
    ElNotification({
      title: '预校验失败',
      message: '网络错误，请检查连接后重试',
      type: 'error',
      duration: 5000
    })
  } finally {
    prevalidating.value = false
  }
}

// ========== 填充示例 ==========
function fillExample() {
  const min = minQuantity.value || 100
  if (inputMode.value === 'single') {
    singleUrl.value = 'https://xhslink.com/example1'
    singleQuantity.value = String(min)
    return
  }
  batchText.value = `https://xhslink.com/example1 ${min}\nhttps://xhslink.com/example2 ${min * 2}\nhttps://xhslink.com/example3 ${min}`
}

// ========== 删除问题链接 ==========
const removedLines = ref([])
const duplicateCopySuccess = ref(false)
const duplicateRemovedLines = computed(() =>
  removedLines.value.filter(line => (line.error || '').includes('重复'))
)

const allInvalidLines = computed(() => {
  return getBatchProblemLines({
    parsedLines: parsedLines.value,
    invalidLines: invalidLines.value,
    prevalidateResults: prevalidateResults.value
  })
})

function removeInvalidLines() {
  if (allInvalidLines.value.length === 0) return
  removedLines.value = [...allInvalidLines.value]
  duplicateCopySuccess.value = false
  if (inputMode.value === 'single') {
    singleUrl.value = ''
    singleQuantity.value = ''
  } else {
    batchText.value = removeBatchProblemLines({
      parsedLines: parsedLines.value,
      problemLines: allInvalidLines.value
    })
  }
  prevalidateResults.value = []
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    return true
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

async function copyDuplicateRemovedLines() {
  const text = duplicateRemovedLines.value
    .map(line => line.raw || `${line.url} ${line.quantity || ''}`.trim())
    .join('\n')
  if (!text) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      fallbackCopyText(text)
    }
    duplicateCopySuccess.value = true
    setTimeout(() => { duplicateCopySuccess.value = false }, 1800)
  } catch {
    fallbackCopyText(text)
    duplicateCopySuccess.value = true
    setTimeout(() => { duplicateCopySuccess.value = false }, 1800)
  }
}

// ========== 清空 ==========
function clearInput() {
  batchText.value = ''
  singleUrl.value = ''
  singleQuantity.value = ''
  prevalidateResults.value = []
  prevalidateSignature.value = ''
  removedLines.value = []
  duplicateCopySuccess.value = false
}

watch([batchText, singleUrl, singleQuantity, activeProductId, inputMode], () => {
  prevalidateResults.value = []
  prevalidateSignature.value = ''
})

// ========== 公告内容 ==========
const announcementText = ref('1. 请确保提交的链接为有效的小红书笔记链接，无效链接将被自动过滤。\n2. 每条链接的下单数量不得低于最低下单量，否则该行将被标记为无效。\n3. 提交后系统将自动处理订单，请勿重复提交相同链接。\n4. 如遇问题请联系客服处理，退款将在 1-3 个工作日内到账。')

// ========== 生命周期 ==========
onMounted(() => {
  checkConnection()
  fetchProducts()
})
</script>

<template>
  <div class="batch-wizard">
    <!-- 页面头部 -->
    <header class="page-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-content">
        <div class="hero-text">
          <span class="hero-badge">批量下单向导</span>
          <h1 class="hero-title">快速提交订单</h1>
          <p class="hero-desc">三步完成类型选择、内容校验与结算确认，支持批量链接一次性提交。</p>
        </div>
        <div :class="['connection-pill', connectionOk ? 'is-ok' : 'is-fail']">
          <span class="conn-indicator">
            <span class="conn-dot"></span>
            <span class="conn-ring"></span>
          </span>
          <div class="conn-text">
            <strong>{{ connectionChecking ? '检测中' : connectionOk ? '服务连接正常' : '连接异常' }}</strong>
            <small>API 网关状态</small>
          </div>
          <button type="button" class="conn-refresh" @click="checkConnection" :disabled="connectionChecking" title="重新检测">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- 步骤指示器 -->
    <nav class="stepper card" :style="{ '--stepper-progress': stepperProgress }">
      <div class="stepper-rail" aria-hidden="true"></div>
      <button v-for="s in STEPS" :key="s.no" type="button" class="step"
        :class="{ active: currentStep === s.no, done: currentStep > s.no, clickable: s.no < currentStep || (s.no === 2 && canGoStep2) || (s.no === 3 && prevalidationPassed) }"
        @click="goStep(s.no)">
        <span class="step-index">
          <svg v-if="currentStep > s.no" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <template v-else>{{ s.no }}</template>
        </span>
        <span class="step-text">
          <strong>{{ s.title }}</strong>
          <small>{{ s.desc }}</small>
        </span>
      </button>
    </nav>

    <!-- ============ 第 1 步：选择类型与数据源 ============ -->
    <section v-show="currentStep === 1" class="card step-card step-enter">
      <header class="step-head">
        <span class="step-kicker">第 1 步</span>
        <h2 class="card-heading">选择下单类型</h2>
        <p class="step-tip">先选择要购买的服务类型，再选择数据来源平台。</p>
      </header>

      <!-- 类型 -->
      <div class="field-block">
        <div class="field-label">
          <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          服务类型
        </div>
        <div class="type-tabs">
          <button v-for="g in groupedTypes" :key="g.target_type" type="button"
            :class="['type-tab', { active: activeTargetType === g.target_type }]" @click="selectType(g.target_type)">
            {{ g.label }}
          </button>
        </div>
      </div>

      <!-- 数据源 -->
      <div class="field-block">
        <div class="field-label">
          <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          数据源
        </div>
        <div class="source-cards">
          <button v-for="src in DATA_SOURCE_ORDER" :key="src" type="button" class="source-card"
            :class="{ active: activeDataSource === src, disabled: !sourceAvailable(src) }"
            :disabled="!sourceAvailable(src)" @click="selectDataSource(src)">
            <span class="source-icon" :class="src">
              <svg v-if="src === 'realtime'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </span>
            <span class="source-body">
              <strong>{{ DATA_SOURCE_LABELS[src] }}</strong>
              <small>{{ sourceAvailable(src) ? DATA_SOURCE_DESC[src] : '该商品未开放此数据源' }}</small>
            </span>
            <span class="source-radio"></span>
          </button>
        </div>
      </div>

      <!-- 选择摘要 -->
      <div v-if="activeProduct" class="choice-summary">
        <div class="cs-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          当前选择
        </div>
        <div class="cs-grid">
          <div class="cs-item">
            <span class="cs-label">已选服务</span>
            <strong>{{ activeTypeLabel }}</strong>
          </div>
          <div class="cs-item">
            <span class="cs-label">数据源</span>
            <strong>{{ activeDataSourceLabel }}</strong>
          </div>
          <div class="cs-item highlight">
            <span class="cs-label">单价</span>
            <strong class="cs-price">¥{{ unitPrice.toFixed(4) }}</strong>
          </div>
          <div class="cs-item">
            <span class="cs-label">最低下单量</span>
            <strong>{{ minQuantity }}</strong>
          </div>
        </div>
      </div>

      <div class="step-actions">
        <span></span>
        <button type="button" class="btn btn-primary" :disabled="!canGoStep2" @click="nextStep">
          下一步：输入内容
        </button>
      </div>
    </section>

    <!-- ============ 第 2 步：输入链接和数量 ============ -->
    <section v-show="currentStep === 2" class="card step-card step-enter">
      <header class="step-head step-head--split">
        <div class="step-head-main">
          <span class="step-kicker">第 2 步</span>
          <h2 class="card-heading">输入链接与数量</h2>
          <p class="step-tip">
            <span class="inline-badge">{{ activeTypeLabel }}</span>
            <span class="inline-badge alt">{{ activeDataSourceLabel }}</span>
            <template v-if="inputMode === 'batch'">格式：链接 + 数量，支持空格或 Tab 分隔。</template>
            <template v-else>单条提交：分别填写链接与数量。</template>
          </p>
        </div>
        <div class="input-mode-toggle" role="tablist" aria-label="输入模式">
          <button
            type="button"
            role="tab"
            :class="{ active: inputMode === 'single' }"
            :aria-selected="inputMode === 'single'"
            @click="inputMode = 'single'"
          >单条</button>
          <button
            type="button"
            role="tab"
            :class="{ active: inputMode === 'batch' }"
            :aria-selected="inputMode === 'batch'"
            @click="inputMode = 'batch'"
          >批量</button>
        </div>
      </header>

      <div class="format-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <p class="format-hint-text">
          <template v-if="inputMode === 'batch'">
            每行一条：<code>链接</code> + 空格/Tab + <code>数量</code>，数量不低于 {{ minQuantity }}
          </template>
          <template v-else>
            填写一条笔记链接与下单数量，数量不低于 {{ minQuantity }}
          </template>
        </p>
      </div>

      <div v-if="inputMode === 'batch'" class="editor-panel">
        <div class="textarea-label">
          <span class="textarea-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            批量内容
          </span>
          <span class="line-count"><span class="lc-num">{{ lineCount }}</span> 行<span class="lc-sep">·</span>最低 {{ minQuantity }}</span>
        </div>
        <textarea v-model="batchText" class="batch-textarea"
          :placeholder="`示例：https://xhslink.com/xxxxxx ${minQuantity}（${activeTypeLabel}）`"
          spellcheck="false"></textarea>
      </div>

      <div v-else class="editor-panel single-panel">
        <div class="textarea-label">
          <span class="textarea-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 1 0-7l1.4-1.4a5 5 0 1 1 7.1 7.1L17 13"/><path d="M14 11a5 5 0 0 1 0 7l-1.4 1.4a5 5 0 1 1-7.1-7.1L7 11"/></svg>
            单条内容
          </span>
          <span class="line-count"><span class="lc-num">{{ lineCount }}</span> 条<span class="lc-sep">·</span>最低 {{ minQuantity }}</span>
        </div>
        <div class="single-fields">
          <label class="single-field">
            <span class="single-field-label">笔记链接</span>
            <input
              v-model="singleUrl"
              type="url"
              class="single-input"
              placeholder="https://xhslink.com/xxxxxx"
              spellcheck="false"
            />
          </label>
          <label class="single-field">
            <span class="single-field-label">下单数量</span>
            <input
              v-model="singleQuantity"
              type="number"
              class="single-input"
              :min="minQuantity"
              :placeholder="String(minQuantity)"
            />
          </label>
        </div>
      </div>

      <!-- 预校验结果 -->
      <div v-if="prevalidateResults.length > 0" class="prevalidate-results">
        <div class="pv-header">
          <h3>预校验结果</h3>
          <span :class="['pv-badge', prevalidationPassed ? 'pass' : 'fail']">
            {{ prevalidateResults.filter(r => r.valid).length }}/{{ prevalidateResults.length }} 通过
          </span>
        </div>
        <ul>
          <li v-for="(r, i) in prevalidateResults" :key="i" :class="r.valid ? 'valid' : 'invalid'">
            <img v-if="r.valid && r.avatar_url" class="pv-avatar" :src="r.avatar_url" alt="" />
            <span v-else class="pv-dot"></span>
            <div class="pv-body">
              <span class="pv-url">{{ r.url }}</span>
              <span v-if="r.valid && r.title" class="pv-info">{{ r.title }}<template v-if="r.author_name"> · {{
                r.author_name }}</template></span>
            </div>
            <span class="pv-msg">{{ r.valid ? '通过' : (r.message || '无效') }}</span>
          </li>
        </ul>
        <p v-if="!prevalidationPassed" class="pv-fail-tip">预校验未全部通过，请修正链接后重新预校验</p>
      </div>

      <!-- 删除记录 -->
      <div v-if="removedLines.length > 0" class="removed-lines">
        <h3>已删除的问题链接（{{ removedLines.length }} 条）</h3>
        <div v-if="duplicateRemovedLines.length > 0" class="duplicate-reminder">
          <div>
            <strong>重复链接已移出本次提交</strong>
            <span>请先复制保存，下一次再单独提交这些链接。</span>
          </div>
          <button type="button" class="duplicate-copy" :class="{ copied: duplicateCopySuccess }"
            @click="copyDuplicateRemovedLines">
            {{ duplicateCopySuccess ? '已复制' : '复制重复链接' }}
          </button>
        </div>
        <ul>
          <li v-for="(r, i) in removedLines" :key="i">
            <span class="removed-url">{{ r.url }}</span>
            <span class="removed-reason">{{ r.error }}</span>
          </li>
        </ul>
      </div>

      <!-- 工具按钮 -->
      <div class="tool-row">
        <button type="button" class="btn btn-outline" @click="prevalidate" :disabled="prevalidating || lineCount === 0">
          {{ prevalidating ? '校验中...' : '预校验' }}
        </button>
        <button type="button" class="btn btn-outline" @click="fillExample">填充示例</button>
        <button type="button" class="btn btn-outline" @click="removeInvalidLines"
          :disabled="allInvalidLines.length === 0">
          删除问题链接
        </button>
        <button type="button" class="btn btn-outline" @click="clearInput">清空</button>
      </div>

      <div class="step-actions">
        <button type="button" class="btn btn-ghost" @click="prevStep">上一步</button>
        <div class="step-actions-right">
          <span v-if="step2BlockReason" class="step-hint">{{ step2BlockReason }}</span>
          <span v-else-if="prevalidationPassed" class="step-ok">预校验通过</span>
          <button
            v-if="canTryStep3 || prevalidating"
            type="button"
            class="btn btn-primary"
            :disabled="!canTryStep3"
            @click="handleStep2Next"
          >
            {{ prevalidating ? '校验中...' : '下一步：确认下单' }}
          </button>
        </div>
      </div>
    </section>

    <!-- ============ 第 3 步：结算与余额 ============ -->
    <section v-show="currentStep === 3" class="card step-card step-enter">
      <header class="step-head">
        <span class="step-kicker">第 3 步</span>
        <h2 class="card-heading">结算与余额</h2>
        <p class="step-tip">请核对下单信息与扣费，确认无误后提交。</p>
      </header>

      <div class="settle-hero">
        <div class="settle-hero-inner">
          <span class="settle-hero-label">预计扣费</span>
          <strong class="settle-hero-cost">¥{{ totalCost.toFixed(2) }}</strong>
          <span class="settle-hero-sub">{{ validLines.length }} 条有效 · 共 {{ totalQuantity }} 数量</span>
        </div>
      </div>

      <div class="settle-grid">
        <div class="settle-item accent settle-cost-mobile">
          <span class="settle-label">预计扣费</span>
          <strong class="settle-value cost">¥{{ totalCost.toFixed(2) }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">总数</span>
          <strong class="settle-value">{{ totalQuantity }}</strong>
        </div>
        <div class="settle-item valid">
          <span class="settle-label">有效行</span>
          <strong class="settle-value">{{ validLines.length }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">单价</span>
          <strong class="settle-value">¥{{ unitPrice.toFixed(4) }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">服务类型</span>
          <strong class="settle-value sm">{{ activeTypeLabel }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">数据源</span>
          <strong class="settle-value sm">{{ activeDataSourceLabel }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">可用余额</span>
          <strong class="settle-value balance-val">¥{{ balance.toFixed(2) }}</strong>
        </div>
        <div class="settle-item">
          <span class="settle-label">连接状态</span>
          <strong :class="['settle-value', 'sm', connectionOk ? 'ok-text' : 'fail-text']">{{ connectionOk ? '正常' : '异常'
            }}</strong>
        </div>
      </div>

      <div v-if="balanceInsufficient" class="settle-warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        余额不足，请先充值
      </div>

      <!-- 公告 -->
      <div class="notice-box">
        <div class="notice-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
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

      <div class="step-actions">
        <button type="button" class="btn btn-ghost" @click="prevStep">上一步</button>
        <div class="step-actions-right">
          <span v-if="!canSubmit && submitBlockReason" class="step-hint">{{ submitBlockReason }}</span>
          <button type="button" class="btn btn-primary btn-confirm" :disabled="!canSubmit"
            :title="!canSubmit ? submitBlockReason : ''" @click="submitBatch">
            {{ submitting ? '提交中...' : `确认下单（¥${totalCost.toFixed(2)}）` }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ========== 设计变量 ========== */
.batch-wizard {
  --bw-primary: #2f6df6;
  --bw-accent: #2f6df6;
  --bw-purple: #2558d4;
  --bw-success: #42c978;
  --bw-danger: #ff4d4f;
  --bw-text: #152033;
  --bw-text-2: #425066;
  --bw-text-3: #8a95a8;
  --bw-border: #e8eef7;
  --bw-radius: 14px;
  --bw-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  --bw-shadow-lg: 0 12px 40px rgba(47, 109, 246, 0.08), 0 4px 12px rgba(21, 32, 51, 0.04);
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 18px 48px;
  max-width: 940px;
  width: 100%;
  margin: 0 auto;
}

/* ========== 页面头部 ========== */
.page-hero {
  position: relative;
  border-radius: var(--bw-radius);
  overflow: hidden;
  border: 1px solid var(--bw-border);
  box-shadow: var(--bw-shadow-lg);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background: #fff;
}

.hero-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px;
  flex-wrap: wrap;
}

.hero-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--bw-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
}

.hero-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--bw-text);
  line-height: 1.2;
  letter-spacing: -0.3px;
}

.hero-desc {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--bw-text-3);
  line-height: 1.55;
  max-width: 420px;
}

.connection-pill {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 12px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 12px rgba(21, 32, 51, 0.06);
  min-width: 200px;
}

.connection-pill.is-ok { border-color: rgba(66, 201, 120, 0.25); }
.connection-pill.is-fail { border-color: rgba(255, 77, 79, 0.25); }

.conn-indicator {
  position: relative;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.conn-dot {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--bw-success);
}

.connection-pill.is-fail .conn-dot { background: var(--bw-danger); }

.conn-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--bw-success);
  opacity: 0.35;
  animation: conn-pulse 2s ease-out infinite;
}

.connection-pill.is-fail .conn-ring {
  border-color: var(--bw-danger);
  animation: none;
}

@keyframes conn-pulse {
  0% { transform: scale(1); opacity: 0.35; }
  70% { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1.8); opacity: 0; }
}

.conn-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.conn-text strong { font-size: 13px; color: var(--bw-text); font-weight: 800; }
.conn-text small { font-size: 11px; color: var(--bw-text-3); }

.conn-refresh {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--bw-border);
  background: #fff;
  color: var(--bw-text-3);
  cursor: pointer;
  transition: all 200ms ease;
}

.conn-refresh svg { width: 15px; height: 15px; }

.conn-refresh:hover:not(:disabled) {
  color: var(--bw-primary);
  border-color: #c9d6ef;
  background: #f5f8ff;
}

.conn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

/* ========== 通用卡片 ========== */
.card {
  border-radius: var(--bw-radius);
  background: #fff;
  border: 1px solid var(--bw-border);
  box-shadow: var(--bw-shadow);
  padding: 22px 24px;
}

.card-heading {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 800;
  color: var(--bw-text);
  line-height: 1.2;
  letter-spacing: -0.2px;
}

.card-heading::before {
  content: '';
  width: 4px;
  height: 20px;
  border-radius: 999px;
  background: var(--goosd-primary);
  box-shadow: 0 2px 8px rgba(47, 109, 246, 0.28);
}

.step-enter {
  animation: step-fade-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes step-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ========== 步骤指示器（圆点在上、连线居中、文字在下） ========== */
.stepper {
  --step-circle: 34px;
  --step-rail-y: calc(18px + var(--step-circle) / 2);
  display: flex;
  align-items: flex-start;
  gap: 0;
  padding: 18px 28px 16px;
  position: relative;
}

.stepper-rail {
  position: absolute;
  top: var(--step-rail-y);
  left: calc(100% / 6 + var(--step-circle) / 2);
  right: calc(100% / 6 + var(--step-circle) / 2);
  height: 2px;
  background: #e8edf4;
  border-radius: 999px;
  z-index: 0;
  transform: translateY(-50%);
  overflow: hidden;
}

.stepper-rail::after {
  content: '';
  display: block;
  height: 100%;
  width: var(--stepper-progress, 0%);
  border-radius: inherit;
  background: var(--goosd-primary);
  transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: default;
  position: relative;
  text-align: center;
  transition: background 200ms ease;
  z-index: 1;
  min-width: 0;
}

.step.clickable {
  cursor: pointer;
}

.step.clickable:hover {
  background: #f8faff;
}

.step-index {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid #d8e0ee;
  color: #9aa5b5;
  font-size: 14px;
  font-weight: 800;
  background: #fff;
  transition: all 280ms cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 2px 6px rgba(21, 32, 51, 0.04);
}

.step-index svg {
  width: 15px;
  height: 15px;
}

.step.active .step-index {
  border-color: transparent;
  color: #fff;
  background: var(--goosd-primary);
  box-shadow: 0 6px 16px rgba(47, 109, 246, 0.35);
  transform: scale(1.05);
}

.step.done .step-index {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #5dd99a, var(--bw-success));
  box-shadow: 0 4px 12px rgba(66, 201, 120, 0.3);
}

.step-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  line-height: 1.3;
  min-width: 0;
  width: 100%;
}

.step-text strong {
  font-size: 14px;
  color: #2a3650;
  font-weight: 800;
}

.step.active .step-text strong {
  color: var(--bw-primary);
}

.step-text small {
  font-size: 11.5px;
  color: #9aa5b8;
  line-height: 1.35;
  max-width: 100%;
}

/* ========== 步骤卡片 ========== */
.step-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.step-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-head--split {
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.step-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-mode-toggle {
  display: inline-flex;
  flex-shrink: 0;
  padding: 3px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px solid var(--bw-border);
}

.input-mode-toggle button {
  min-width: 56px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #64748b;
  transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.input-mode-toggle button.active {
  color: #fff;
  background: var(--goosd-primary);
  box-shadow: var(--goosd-btn-shadow);
}

.input-mode-toggle button:not(.active):hover {
  color: #334155;
  background: rgba(255, 255, 255, 0.7);
}

.step-kicker {
  color: var(--goosd-primary);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.5px;
}

.step-tip {
  font-size: 13px;
  color: #8a95a8;
  line-height: 1.6;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.inline-badge {
  display: inline-flex;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eef3ff;
  color: #2f6df6;
  font-size: 12px;
  font-weight: 800;
}

.inline-badge.alt {
  background: var(--goosd-primary-soft);
  color: var(--goosd-primary);
}

/* ========== 字段块 ========== */
.field-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 800;
  color: var(--bw-text-2);
}

.field-icon {
  width: 15px;
  height: 15px;
  color: var(--bw-primary);
  opacity: 0.75;
}

/* ========== 类型标签 ========== */
.type-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.type-tab {
  flex: 0 0 auto;
  padding: 10px 22px;
  border-radius: 999px;
  border: 1.5px solid #e6ecf5;
  background: #fff;
  color: #647184;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.type-tab:hover {
  border-color: #c9d6ef;
  color: var(--bw-primary);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(47, 109, 246, 0.08);
}

.type-tab.active {
  color: #fff;
  border-color: transparent;
  background: var(--goosd-primary);
  box-shadow: 0 8px 20px rgba(47, 109, 246, 0.28);
  transform: translateY(-1px);
}

/* ========== 数据源卡片 ========== */
.source-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.source-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1.5px solid #e6ecf5;
  background: linear-gradient(180deg, #fcfdff, #f8faff);
  cursor: pointer;
  text-align: left;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.source-card:hover:not(.disabled) {
  border-color: #c9d6ef;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(47, 109, 246, 0.08);
}

.source-card.active {
  border-color: var(--bw-primary);
  background: linear-gradient(135deg, #f0f5ff, #fafbff);
  box-shadow: 0 8px 24px rgba(47, 109, 246, 0.12);
}

.source-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  transition: all 200ms ease;
}

.source-icon svg { width: 20px; height: 20px; }

.source-icon.realtime {
  background: var(--goosd-primary-soft);
  color: var(--goosd-primary);
}

.source-icon.pgy {
  background: linear-gradient(135deg, #eef3ff, #e4ecff);
  color: var(--bw-primary);
}

.source-card.active .source-icon.realtime {
  background: var(--goosd-primary);
  color: #fff;
}

.source-card.active .source-icon.pgy {
  background: var(--goosd-primary);
  color: #fff;
}

.source-card.disabled {
  opacity: 0.55;
  cursor: not-allowed;
  background: #f6f7fa;
}

.source-radio {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid #cbd5e6;
  position: relative;
  transition: all 180ms ease;
  margin-left: auto;
}

.source-card.active .source-radio {
  border-color: var(--bw-primary);
  background: var(--bw-primary);
}

.source-card.active .source-radio::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: #fff;
}

.source-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-body strong {
  font-size: 14px;
  color: #2a3650;
  font-weight: 800;
}

.source-body small {
  font-size: 12px;
  color: #9aa5b5;
}

.source-price {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 800;
  color: var(--goosd-primary);
  font-variant-numeric: tabular-nums;
}

/* ========== 选择摘要 ========== */
.choice-summary {
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid #e4ebf7;
  background: linear-gradient(135deg, #f8faff 0%, #f0f5ff 100%);
}

.cs-header {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 800;
  color: var(--bw-primary);
  letter-spacing: 0.4px;
  margin-bottom: 14px;
}

.cs-header svg { width: 14px; height: 14px; }

.cs-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.cs-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.9);
}

.cs-item.highlight {
  background: var(--goosd-primary-muted);
  border-color: rgba(47, 109, 246, 0.18);
}

.cs-label {
  font-size: 12px;
  color: #8a95a8;
}

.cs-item strong {
  font-size: 16px;
  color: #152033;
  font-weight: 800;
}

.cs-item strong.cs-price {
  color: var(--goosd-primary);
}

/* ========== 格式提示 & 编辑区 ========== */
.format-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 12.5px;
  color: var(--bw-text-2);
}

.format-hint svg {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  margin-top: 2px;
  color: var(--bw-primary);
}

.format-hint-text {
  margin: 0;
  flex: 1;
  min-width: 0;
  line-height: 1.55;
  word-break: break-word;
}

.format-hint code {
  display: inline;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--bw-primary);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.editor-panel {
  padding: 16px;
  border: 1px solid #e5ebf5;
  border-radius: 12px;
  background: linear-gradient(180deg, #fcfdff, #f6f8fc);
}

.textarea-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #425066;
}

.textarea-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.textarea-title svg {
  width: 15px;
  height: 15px;
  color: var(--bw-primary);
  opacity: 0.7;
}

.line-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #e4ecff;
  color: var(--bw-text-3);
  font-weight: 700;
  font-size: 12px;
}

.lc-num {
  color: var(--bw-primary);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.lc-sep { margin: 0 2px; opacity: 0.4; }

.batch-textarea {
  width: 100%;
  height: clamp(200px, 32vh, 320px);
  padding: 16px 18px;
  border: 1.5px solid #dfe7f3;
  border-radius: 10px;
  font-size: 13.5px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  line-height: 1.75;
  color: var(--bw-text);
  background: #fff;
  resize: vertical;
  outline: none;
  transition: border-color 240ms ease, box-shadow 240ms ease;
}

.batch-textarea:focus {
  border-color: var(--bw-purple);
  box-shadow: 0 0 0 4px rgba(139, 123, 247, 0.12), 0 4px 16px rgba(47, 109, 246, 0.06);
}

.batch-textarea::placeholder {
  color: #c0c8d4;
}

.single-fields {
  display: grid;
  grid-template-columns: 1fr 160px;
  gap: 12px;
}

.single-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.single-field-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
}

.single-input {
  width: 100%;
  min-height: 46px;
  padding: 0 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  color: var(--bw-text);
  font-size: 14px;
  outline: none;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.single-input:focus {
  border-color: rgba(47, 109, 246, 0.45);
  box-shadow: 0 0 0 4px rgba(47, 109, 246, 0.1);
}

.single-panel .single-fields {
  min-height: 120px;
  align-content: start;
}

/* ========== 工具按钮行 ========== */
.tool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* ========== 按钮 ========== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  min-height: 30px;
  padding: 5px 12px;
  font-size: 12px;
}

.btn-outline {
  background: #fbfcff;
  color: #425066;
  border: 1px solid #e8edf4;
}

.btn-outline:hover:not(:disabled) {
  border-color: #c9d6ef;
  background: #fff;
  color: #2f6df6;
}

.btn-ghost {
  background: transparent;
  color: #647184;
  border: 1px solid #e3e9f2;
}

.btn-ghost:hover:not(:disabled) {
  background: #f5f8ff;
  color: #2f6df6;
}

.btn-primary {
  background: var(--goosd-primary);
  color: #fff;
  box-shadow: 0 10px 22px rgba(47, 109, 246, 0.24);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--goosd-primary-dark);
  box-shadow: 0 14px 30px rgba(47, 109, 246, 0.32);
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-confirm {
  min-height: 44px;
  padding: 10px 28px;
  font-size: 15px;
}

/* ========== 步骤操作行 ========== */
.step-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #eef2f7;
  flex-wrap: wrap;
  background-color: #fff;
}

.step-actions-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.step-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: #b96b00;
  padding: 6px 12px;
  border-radius: 8px;
  background: #fff9ef;
  border: 1px solid #ffe1ad;
}

.step-ok {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: #2bA15e;
}

.step-ok::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #42c978;
}

/* ========== 预校验 / 删除记录 ========== */
.prevalidate-results,
.removed-lines {
  padding: 16px;
  border-radius: 12px;
  background: #fafbff;
  border: 1px solid #e8edf4;
}

.pv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.pv-header h3 {
  font-size: 13px;
  font-weight: 800;
  color: var(--bw-text-2);
}

.pv-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.pv-badge.pass {
  background: #e8faf0;
  color: #2ba15e;
  border: 1px solid #b7ebd0;
}

.pv-badge.fail {
  background: #fff1f0;
  color: var(--bw-danger);
  border: 1px solid #ffccc7;
}

.prevalidate-results h3,
.removed-lines h3 {
  font-size: 13px;
  font-weight: 700;
  color: var(--bw-text-2);
  margin-bottom: 10px;
}

.prevalidate-results ul,
.removed-lines ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.prevalidate-results li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #edf1f7;
  font-size: 13px;
  transition: border-color 180ms ease;
}

.prevalidate-results li.valid { border-left: 3px solid var(--bw-success); }
.prevalidate-results li.invalid { border-left: 3px solid var(--bw-danger); }

.pv-fail-tip {
  margin: 14px 0 0;
  padding-top: 14px;
  border-top: 1px solid #ffe1ad;
  font-size: 12.5px;
  font-weight: 700;
  color: #b96b00;
  text-align: right;
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

.pv-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 7px;
}

.prevalidate-results li.valid .pv-dot {
  background: #42c978;
}

.prevalidate-results li.invalid .pv-dot {
  background: #ff4d4f;
}

.pv-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pv-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #425066;
}

.pv-info {
  font-size: 12px;
  color: #9aa5b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pv-msg {
  flex-shrink: 0;
  font-weight: 600;
  align-self: flex-start;
  margin-top: 2px;
}

.prevalidate-results li.valid .pv-msg {
  color: #42c978;
}

.prevalidate-results li.invalid .pv-msg {
  color: #ff4d4f;
}

.duplicate-reminder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ffe1ad;
  background: #fff9ef;
}

.duplicate-reminder div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.duplicate-reminder strong {
  color: #7a3f00;
  font-size: 13px;
  line-height: 1.2;
}

.duplicate-reminder span {
  color: #9a6a28;
  font-size: 12px;
  line-height: 1.45;
}

.duplicate-copy {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  background: #ffae2a;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  border: none;
  cursor: pointer;
  transition: background 180ms ease;
}

.duplicate-copy:hover {
  background: #f09312;
}

.duplicate-copy.copied {
  background: #42c978;
}

.removed-lines li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #647184;
}

.removed-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removed-reason {
  flex-shrink: 0;
  color: #ff4d4f;
  font-size: 12px;
}

/* ========== 结算 ========== */
.settle-hero {
  border-radius: 14px;
  overflow: hidden;
  background: var(--goosd-primary);
  box-shadow: 0 12px 32px rgba(47, 109, 246, 0.22);
}

.settle-hero-inner {
  padding: 24px 28px;
  text-align: center;
  color: #fff;
}

.settle-hero-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.85;
  letter-spacing: 0.5px;
}

.settle-hero-cost {
  display: block;
  margin-top: 6px;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.settle-hero-sub {
  display: block;
  margin-top: 8px;
  font-size: 13px;
  opacity: 0.85;
}

.settle-cost-mobile { display: none; }

.settle-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.settle-item {
  min-height: 72px;
  padding: 14px 16px;
  display: grid;
  align-content: center;
  border-radius: 12px;
  border: 1px solid #edf1f7;
  background: linear-gradient(180deg, #fcfdff, #f7f9fd);
  transition: transform 200ms ease, box-shadow 200ms ease;
}

.settle-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(21, 32, 51, 0.05);
}

.settle-item.accent {
  border-color: #c7d7ff;
  background: linear-gradient(135deg, #f0f5ff, #fafbff);
}

.settle-item.valid {
  border-color: #d9f4e6;
  background: linear-gradient(135deg, #f0fff4, #fbfffd);
}

.settle-label {
  display: block;
  font-size: 12px;
  color: #8a95a8;
  margin-bottom: 4px;
}

.settle-value {
  display: block;
  font-size: 20px;
  color: #152033;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}

.settle-value.sm {
  font-size: 15px;
}

.settle-value.cost {
  color: var(--goosd-primary);
}

.settle-value.balance-val {
  color: var(--goosd-primary);
}

.settle-value.ok-text {
  color: #42c978;
}

.settle-value.fail-text {
  color: #ff4d4f;
}

.settle-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fff1f0;
  color: #ff4d4f;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid #ffccc7;
}

/* ========== 公告 ========== */
.notice-box {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: linear-gradient(135deg, #fffaf2, #fffdf8);
  border: 1px solid #f7dfb9;
}

.notice-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #f5a623;
}

.notice-text {
  flex: 1;
}

.notice-text p {
  font-size: 13px;
  color: #425066;
  line-height: 1.8;
}

/* ========== 复选框 ========== */
.agree-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  color: #425066;
  font-weight: 600;
}

.agree-check input[type="checkbox"] {
  display: none;
}

.checkmark {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid #d0d7e2;
  background: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: all 160ms ease;
}

.agree-check input:checked+.checkmark {
  background: var(--goosd-primary);
  border-color: transparent;
}

.agree-check input:checked+.checkmark::after {
  content: '';
  width: 10px;
  height: 6px;
  border-left: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(-45deg);
  margin-top: -2px;
}

/* ========== 响应式：手机端 ========== */
@media (max-width: 768px) {
  .batch-wizard {
    padding: 12px 12px calc(40px + env(safe-area-inset-bottom, 0px));
    gap: 12px;
  }

  .hero-content {
    flex-direction: column;
    align-items: stretch;
    padding: 14px 14px;
    gap: 12px;
  }

  .hero-badge {
    font-size: 10px;
    padding: 3px 10px;
    margin-bottom: 6px;
  }

  .hero-title {
    font-size: 16px;
    letter-spacing: -0.2px;
  }

  .hero-desc {
    font-size: 12px;
    line-height: 1.45;
    margin-top: 4px;
  }

  .connection-pill {
    min-width: 0;
    padding: 10px 12px;
    gap: 10px;
  }

  .conn-text strong {
    font-size: 12px;
  }

  .conn-text small {
    font-size: 10px;
  }

  .card {
    padding: 16px;
    border-radius: 12px;
  }

  .settle-hero { display: none; }

  .settle-cost-mobile { display: grid; }

  .stepper {
    --step-circle: 28px;
    padding: 14px 10px 12px;
  }

  .step {
    gap: 6px;
    padding: 0 2px;
  }

  .step-index {
    width: var(--step-circle);
    height: var(--step-circle);
    font-size: 13px;
  }

  .step-text strong {
    font-size: 12px;
  }

  .step-text small {
    display: none;
  }

  .step-kicker {
    font-size: 11px;
  }

  .step-tip {
    font-size: 12px;
    line-height: 1.45;
  }

  .card-heading {
    font-size: 14px;
  }

  .card-heading::before {
    height: 13px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 700;
  }

  .field-icon {
    width: 14px;
    height: 14px;
  }

  .step-head--split {
    flex-direction: column;
    align-items: stretch;
  }

  .input-mode-toggle {
    align-self: flex-end;
  }

  .single-fields {
    grid-template-columns: 1fr;
  }

  .type-tab {
    padding: 7px 14px;
    font-size: 12px;
  }

  .source-cards {
    grid-template-columns: 1fr;
  }

  .source-card {
    padding: 12px 14px;
    gap: 10px;
  }

  .source-icon {
    width: 34px;
    height: 34px;
  }

  .source-icon svg {
    width: 17px;
    height: 17px;
  }

  .source-body strong {
    font-size: 13px;
  }

  .source-body small {
    font-size: 11px;
  }

  .source-price {
    font-size: 12px;
  }

  .choice-summary { padding: 14px; }

  .cs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cs-item strong {
    font-size: 15px;
  }

  .format-hint {
    padding: 10px 12px;
    font-size: 12px;
  }

  .format-hint-text {
    line-height: 1.6;
  }

  .format-hint code {
    padding: 1px 5px;
    font-size: 11.5px;
  }

  .batch-textarea {
    height: 200px;
    font-size: 13px;
  }

  .tool-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .tool-row .btn {
    width: 100%;
    padding: 9px 10px;
  }

  .settle-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .settle-value {
    font-size: 18px;
  }

  .step-actions {
    gap: 10px;
  }

  .step-actions-right {
    width: 100%;
    justify-content: space-between;
  }

  .step-actions .btn-primary {
    flex: 1;
  }

  .btn-confirm {
    width: 100%;
  }
}
</style>
