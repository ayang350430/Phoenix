<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElNotification } from 'element-plus'
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
  if (validLines.value.length !== parsedLines.value.length) return '存在格式或数量错误，请修正后重新校验'
  if (prevalidating.value) return '正在预校验...'
  if (!prevalidateSignature.value || prevalidateSignature.value !== currentInputSignature.value) return '请先点击「预校验」，通过后才能下一步'
  if (!prevalidationPassed.value) return '预校验未全部通过，请删除问题链接后重试'
  return ''
})

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
    }
    showBalanceNotification()
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
  batchText.value = removeBatchProblemLines({
    parsedLines: parsedLines.value,
    problemLines: allInvalidLines.value
  })
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
  prevalidateResults.value = []
  prevalidateSignature.value = ''
  removedLines.value = []
  duplicateCopySuccess.value = false
}

watch([batchText, activeProductId], () => {
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
    <!-- 连接状态 -->
    <section :class="['card', 'connection-card', connectionOk ? 'is-ok' : 'is-fail']">
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

    <!-- 步骤指示器 -->
    <nav class="stepper card">
      <button
        v-for="(s, i) in STEPS"
        :key="s.no"
        type="button"
        class="step"
        :class="{ active: currentStep === s.no, done: currentStep > s.no, clickable: s.no < currentStep || (s.no === 2 && canGoStep2) || (s.no === 3 && prevalidationPassed) }"
        @click="goStep(s.no)"
      >
        <span class="step-index">
          <svg v-if="currentStep > s.no" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <template v-else>{{ s.no }}</template>
        </span>
        <span class="step-text">
          <strong>{{ s.title }}</strong>
          <small>{{ s.desc }}</small>
        </span>
        <span v-if="i < STEPS.length - 1" class="step-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </button>
    </nav>

    <!-- ============ 第 1 步：选择类型与数据源 ============ -->
    <section v-show="currentStep === 1" class="card step-card">
      <header class="step-head">
        <span class="step-kicker">第 1 步</span>
        <h2 class="card-heading">选择下单类型</h2>
        <p class="step-tip">先选择要购买的服务类型，再选择数据来源平台。</p>
      </header>

      <!-- 类型 -->
      <div class="field-block">
        <div class="field-label">服务类型</div>
        <div class="type-tabs">
          <button
            v-for="g in groupedTypes"
            :key="g.target_type"
            type="button"
            :class="['type-tab', { active: activeTargetType === g.target_type }]"
            @click="selectType(g.target_type)"
          >
            {{ g.label }}
          </button>
        </div>
      </div>

      <!-- 数据源 -->
      <div class="field-block">
        <div class="field-label">数据源</div>
        <div class="source-cards">
          <button
            v-for="src in DATA_SOURCE_ORDER"
            :key="src"
            type="button"
            class="source-card"
            :class="{ active: activeDataSource === src, disabled: !sourceAvailable(src) }"
            :disabled="!sourceAvailable(src)"
            @click="selectDataSource(src)"
          >
            <span class="source-radio"></span>
            <span class="source-body">
              <strong>{{ DATA_SOURCE_LABELS[src] }}</strong>
              <small>{{ sourceAvailable(src) ? DATA_SOURCE_DESC[src] : '该商品未开放此数据源' }}</small>
            </span>
          </button>
        </div>
      </div>

      <!-- 选择摘要 -->
      <div v-if="activeProduct" class="choice-summary">
        <div class="cs-item">
          <span class="cs-label">已选服务</span>
          <strong>{{ activeTypeLabel }}</strong>
        </div>
        <div class="cs-item">
          <span class="cs-label">数据源</span>
          <strong>{{ activeDataSourceLabel }}</strong>
        </div>
        <div class="cs-item">
          <span class="cs-label">单价</span>
          <strong class="cs-price">¥{{ unitPrice.toFixed(4) }}</strong>
        </div>
        <div class="cs-item">
          <span class="cs-label">最低下单量</span>
          <strong>{{ minQuantity }}</strong>
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
    <section v-show="currentStep === 2" class="card step-card">
      <header class="step-head">
        <span class="step-kicker">第 2 步</span>
        <h2 class="card-heading">输入链接与数量</h2>
        <p class="step-tip">
          <span class="inline-badge">{{ activeTypeLabel }}</span>
          <span class="inline-badge alt">{{ activeDataSourceLabel }}</span>
          格式：链接 + 数量，支持空格或 Tab 分隔。
        </p>
      </header>

      <div class="editor-panel">
        <div class="textarea-label">
          <span>批量内容</span>
          <span class="line-count">已输入 {{ lineCount }} 行 · 最低 {{ minQuantity }}</span>
        </div>
        <textarea
          v-model="batchText"
          class="batch-textarea"
          :placeholder="`示例：https://xhslink.com/xxxxxx ${minQuantity}（${activeTypeLabel}）`"
          spellcheck="false"
        ></textarea>
      </div>

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
        <div v-if="duplicateRemovedLines.length > 0" class="duplicate-reminder">
          <div>
            <strong>重复链接已移出本次提交</strong>
            <span>请先复制保存，下一次再单独提交这些链接。</span>
          </div>
          <button type="button" class="duplicate-copy" :class="{ copied: duplicateCopySuccess }" @click="copyDuplicateRemovedLines">
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
        <button type="button" class="btn btn-outline" @click="removeInvalidLines" :disabled="allInvalidLines.length === 0">
          删除问题链接
        </button>
        <button type="button" class="btn btn-outline" @click="clearInput">清空</button>
      </div>

      <div class="step-actions">
        <button type="button" class="btn btn-ghost" @click="prevStep">上一步</button>
        <div class="step-actions-right">
          <span v-if="step2BlockReason" class="step-hint">{{ step2BlockReason }}</span>
          <span v-else class="step-ok">预校验通过，可进入下一步</span>
          <button type="button" class="btn btn-primary" :disabled="!prevalidationPassed" @click="nextStep">
            下一步：确认下单
          </button>
        </div>
      </div>
    </section>

    <!-- ============ 第 3 步：结算与余额 ============ -->
    <section v-show="currentStep === 3" class="card step-card">
      <header class="step-head">
        <span class="step-kicker">第 3 步</span>
        <h2 class="card-heading">结算与余额</h2>
        <p class="step-tip">请核对下单信息与扣费，确认无误后提交。</p>
      </header>

      <div class="settle-grid">
        <div class="settle-item accent">
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
          <strong :class="['settle-value', 'sm', connectionOk ? 'ok-text' : 'fail-text']">{{ connectionOk ? '正常' : '异常' }}</strong>
        </div>
      </div>

      <div v-if="balanceInsufficient" class="settle-warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        余额不足，请先充值
      </div>

      <!-- 公告 -->
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

      <div class="step-actions">
        <button type="button" class="btn btn-ghost" @click="prevStep">上一步</button>
        <div class="step-actions-right">
          <span v-if="!canSubmit && submitBlockReason" class="step-hint">{{ submitBlockReason }}</span>
          <button
            type="button"
            class="btn btn-primary btn-confirm"
            :disabled="!canSubmit"
            :title="!canSubmit ? submitBlockReason : ''"
            @click="submitBatch"
          >
            {{ submitting ? '提交中...' : `确认下单（¥${totalCost.toFixed(2)}）` }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ========== 容器 ========== */
.batch-wizard {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 16px 40px;
  max-width: 920px;
  width: 100%;
  margin: 0 auto;
}

/* ========== 通用卡片 ========== */
.card {
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e8eef7;
  box-shadow: 0 12px 30px rgba(21, 32, 51, 0.045);
  padding: 20px 22px;
}

.card-heading {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 800;
  color: #152033;
  line-height: 1.2;
}

.card-heading::before {
  content: '';
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ee4d7a, #5b8def);
}

/* ========== 连接状态卡片 ========== */
.connection-card { padding: 12px 18px; }
.connection-card.is-ok { border-color: #d9f3e5; }
.connection-card.is-fail { border-color: #ffe1e1; }

.connection-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.connection-info { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.connection-label { font-weight: 800; color: #243149; }
.connection-sep { color: #9aa5b5; }
.connection-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.connection-status.ok { color: #42c978; }
.connection-status.fail { color: #ff4d4f; }
.conn-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.connection-status.ok .conn-dot { background: #42c978; box-shadow: 0 0 8px rgba(66, 201, 120, 0.5); }
.connection-status.fail .conn-dot { background: #ff4d4f; box-shadow: 0 0 8px rgba(255, 77, 79, 0.5); }

/* ========== 步骤指示器 ========== */
.stepper {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 12px 14px;
}

.step {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: default;
  position: relative;
  text-align: left;
  transition: background 200ms ease;
}

.step.clickable { cursor: pointer; }
.step.clickable:hover { background: #f5f8ff; }

.step-index {
  flex-shrink: 0;
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border-radius: 50%;
  border: 2px solid #d8e0ee;
  color: #9aa5b5;
  font-size: 14px; font-weight: 800;
  background: #fff;
  transition: all 220ms ease;
}

.step-index svg { width: 15px; height: 15px; }

.step.active .step-index {
  border-color: transparent;
  color: #fff;
  background: linear-gradient(135deg, #6f7df5, #2f6df6);
  box-shadow: 0 6px 14px rgba(91, 141, 239, 0.3);
}

.step.done .step-index {
  border-color: transparent;
  color: #fff;
  background: #42c978;
}

.step-text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.step-text strong { font-size: 14px; color: #2a3650; font-weight: 800; }
.step.active .step-text strong { color: #2f6df6; }
.step-text small { font-size: 11.5px; color: #9aa5b5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.step-arrow {
  position: absolute;
  right: -6px; top: 50%;
  transform: translateY(-50%);
  color: #cdd6e6;
}
.step-arrow svg { width: 16px; height: 16px; display: block; }

/* ========== 步骤卡片 ========== */
.step-card { display: flex; flex-direction: column; gap: 18px; }
.step-head { display: flex; flex-direction: column; gap: 6px; }
.step-kicker { color: #5b8def; font-size: 12px; font-weight: 900; letter-spacing: 0.5px; }
.step-tip { font-size: 13px; color: #8a95a8; line-height: 1.6; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }

.inline-badge {
  display: inline-flex;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eef3ff;
  color: #2f6df6;
  font-size: 12px;
  font-weight: 800;
}
.inline-badge.alt { background: #fff0f5; color: #ee4d7a; }

/* ========== 字段块 ========== */
.field-block { display: flex; flex-direction: column; gap: 10px; }
.field-label { font-size: 13px; font-weight: 800; color: #425066; }

/* ========== 类型标签 ========== */
.type-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.type-tab {
  flex: 0 0 auto;
  padding: 9px 20px;
  border-radius: 999px;
  border: 1px solid #e6ecf5;
  background: #fff;
  color: #647184;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.type-tab:hover { border-color: #c9d6ef; color: #2f6df6; }

.type-tab.active {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #6f7df5, #2f6df6);
  box-shadow: 0 8px 18px rgba(91, 141, 239, 0.24);
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
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid #e6ecf5;
  background: #fbfcff;
  cursor: pointer;
  text-align: left;
  transition: all 200ms ease;
}

.source-card:hover:not(.disabled) { border-color: #c9d6ef; background: #fff; }

.source-card.active {
  border-color: #2f6df6;
  background: linear-gradient(135deg, #f3f7ff, #fbfcff);
  box-shadow: 0 8px 18px rgba(47, 109, 246, 0.1);
}

.source-card.disabled { opacity: 0.55; cursor: not-allowed; background: #f6f7fa; }

.source-radio {
  flex-shrink: 0;
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid #cbd5e6;
  position: relative;
  transition: all 180ms ease;
}

.source-card.active .source-radio { border-color: #2f6df6; }
.source-card.active .source-radio::after {
  content: '';
  position: absolute; inset: 3px;
  border-radius: 50%;
  background: #2f6df6;
}

.source-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.source-body strong { font-size: 14px; color: #2a3650; font-weight: 800; }
.source-body small { font-size: 12px; color: #9aa5b5; }
.source-price { flex-shrink: 0; font-size: 13px; font-weight: 800; color: #ee4d7a; font-variant-numeric: tabular-nums; }

/* ========== 选择摘要 ========== */
.choice-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid #edf1f7;
  background: linear-gradient(180deg, #fbfcff, #f7f9fd);
}

.cs-item { display: flex; flex-direction: column; gap: 4px; }
.cs-label { font-size: 12px; color: #8a95a8; }
.cs-item strong { font-size: 16px; color: #152033; font-weight: 800; }
.cs-item strong.cs-price { color: #ee4d7a; }

/* ========== 编辑区 ========== */
.editor-panel {
  padding: 14px;
  border: 1px solid #e5ebf5;
  border-radius: 10px;
  background: linear-gradient(180deg, #fbfcff, #f7f9fd);
}

.textarea-label {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 10px;
  font-size: 13px; font-weight: 700; color: #425066;
}

.line-count {
  display: inline-flex; padding: 4px 9px; border-radius: 999px;
  background: #eef3ff; color: #5b8def; font-weight: 800; font-size: 12px;
}

.batch-textarea {
  width: 100%;
  height: clamp(200px, 32vh, 320px);
  padding: 14px 16px;
  border: 1px solid #dfe7f3;
  border-radius: 8px;
  font-size: 14px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  line-height: 1.7;
  color: #152033;
  background: #fff;
  resize: vertical;
  outline: none;
  transition: border-color 240ms ease, box-shadow 240ms ease;
}

.batch-textarea:focus {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 4px rgba(139, 123, 247, 0.12);
}

.batch-textarea::placeholder { color: #c0c8d4; }

/* ========== 工具按钮行 ========== */
.tool-row { display: flex; flex-wrap: wrap; gap: 10px; }

/* ========== 按钮 ========== */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 38px; padding: 9px 18px;
  border-radius: 8px; font-size: 14px; font-weight: 700;
  cursor: pointer; border: none;
  transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { min-height: 30px; padding: 5px 12px; font-size: 12px; }

.btn-outline { background: #fbfcff; color: #425066; border: 1px solid #e8edf4; }
.btn-outline:hover:not(:disabled) { border-color: #c9d6ef; background: #fff; color: #2f6df6; }

.btn-ghost { background: transparent; color: #647184; border: 1px solid #e3e9f2; }
.btn-ghost:hover:not(:disabled) { background: #f5f8ff; color: #2f6df6; }

.btn-primary {
  background: linear-gradient(135deg, #ee4d7a 0%, #7b7df4 54%, #2f6df6 100%);
  color: #fff;
  box-shadow: 0 10px 22px rgba(91, 141, 239, 0.24);
}
.btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(91, 141, 239, 0.32); filter: saturate(1.08); }
.btn-primary:active:not(:disabled) { transform: scale(0.98); }
.btn-confirm { min-height: 44px; padding: 10px 28px; font-size: 15px; }

/* ========== 步骤操作行 ========== */
.step-actions {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #eef2f7;
  flex-wrap: wrap;
}

.step-actions-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }

.step-hint {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 700; color: #b96b00;
  padding: 6px 12px; border-radius: 8px;
  background: #fff9ef; border: 1px solid #ffe1ad;
}

.step-ok {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 700; color: #2bA15e;
}
.step-ok::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #42c978; }

/* ========== 预校验 / 删除记录 ========== */
.prevalidate-results, .removed-lines {
  padding: 14px; border-radius: 10px; background: #fbfcff; border: 1px solid #e8edf4;
}
.prevalidate-results h3, .removed-lines h3 { font-size: 13px; font-weight: 700; color: #425066; margin-bottom: 10px; }
.prevalidate-results ul, .removed-lines ul {
  list-style: none; display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;
}
.prevalidate-results li {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 8px; background: #fff; border: 1px solid #edf1f7; font-size: 13px;
}
.pv-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; object-fit: cover; align-self: flex-start; margin-top: 2px; border: 1px solid #e8edf4; }
.pv-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; align-self: flex-start; margin-top: 7px; }
.prevalidate-results li.valid .pv-dot { background: #42c978; }
.prevalidate-results li.invalid .pv-dot { background: #ff4d4f; }
.pv-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pv-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #425066; }
.pv-info { font-size: 12px; color: #9aa5b5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-msg { flex-shrink: 0; font-weight: 600; align-self: flex-start; margin-top: 2px; }
.prevalidate-results li.valid .pv-msg { color: #42c978; }
.prevalidate-results li.invalid .pv-msg { color: #ff4d4f; }

.duplicate-reminder {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 0 0 10px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #ffe1ad; background: #fff9ef;
}
.duplicate-reminder div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.duplicate-reminder strong { color: #7a3f00; font-size: 13px; line-height: 1.2; }
.duplicate-reminder span { color: #9a6a28; font-size: 12px; line-height: 1.45; }
.duplicate-copy {
  flex: 0 0 auto; min-height: 30px; padding: 0 12px; border-radius: 8px;
  background: #ffae2a; color: #fff; font-size: 12px; font-weight: 800; border: none; cursor: pointer;
  transition: background 180ms ease;
}
.duplicate-copy:hover { background: #f09312; }
.duplicate-copy.copied { background: #42c978; }

.removed-lines li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #647184; }
.removed-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.removed-reason { flex-shrink: 0; color: #ff4d4f; font-size: 12px; }

/* ========== 结算网格 ========== */
.settle-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.settle-item {
  min-height: 70px;
  padding: 12px 14px;
  display: grid; align-content: center;
  border-radius: 10px; border: 1px solid #edf1f7;
  background: linear-gradient(180deg, #fbfcff, #f7f9fd);
}
.settle-item.accent { border-color: #f8d8e4; background: linear-gradient(135deg, #fff3f7, #fff9fb); }
.settle-item.valid { border-color: #d9f4e6; background: linear-gradient(135deg, #f0fff4, #fbfffd); }
.settle-label { display: block; font-size: 12px; color: #8a95a8; margin-bottom: 4px; }
.settle-value { display: block; font-size: 20px; color: #152033; line-height: 1.2; font-variant-numeric: tabular-nums; font-weight: 800; }
.settle-value.sm { font-size: 15px; }
.settle-value.cost { color: #ee4d7a; }
.settle-value.balance-val { color: #8b7bf7; }
.settle-value.ok-text { color: #42c978; }
.settle-value.fail-text { color: #ff4d4f; }

.settle-warning {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px; border-radius: 8px;
  background: #fff1f0; color: #ff4d4f;
  font-size: 13px; font-weight: 700; border: 1px solid #ffccc7;
}

/* ========== 公告 ========== */
.notice-box {
  display: flex; gap: 12px; padding: 14px 16px; border-radius: 10px;
  background: linear-gradient(135deg, #fffaf2, #fffdf8); border: 1px solid #f7dfb9;
}
.notice-icon { flex-shrink: 0; margin-top: 2px; color: #f5a623; }
.notice-text { flex: 1; }
.notice-text p { font-size: 13px; color: #425066; line-height: 1.8; }

/* ========== 复选框 ========== */
.agree-check {
  display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
  font-size: 14px; color: #425066; font-weight: 600;
}
.agree-check input[type="checkbox"] { display: none; }
.checkmark {
  width: 18px; height: 18px; border-radius: 4px; border: 2px solid #d0d7e2;
  background: #fff; display: grid; place-items: center; flex-shrink: 0; transition: all 160ms ease;
}
.agree-check input:checked + .checkmark { background: linear-gradient(135deg, #8b7bf7, #5b8def); border-color: transparent; }
.agree-check input:checked + .checkmark::after {
  content: ''; width: 10px; height: 6px;
  border-left: 2px solid #fff; border-bottom: 2px solid #fff;
  transform: rotate(-45deg); margin-top: -2px;
}

/* ========== 响应式：手机端 ========== */
@media (max-width: 768px) {
  .batch-wizard {
    padding: 10px 10px calc(40px + env(safe-area-inset-bottom, 0px));
    gap: 12px;
  }

  .card { padding: 14px; border-radius: 12px; }

  .stepper { padding: 10px 8px; gap: 0; }
  .step { flex-direction: column; gap: 5px; padding: 4px 2px; text-align: center; align-items: center; }
  .step-index { width: 26px; height: 26px; font-size: 13px; }
  .step-text strong { font-size: 12px; }
  .step-text small { display: none; }
  .step-arrow { display: none; }

  .card-heading { font-size: 16px; }
  .card-heading::before { height: 15px; }

  .type-tab { padding: 8px 16px; font-size: 13px; }

  .source-cards { grid-template-columns: 1fr; }

  .choice-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cs-item strong { font-size: 15px; }

  .batch-textarea { height: 200px; font-size: 13px; }

  .tool-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .tool-row .btn { width: 100%; padding: 9px 10px; }

  .settle-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settle-value { font-size: 18px; }

  .step-actions { gap: 10px; }
  .step-actions-right { width: 100%; justify-content: space-between; }
  .step-actions .btn-primary { flex: 1; }
  .btn-confirm { width: 100%; }
}
</style>
