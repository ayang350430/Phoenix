<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox, ElMessage, ElPagination } from 'element-plus'
import { getUserOrderStatusDisplay } from '../utils/orderStatusDisplay.js'

// v-click-outside 指令
const vClickOutside = {
  mounted(el, binding) {
    el.__clickOutside = (e) => {
      if (!el.contains(e.target)) binding.value()
    }
    document.addEventListener('pointerdown', el.__clickOutside)
  },
  unmounted(el) {
    document.removeEventListener('pointerdown', el.__clickOutside)
  }
}

const route = useRoute()
const ws = inject('workspace')
const { getToken, refreshKey, isAdmin, isAgent, fetchBalance, currentUser } = ws
const isMyOrdersPage = computed(() => route.path === '/my-orders')
const canExportProblemOrders = computed(() => (isAdmin.value || isAgent.value) && !isMyOrdersPage.value)
const canViewOrderStatus = computed(() => (isAdmin.value || isAgent.value) && !isMyOrdersPage.value)

// ========== 统计 ==========
const batchTotal = ref(0)
const orderTotal = ref(0)
const processingCount = ref(0)
const totalSpent = ref(0)

// ========== 模块切换 ==========
const activeModule = ref('orders')  // 'orders' | 'supplements'
const showModuleDropdown = ref(false)

const moduleOptions = computed(() => {
  const opts = [{ key: 'orders', label: '下单记录' }]
  if (isAdmin.value) opts.push({ key: 'supplements', label: '补单记录' })
  return opts
})

const activeModuleLabel = computed(() =>
  moduleOptions.value.find(o => o.key === activeModule.value)?.label || '下单记录'
)

function switchModule(key) {
  activeModule.value = key
  showModuleDropdown.value = false
  if (key === 'supplements' && supBatches.value.length === 0 && !supLoading.value) {
    fetchSupplements()
  }
}

function toggleModuleDropdown() { showModuleDropdown.value = !showModuleDropdown.value }
function closeModuleDropdown() { showModuleDropdown.value = false }

// ========== 搜索 ==========
const searchBatchNo = ref('')
const searchOrderNo = ref('')

// ========== 批次列表 ==========
const batches = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 5
const loading = ref(false)

// ========== 状态 & 类型 ==========
const statusConf = {
  pending:            { label: '待处理',   color: '#9aa5b5', bg: '#f6f8fc', border: '#d0d7e2' },
  processing:         { label: '处理中',   color: '#5b8def', bg: '#eef3ff', border: '#5b8def' },
  completed:          { label: '已完成',   color: '#42c978', bg: '#f0fff4', border: '#42c978' },
  partial_completed:  { label: '部分完成', color: '#f5a623', bg: '#fff7e6', border: '#f5a623' },
  refunded:           { label: '已退款',   color: '#e8a735', bg: '#fffbf0', border: '#e8a735' },
  failed:             { label: '失败',     color: '#ff4d4f', bg: '#fff1f0', border: '#ff4d4f' },
  cancelled:          { label: '已取消',   color: '#9aa5b5', bg: '#f6f8fc', border: '#d0d7e2' },
  stopped:            { label: '已停止',   color: '#9aa5b5', bg: '#f6f8fc', border: '#d0d7e2' }
}

const typeLabels = { read: '阅读', like: '点赞', impression: '曝光', collect: '收藏', test: '测试' }

function sc(s) { return statusConf[s] || statusConf.pending }
function ft(t) { return typeLabels[t] || t || '其他' }
function pn(item) {
  if (item.product_name) return item.product_name.replace(/^小红书/, '')
  return ft(item.target_type)
}

function batchStatusView(batch) {
  return canViewOrderStatus.value ? sc(batch?.status) : getUserOrderStatusDisplay(batch?.status)
}

function batchProgressTone(batch) {
  return canViewOrderStatus.value ? sc(batch?.status).color : 'linear-gradient(90deg, #ec4f8b 0%, #2f6df6 100%)'
}

function batchBorderTone(batch) {
  return canViewOrderStatus.value ? sc(batch?.status).border : '#5b8def'
}

function batchProgress(batch) {
  const totalOrdered = batch.total_ordered || 0
  if (totalOrdered === 0) return 0
  const completed = batch.total_completed || 0
  return Math.min(100, Math.round(completed / totalOrdered * 100))
}

function orderProgress(order) {
  const total = order.ordered_quantity || 0
  if (total === 0) return 0
  const done = order.completed_quantity || 0
  return Math.min(100, Math.round(done / total * 100))
}

function fmtTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtMoney(v) {
  return (parseFloat(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ========== API ==========
async function fetchStats() {
  try {
    const res = await fetch('/api/tasks/stats', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      const s = data.data
      batchTotal.value = s.total_batches || 0
      orderTotal.value = s.total_orders || 0
      totalSpent.value = s.total_spent || 0
      const byStatus = s.by_status || []
      const proc = byStatus.find(x => x.order_status === 'processing')
      processingCount.value = proc ? Number(proc.count) : 0
    }
  } catch { /* ignore */ }
}

async function fetchBatches() {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: page.value, pageSize })
    if (searchBatchNo.value.trim()) q.set('batch_no', searchBatchNo.value.trim())
    const res = await fetch(`/api/tasks/batches?${q}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      batches.value = data.data.rows || []
      total.value = data.data.total || 0
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function doSearch() { page.value = 1; fetchBatches() }

function resetSearch() {
  searchBatchNo.value = ''
  searchOrderNo.value = ''
  page.value = 1
  fetchBatches()
}

// ========== 批次详情抽屉 ==========
const showDrawer = ref(false)
const drawerBatch = ref(null)
const drawerOrders = ref([])
const drawerLoading = ref(false)
const isAnyDrawerOpen = computed(() => showDrawer.value || supDrawerShow.value)
let scrollLockState = null

function lockPageScroll() {
  if (scrollLockState) return
  scrollLockState = {
    top: window.scrollY,
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    width: document.body.style.width,
    topStyle: document.body.style.top
  }
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.width = '100%'
  document.body.style.top = `-${scrollLockState.top}px`
}

function unlockPageScroll() {
  if (!scrollLockState) return
  const { top, overflow, position, width, topStyle } = scrollLockState
  document.body.style.overflow = overflow
  document.body.style.position = position
  document.body.style.width = width
  document.body.style.top = topStyle
  scrollLockState = null
  window.scrollTo(0, top)
}

async function openBatchDrawer(batch) {
  drawerBatch.value = batch
  showDrawer.value = true
  drawerLoading.value = true
  drawerOrders.value = []
  hasPendingRefund.value = false
  checkPendingRefund(batch.id)
  try {
    const res = await fetch(`/api/batch/${batch.id}/orders`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      drawerOrders.value = data.data.orders || []
    }
  } catch { /* ignore */ }
  finally { drawerLoading.value = false }
}

function closeDrawer() { showDrawer.value = false }

const orderStatusConf = {
  pending:           { label: '待处理', color: '#9aa5b5' },
  running:           { label: '进行中', color: '#5b8def' },
  processing:        { label: '处理中', color: '#5b8def' },
  completed:         { label: '已完成', color: '#42c978' },
  failed:            { label: '失败',   color: '#ff4d4f' },
  refund_requested:  { label: '退款中', color: '#f5a623' },
  refunded:          { label: '已退款', color: '#e8a735' },
  stopped:           { label: '已停止', color: '#9aa5b5' },
  cancelled:         { label: '已取消', color: '#9aa5b5' }
}

function osc(s) { return orderStatusConf[s] || { label: s || '未知', color: '#9aa5b5' } }

function orderStatusView(order) {
  return canViewOrderStatus.value ? osc(order?.order_status) : getUserOrderStatusDisplay(order?.order_status)
}

function orderProgressTone(order) {
  return canViewOrderStatus.value ? osc(order?.order_status).color : 'linear-gradient(90deg, #ec4f8b 0%, #2f6df6 100%)'
}

function orderProgressTextColor(order) {
  return canViewOrderStatus.value ? osc(order?.order_status).color : '#5b8def'
}

// ========== 退款 ==========
const refunding = ref(false)
const hasPendingRefund = ref(false)
const pendingOrderIds = ref([])
const refundingOrderId = ref(null)

// 当前抽屉批次是否属于自己（代理查看下级订单时不能退款，管理员不受限）
const isOwnBatch = computed(() => {
  if (!drawerBatch.value || !currentUser.value) return true
  if (isAdmin.value) return true
  return drawerBatch.value.user_id === currentUser.value.id
})

// 批次内是否还有可退款的订单
const canBatchRefund = computed(() => {
  if (!isOwnBatch.value) return false
  if (!drawerOrders.value.length) return false
  return drawerOrders.value.some(o => !['refunded', 'cancelled', 'completed'].includes(o.order_status))
})

const confirmModal = ref({ show: false, msg: '', onOk: null })
const toastMsg = ref('')
let toastTimer = null

function showConfirm(msg, onOk) {
  confirmModal.value = { show: true, msg, onOk }
}
function confirmOk() {
  const fn = confirmModal.value.onOk
  confirmModal.value = { show: false, msg: '', onOk: null }
  if (fn) fn()
}
function confirmCancel() {
  confirmModal.value = { show: false, msg: '', onOk: null }
}
function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 3000)
}

async function checkPendingRefund(batchId) {
  hasPendingRefund.value = false
  pendingOrderIds.value = []
  try {
    const res = await fetch(`/api/refund/check/${batchId}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      hasPendingRefund.value = !!data.data.pending
      pendingOrderIds.value = data.data.pendingOrderIds || []
    }
  } catch { /* ignore */ }
}

// ========== 批次验证快照 ==========
const verifyingBatch = ref(false)

async function verifyBatchSnapshot() {
  if (verifyingBatch.value || !drawerBatch.value) return
  verifyingBatch.value = true
  try {
    const res = await fetch(`/api/batch/${drawerBatch.value.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      showToast(data.message || '验证完成')
      // 刷新订单列表
      const res2 = await fetch(`/api/batch/${drawerBatch.value.id}/orders`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      const d2 = await res2.json()
      if (d2.code === 0) drawerOrders.value = d2.data.orders || []
      await fetchBatches()
      const refreshed = batches.value.find(b => b.id === drawerBatch.value.id)
      if (refreshed) drawerBatch.value = refreshed
    } else {
      showToast(data.message || '验证失败')
    }
  } catch {
    showToast('验证失败')
  } finally {
    verifyingBatch.value = false
  }
}

function requestBatchRefund() {
  if (refunding.value || !drawerBatch.value) return
  showConfirm('确认对该批次所有未完成订单申请退款？提交后需等待管理员审批。', doRefund)
}

async function doRefund() {
  if (!drawerBatch.value) return
  refunding.value = true
  try {
    const res = await fetch(`/api/batch/${drawerBatch.value.id}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ reason: '' })
    })
    const data = await res.json()
    if (data.code === 0) {
      if (data.refunded) {
        showToast(data.message || '退款成功')
        closeDrawer()
        fetchBatches()
        fetchBalance()
      } else {
        hasPendingRefund.value = true
        showToast(data.message || '退款申请已提交')
        fetchBatches()
      }
    } else {
      showToast(data.message || '申请失败')
    }
  } catch { showToast('请求失败') }
  finally { refunding.value = false }
}

function requestOrderRefund(order) {
  if (refundingOrderId.value) return
  showConfirm(`确认对订单 ${order.order_no} 申请退款？`, () => doOrderRefund(order))
}

async function doOrderRefund(order) {
  refundingOrderId.value = order.id
  try {
    const res = await fetch(`/api/batch/orders/${order.id}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ reason: '' })
    })
    const data = await res.json()
    if (data.code === 0) {
      if (data.refunded) {
        showToast(data.message || '退款成功')
        if (drawerBatch.value) openBatchDrawer(drawerBatch.value)
        fetchBatches()
        fetchBalance()
      } else {
        pendingOrderIds.value.push(order.id)
        showToast(data.message || '退款申请已提交')
      }
    } else {
      showToast(data.message || '申请失败')
    }
  } catch { showToast('请求失败') }
  finally { refundingOrderId.value = null }
}

// ========== 申请补单 ==========
const requestingId = ref(null)

async function requestSupplement(order) {
  if (requestingId.value) return
  if (!confirm('确认申请补单？管理员审核通过后将启动补单。')) return
  requestingId.value = order.id
  try {
    const res = await fetch(`/api/batch/orders/${order.id}/request-supplement`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })
    const data = await res.json()
    if (data.code === 0) {
      alert('补单申请已提交')
      order._repRequested = true
    } else {
      alert(data.message || '申请失败')
    }
  } catch { alert('申请请求失败') }
  finally { requestingId.value = null }
}

/**
 * 计算订单验证结果
 */
function getVerifyInfo(order) {
  if (!order.last_verified_at) return null
  // 只有这些类型支持快照验证
  const supported = ['read', 'view', 'like', 'collect', 'comment', 'share']
  if (!supported.includes(order.target_type)) {
    return { unavailable: true }
  }
  const isLike = order.target_type === 'like'
  const baseLine = isLike ? (order.like_count ?? 0) : (order.snapshot_current_read_count ?? 0)
  const verified = isLike ? (order.snapshot_verified_like_count ?? 0) : (order.snapshot_verified_read_count ?? 0)
  const gain = Math.max(0, verified - baseLine)
  const shortage = Math.max(0, order.ordered_quantity - gain)
  return { baseLine, verified, gain, shortage, pass: shortage <= 0 }
}

// ========== 商品类型列表（动态） ==========
const productTypes = ref([])
async function fetchProductTypes() {
  try {
    const res = await fetch('/api/products/all', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data?.length) {
      productTypes.value = data.data.map(p => ({ value: p.target_type, label: p.name }))
    }
  } catch { /* ignore */ }
}

// ========== 一键下载问题订单 ==========
const exportingProblems = ref(false)
const showExportDialog = ref(false)
const exportStartDate = ref('')
const exportEndDate = ref('')
const exportTargetType = ref('')

function openExportDialog() {
  const today = new Date().toISOString().slice(0, 10)
  exportStartDate.value = today
  exportEndDate.value = today
  exportTargetType.value = ''
  if (!productTypes.value.length) fetchProductTypes()
  showExportDialog.value = true
}

async function exportProblemOrders() {
  if (exportingProblems.value) return
  exportingProblems.value = true
  showExportDialog.value = false
  try {
    const params = new URLSearchParams()
    if (exportStartDate.value) params.set('start', exportStartDate.value)
    if (exportEndDate.value) params.set('end', exportEndDate.value)
    if (exportTargetType.value) params.set('target_type', exportTargetType.value)
    const res = await fetch(`/api/batch/problem-orders?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code !== 0 || !data.data?.length) {
      showToast('没有问题订单')
      return
    }
    const orders = data.data
    const BOM = '﻿'
    const headers = ['订单ID', '订单号', '批次号', '笔记链接', '类型', '下单量', '状态', '失败原因', '付款金额', '创建时间']
    const rows = orders.map(o => [
      o.id, o.order_no, o.batch_no || '', o.note_url || '',
      pn(o), o.ordered_quantity || 0,
      osc(o.order_status).label,
      o.reason_message || '',
      (parseFloat(o.actual_paid_amount) || 0).toFixed(2),
      fmtTime(o.created_at)
    ])
    const csv = BOM + [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const range = [exportStartDate.value, exportEndDate.value].filter(Boolean).join('_')
    a.download = `问题订单_${range || new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('导出成功')
  } catch {
    showToast('导出失败')
  } finally {
    exportingProblems.value = false
  }
}

// ========== 导出批次订单 ==========
const exporting = ref({})

async function exportBatchOrders(batch, e) {
  e.stopPropagation()
  if (exporting.value[batch.id]) return
  exporting.value = { ...exporting.value, [batch.id]: true }
  try {
    const res = await fetch(`/api/batch/${batch.id}/orders`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code !== 0 || !data.data.orders?.length) {
      showToast('没有可导出的订单')
      return
    }
    const orders = data.data.orders
    const batchInfo = data.data.batch

    // 构建 CSV
    const BOM = '﻿'
    const headers = ['序号', '订单ID', '订单号', '笔记链接', '类型', '下单量', '完成量', '状态', '付款金额', '创建时间']
    const rows = orders.map((o, i) => [
      i + 1,
      o.id,
      o.order_no,
      o.note_url || '',
      pn(o),
      o.ordered_quantity || 0,
      o.completed_quantity || 0,
      osc(o.order_status).label,
      (parseFloat(o.actual_paid_amount) || 0).toFixed(2),
      fmtTime(o.created_at)
    ])

    const csvContent = BOM + [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${batchInfo?.batch_no || batch.batch_no || 'batch'}_订单导出.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('导出成功')
  } catch {
    showToast('导出失败')
  } finally {
    exporting.value = { ...exporting.value, [batch.id]: false }
  }
}

// ========== 补单记录（按批次分组） ==========
const supBatches = ref([])
const supTotal = ref(0)
const supPage = ref(1)
const supPageSize = 10
const supLoading = ref(false)
const supSearchStatus = ref('')
const repStatusConf = {
  pending:        { label: '待审核', color: '#f5a623', bg: '#fff7e6' },
  created:        { label: '待审核', color: '#f5a623', bg: '#fff7e6' },
  agent_approved: { label: '代理已批准', color: '#8b7bf7', bg: '#f4f0ff' },
  approved:       { label: '已批准', color: '#5b8def', bg: '#eef3ff' },
  processing:     { label: '处理中', color: '#5b8def', bg: '#eef3ff' },
  rejected:       { label: '已驳回', color: '#ff4d4f', bg: '#fff1f0' },
  completed:      { label: '已完成', color: '#42c978', bg: '#f0fff4' }
}
function rsc(s) { return repStatusConf[s] || repStatusConf.pending }

function batchApprovableCount(batch) {
  if (isAdmin.value) return (batch.pending_count || 0) + (batch.agent_approved_count || 0)
  return 0
}

function canApproveRecord(r) {
  if (isAdmin.value) return ['pending', 'created', 'agent_approved'].includes(r.status)
  return false
}

function supBatchHint(sb) {
  if (sb.pending_count > 0) return { text: '待审核', cls: 'hint-warn' }
  if (sb.agent_approved_count > 0) return { text: '等待管理员审核', cls: 'hint-purple' }
  if (sb.processing_count > 0) return { text: '补单处理中', cls: 'hint-blue' }
  if (sb.rejected_count > 0 && sb.rejected_count === sb.total_count) return { text: '已驳回', cls: 'hint-red' }
  return null
}

async function fetchSupplements() {
  supLoading.value = true
  try {
    const q = new URLSearchParams({ page: supPage.value, pageSize: supPageSize })
    if (supSearchStatus.value) q.set('status', supSearchStatus.value)
    const res = await fetch(`/api/tasks/supplements/by-batch?${q}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      supBatches.value = data.data.rows || []
      supTotal.value = data.data.total || 0
    }
  } catch { /* ignore */ }
  finally { supLoading.value = false }
}

function supDoSearch() { supPage.value = 1; fetchSupplements() }

function supReset() {
  supSearchStatus.value = ''
  supPage.value = 1
  fetchSupplements()
}

// 补单详情抽屉
const supDrawerShow = ref(false)
const supDrawerBatch = ref(null)
const supDrawerRecords = ref([])
const supDrawerLoading = ref(false)

async function openSupDrawer(batch) {
  supDrawerBatch.value = batch
  supDrawerShow.value = true
  supDrawerLoading.value = true
  supDrawerRecords.value = []
  try {
    const res = await fetch(`/api/tasks/supplements/batch/${batch.batch_id}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      supDrawerRecords.value = data.data || []
    }
  } catch { /* ignore */ }
  finally { supDrawerLoading.value = false }
}

function closeSupDrawer() { supDrawerShow.value = false }

async function goToBatch(batchId) {
  closeSupDrawer()
  activeModule.value = 'orders'
  await fetchBatches()
  const b = batches.value.find(x => x.id === batchId)
  if (b) openBatchDrawer(b)
}

async function goToOrder(batchId, orderNo) {
  closeSupDrawer()
  activeModule.value = 'orders'
  await fetchBatches()
  const b = batches.value.find(x => x.id === batchId)
  if (b) {
    await openBatchDrawer(b)
    await new Promise(r => setTimeout(r, 200))
    const el = document.querySelector(`[data-order-no="${orderNo}"]`)
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-pulse'); setTimeout(() => el.classList.remove('highlight-pulse'), 2000) }
  }
}

// 审批
const approvingId = ref(null)
const batchApproving = ref(null)

async function approveSupplement(record) {
  if (approvingId.value) return
  try {
    await ElMessageBox.confirm('确认批准该补单申请？', '审批确认', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  approvingId.value = record.id
  try {
    const res = await fetch(`/api/batch/supplement/${record.id}/approve`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      ElMessage.success(data.message || '已批准')
      if (supDrawerBatch.value) openSupDrawer(supDrawerBatch.value)
      fetchSupplements()
    } else { ElMessage.error(data.message || '操作失败') }
  } catch { ElMessage.error('请求失败') }
  finally { approvingId.value = null }
}

async function rejectSupplement(record) {
  if (approvingId.value) return
  let reason = ''
  try {
    const { value } = await ElMessageBox.prompt('驳回原因（可选）：', '驳回补单', { confirmButtonText: '确认驳回', cancelButtonText: '取消', inputPlaceholder: '请输入原因' })
    reason = value || ''
  } catch { return }
  approvingId.value = record.id
  try {
    const res = await fetch(`/api/batch/supplement/${record.id}/reject`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    })
    const data = await res.json()
    if (data.code === 0) {
      ElMessage.success('已驳回')
      if (supDrawerBatch.value) openSupDrawer(supDrawerBatch.value)
      fetchSupplements()
    } else { ElMessage.error(data.message || '操作失败') }
  } catch { ElMessage.error('请求失败') }
  finally { approvingId.value = null }
}

async function approveAllBatch(batch) {
  if (batchApproving.value) return
  const cnt = batchApprovableCount(batch)
  try {
    await ElMessageBox.confirm(`确认一键批准该批次（${batch.batch_no}）${cnt} 条待审核补单？`, '批量审批', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  batchApproving.value = batch.batch_id
  try {
    const res = await fetch(`/api/tasks/supplements/batch/${batch.batch_id}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code !== 0) { ElMessage.error('获取补单列表失败'); return }
    const records = data.data || []
    const approvable = isAdmin.value
      ? ['pending', 'created', 'agent_approved']
      : []
    const toApprove = records.filter(r => approvable.includes(r.status))
    if (toApprove.length === 0) { ElMessage.info('没有可审批的补单'); return }
    let ok = 0, fail = 0
    for (const r of toApprove) {
      try {
        const resp = await fetch(`/api/batch/supplement/${r.id}/approve`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${getToken()}` }
        })
        const d = await resp.json()
        if (d.code === 0) ok++; else fail++
      } catch { fail++ }
    }
    if (ok > 0) ElMessage.success(`已批准 ${ok} 条${fail > 0 ? `，${fail} 条失败` : ''}`)
    else if (fail > 0) ElMessage.error(`${fail} 条审批失败`)
    fetchSupplements()
    if (supDrawerShow.value && supDrawerBatch.value?.batch_id === batch.batch_id) {
      openSupDrawer(batch)
    }
  } catch { ElMessage.error('请求失败') }
  finally { batchApproving.value = null }
}


// ========== 刷新 ==========
watch(refreshKey, () => {
  page.value = 1; fetchStats(); fetchBatches()
  if (activeModule.value === 'supplements') { supPage.value = 1; fetchSupplements() }
})

watch(isAnyDrawerOpen, (open) => {
  if (open) lockPageScroll()
  else unlockPageScroll()
})

onMounted(() => {
  fetchStats()
  fetchBatches()
})

onUnmounted(() => {
  unlockPageScroll()
})
</script>

<template>
  <div class="records-page">
    <!-- 顶部统计 -->
    <div class="stats-row">
      <div class="stat-card card-batch">
        <div class="stat-top">
          <div class="stat-icon icon-batch">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <span class="stat-label">批次数</span>
        </div>
        <strong class="stat-value">{{ batchTotal }}</strong>
      </div>
      <div class="stat-card card-orders">
        <div class="stat-top">
          <div class="stat-icon icon-orders">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <span class="stat-label">订单总数</span>
        </div>
        <strong class="stat-value">{{ orderTotal }}</strong>
      </div>
      <div v-if="canViewOrderStatus" class="stat-card card-processing">
        <div class="stat-top">
          <div class="stat-icon icon-processing">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg>
          </div>
          <span class="stat-label">进行中</span>
        </div>
        <strong class="stat-value">{{ processingCount }}</strong>
      </div>
      <div class="stat-card card-spent">
        <div class="stat-top">
          <div class="stat-icon icon-spent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <span class="stat-label">累计消费</span>
        </div>
        <strong class="stat-value spent">¥ {{ fmtMoney(totalSpent) }}</strong>
      </div>
    </div>

    <!-- 问题订单下载 -->
    <div v-if="canExportProblemOrders" class="problem-bar">
      <button type="button" class="problem-btn" :disabled="exportingProblems" @click="openExportDialog">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {{ exportingProblems ? '导出中...' : '一键下载问题订单' }}
      </button>
      <span class="problem-hint">包含失败、无上游、派单未成功的订单</span>
    </div>

    <!-- 导出问题订单弹窗 -->
    <div v-if="canExportProblemOrders && showExportDialog" class="export-overlay" @click.self="showExportDialog = false">
      <div class="export-dialog">
        <h3 class="export-dialog-title">导出问题订单</h3>
        <div class="export-field">
          <label>开始日期</label>
          <input type="date" v-model="exportStartDate" class="export-input" />
        </div>
        <div class="export-field">
          <label>结束日期</label>
          <input type="date" v-model="exportEndDate" class="export-input" />
        </div>
        <div class="export-field">
          <label>订单类型</label>
          <select v-model="exportTargetType" class="export-input">
            <option value="">全部类型</option>
            <option v-for="pt in productTypes" :key="pt.value" :value="pt.value">{{ pt.label }}</option>
          </select>
        </div>
        <div class="export-dialog-actions">
          <button class="export-cancel-btn" @click="showExportDialog = false">取消</button>
          <button class="export-confirm-btn" :disabled="exportingProblems" @click="exportProblemOrders">
            {{ exportingProblems ? '导出中...' : '确认导出' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 主体 -->
    <section class="records-body">
      <!-- 移动端 tab 导航 -->
      <div class="mobile-tabs">
        <button
          v-for="opt in moduleOptions"
          :key="opt.key"
          type="button"
          class="mobile-tab"
          :class="{ active: activeModule === opt.key }"
          @click="switchModule(opt.key)"
        >{{ opt.label }}</button>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <div class="filter-left">
          <!-- 模块下拉选择 -->
          <div class="module-select" v-click-outside="closeModuleDropdown">
            <button type="button" class="module-trigger" @click="toggleModuleDropdown">
              <svg v-if="activeModule === 'orders'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <span>{{ activeModuleLabel }}</span>
              <svg class="chevron" :class="{ open: showModuleDropdown }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <Transition name="dropdown">
              <div v-if="showModuleDropdown" class="module-dropdown">
                <div
                  v-for="opt in moduleOptions"
                  :key="opt.key"
                  class="module-option"
                  :class="{ active: activeModule === opt.key }"
                  @click="switchModule(opt.key)"
                >
                  <svg v-if="opt.key === 'orders'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                  <span>{{ opt.label }}</span>
                  <svg v-if="activeModule === opt.key" class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
            </Transition>
          </div>

          <!-- 下单记录筛选 -->
          <div v-if="activeModule === 'orders'" class="filter-inputs">
            <input v-model="searchBatchNo" placeholder="批次号" @keyup.enter="doSearch" />
            <input v-model="searchOrderNo" placeholder="订单号" @keyup.enter="doSearch" />
            <button type="button" class="btn-search" @click="doSearch">搜索</button>
            <button type="button" class="btn-reset" @click="resetSearch">重置</button>
          </div>

          <!-- 补单记录筛选 -->
          <div v-else class="filter-inputs">
            <select v-model="supSearchStatus" class="filter-select" @change="supDoSearch">
              <option value="">全部状态</option>
              <option value="pending">待审核</option>
              <option value="agent_approved">代理已批准</option>
              <option value="processing">处理中</option>
              <option value="rejected">已驳回</option>
              <option value="completed">已完成</option>
            </select>
            <button type="button" class="btn-search" @click="supDoSearch">搜索</button>
            <button type="button" class="btn-reset" @click="supReset">重置</button>
          </div>
        </div>
        <span class="filter-total">{{ activeModule === 'orders' ? `共 ${total} 条记录` : `共 ${supTotal} 条记录` }}</span>
      </div>

      <!-- ===== 下单记录模块 ===== -->
      <template v-if="activeModule === 'orders'">
        <div class="batch-list">
          <div v-if="loading" class="empty-state">加载中...</div>
          <template v-else-if="batches.length">
            <div
              v-for="batch in batches"
              :key="batch.id"
              class="batch-row"
              :class="{ 'no-fail-col': !canViewOrderStatus }"
              :style="{ '--bdr': batchBorderTone(batch), '--prog': batchProgress(batch) + '%', '--prog-color': batchProgressTone(batch) }"
              @click="openBatchDrawer(batch)"
            >
              <div class="batch-progress-bar"></div>
              <div class="batch-info">
                <div class="batch-head">
                  <span class="batch-no">{{ batch.batch_no || batch.batch_id }}</span>
                  <span class="tag type-tag">{{ pn(batch) }}</span>
                  <span class="tag" :style="batch.data_source === 'pgy' ? 'color:#ee4d7a;background:#fff0f5;border-color:#f8d8e4' : 'color:#18a058;background:#eafaf1;border-color:#b7ebc9'">{{ batch.data_source === 'pgy' ? '蒲公英' : '实时' }}</span>
                  <span class="tag method-tag">确认提交</span>
                  <span v-if="isMyOrdersPage && isAgent && batch.nickname" class="tag user-tag">{{ batch.nickname || batch.username }}</span>
                  <span v-if="canViewOrderStatus && batch.has_upstream === false" class="tag no-upstream-tag">无上游</span>
                </div>
                <div class="batch-time">
                  提交时间: {{ fmtTime(batch.created_at) }}
                  <span v-if="canViewOrderStatus && batch.has_upstream === false" class="no-upstream-hint">请下载文件联系客服</span>
                </div>
                <!-- 移动端统计网格 -->
                <div class="mobile-stat-grid">
                  <div class="msg-cell">
                    <span class="msg-label">总数</span>
                    <strong class="msg-val">{{ batch.total_count || 0 }}</strong>
                  </div>
                  <div class="msg-cell">
                    <span class="msg-label">成功</span>
                    <strong class="msg-val ok">{{ batch.succeeded_count || 0 }}</strong>
                  </div>
                  <div v-if="canViewOrderStatus" class="msg-cell">
                    <span class="msg-label">失败</span>
                    <strong class="msg-val" :class="{ fail: batch.failed_count > 0 }">{{ batch.failed_count || 0 }}</strong>
                  </div>
                  <div class="msg-cell amount">
                    <span class="msg-label">实际付款金额</span>
                    <strong class="msg-val accent">¥ {{ fmtMoney(batch.estimated_amount) }}</strong>
                  </div>
                </div>
              </div>
              <div class="batch-stat">
                <span class="stat-lbl">总数</span>
                <strong>{{ batch.total_count || 0 }}</strong>
              </div>
              <div class="batch-stat">
                <span class="stat-lbl">成功</span>
                <strong>{{ batch.succeeded_count || 0 }}</strong>
              </div>
              <div v-if="canViewOrderStatus" class="batch-stat">
                <span class="stat-lbl">失败</span>
                <strong>{{ batch.failed_count || 0 }}</strong>
              </div>
              <div class="batch-amount">
                <span class="stat-lbl">实际付款金额</span>
                <strong>¥ {{ fmtMoney(batch.estimated_amount) }}</strong>
              </div>
              <div class="batch-action">
                <div class="flex_tab">
                  <button
                    class="export-icon-btn"
                    :class="{ loading: exporting[batch.id] }"
                    :disabled="exporting[batch.id]"
                    title="导出订单 CSV"
                    @click="exportBatchOrders(batch, $event)"
                  >
                    <svg v-if="!exporting[batch.id]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <svg v-else class="spin-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                  </button>
                  <span
                    class="status-pill"
                    :style="{
                      color: batchStatusView(batch).color,
                      background: batchStatusView(batch).bg,
                      borderColor: batchStatusView(batch).border || batchStatusView(batch).color
                    }"
                    style="margin-left: 6px;"
                  >{{ batchStatusView(batch).label }}</span>
                </div>
                <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                <div class="action-amount">
                  <span class="msg-label">实际付款金额</span>
                  <strong class="msg-val accent">¥ {{ fmtMoney(batch.estimated_amount) }}</strong>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="empty-state">暂无批次记录</div>
        </div>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="total, prev, pager, next"
            background
            small
            @current-change="fetchBatches"
          />
        </div>
      </template>

      <!-- ===== 补单记录模块（按批次分组） ===== -->
      <template v-else-if="activeModule === 'supplements'">
        <div class="batch-list">
          <div v-if="supLoading" class="empty-state">加载中...</div>
          <template v-else-if="supBatches.length">
            <div
              v-for="sb in supBatches"
              :key="sb.batch_id"
              class="batch-row sup-batch-row"
              @click="openSupDrawer(sb)"
            >
              <div class="batch-info">
                <div class="batch-head">
                  <a class="batch-no sup-link" @click.stop="goToBatch(sb.batch_id)" title="查看批次订单">{{ sb.batch_no }}</a>
                  <span class="tag type-tag">{{ sb.source_type || '补单' }}</span>
                  <span v-if="(isAdmin || isAgent) && sb.username" class="tag user-tag">{{ sb.nickname || sb.username }}</span>
                </div>
                <div class="batch-time">
                  申请时间: {{ fmtTime(sb.earliest_at) }}
                  <span v-if="supBatchHint(sb)" class="sup-hint" :class="supBatchHint(sb).cls">{{ supBatchHint(sb).text }}</span>
                </div>
                <!-- 移动端统计网格 -->
                <div class="mobile-stat-grid sup-grid">
                  <div class="msg-cell">
                    <span class="msg-label">补单数</span>
                    <strong class="msg-val">{{ sb.total_count }}</strong>
                  </div>
                  <div class="msg-cell">
                    <span class="msg-label">待审核</span>
                    <strong class="msg-val" :class="{ fail: sb.pending_count > 0 }">{{ sb.pending_count }}</strong>
                  </div>
                  <div v-if="isAdmin" class="msg-cell">
                    <span class="msg-label">代理已批</span>
                    <strong class="msg-val ok">{{ sb.agent_approved_count }}</strong>
                  </div>
                  <!-- <div class="msg-cell">
                    <span class="msg-label">差额总量</span>
                    <strong class="msg-val fail">{{ sb.total_shortage }}</strong>
                  </div> -->
                </div>
              </div>
              <div class="batch-stat">
                <span class="stat-lbl">补单数</span>
                <strong>{{ sb.total_count }}</strong>
              </div>
              <div class="batch-stat">
                <span class="stat-lbl">待审核</span>
                <strong :class="{ 'fail-num': sb.pending_count > 0 }">{{ sb.pending_count }}</strong>
              </div>
              <div class="batch-stat" v-if="isAdmin">
                <span class="stat-lbl">代理已批</span>
                <strong :class="{ 'ok-num': sb.agent_approved_count > 0 }">{{ sb.agent_approved_count }}</strong>
              </div>
              <div class="batch-stat">
                <span class="stat-lbl">差额总量</span>
                <strong class="fail-num">{{ sb.total_shortage }}</strong>
              </div>
              <div class="batch-action">
                <button
                  v-if="(isAdmin || isAgent) && batchApprovableCount(sb) > 0"
                  class="btn-approve-all"
                  :disabled="batchApproving === sb.batch_id"
                  @click.stop="approveAllBatch(sb)"
                >{{ batchApproving === sb.batch_id ? '处理中...' : `一键同意(${batchApprovableCount(sb)})` }}</button>
                <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          </template>
          <div v-else class="empty-state">暂无补单记录</div>
        </div>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="supPage"
            :page-size="supPageSize"
            :total="supTotal"
            layout="total, prev, pager, next"
            background
            small
            @current-change="fetchSupplements"
          />
        </div>
      </template>
    </section>

    <!-- 批次订单详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showDrawer" class="drawer-mask" @click.self="closeDrawer">
        <Transition name="drawer-slide">
          <div v-if="showDrawer" class="order-drawer">
            <!-- 抽屉头部 -->
            <div class="drawer-header">
              <div class="drawer-title-row">
                <h3>订单明细</h3>
                <div class="drawer-title-actions">
                  <span
                    v-if="drawerBatch && canBatchRefund && !['refunded','cancelled'].includes(drawerBatch.status) && hasPendingRefund"
                    class="refund-pending-tag"
                  >退款申请中</span>
                  <button
                    v-else-if="drawerBatch && canBatchRefund && !['refunded','cancelled'].includes(drawerBatch.status)"
                    class="refund-btn"
                    :disabled="refunding"
                    @click="requestBatchRefund"
                  >{{ refunding ? '处理中...' : '申请退款' }}</button>
                  <button class="drawer-close" @click="closeDrawer">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                </div>
              </div>
              <div v-if="drawerBatch" class="drawer-batch-info">
                <div class="dbi-row">
                  <span class="dbi-label">批次号</span>
                  <span class="dbi-val mono">{{ drawerBatch.batch_no || drawerBatch.batch_id }}</span>
                </div>
                <div class="dbi-row">
                  <span class="dbi-label">状态</span>
                  <span
                    class="status-pill small"
                    :style="{
                      color: batchStatusView(drawerBatch).color,
                      background: batchStatusView(drawerBatch).bg,
                      borderColor: batchStatusView(drawerBatch).border || batchStatusView(drawerBatch).color
                    }"
                  >{{ batchStatusView(drawerBatch).label }}</span>
                </div>
                <div class="dbi-row">
                  <span class="dbi-label">提交时间</span>
                  <span class="dbi-val">{{ fmtTime(drawerBatch.created_at) }}</span>
                </div>
                <div class="dbi-summary">
                  <div class="dbi-chip">
                    <span>总数</span>
                    <strong>{{ drawerBatch.total_count || 0 }}</strong>
                  </div>
                  <div class="dbi-chip ok">
                    <span>成功</span>
                    <strong>{{ drawerBatch.succeeded_count || 0 }}</strong>
                  </div>
                  <div v-if="canViewOrderStatus" class="dbi-chip fail">
                    <span>失败</span>
                    <strong>{{ drawerBatch.failed_count || 0 }}</strong>
                  </div>
                  <div class="dbi-chip amount">
                    <span>金额</span>
                    <strong>¥{{ fmtMoney(drawerBatch.estimated_amount) }}</strong>
                  </div>
                </div>
              </div>
              <!-- 批次进度条 -->
              <div class="dbi-progress-wrap">
                <div class="dbi-progress-bar">
                  <div
                    class="dbi-progress-fill"
                    :style="{ width: batchProgress(drawerBatch) + '%', background: batchProgressTone(drawerBatch) }"
                  ></div>
                </div>
                <span class="dbi-progress-text">{{ batchProgress(drawerBatch) }}%</span>
              </div>
            </div>

            <!-- 批次操作按钮 -->
            <div v-if="drawerBatch && canViewOrderStatus" class="drawer-actions-bar">
              <button
                type="button"
                class="verify-batch-btn"
                :disabled="verifyingBatch"
                @click="verifyBatchSnapshot"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                {{ verifyingBatch ? '验证中...' : '验证快照' }}
              </button>
            </div>

            <!-- 移动端拖拽条 -->
            <div class="drawer-drag-bar"><span></span></div>

            <!-- 订单列表 -->
            <div class="drawer-body">
              <div v-if="drawerLoading" class="drawer-loading">
                <div class="spinner"></div>
                <span>加载中...</span>
              </div>
              <template v-else-if="drawerOrders.length">
                <div v-for="(order, idx) in drawerOrders" :key="order.id" class="order-card" :data-order-no="order.order_no">
                  <div class="oc-head">
                    <span class="oc-idx">#{{ idx + 1 }}</span>
                    <span class="oc-no mono">{{ order.order_no }}</span>
                    <span v-if="isOwnBatch && pendingOrderIds.includes(order.id)" class="oc-refund-pending">退款申请中</span>
                    <button
                      v-else-if="isOwnBatch && !['completed','refunded','cancelled'].includes(order.order_status)"
                      class="oc-refund-btn"
                      :disabled="refundingOrderId === order.id"
                      @click.stop="requestOrderRefund(order)"
                    >{{ refundingOrderId === order.id ? '提交中...' : '申请退款' }}</button>
                    <span class="oc-status" :style="{ color: orderStatusView(order).color }">{{ orderStatusView(order).label }}</span>
                  </div>
                  <div class="oc-url">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <a :href="order.note_url" target="_blank" rel="noopener" @click.stop>{{ order.note_url }}</a>
                  </div>
                  <div class="oc-details">
                    <div class="oc-detail">
                      <span class="oc-dl">类型</span>
                      <span class="tag type-tag">{{ pn(order) }}</span>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">下单数</span>
                      <strong>{{ order.ordered_quantity }}</strong>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">完成数</span>
                      <strong class="ok-num">{{ order.completed_quantity || 0 }}</strong>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">付款</span>
                      <strong>¥{{ fmtMoney(order.actual_paid_amount || 0) }}</strong>
                    </div>
                  </div>
                  <!-- 订单进度条 -->
                  <div class="oc-progress-wrap">
                    <div class="oc-progress-bar">
                      <div
                        class="oc-progress-fill"
                        :style="{ width: orderProgress(order) + '%', background: orderProgressTone(order) }"
                      ></div>
                    </div>
                    <span class="oc-progress-text" :style="{ color: orderProgressTextColor(order) }">{{ orderProgress(order) }}%</span>
                  </div>

                  <!-- 失败原因 + 联系客服提示 -->
                  <div v-if="canViewOrderStatus && order.order_status === 'failed' && order.reason_message" class="oc-fail-reason">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    <span>{{ order.reason_message }}</span>
                  </div>
                  <!-- 退款原因 -->
                  <div v-if="canViewOrderStatus && order.order_status === 'refunded' && order.reason_message" class="oc-fail-reason">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>{{ order.reason_message }}</span>
                  </div>

                  <!-- 没有上游提示 -->
                  <div v-if="canViewOrderStatus && !order.product_api_endpoint && !order.external_task_id" class="oc-no-upstream">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>没有上游，请下载文件联系客服</span>
                  </div>

                  <!-- 验证快照结果（后台自动验证） -->
                  <template v-if="canViewOrderStatus && order.target_type !== 'impression'">
                    <!-- 该类型无快照指标 -->
                    <div v-if="canViewOrderStatus && getVerifyInfo(order)?.unavailable" class="oc-verify-unavailable">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span>获取不到快照，该类型不支持自动验证</span>
                    </div>
                    <!-- 已验证：显示结果 -->
                    <div v-else-if="getVerifyInfo(order) && !getVerifyInfo(order).unavailable" class="oc-verify">
                      <div class="oc-verify-head">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <span>快照验证</span>
                        <span v-if="canViewOrderStatus" class="oc-verify-badge" :class="getVerifyInfo(order).pass ? 'pass' : 'fail'">
                          {{ getVerifyInfo(order).pass ? '达标' : '未达标' }}
                        </span>
                      </div>
                      <div class="oc-verify-row">
                        <div class="oc-verify-item">
                          <span class="oc-dl">下单前</span>
                          <strong>{{ getVerifyInfo(order).baseLine }}</strong>
                        </div>
                        <div class="oc-verify-item">
                          <span class="oc-dl">验证后</span>
                          <strong>{{ getVerifyInfo(order).verified }}</strong>
                        </div>
                        <div class="oc-verify-item">
                          <span class="oc-dl">增量</span>
                          <strong class="ok-num">{{ getVerifyInfo(order).gain }}</strong>
                        </div>
                        <div class="oc-verify-item">
                          <span class="oc-dl">差额</span>
                          <strong :class="getVerifyInfo(order).shortage > 0 ? 'fail-num' : 'ok-num'">
                            {{ getVerifyInfo(order).shortage }}
                          </strong>
                        </div>
                      </div>
                      <div class="oc-verify-time">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        验证于 {{ fmtTime(order.last_verified_at) }}
                      </div>

                      <!-- 补单统一在补单记录里由管理员审核处理 -->
                    </div>

                    <!-- 未验证但已完成：等待验证提示 -->
                    <div
                      v-else-if="canViewOrderStatus && ['completed','partial_completed','failed','stopped'].includes(order.order_status)"
                      class="oc-verify-pending"
                    >
                      <div class="spinner-sm"></div>
                      <span>快照验证中，完成后自动显示结果</span>
                    </div>
                  </template>
                </div>
              </template>
              <div v-else class="drawer-empty">暂无订单数据</div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 补单详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="supDrawerShow" class="drawer-mask" @click.self="closeSupDrawer">
        <Transition name="drawer-slide">
          <div v-if="supDrawerShow" class="order-drawer sup-drawer">
            <div class="drawer-header sup-drawer-header">
              <div class="drawer-title-row">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                  补单明细
                </h3>
                <div class="drawer-title-actions">
                  <button
                    v-if="(isAdmin || isAgent) && supDrawerBatch && batchApprovableCount(supDrawerBatch) > 0"
                    class="btn-approve-all"
                    :disabled="!!batchApproving"
                    @click="approveAllBatch(supDrawerBatch)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    一键同意 ({{ batchApprovableCount(supDrawerBatch) }})
                  </button>
                  <button class="drawer-close" @click="closeSupDrawer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div v-if="supDrawerBatch" class="sup-drawer-meta">
                <a class="sup-drawer-batch-link" @click="goToBatch(supDrawerBatch.batch_id)" title="查看批次订单">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {{ supDrawerBatch.batch_no }}
                </a>
                <div class="sup-drawer-chips">
                  <div class="sd-chip"><span>补单</span><strong>{{ supDrawerBatch.total_count }}</strong></div>
                  <div class="sd-chip warn"><span>待审</span><strong>{{ supDrawerBatch.pending_count }}</strong></div>
                  <div v-if="isAdmin" class="sd-chip purple"><span>代理批</span><strong>{{ supDrawerBatch.agent_approved_count }}</strong></div>
                  <div class="sd-chip danger"><span>差额</span><strong>{{ supDrawerBatch.total_shortage }}</strong></div>
                </div>
              </div>
            </div>

            <div class="drawer-drag-bar"><span></span></div>

            <div class="drawer-body">
              <div v-if="supDrawerLoading" class="drawer-loading">
                <div class="spinner"></div>
                <span>加载中...</span>
              </div>
              <template v-else-if="supDrawerRecords.length">
                <div v-for="(r, idx) in supDrawerRecords" :key="r.id" class="sup-card" :class="{ 'sup-card--approvable': canApproveRecord(r) }">
                  <div class="sup-card-head">
                    <span class="sup-card-idx">#{{ idx + 1 }}</span>
                    <a class="sup-card-order sup-link" @click.stop="goToOrder(r.batch_id, r.order_no)" title="查看订单">{{ r.order_no }}</a>
                    <span
                      class="status-pill small"
                      :style="{ color: rsc(r.status).color, background: rsc(r.status).bg, borderColor: rsc(r.status).color }"
                    >{{ rsc(r.status).label }}</span>
                  </div>
                  <div class="sup-card-body">
                    <div class="sup-card-field">
                      <span class="sup-card-label">产品</span>
                      <span class="sup-card-val">{{ r.product_name || '-' }}</span>
                    </div>
                    <div class="sup-card-field">
                      <span class="sup-card-label">差额</span>
                      <strong class="sup-card-val fail-num">{{ r.shortage_quantity || 0 }}</strong>
                    </div>
                    <div class="sup-card-field">
                      <span class="sup-card-label">时间</span>
                      <span class="sup-card-val sup-card-time">{{ fmtTime(r.created_at) }}</span>
                    </div>
                  </div>
                  <div v-if="canApproveRecord(r)" class="sup-card-actions">
                    <button type="button" class="btn-approve" :disabled="!!approvingId" @click.stop="approveSupplement(r)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      {{ approvingId === r.id ? '处理中...' : '同意' }}
                    </button>
                    <button type="button" class="btn-reject" :disabled="!!approvingId" @click.stop="rejectSupplement(r)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      驳回
                    </button>
                  </div>
                  <div v-else-if="r.status === 'rejected' && r.reason_message" class="sup-card-rejected">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {{ r.reason_message }}
                  </div>
                </div>
              </template>
              <div v-else class="drawer-empty">暂无补单数据</div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 自定义确认弹窗 -->
    <Transition name="modal-fade">
      <div v-if="confirmModal.show" class="custom-modal-mask" @click.self="confirmCancel">
        <div class="custom-modal">
          <div class="custom-modal-body">{{ confirmModal.msg }}</div>
          <div class="custom-modal-actions">
            <button class="cm-btn cancel" @click="confirmCancel">取消</button>
            <button class="cm-btn ok" @click="confirmOk">确认</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast 提示 -->
    <Transition name="toast-slide">
      <div v-if="toastMsg" class="custom-toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.records-page {
  padding: 18px 28px 28px;
}

/* ========== 问题订单下载栏 ========== */
.problem-bar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 16px; padding: 12px 18px;
  background: #fff; border-radius: 12px;
  box-shadow: 0 2px 10px rgba(21,32,51,.04);
  border-left: 3px solid #ff4d4f;
}
.problem-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px; border-radius: 9px; font-size: 13px; font-weight: 700;
  border: 1.5px solid #ff4d4f; background: #fff1f0; color: #ff4d4f;
  cursor: pointer; transition: all 160ms ease;
}
.problem-btn:hover { background: #ffe7e6; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(255,77,79,.15); }
.problem-btn:disabled { opacity: .6; pointer-events: none; }
.problem-hint { font-size: 12px; color: #9aa5b5; }

/* ========== 导出弹窗 ========== */
.export-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center;
}
.export-dialog {
  background: #fff; border-radius: 16px; padding: 28px 32px; width: 380px;
  box-shadow: 0 12px 40px rgba(0,0,0,.15);
}
.export-dialog-title {
  font-size: 17px; font-weight: 700; color: #1a2233; margin: 0 0 20px; text-align: center;
}
.export-field {
  margin-bottom: 16px;
}
.export-field label {
  display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px;
}
.export-input {
  width: 100%; padding: 9px 12px; border: 1.5px solid #e0e4ea; border-radius: 9px;
  font-size: 14px; color: #333; background: #fafbfc; outline: none;
  transition: border-color 160ms;
  box-sizing: border-box;
}
.export-input:focus { border-color: #7c5cfc; }
.export-dialog-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;
}
.export-cancel-btn {
  padding: 8px 20px; border-radius: 9px; font-size: 13px; font-weight: 600;
  border: 1.5px solid #e0e4ea; background: #fff; color: #666; cursor: pointer;
  transition: all 160ms;
}
.export-cancel-btn:hover { background: #f5f6f8; }
.export-confirm-btn {
  padding: 8px 20px; border-radius: 9px; font-size: 13px; font-weight: 700;
  border: none; background: linear-gradient(135deg, #7c5cfc, #9b7cff); color: #fff;
  cursor: pointer; transition: all 160ms;
}
.export-confirm-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,92,252,.25); }
.export-confirm-btn:disabled { opacity: .6; pointer-events: none; }

/* ========== 批次操作按钮栏 ========== */
.drawer-actions-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-bottom: 1px solid #edf1f6;
}
.verify-batch-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  border: 1.5px solid #5b8def; background: #eef3ff; color: #5b8def;
  cursor: pointer; transition: all 160ms ease;
}
.verify-batch-btn:hover { background: #dde8ff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(91,141,239,.15); }
.verify-batch-btn:disabled { opacity: .6; pointer-events: none; }

/* ========== 统计卡片 ========== */

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  margin-bottom: 18px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px 22px;
  min-height: 110px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 18px rgba(21, 32, 51, 0.06);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(21, 32, 51, 0.1);
}

.stat-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-icon {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  flex-shrink: 0;
}

.icon-batch { background: linear-gradient(135deg, #ee4d7a, #8b7bf7); }
.icon-orders { background: linear-gradient(135deg, #42c978, #38b2ac); }
.icon-processing { background: linear-gradient(135deg, #f5a623, #f09d3d); }
.icon-spent { background: linear-gradient(135deg, #ff6b6b, #ee4d7a); }

.stat-label {
  font-size: 13px;
  color: #9aa5b5;
  font-weight: 500;
}

.stat-value {
  align-self: flex-start;
  margin-left: 52px;
  font-size: 28px;
  color: #152033;
  line-height: 1;
}

.stat-value.spent { color: #ee4d7a; }

/* ========== 移动端 tab ========== */

.mobile-tabs {
  display: none;
  border-bottom: 1px solid #edf1f6;
}

.mobile-tab {
  flex: 1;
  padding: 14px 0;
  font-size: 15px;
  font-weight: 700;
  color: #9aa5b5;
  background: none;
  border: none;
  border-bottom: 2.5px solid transparent;
  cursor: pointer;
  transition: all 180ms ease;
}

.mobile-tab.active {
  color: #152033;
  border-bottom-color: #5b8def;
}

/* ========== 移动端统计网格（默认隐藏） ========== */

.mobile-stat-grid {
  display: none;
}

.msg-cell { text-align: center; }
.msg-label { display: block; font-size: 11px; color: #9aa5b5; margin-bottom: 2px; }
.msg-val { display: block; font-size: 18px; font-weight: 800; color: #152033; }
.msg-val.ok { color: #42c978; }
.msg-val.fail { color: #ff4d4f; }
.msg-val.accent { color: #5b8def; font-size: 15px; }
.msg-cell.amount .msg-label { white-space: nowrap; }
.action-amount { display: none; }

/* ========== 主体卡片 ========== */

.records-body {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 18px rgba(21, 32, 51, 0.06);
  overflow: hidden;
}

/* ========== 筛选栏 ========== */

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid #f0f2f5;
  border-top: 3px solid transparent;
  background-clip: padding-box;
  position: relative;
}

.filter-bar::before {
  content: '';
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7, #5b8def);
  border-radius: 12px 12px 0 0;
}

.filter-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

/* ========== 模块下拉选择 ========== */

.module-select {
  position: relative;
  flex-shrink: 0;
}

.module-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px 0 14px;
  border-radius: 8px;
  border: 1px solid #dfe5ec;
  background: #fff;
  color: #152033;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.module-trigger:hover {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.08);
}

.module-trigger svg:first-child {
  color: #8b7bf7;
}

.chevron {
  color: #9aa5b5;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chevron.open {
  transform: rotate(180deg);
}

.module-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 240px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e8edf4;
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.12);
  padding: 6px;
  z-index: 100;
}

.module-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #425066;
  white-space: nowrap;
  transition: background 160ms ease, color 160ms ease;
}

.module-option:hover {
  background: #f6f8fc;
  color: #152033;
}

.module-option.active {
  background: #f3f0ff;
  color: #8b7bf7;
}

.module-option svg:first-child {
  color: #9aa5b5;
  flex-shrink: 0;
}

.module-option.active svg:first-child {
  color: #8b7bf7;
}

.module-option .sup-badge {
  margin-left: 4px;
  flex-shrink: 0;
}

.module-option .check-icon {
  margin-left: auto;
  color: #8b7bf7;
  flex-shrink: 0;
}

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: top left;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}

.filter-inputs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.filter-inputs input {
  width: 160px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #dfe5ec;
  border-radius: 6px;
  font-size: 13px;
  color: #425066;
  outline: none;
  background: #fff;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.filter-inputs input:focus {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.1);
}

.filter-inputs input::placeholder { color: #b0b8c6; }

.btn-search {
  height: 36px;
  padding: 0 24px;
  border-radius: 6px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(91, 141, 239, 0.28);
}

.btn-search:active { transform: scale(0.97); }

.btn-reset {
  height: 36px;
  padding: 0 18px;
  border-radius: 6px;
  background: #f6f8fc;
  color: #647184;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid #e8edf4;
  cursor: pointer;
  transition: background 200ms ease, color 200ms ease;
}

.btn-reset:hover { background: #eef3ff; color: #8b7bf7; }

.filter-total {
  font-size: 14px;
  color: #9aa5b5;
  font-weight: 600;
  white-space: nowrap;
}

/* ========== 批次列表 ========== */

.batch-list {
  padding: 16px 24px 24px;
}

.batch-row {
  position: relative;
  display: grid;
  grid-template-columns: 1.2fr 90px 90px 90px 160px 130px;
  align-items: center;
  padding: 20px 24px;
  margin-bottom: 12px;
  border-radius: 10px;
  border: 1px solid #f0f2f5;
  border-left: 4px solid var(--bdr, #d0d7e2);
  background: #fff;
  cursor: pointer;
  overflow: hidden;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.batch-progress-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: var(--prog, 0%);
  background: var(--prog-color, #5b8def);
  border-radius: 0 3px 3px 0;
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
  opacity: 0.6;
}

.batch-row:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(21, 32, 51, 0.07);
}

.batch-row:last-child { margin-bottom: 0; }

/* 普通用户无「失败」列：用 5 列模板，避免金额列落进窄列被折行 */
.batch-row.no-fail-col {
  grid-template-columns: 1.2fr 90px 90px 160px 130px;
}

.batch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.batch-no {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 14px;
  font-weight: 800;
  color: #152033;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid;
  line-height: 1.6;
}

.type-tag {
  color: #5b8def;
  background: #eef3ff;
  border-color: #c8d9f7;
}

.method-tag {
  color: #9aa5b5;
  background: #f6f8fc;
  border-color: #e8edf4;
}

.no-upstream-tag {
  color: #f59e0b;
  background: #fef3c7;
  border-color: #fde68a;
}

.no-upstream-hint {
  color: #f59e0b;
  font-weight: 600;
  margin-left: 8px;
}

.batch-time {
  font-size: 12px;
  color: #9aa5b5;
}

.batch-stat {
  text-align: center;
}

.stat-lbl {
  display: block;
  font-size: 12px;
  color: #9aa5b5;
  margin-bottom: 4px;
}

.batch-stat strong {
  font-size: 20px;
  color: #152033;
}

.batch-amount {
  text-align: center;
}

.batch-amount strong {
  font-size: 18px;
  color: #152033;
}

.batch-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.batch-action .flex_tab {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 14px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid;
  white-space: nowrap;
}

.export-icon-btn {
  width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center;
  border: none; background: transparent; color: #c0c8d4;
  cursor: pointer; transition: all 180ms ease; flex-shrink: 0;
}
.export-icon-btn:hover { background: #f3f0ff; color: #8b7bf7; }
.export-icon-btn:active { transform: scale(.9); }
.export-icon-btn:disabled { pointer-events: none; }
.export-icon-btn.loading { color: #8b7bf7; }
.spin-icon { animation: spin .8s linear infinite; }

.arrow-icon {
  color: #d0d7e2;
  flex-shrink: 0;
  transition: color 200ms ease, transform 200ms ease;
}

.batch-row:hover .arrow-icon {
  color: #8b7bf7;
  transform: translateX(3px);
}

/* ========== 空状态 ========== */

.empty-state {
  text-align: center;
  padding: 60px 0;
  color: #9aa5b5;
  font-size: 15px;
}

/* ========== 分页 ========== */

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 12px 24px 20px;
}

/* ========== 补单记录 ========== */

.sup-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: linear-gradient(135deg, #ee4d7a, #ff7eb3);
  color: #fff;
}

/* 补单批次行 */
.sup-batch-row {
  --bdr: #8b7bf7;
  --prog: 0%;
  --prog-color: #8b7bf7;
}

.batch-row .batch-info .batch-head .user-tag,
.sup-batch-row .batch-info .batch-head .user-tag {
  background: #f4f0ff;
  color: #8b7bf7;
  border: 1px solid #d4ccf7;
}

/* 补单状态提示 */
.sup-hint {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.hint-warn { background: #fff7e6; color: #f5a623; }
.hint-purple { background: #f4f0ff; color: #8b7bf7; }
.hint-blue { background: #eef3ff; color: #5b8def; }
.hint-red { background: #fff1f0; color: #ff4d4f; }

/* 可点击链接 */
.sup-link {
  color: #5b8def;
  cursor: pointer;
  text-decoration: none;
  transition: color 160ms ease;
}

.sup-link:hover {
  color: #8b7bf7;
  text-decoration: underline;
}

/* 一键同意按钮 */
.btn-approve-all {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  border: none;
  background: linear-gradient(135deg, #42c978, #38b2ac);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: opacity 200ms ease, transform 200ms ease, box-shadow 200ms ease;
}

.btn-approve-all:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(66, 201, 120, 0.3);
}

.btn-approve-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* ========== 补单抽屉 ========== */

.sup-drawer-header {
  border-bottom: none;
  padding-bottom: 0;
}

.sup-drawer-header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sup-drawer-header h3 svg {
  color: #8b7bf7;
}

.sup-drawer-meta {
  padding: 12px 0 0;
}

.sup-drawer-batch-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  color: #5b8def;
  cursor: pointer;
  margin-bottom: 12px;
  transition: color 160ms ease;
}

.sup-drawer-batch-link:hover {
  color: #8b7bf7;
  text-decoration: underline;
}

.sup-drawer-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sd-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: #f6f8fc;
  font-size: 12px;
  color: #647184;
}

.sd-chip strong {
  font-size: 15px;
  color: #152033;
}

.sd-chip.warn { background: #fff7e6; }
.sd-chip.warn strong { color: #f5a623; }
.sd-chip.purple { background: #f4f0ff; }
.sd-chip.purple strong { color: #8b7bf7; }
.sd-chip.danger { background: #fff1f0; }
.sd-chip.danger strong { color: #ff4d4f; }

/* 补单记录卡片 */
.sup-card {
  background: #fff;
  border: 1px solid #eef0f5;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.sup-card:hover {
  border-color: #d4ccf7;
  box-shadow: 0 2px 12px rgba(139, 123, 247, 0.08);
}

.sup-card--approvable {
  border-left: 3px solid #8b7bf7;
}

.sup-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.sup-card-idx {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b7bf7, #6c5ce7);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.sup-card-order {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 12.5px;
  font-weight: 600;
}

.sup-card-body {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding: 10px 0;
  border-top: 1px dashed #eef0f5;
  border-bottom: 1px dashed #eef0f5;
}

.sup-card-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sup-card-label {
  font-size: 11px;
  color: #9aa5b5;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sup-card-val {
  font-size: 14px;
  color: #152033;
  font-weight: 600;
}

.sup-card-time {
  font-size: 12px;
  font-weight: 400;
  color: #647184;
}

.sup-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.sup-card-actions .btn-approve,
.sup-card-actions .btn-reject {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
}

.sup-card-rejected {
  margin-top: 10px;
  padding: 8px 12px;
  background: #fff1f0;
  border-radius: 6px;
  font-size: 12px;
  color: #ff4d4f;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 高亮脉冲动画（定位订单时） */
@keyframes highlight-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(139, 123, 247, 0); }
  30% { box-shadow: 0 0 0 4px rgba(139, 123, 247, 0.3); }
  60% { box-shadow: 0 0 0 2px rgba(139, 123, 247, 0.15); }
}

.highlight-pulse {
  animation: highlight-pulse 1s ease 2;
  border-color: #8b7bf7 !important;
}

.time-cell {
  font-size: 12px;
  color: #9aa5b5;
}

.filter-select {
  height: 36px;
  padding: 0 32px 0 14px;
  border: 1px solid #dfe5ec;
  border-radius: 6px;
  font-size: 13px;
  color: #425066;
  outline: none;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpolyline points='1 1 5 5 9 1' fill='none' stroke='%239aa5b5' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 12px center;
  appearance: none;
  cursor: pointer;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.filter-select:focus {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.1);
}

/* 补单操作按钮 */
.sup-actions {
  display: flex;
  gap: 6px;
}

.btn-approve {
  height: 28px;
  padding: 0 14px;
  border-radius: 5px;
  border: none;
  background: #42c978;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 200ms ease, transform 200ms ease;
}

.btn-approve:hover { opacity: 0.85; transform: translateY(-1px); }
.btn-approve:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.btn-reject {
  height: 28px;
  padding: 0 14px;
  border-radius: 5px;
  border: 1px solid #ffc0c0;
  background: #fff1f0;
  color: #ff4d4f;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 200ms ease, transform 200ms ease;
}

.btn-reject:hover { background: #ffe7e6; transform: translateY(-1px); }
.btn-reject:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.sup-done-hint {
  font-size: 12px;
  color: #9aa5b5;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
}

/* ========== 抽屉 ========== */

.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
}

.order-drawer {
  width: 520px;
  max-width: 100%;
  height: 100%;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 40px rgba(15, 23, 42, 0.12);
  overflow: hidden;
}

.drawer-header {
  padding: 22px 24px 18px;
  border-bottom: 1px solid #f0f2f5;
  flex-shrink: 0;
  background: linear-gradient(180deg, #fafbfd, #fff);
}

.drawer-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.drawer-title-row h3 {
  font-size: 18px;
  font-weight: 800;
  color: #152033;
}

.drawer-title-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.refund-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #ef4444, #f97316);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity .2s;
}
.refund-btn:hover { opacity: .85; }
.refund-btn:disabled { opacity: .5; cursor: not-allowed; }

.drawer-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: none;
  background: #f6f8fc;
  color: #647184;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
}

.drawer-close:hover {
  background: #fee2e2;
  color: #ef4444;
}

.drawer-batch-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dbi-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dbi-label {
  font-size: 12px;
  color: #9aa5b5;
  min-width: 56px;
}

.dbi-val {
  font-size: 13px;
  color: #425066;
}

.dbi-val.mono {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-weight: 700;
  color: #152033;
}

.status-pill.small {
  font-size: 11px;
  padding: 2px 10px;
}

.dbi-summary {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.dbi-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px;
  border-radius: 8px;
  background: #f6f8fc;
  flex: 1;
  min-width: 70px;
}

.dbi-chip span {
  font-size: 11px;
  color: #9aa5b5;
  margin-bottom: 2px;
}

.dbi-chip strong {
  font-size: 16px;
  color: #152033;
}

.dbi-chip.ok strong { color: #42c978; }
.dbi-chip.fail strong { color: #ff4d4f; }
.dbi-chip.amount strong { color: #ee4d7a; font-size: 14px; }

/* 批次进度条 */
.dbi-progress-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.dbi-progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 6px;
  background: #f0f2f5;
  overflow: hidden;
}

.dbi-progress-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.dbi-progress-text {
  font-size: 12px;
  font-weight: 800;
  color: #647184;
  min-width: 34px;
  text-align: right;
}

/* 拖拽条（仅移动端可见） */
.drawer-drag-bar {
  display: none;
}

/* 订单列表 */
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.drawer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 12px;
  color: #9aa5b5;
  font-size: 14px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #e8edf4;
  border-top-color: #8b7bf7;
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.drawer-empty {
  text-align: center;
  padding: 60px 0;
  color: #9aa5b5;
  font-size: 14px;
}

.order-card {
  padding: 16px;
  border: 1px solid #f0f2f5;
  border-radius: 10px;
  margin-bottom: 10px;
  transition: box-shadow 200ms ease;
}

.order-card:hover {
  box-shadow: 0 4px 16px rgba(21, 32, 51, 0.06);
}

.order-card:last-child { margin-bottom: 0; }

.oc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.oc-idx {
  font-size: 12px;
  font-weight: 800;
  color: #8b7bf7;
  background: #f3f0ff;
  padding: 1px 7px;
  border-radius: 4px;
}

.oc-no {
  font-size: 12px;
  color: #647184;
}

.oc-no.mono {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
}

.oc-refund-btn {
  margin-left: auto;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #ef4444;
  background: #fee2e2;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all .2s;
  white-space: nowrap;
}
.oc-refund-btn:hover { background: #fecaca; }
.oc-refund-btn:disabled { opacity: .5; cursor: not-allowed; }

.oc-refund-pending {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #f59e0b;
  background: #fef3c7;
  padding: 3px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.oc-status {
  font-size: 12px;
  font-weight: 700;
}

.oc-url {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  color: #5b8def;
}

.oc-url svg { flex-shrink: 0; color: #b0b8c6; }

.oc-url a {
  font-size: 12px;
  color: #5b8def;
  text-decoration: none;
  word-break: break-all;
  line-height: 1.4;
}

.oc-url a:hover { text-decoration: underline; }

.oc-details {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.oc-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.oc-dl {
  font-size: 11px;
  color: #9aa5b5;
}

.oc-detail strong {
  font-size: 14px;
  color: #152033;
}

.oc-detail .ok-num { color: #42c978; }

/* 订单进度条 */
.oc-progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.oc-progress-bar {
  flex: 1;
  height: 4px;
  border-radius: 4px;
  background: #f0f2f5;
  overflow: hidden;
}

.oc-progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.oc-progress-text {
  font-size: 11px;
  font-weight: 800;
  min-width: 30px;
  text-align: right;
}

/* 没有上游提示 */
.oc-no-upstream {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef3c7;
  border: 1px solid #fde68a;
  font-size: 12px;
  color: #92400e;
  font-weight: 600;
}
.oc-no-upstream svg { flex-shrink: 0; color: #f59e0b; }

.oc-fail-reason {
  margin-top: 12px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  font-size: 12px;
  color: #a8071a;
  font-weight: 600;
  line-height: 1.5;
}
.oc-fail-reason svg { flex-shrink: 0; color: #ff4d4f; margin-top: 1px; }

/* 验证快照区域 */
.oc-verify {
  margin-top: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #f8fafd;
  border: 1px solid #e8edf4;
}

.oc-verify-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 700;
  color: #647184;
}

.oc-verify-head svg { color: #5b8def; flex-shrink: 0; }

.oc-verify-badge {
  margin-left: auto;
  padding: 1px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 800;
}

.oc-verify-badge.pass {
  color: #42c978;
  background: #e8faf0;
}

.oc-verify-badge.fail {
  color: #ff4d4f;
  background: #fff1f0;
}

.oc-verify-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.oc-verify-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.oc-verify-item strong {
  font-size: 14px;
  color: #152033;
}

.oc-verify-item .ok-num { color: #42c978; }
.oc-verify-item .fail-num { color: #ff4d4f; }

.oc-verify-time {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  font-size: 11px;
  color: #9aa5b5;
}

.oc-verify-time svg { flex-shrink: 0; }

/* 快照不可用提示 */
.oc-verify-unavailable {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f6f8fc;
  border: 1px solid #e0e5ed;
  font-size: 12px;
  font-weight: 600;
  color: #9aa5b5;
}
.oc-verify-unavailable svg { flex-shrink: 0; color: #b0b8c6; }

/* 等待验证提示 */
.oc-verify-pending {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fefce8;
  border: 1px solid #fde68a;
  font-size: 12px;
  color: #92400e;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid #fde68a;
  border-top-color: #f59e0b;
  border-radius: 50%;
  animation: spin 800ms linear infinite;
  flex-shrink: 0;
}

/* 订单操作按钮 */
.oc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.btn-supplement {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  border: none;
  background: linear-gradient(135deg, #ee4d7a, #ff7eb3);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 200ms ease, transform 200ms ease, box-shadow 200ms ease;
  width: 100%;
  justify-content: center;
}

.btn-supplement:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(238, 77, 122, 0.25);
}

.btn-supplement:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.rep-submitted-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #42c978;
}

/* 抽屉动画 — PC 右侧滑入 */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 280ms ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.drawer-slide-enter-from {
  transform: translateX(100%);
}

.drawer-slide-leave-to {
  transform: translateX(100%);
}

/* ========== 响应式 ========== */

@media (max-width: 1280px) {
  .batch-row {
    grid-template-columns: 1.2fr 80px 80px 80px 140px 110px;
    padding: 16px 18px;
  }

  .batch-row.no-fail-col {
    grid-template-columns: 1.2fr 80px 80px 140px 110px;
  }

  .batch-stat strong { font-size: 18px; }
  .batch-amount strong { font-size: 16px; }
}

@media (max-width: 1000px) {
  .stats-row { grid-template-columns: repeat(2, 1fr); }

  .batch-row {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 14px 10px;
  }

  .batch-info { grid-column: 1 / -1; }

  .batch-amount { text-align: left; }

  .batch-action {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .records-page { padding: 12px; }

  .problem-bar {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 12px;
    margin-bottom: 12px;
    border-left: 0;
    border: 1px solid #ffe1df;
    border-radius: 10px;
    background: #fffafa;
    box-shadow: 0 4px 16px rgba(255, 77, 79, 0.08);
  }

  .problem-btn {
    width: 100%;
    height: 40px;
    justify-content: center;
    padding: 0 14px;
    border-radius: 8px;
    white-space: nowrap;
  }

  .problem-hint {
    display: block;
    padding: 8px 10px;
    border-radius: 8px;
    background: #fff3f2;
    color: #8c96a8;
    font-size: 12px;
    line-height: 1.45;
  }

  .btn-approve-all { height: 28px; padding: 0 10px; font-size: 12px; }

  .stats-row { grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat-card { padding: 14px; min-height: 90px; }
  .stat-top { gap: 8px; }
  .stat-icon { width: 32px; height: 32px; }
  .stat-icon svg { width: 15px; height: 15px; }
  .stat-label { font-size: 12px; }
  .stat-value { margin-left: 40px; font-size: 20px; }

  .filter-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 16px;
    border-top: none;
  }

  .filter-bar::before { display: none; }

  .filter-left {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 10px;
  }

  .module-trigger { width: 100%; justify-content: flex-start; }

  .module-dropdown { min-width: 100%; }

  .filter-inputs {
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    width: 100%;
    gap: 8px;
  }
  .filter-inputs input { width: 100%; min-width: 0; }
  .filter-inputs .btn-search { grid-column: 1; }
  .filter-inputs .btn-reset { grid-column: 2; }
  .filter-inputs .filter-select { grid-column: 1 / -1; }

  .batch-list { padding: 12px 16px 16px; }

  .mobile-tabs { display: flex; }
  .module-select { display: none; }

  .batch-row {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 16px;
  }

  .batch-info { grid-column: 0; margin-bottom: 0; }

  .batch-stat,
  .batch-amount { display: none; }

  .mobile-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 0;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #f0f2f5;
  }

  .mobile-stat-grid:not(.sup-grid) {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .mobile-stat-grid:not(.sup-grid) .msg-cell.amount {
    display: none;
  }

  .action-amount {
    display: block;
    text-align: right;
    margin-top: 2px;
  }
  .action-amount .msg-label { font-size: 10px; color: #9aa5b5; }
  .action-amount .msg-val { font-size: 14px; font-weight: 700; }

  .batch-head { padding-right: 80px; flex-wrap: wrap; }

  .mobile-stat-grid.sup-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .batch-action {
    grid-column: 1;
    position: absolute;
    top: 14px; right: 14px;
    margin-top: 0;
    gap: 4px;
    flex-direction: column;
    align-items: flex-end;
  }

  .batch-action .arrow-icon { display: none; }

  .batch-action .export-icon-btn {
    width: 26px; height: 26px; border-radius: 6px;
  }

  .batch-action .status-pill {
    font-size: 12px; padding: 3px 10px;
  }

  /* 批次号独占一行，三个标签落到下一行横向排列（不被长批次号挤成竖排） */
  .batch-head .batch-no { font-size: 12.5px; flex-basis: 100%; }

  .pagination-wrap { padding: 8px 16px 16px; }

  /* 抽屉 → 底部弹窗 */
  .drawer-mask {
    align-items: flex-end;
    justify-content: stretch;
  }

  .order-drawer {
    width: 100%;
    height: auto;
    max-height: 88vh;
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 40px rgba(15, 23, 42, 0.15);
  }

  .drawer-drag-bar {
    display: flex;
    justify-content: center;
    padding: 10px 0 4px;
    flex-shrink: 0;
  }

  .drawer-drag-bar span {
    width: 36px;
    height: 4px;
    border-radius: 4px;
    background: #d0d7e2;
  }

  .drawer-header {
    padding: 14px 18px 14px;
  }

  .drawer-title-row { margin-bottom: 12px; }
  .drawer-title-row h3 { font-size: 16px; }

  .dbi-summary { gap: 6px; }
  .dbi-chip { padding: 6px 10px; }
  .dbi-chip strong { font-size: 14px; }

  .drawer-body { padding: 12px 18px 18px; }

  .order-card { padding: 14px; }

  .oc-details {
    grid-template-columns: repeat(2, 1fr);
  }

  .oc-verify-row {
    grid-template-columns: repeat(2, 1fr);
  }

  /* 补单批次行 - 移动端 */
  .sup-batch-row {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 16px;
  }

  .sup-batch-row .batch-info {
    grid-column: 1;
    margin-bottom: 10px;
  }

  .sup-batch-row .batch-head {
    margin-bottom: 4px;
  }

  .sup-batch-row .batch-head .batch-no {
    font-size: 12.5px;
  }

  .sup-batch-row .batch-stat {
    display: none;
  }

  .sup-batch-row .batch-action {
    position: absolute;
    bottom: 30px; 
    right: 14px;
    top: auto;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }


  .batch-action .flex_tab {
    display: flex;
    margin-bottom: 10px;
  }

  .sup-batch-row .batch-action .arrow-icon { display: none; }

  .sup-batch-row .mobile-stat-grid {
    display: grid;
    padding-right: 90px;
  }

  .sup-hint { margin-left: 0; margin-top: 10px; display: block; }

  .sup-batch-row .batch-time {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  /* 补单抽屉 - 移动端 */
  .sup-drawer-meta { padding-top: 8px; }

  .sup-drawer-batch-link { font-size: 12px; margin-bottom: 8px; }

  .sup-drawer-chips { gap: 6px; }

  .sd-chip { padding: 4px 8px; font-size: 11px; }
  .sd-chip strong { font-size: 13px; }

  .sup-card { padding: 12px; margin-bottom: 10px; }

  .sup-card-head { margin-bottom: 10px; gap: 6px; flex-wrap: wrap; }

  .sup-card-idx { width: 22px; height: 22px; font-size: 10px; }

  .sup-card-order { font-size: 11.5px; }

  .sup-card-body {
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 8px 0;
  }

  .sup-card-field:last-child {
    grid-column: 1 / -1;
  }

  .sup-card-label { font-size: 10px; }
  .sup-card-val { font-size: 13px; }

  .sup-card-actions { margin-top: 10px; gap: 6px; }
  .sup-card-actions .btn-approve,
  .sup-card-actions .btn-reject {
    height: 30px;
    padding: 0 12px;
    font-size: 12px;
  }

  /* 底部弹窗动画：上下滑动 */
  .drawer-slide-enter-from {
    transform: translateY(100%);
  }

  .drawer-slide-leave-to {
    transform: translateY(100%);
  }
}

.refund-pending-tag {
  display: inline-block;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #f59e0b;
  background: #fef3c7;
  border-radius: 8px;
}

.custom-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-modal {
  background: #fff;
  border-radius: 16px;
  padding: 28px 28px 20px;
  min-width: 340px;
  max-width: 420px;
  box-shadow: 0 20px 60px rgba(0,0,0,.18);
}

.custom-modal-body {
  font-size: 15px;
  color: #1f2937;
  line-height: 1.6;
  margin-bottom: 24px;
  text-align: center;
}

.custom-modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.cm-btn {
  padding: 9px 32px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all .2s;
}

.cm-btn.cancel {
  background: #f3f4f6;
  color: #6b7280;
}
.cm-btn.cancel:hover { background: #e5e7eb; }

.cm-btn.ok {
  background: linear-gradient(135deg, #7c3aed, #6366f1);
  color: #fff;
}
.cm-btn.ok:hover { opacity: .9; }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity .2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

.custom-toast {
  position: fixed;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  background: #1f2937;
  color: #fff;
  padding: 12px 28px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10000;
  box-shadow: 0 8px 30px rgba(0,0,0,.18);
}

.toast-slide-enter-active, .toast-slide-leave-active { transition: all .3s; }
.toast-slide-enter-from { opacity: 0; transform: translate(-50%, -20px); }
.toast-slide-leave-to { opacity: 0; transform: translate(-50%, -20px); }

</style>
