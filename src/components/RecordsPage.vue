<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox, ElMessage, ElPagination, ElDatePicker } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/date-picker/style/css'
import { getUserOrderStatusDisplay } from '../utils/orderStatusDisplay.js'
import EmptyState from './EmptyState.vue'

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
const isRegularUserOrderView = computed(() => isMyOrdersPage.value && !isAdmin.value && !isAgent.value)
const pageHeroTitle = computed(() => (isMyOrdersPage.value ? '我的订单' : '下单记录'))
const pageHeroDesc = computed(() =>
  isRegularUserOrderView.value
    ? '查看您提交的订单进度与退款状态'
    : isMyOrdersPage.value
      ? '查看您提交的批次进度、订单明细与退款状态'
      : '批次汇总、订单状态追踪，管理员可审核补单与导出问题订单'
)
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
const searchAgentId = ref('')
const searchStartDate = ref('')
const searchEndDate = ref('')
const agentList = ref([])

async function fetchAgentList() {
  if (!isAdmin.value) return
  try {
    const res = await fetch('/api/users/agents', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) agentList.value = data.data || []
  } catch { /* ignore */ }
}

// ========== 批次 / 订单列表 ==========
const batches = ref([])
const orders = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 5
const loading = ref(false)

// ========== 状态 & 类型 ==========
const statusConf = {
  pending:            { label: '待处理',   color: '#9aa5b5', bg: '#f6f8fc', border: '#d0d7e2' },
  processing:         { label: '处理中',   color: '#2f6df6', bg: 'rgba(47, 109, 246, 0.1)', border: '#2f6df6' },
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
  return canViewOrderStatus.value ? sc(batch?.status).color : 'var(--rp-primary)'
}

function batchBorderTone(batch) {
  return canViewOrderStatus.value ? sc(batch?.status).border : '#2f6df6'
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

/** 订单实付：优先后端 actual_paid_amount，兼容旧数据缺字段 */
function orderPaidAmount(order) {
  if (!order) return 0
  for (const key of ['actual_paid_amount', 'payable_amount', 'original_total_amount']) {
    const n = parseFloat(order[key])
    if (Number.isFinite(n) && n > 0) return n
  }
  const qty = Number(order.ordered_quantity) || 0
  const unit = parseFloat(order.original_unit_price)
  if (qty > 0 && Number.isFinite(unit) && unit > 0) return Math.round(qty * unit * 10000) / 10000
  return 0
}

// ========== API ==========
function buildAdminFilterParams(q) {
  if (!isAdmin.value) return
  if (searchAgentId.value) q.set('agent_id', searchAgentId.value)
  if (searchStartDate.value) q.set('start_date', searchStartDate.value)
  if (searchEndDate.value) q.set('end_date', searchEndDate.value)
}

async function fetchStats() {
  try {
    const q = new URLSearchParams()
    buildAdminFilterParams(q)
    const res = await fetch(`/api/tasks/stats?${q}`, {
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

function orderListStatusView(order) {
  return orderStatusView(order)
}

function orderListProgress(order) {
  if (typeof order?.progress === 'number') return order.progress
  return orderProgress(order)
}

function orderListBorderTone(order) {
  return orderListStatusView(order).color || '#2f6df6'
}

function orderListProgressTone(order) {
  return canViewOrderStatus.value ? orderListStatusView(order).color : 'var(--rp-primary)'
}

async function fetchOrders() {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: page.value, pageSize })
    if (searchOrderNo.value.trim()) q.set('order_no', searchOrderNo.value.trim())
    if (searchStartDate.value) q.set('start', searchStartDate.value)
    if (searchEndDate.value) q.set('end', searchEndDate.value)
    const res = await fetch(`/api/tasks/orders?${q}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      orders.value = data.data.rows || []
      total.value = data.data.total || 0
      expandedOrderId.value = null
      userOrderDetailMap.value = {}
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

async function fetchRecords() {
  if (isRegularUserOrderView.value) await fetchOrders()
  else await fetchBatches()
}

async function fetchBatches() {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: page.value, pageSize })
    if (searchBatchNo.value.trim()) q.set('batch_no', searchBatchNo.value.trim())
    buildAdminFilterParams(q)
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

function doSearch() { page.value = 1; fetchStats(); fetchRecords() }

function resetSearch() {
  searchBatchNo.value = ''
  searchOrderNo.value = ''
  searchAgentId.value = ''
  searchStartDate.value = ''
  searchEndDate.value = ''
  page.value = 1
  fetchStats()
  fetchRecords()
}

// ========== 批次详情抽屉 ==========
const showDrawer = ref(false)
const drawerBatch = ref(null)
const drawerOrders = ref([])
const drawerLoading = ref(false)
const isDrawerVisible = computed(() =>
  (showDrawer.value && !isRegularUserOrderView.value) || supDrawerShow.value
)
const isAnyDrawerOpen = computed(() => isDrawerVisible.value)
const drawerBodyRef = ref(null)
let scrollLockDepth = 0
let scrollLockSnapshot = null

/** 仅用 overflow 锁定背景滚动，避免 position:fixed 导致关闭时页面先闪到顶部 */
function lockPageScroll() {
  scrollLockDepth += 1
  if (scrollLockDepth > 1) return
  scrollLockSnapshot = {
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow
  }
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
}

function unlockPageScroll() {
  if (scrollLockDepth <= 0) return
  scrollLockDepth -= 1
  if (scrollLockDepth > 0 || !scrollLockSnapshot) return
  const { htmlOverflow, bodyOverflow } = scrollLockSnapshot
  document.documentElement.style.overflow = htmlOverflow
  document.body.style.overflow = bodyOverflow
  scrollLockSnapshot = null
}

/** 普通用户展开详情时不锁滚动；进入页面时兜底恢复 */
function ensurePageScrollable() {
  if (isDrawerVisible.value) return
  scrollLockDepth = 0
  scrollLockSnapshot = null
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
}

function scrollToOrderInDrawer(orderNo) {
  const root = drawerBodyRef.value
  if (!root || !orderNo) return
  const el = root.querySelector(`[data-order-no="${CSS.escape(String(orderNo))}"]`)
  if (!el) return
  const targetTop = el.offsetTop - (root.clientHeight - el.offsetHeight) / 2
  root.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  el.classList.add('highlight-pulse')
  setTimeout(() => el.classList.remove('highlight-pulse'), 2000)
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

// ========== 普通用户订单展开 ==========
const expandedOrderId = ref(null)
const userOrderDetailMap = ref({})
const userOrderDetailLoading = ref(null)

const UOR_EXPAND_MS = 320
const UOR_EXPAND_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function uorExpandEl(el) {
  return el instanceof HTMLElement ? el : null
}

function uorExpandClear(el) {
  const node = uorExpandEl(el)
  if (!node) return
  node.style.height = ''
  node.style.overflow = ''
  node.style.transition = ''
  node.style.opacity = ''
}

function onUorBeforeEnter(el) {
  const node = uorExpandEl(el)
  if (!node) return
  uorExpandClear(node)
  node.style.height = '0'
  node.style.overflow = 'hidden'
}

function onUorEnter(el, done) {
  const node = uorExpandEl(el)
  if (!node) {
    done()
    return
  }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    node.removeEventListener('transitionend', onEnd)
    uorExpandClear(node)
    node.style.height = 'auto'
    done()
  }
  const onEnd = (e) => {
    if (e.target === node && e.propertyName === 'height') finish()
  }
  const run = () => {
    const target = node.scrollHeight
    node.style.transition = `height ${UOR_EXPAND_MS}ms ${UOR_EXPAND_EASE}`
    void node.offsetHeight
    node.style.height = `${target}px`
    node.addEventListener('transitionend', onEnd)
    window.setTimeout(finish, UOR_EXPAND_MS + 40)
  }
  /* 等 Vue 绘制完再量高度，避免首次展开量到 0 或偏小导致卡顿 */
  requestAnimationFrame(() => requestAnimationFrame(run))
}

function onUorBeforeLeave(el) {
  const node = uorExpandEl(el)
  if (!node) return
  uorExpandClear(node)
  node.style.height = `${node.scrollHeight}px`
  node.style.overflow = 'hidden'
}

function onUorLeave(el, done) {
  const node = uorExpandEl(el)
  if (!node) {
    done()
    return
  }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    node.removeEventListener('transitionend', onEnd)
    done()
  }
  const onEnd = (e) => {
    if (e.target === node && e.propertyName === 'height') finish()
  }
  node.style.transition = `height ${UOR_EXPAND_MS}ms ${UOR_EXPAND_EASE}`
  void node.offsetHeight
  node.style.height = '0'
  node.addEventListener('transitionend', onEnd)
  window.setTimeout(finish, UOR_EXPAND_MS + 40)
}

function detailOrder(order) {
  if (!order?.id) return order
  return userOrderDetailMap.value[order.id] || order
}

async function toggleUserOrderDetail(order) {
  if (!order?.id) return
  if (expandedOrderId.value === order.id) {
    expandedOrderId.value = null
    return
  }
  if (userOrderDetailLoading.value === order.id) return
  pendingOrderIds.value = []
  if (order.batch_id) checkPendingRefund(order.batch_id)
  /* 先拉详情再展开，避免动画按「加载中」高度播放后内容突增卡顿 */
  if (!userOrderDetailMap.value[order.id]) {
    userOrderDetailLoading.value = order.id
    try {
      const res = await fetch(`/api/tasks/orders/${order.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      const data = await res.json()
      if (data.code === 0 && data.data) {
        userOrderDetailMap.value = { ...userOrderDetailMap.value, [order.id]: data.data }
      }
    } catch { /* ignore */ }
    finally {
      userOrderDetailLoading.value = null
    }
  }
  expandedOrderId.value = order.id
  await nextTick()
  if (expandedOrderId.value === order.id) {
    window.setTimeout(() => {
      if (expandedOrderId.value !== order.id) return
      const row = document.querySelector(`[data-order-id="${order.id}"]`)
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, UOR_EXPAND_MS + 24)
  }
}

async function openOrderDrawer(order) {
  if (isRegularUserOrderView.value) {
    await toggleUserOrderDetail(order)
    return
  }
  if (!order?.id) return
  drawerBatch.value = {
    id: order.batch_id,
    batch_no: order.batch_no,
    user_id: order.user_id,
    created_at: order.created_at,
    total_count: order.ordered_quantity,
    succeeded_count: order.completed_quantity || 0,
    estimated_amount: order.actual_paid_amount,
    target_type: order.target_type,
    product_name: order.product_name,
    data_source: order.data_source,
    status: order.order_status
  }
  showDrawer.value = true
  drawerLoading.value = true
  drawerOrders.value = []
  hasPendingRefund.value = false
  pendingOrderIds.value = []
  avatarLoadFailed.value = {}
  if (order.batch_id) checkPendingRefund(order.batch_id)
  try {
    const res = await fetch(`/api/tasks/orders/${order.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data) {
      drawerOrders.value = [data.data]
    } else {
      drawerOrders.value = [order]
    }
  } catch {
    drawerOrders.value = [order]
  } finally {
    drawerLoading.value = false
  }
}

function closeDrawer() { showDrawer.value = false }

const copiedNoteUrlId = ref(null)
let copiedNoteUrlTimer = null

function fallbackCopyText(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

async function copyNoteUrl(url, orderId) {
  if (!url) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url)
    } else if (!fallbackCopyText(url)) {
      ElMessage.error('复制失败')
      return
    }
  } catch {
    if (!fallbackCopyText(url)) {
      ElMessage.error('复制失败')
      return
    }
  }
  copiedNoteUrlId.value = orderId
  if (copiedNoteUrlTimer) clearTimeout(copiedNoteUrlTimer)
  copiedNoteUrlTimer = setTimeout(() => { copiedNoteUrlId.value = null }, 2000)
}

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
  return canViewOrderStatus.value ? osc(order?.order_status).color : 'var(--rp-primary)'
}

function orderProgressTextColor(order) {
  return canViewOrderStatus.value ? osc(order?.order_status).color : 'var(--rp-primary)'
}

function orderAvatarUrl(order) {
  return order?.avatar_url || order?.avatar || ''
}

function orderAvatarInitial(order) {
  const name = (order?.author_name || order?.title || '笔记').trim()
  return (name[0] || '笔').toUpperCase()
}

function orderAuthorName(order) {
  return order?.author_name || ''
}

function orderNoteTitle(order) {
  return order?.title || ''
}

const avatarLoadFailed = ref({})

function showOrderAvatarFallback(order) {
  if (!order?.id) return true
  return !orderAvatarUrl(order) || !!avatarLoadFailed.value[order.id]
}

function onOrderAvatarError(orderId) {
  if (!orderId) return
  avatarLoadFailed.value = { ...avatarLoadFailed.value, [orderId]: true }
}

/** 补单明细行 → 与订单卡片共用的笔记/头像字段 */
function supAsOrder(r) {
  if (!r) return {}
  return {
    id: r.order_id || r.id,
    title: r.order_title || r.title || '',
    author_name: r.author_name || '',
    avatar_url: r.avatar_url || '',
    note_url: r.order_note_url || r.note_url || ''
  }
}

function supRejectReason(r) {
  return (r?.review_remark || r?.reason_message || '').trim()
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
        fetchRecords()
        fetchBalance()
      } else {
        hasPendingRefund.value = true
        showToast(data.message || '退款申请已提交')
        fetchRecords()
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
        await fetchRecords()
        if (isRegularUserOrderView.value) {
          await fetchRecords()
          const updated = orders.value.find(o => o.id === order.id)
          if (updated) {
            userOrderDetailMap.value = { ...userOrderDetailMap.value, [order.id]: updated }
            expandedOrderId.value = order.id
          }
        } else if (drawerBatch.value) {
          openBatchDrawer(drawerBatch.value)
        }
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

function supBatchStatusView(sb) {
  const hint = supBatchHint(sb)
  if (!hint) return { label: '补单', color: '#2f6df6', bg: 'rgba(47, 109, 246, 0.1)' }
  const tone = {
    'hint-warn': { color: '#f5a623', bg: '#fff7e6' },
    'hint-purple': { color: '#8b7bf7', bg: '#f4f0ff' },
    'hint-blue': { color: '#2f6df6', bg: 'rgba(47, 109, 246, 0.1)' },
    'hint-red': { color: '#ff4d4f', bg: '#fff1f0' }
  }
  return { label: hint.text, ...(tone[hint.cls] || { color: '#647184', bg: '#f6f8fc' }) }
}

function supBatchProgress(sb) {
  const total = sb.total_count || 0
  if (!total) return 0
  const open = (sb.pending_count || 0) + (sb.agent_approved_count || 0)
  return Math.min(100, Math.round(((total - open) / total) * 100))
}

function supBatchProgressTone() {
  return 'var(--rp-primary)'
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
  if (!b) return
  await openBatchDrawer(b)
  await nextTick()
  scrollToOrderInDrawer(orderNo)
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
  page.value = 1; fetchStats(); fetchRecords()
  if (activeModule.value === 'supplements') { supPage.value = 1; fetchSupplements() }
})

watch(isDrawerVisible, (open) => {
  if (open) lockPageScroll()
  else {
    unlockPageScroll()
    ensurePageScrollable()
  }
})

onMounted(() => {
  ensurePageScrollable()
  fetchStats()
  fetchRecords()
  fetchAgentList()
})

onUnmounted(() => {
  scrollLockDepth = 0
  scrollLockSnapshot = null
  ensurePageScrollable()
  if (copiedNoteUrlTimer) clearTimeout(copiedNoteUrlTimer)
})
</script>

<template>
  <div class="records-page" :class="{ 'records-page--user-orders': isRegularUserOrderView }">
    <header class="page-hero" :class="{ 'page-hero--user': isRegularUserOrderView }">
      <div class="hero-bg" aria-hidden="true"></div>
      <div v-if="isRegularUserOrderView" class="hero-content user-hero-row">
        <div class="user-hero-main">
          <span class="hero-badge">订单中心</span>
          <h1 class="hero-title">{{ pageHeroTitle }}</h1>
          <p class="hero-desc">{{ pageHeroDesc }}</p>
        </div>
        <div class="user-hero-cards" role="group" aria-label="订单统计">
          <div class="user-stat-card user-stat-card--orders">
            <div class="user-stat-icon icon-orders" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="user-stat-body">
              <strong class="user-stat-val">{{ orderTotal }}</strong>
              <span class="user-stat-label">订单总数</span>
            </div>
          </div>
          <div class="user-stat-card user-stat-card--spent">
            <div class="user-stat-icon icon-spent" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <div class="user-stat-body">
              <strong class="user-stat-val user-stat-val--money">¥{{ fmtMoney(totalSpent) }}</strong>
              <span class="user-stat-label">累计消费</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="hero-inner">
        <div class="hero-content">
          <span class="hero-badge">{{ isMyOrdersPage ? '订单中心' : '记录中心' }}</span>
          <h1 class="hero-title">{{ pageHeroTitle }}</h1>
          <p class="hero-desc">{{ pageHeroDesc }}</p>
        </div>
      </div>
    </header>

    <!-- 顶部统计 -->
    <div v-if="!isRegularUserOrderView" class="stats-row">
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
          <el-date-picker v-model="exportStartDate" type="date" placeholder="选择开始日期" value-format="YYYY-MM-DD" size="default" style="width:100%" />
        </div>
        <div class="export-field">
          <label>结束日期</label>
          <el-date-picker v-model="exportEndDate" type="date" placeholder="选择结束日期" value-format="YYYY-MM-DD" size="default" style="width:100%" />
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
      <div class="filter-bar" :class="{ 'filter-bar--user': isRegularUserOrderView }">
        <div v-if="isRegularUserOrderView && activeModule === 'orders'" class="user-order-filter">
          <div class="user-order-filter-head">
            <span class="user-order-filter-title">订单列表</span>
            <span class="user-order-filter-count">共 <strong>{{ total }}</strong> 条</span>
          </div>
          <div class="user-order-filter-bar">
            <label class="user-search-field">
              <svg class="user-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                v-model="searchOrderNo"
                class="user-search-input"
                type="search"
                placeholder="输入订单号搜索"
                enterkeyhint="search"
                @keyup.enter="doSearch"
              />
              <button
                v-if="searchOrderNo"
                type="button"
                class="user-search-clear"
                aria-label="清除"
                @click="resetSearch"
              >×</button>
            </label>
            <button type="button" class="user-search-btn" @click="doSearch">搜索</button>
          </div>
        </div>
        <div v-else class="filter-toolbar" :class="{ 'filter-toolbar--sup': activeModule === 'supplements' }">
          
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
          <div v-if="activeModule === 'orders'" class="filter-form">
            <div class="filter-fields">
              <input v-model="searchOrderNo" class="filter-input" placeholder="订单号" @keyup.enter="doSearch" />
              <template v-if="isAdmin">
                <select v-model="searchAgentId" class="filter-select filter-field-agent" @change="doSearch">
                  <option value="">全部代理</option>
                  <option v-for="a in agentList" :key="a.id" :value="a.id">{{ a.nickname || a.username }} ({{ a.sub_count }}人)</option>
                </select>
                <el-date-picker v-model="searchStartDate" class="filter-date" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" size="small" @change="doSearch" />
                <el-date-picker v-model="searchEndDate" class="filter-date" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" size="small" @change="doSearch" />
              </template>
            </div>
            <div class="filter-actions">
              <span class="filter-total">
                <span class="filter-total-num">{{ total }}</span>
                条记录
              </span>
              <div class="filter-btns">
                <button type="button" class="btn-search" @click="doSearch">搜索</button>
                <button type="button" class="btn-reset" @click="resetSearch">重置</button>
              </div>
            </div>
          </div>

          <!-- 补单记录筛选 -->
          <div v-else class="filter-form filter-form--sup">
            <div class="filter-fields">
              <select v-model="supSearchStatus" class="filter-select" @change="supDoSearch">
                <option value="">全部状态</option>
                <option value="pending">待审核</option>
                <option value="agent_approved">代理已批准</option>
                <option value="processing">处理中</option>
                <option value="rejected">已驳回</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div class="filter-actions filter-actions--btns-only">
              <span class="filter-total filter-sup-mobile-total">
                <span class="filter-total-num">{{ supTotal }}</span>
                条记录
              </span>
              <div class="filter-btns">
                <button type="button" class="btn-search" @click="supDoSearch">搜索</button>
                <button type="button" class="btn-reset" @click="supReset">重置</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 下单记录模块 ===== -->
      <template v-if="activeModule === 'orders'">
        <!-- 普通用户：订单列表（卡片摘要 + 点击展开详情） -->
        <div v-if="isRegularUserOrderView" class="user-order-list">
          <EmptyState v-if="loading" loading class="empty-state" />
          <template v-else-if="orders.length">
            <div
              v-for="order in orders"
              :key="order.id"
              class="user-order-row"
              :class="{
                'is-expanded': expandedOrderId === order.id,
                'is-detail-loading': userOrderDetailLoading === order.id
              }"
              :data-order-id="order.id"
            >
              <div
                class="uor-clickable"
                role="button"
                tabindex="0"
                @click="toggleUserOrderDetail(order)"
                @keyup.enter="toggleUserOrderDetail(order)"
              >
                <div class="uor-head">
                  <div class="uor-avatar-wrap">
                    <img
                      v-if="orderAvatarUrl(order) && !showOrderAvatarFallback(order)"
                      class="uor-avatar"
                      :src="orderAvatarUrl(order)"
                      :alt="orderAuthorName(order) || '笔记头像'"
                      loading="lazy"
                      @error="onOrderAvatarError(order.id)"
                    />
                    <span v-else class="uor-avatar-fallback">{{ orderAvatarInitial(order) }}</span>
                  </div>
                  <div class="uor-body">
                    <div class="uor-title-row">
                      <p class="uor-title">{{ orderNoteTitle(order) || order.order_no }}</p>
                      <svg
                        class="uor-chevron"
                        :class="{ 'uor-chevron--open': expandedOrderId === order.id }"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      ><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                    <div class="uor-meta">
                      <span class="uor-time">{{ fmtTime(order.created_at) }}</span>
                      <span
                        class="uor-status"
                        :style="{
                          color: orderListStatusView(order).color,
                          background: orderListStatusView(order).bg,
                          borderColor: (orderListStatusView(order).border || orderListStatusView(order).color) + '44'
                        }"
                      >{{ orderListStatusView(order).label }}</span>
                    </div>
                  </div>
                </div>

                <div class="uor-progress">
                  <div class="uor-progress-track">
                    <div
                      class="uor-progress-fill"
                      :style="{
                        width: orderProgress(order) + '%',
                        background: orderProgressTone(order)
                      }"
                    ></div>
                  </div>
                  <span class="uor-progress-pct">{{ orderProgress(order) }}%</span>
                </div>
              </div>

              <Transition
                :css="false"
                @before-enter="onUorBeforeEnter"
                @enter="onUorEnter"
                @before-leave="onUorBeforeLeave"
                @leave="onUorLeave"
              >
                <div v-if="expandedOrderId === order.id" class="uor-detail-wrap">
                <div class="uor-detail">
                <div v-if="userOrderDetailLoading === order.id" class="uor-detail-loading">加载中...</div>
                <template v-else>
                  <p class="uor-detail-no mono">{{ detailOrder(order).order_no }}</p>
                  <div class="uor-metrics uor-metrics--detail">
                    <div class="uor-metric">
                      <span class="uor-metric-label">类型</span>
                      <span class="uor-metric-type">{{ pn(detailOrder(order)) }}</span>
                    </div>
                    <div class="uor-metric">
                      <span class="uor-metric-label">下单数</span>
                      <strong>{{ detailOrder(order).ordered_quantity || 0 }}</strong>
                    </div>
                    <div class="uor-metric">
                      <span class="uor-metric-label">完成数</span>
                      <strong class="is-ok">{{ detailOrder(order).completed_quantity || 0 }}</strong>
                    </div>
                    <div class="uor-metric">
                      <span class="uor-metric-label">付款</span>
                      <strong class="is-pay">¥{{ fmtMoney(orderPaidAmount(detailOrder(order))) }}</strong>
                    </div>
                  </div>
                  <div v-if="detailOrder(order).product_description" class="order-pdesc-card">
                    <div class="order-pdesc-head">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      <span class="order-pdesc-label">商品描述</span>
                    </div>
                    <p class="order-pdesc-text">{{ detailOrder(order).product_description }}</p>
                  </div>
                  <div v-if="detailOrder(order).note_url" class="oc-url-row">
                    <a class="oc-url" :href="detailOrder(order).note_url" target="_blank" rel="noopener">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span>{{ detailOrder(order).note_url }}</span>
                    </a>
                    <button
                      type="button"
                      class="oc-url-copy"
                      :class="{ copied: copiedNoteUrlId === order.id }"
                      :title="copiedNoteUrlId === order.id ? '已复制' : '复制链接'"
                      aria-label="复制链接"
                      @click="copyNoteUrl(detailOrder(order).note_url, order.id)"
                    >
                      <svg v-if="copiedNoteUrlId !== order.id" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                  <div class="oc-progress-wrap">
                    <div class="oc-progress-top">
                      <span>完成进度</span>
                      <strong :style="{ color: orderProgressTextColor(detailOrder(order)) }">{{ orderProgress(detailOrder(order)) }}%</strong>
                    </div>
                    <div class="oc-progress-bar">
                      <div
                        class="oc-progress-fill"
                        :style="{ width: orderProgress(detailOrder(order)) + '%', background: orderProgressTone(detailOrder(order)) }"
                      ></div>
                    </div>
                  </div>
                  <div class="uor-detail-actions">
                    <span v-if="pendingOrderIds.includes(order.id)" class="oc-refund-pending">退款申请中</span>
                    <button
                      v-else-if="!['completed','refunded','cancelled'].includes(detailOrder(order).order_status)"
                      type="button"
                      class="oc-refund-btn"
                      :disabled="refundingOrderId === order.id"
                      @click="requestOrderRefund(detailOrder(order))"
                    >{{ refundingOrderId === order.id ? '提交中...' : '申请退款' }}</button>
                  </div>
                </template>
                </div>
                </div>
              </Transition>
            </div>
          </template>
          <EmptyState v-else class="empty-state" text="暂无订单记录" />
        </div>

        <!-- 代理 / 管理员：批次列表 -->
        <div v-else class="batch-list">
          <EmptyState v-if="loading" loading class="empty-state" />
          <template v-else-if="batches.length">
            <div
              class="batch-list-head"
              :class="{ 'no-fail-col': !canViewOrderStatus }"
              aria-hidden="true"
            >
              <span class="blh-info">批次信息</span>
              <span class="blh-stat">总数</span>
              <span class="blh-stat">成功</span>
              <span v-if="canViewOrderStatus" class="blh-stat">失败</span>
              <span class="blh-amount">实际付款</span>
              <span class="blh-action">操作</span>
            </div>
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
                  <span class="batch-chip batch-chip--type">{{ pn(batch) }}</span>
                  <span
                    class="batch-chip"
                    :class="batch.data_source === 'pgy' ? 'batch-chip--pgy' : 'batch-chip--live'"
                  >{{ batch.data_source === 'pgy' ? '蒲公英' : '实时' }}</span>
                </div>
                <div class="batch-meta-row">
                  <span
                    class="batch-chip batch-chip--status"
                    :style="{
                      color: batchStatusView(batch).color,
                      background: batchStatusView(batch).bg
                    }"
                  >{{ batchStatusView(batch).label }}</span>
                  <span v-if="isAdmin && batch.nickname" class="batch-chip batch-chip--user">{{ batch.nickname || batch.username }}</span>
                  <span v-if="isAdmin && batch.agent_name" class="batch-chip batch-chip--agent">代理 {{ batch.agent_name }}</span>
                  <span v-else-if="isAdmin && !batch.agent_id" class="batch-chip batch-chip--direct">直属</span>
                  <span v-if="isMyOrdersPage && isAgent && batch.nickname" class="batch-chip batch-chip--user">{{ batch.nickname || batch.username }}</span>
                  <span v-if="canViewOrderStatus && batch.has_upstream === false" class="batch-chip batch-chip--warn">无上游</span>
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
              <div class="batch-stat batch-stat--total">
                <strong>{{ batch.total_count || 0 }}</strong>
              </div>
              <div class="batch-stat batch-stat--ok">
                <strong>{{ batch.succeeded_count || 0 }}</strong>
              </div>
              <div v-if="canViewOrderStatus" class="batch-stat batch-stat--fail">
                <strong :class="{ 'is-hot': (batch.failed_count || 0) > 0 }">{{ batch.failed_count || 0 }}</strong>
              </div>
              <div class="batch-amount">
                <strong>¥{{ fmtMoney(batch.estimated_amount) }}</strong>
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
                </div>
                <svg class="arrow-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                <div class="action-amount">
                  <span class="msg-label">实际付款金额</span>
                  <strong class="msg-val accent">¥ {{ fmtMoney(batch.estimated_amount) }}</strong>
                </div>
              </div>
            </div>
          </template>
          <EmptyState v-else class="empty-state" text="暂无批次记录" />
        </div>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page"
            :page-size="pageSize"
            :total="total"
            layout="total, prev, pager, next"
            background
            small
            @current-change="fetchRecords"
          />
        </div>
      </template>

      <!-- ===== 补单记录模块（按批次分组） ===== -->
      <template v-else-if="activeModule === 'supplements'">
        <div class="batch-list">
          <EmptyState v-if="supLoading" loading class="empty-state" />
          <template v-else-if="supBatches.length">
            <div
              class="batch-list-head sup-batch-list-head"
              :class="{ 'sup-batch-list-head--no-agent': !isAdmin }"
              aria-hidden="true"
            >
              <span class="blh-info">批次信息</span>
              <span class="blh-stat">补单数</span>
              <span class="blh-stat">待审核</span>
              <span v-if="isAdmin" class="blh-stat">代理已批</span>
              <span class="blh-amount">差额总量</span>
              <span class="blh-action">操作</span>
            </div>
            <div
              v-for="sb in supBatches"
              :key="sb.batch_id"
              class="batch-row sup-batch-row"
              :class="{ 'sup-batch-row--no-agent': !isAdmin }"
              :style="{ '--prog': supBatchProgress(sb) + '%', '--prog-color': supBatchProgressTone() }"
              @click="openSupDrawer(sb)"
            >
              <div class="batch-progress-bar"></div>
              <div class="batch-info">
                <div class="batch-head">
                  <a class="batch-no sup-link" @click.stop="goToBatch(sb.batch_id)" title="查看批次订单">{{ sb.batch_no }}</a>
                  <span class="batch-chip batch-chip--type">{{ sb.source_type || '补单' }}</span>
                </div>
                <div class="batch-meta-row">
                  <span
                    class="batch-chip batch-chip--status"
                    :style="{
                      color: supBatchStatusView(sb).color,
                      background: supBatchStatusView(sb).bg
                    }"
                  >{{ supBatchStatusView(sb).label }}</span>
                  <span v-if="(isAdmin || isAgent) && sb.username" class="batch-chip batch-chip--user">{{ sb.nickname || sb.username }}</span>
                </div>
                <div class="batch-time">
                  申请时间: {{ fmtTime(sb.earliest_at) }}
                </div>
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
                  <div class="msg-cell amount">
                    <span class="msg-label">差额总量</span>
                    <strong class="msg-val accent">{{ sb.total_shortage }}</strong>
                  </div>
                </div>
              </div>
              <div class="batch-stat batch-stat--total">
                <strong>{{ sb.total_count }}</strong>
              </div>
              <div class="batch-stat batch-stat--pending">
                <strong :class="{ 'fail-num': sb.pending_count > 0 }">{{ sb.pending_count }}</strong>
              </div>
              <div v-if="isAdmin" class="batch-stat batch-stat--agent">
                <strong :class="{ 'ok-num': sb.agent_approved_count > 0 }">{{ sb.agent_approved_count }}</strong>
              </div>
              <div class="batch-amount batch-amount--shortage">
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
          <EmptyState v-else class="empty-state" text="暂无补单记录" />
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

    <!-- 批次订单详情抽屉（代理/管理员；Teleport 避免被父级 overflow 截断） -->
    <Teleport to="body">
      <Transition name="drawer-fade">
        <div v-if="showDrawer && !isRegularUserOrderView" class="drawer-mask records-drawer-mask" @click.self="closeDrawer">
          <div class="order-drawer">
            <div class="drawer-drag-bar" aria-hidden="true"><span></span></div>
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
                    v-else-if="drawerBatch && canBatchRefund && !isRegularUserOrderView && !['refunded','cancelled'].includes(drawerBatch.status)"
                    type="button"
                    class="refund-btn"
                    :disabled="refunding"
                    @click="requestBatchRefund"
                  >{{ refunding ? '处理中...' : '申请退款' }}</button>
                  <button type="button" class="drawer-close" aria-label="关闭" @click="closeDrawer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div v-if="drawerBatch && !isRegularUserOrderView" class="drawer-summary">
                <div class="drawer-stats">
                  <div class="drawer-stat drawer-stat--wide">
                    <span class="drawer-stat-label">批次号</span>
                    <span class="drawer-stat-val mono">{{ drawerBatch.batch_no || drawerBatch.batch_id }}</span>
                  </div>
                  <div class="drawer-stat">
                    <span class="drawer-stat-label">状态</span>
                    <span
                      class="status-pill drawer-stat-pill"
                      :style="{
                        color: batchStatusView(drawerBatch).color,
                        background: batchStatusView(drawerBatch).bg,
                        borderColor: batchStatusView(drawerBatch).border || batchStatusView(drawerBatch).color
                      }"
                    >{{ batchStatusView(drawerBatch).label }}</span>
                  </div>
                  <div class="drawer-stat drawer-stat--time">
                    <span class="drawer-stat-label">提交时间</span>
                    <span class="drawer-stat-val">{{ fmtTime(drawerBatch.created_at) }}</span>
                  </div>
                  <div class="drawer-stat">
                    <span class="drawer-stat-label">总数</span>
                    <span class="drawer-stat-val">{{ drawerBatch.total_count || 0 }}</span>
                  </div>
                  <div class="drawer-stat drawer-stat--ok">
                    <span class="drawer-stat-label">成功</span>
                    <span class="drawer-stat-val">{{ drawerBatch.succeeded_count || 0 }}</span>
                  </div>
                  <div v-if="canViewOrderStatus" class="drawer-stat drawer-stat--fail">
                    <span class="drawer-stat-label">失败</span>
                    <span class="drawer-stat-val">{{ drawerBatch.failed_count || 0 }}</span>
                  </div>
                  <div class="drawer-stat drawer-stat--accent">
                    <span class="drawer-stat-label">金额</span>
                    <span class="drawer-stat-val drawer-stat-amount">¥{{ fmtMoney(drawerBatch.estimated_amount) }}</span>
                  </div>
                </div>
                <div class="dbi-progress-wrap">
                  <div class="dbi-progress-top">
                    <span>批次进度</span>
                    <strong>{{ batchProgress(drawerBatch) }}%</strong>
                  </div>
                  <div class="dbi-progress-bar">
                    <div
                      class="dbi-progress-fill"
                      :style="{ width: batchProgress(drawerBatch) + '%', background: batchProgressTone(drawerBatch) }"
                    ></div>
                  </div>
                </div>
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

            <!-- 订单列表 -->
            <div ref="drawerBodyRef" class="drawer-body">
              <div v-if="drawerLoading" class="drawer-loading">
                <div class="spinner"></div>
                <span>加载中...</span>
              </div>
              <template v-else-if="drawerOrders.length">
                <div v-if="!isRegularUserOrderView" class="drawer-order-count">
                  <span class="drawer-order-count-badge">{{ drawerOrders.length }}</span>
                  条订单
                </div>
                <div v-for="(order, idx) in drawerOrders" :key="order.id" class="order-card" :data-order-no="order.order_no">
                  <div class="oc-card-top">
                    <span class="oc-idx">#{{ idx + 1 }}</span>
                    <div class="oc-card-top-end">
                      <span v-if="isOwnBatch && pendingOrderIds.includes(order.id)" class="oc-refund-pending">退款申请中</span>
                      <button
                        v-else-if="isOwnBatch && !['completed','refunded','cancelled'].includes(order.order_status)"
                        type="button"
                        class="oc-refund-btn"
                        :disabled="refundingOrderId === order.id"
                        @click.stop="requestOrderRefund(order)"
                      >{{ refundingOrderId === order.id ? '提交中...' : '申请退款' }}</button>
                      <span class="oc-status-pill" :style="{ color: orderStatusView(order).color, background: orderStatusView(order).color + '14', borderColor: orderStatusView(order).color + '40' }">{{ orderStatusView(order).label }}</span>
                    </div>
                  </div>

                  <div class="oc-card-main">
                    <div class="oc-avatar-wrap">
                      <img
                        v-if="orderAvatarUrl(order) && !showOrderAvatarFallback(order)"
                        class="oc-avatar"
                        :src="orderAvatarUrl(order)"
                        :alt="orderAuthorName(order) || '笔记头像'"
                        loading="lazy"
                        @error="onOrderAvatarError(order.id)"
                      />
                      <span v-if="showOrderAvatarFallback(order)" class="oc-avatar-fallback">{{ orderAvatarInitial(order) }}</span>
                    </div>
                    <div class="oc-note-block">
                      <p v-if="orderNoteTitle(order)" class="oc-title">{{ orderNoteTitle(order) }}</p>
                      <p v-else class="oc-title oc-title-muted">未获取笔记标题</p>
                      <p v-if="orderAuthorName(order)" class="oc-author">{{ orderAuthorName(order) }}</p>
                    </div>
                  </div>

                  <p class="oc-order-no mono">{{ order.order_no }}</p>

                  <div v-if="order.note_url" class="oc-url-row">
                    <a class="oc-url" :href="order.note_url" target="_blank" rel="noopener" @click.stop>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span>{{ order.note_url }}</span>
                    </a>
                    <button
                      type="button"
                      class="oc-url-copy"
                      :class="{ copied: copiedNoteUrlId === order.id }"
                      :title="copiedNoteUrlId === order.id ? '已复制' : '复制链接'"
                      aria-label="复制链接"
                      @click.stop="copyNoteUrl(order.note_url, order.id)"
                    >
                      <svg v-if="copiedNoteUrlId !== order.id" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
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
                      <strong>¥{{ fmtMoney(orderPaidAmount(order)) }}</strong>
                    </div>
                  </div>
                  <div v-if="order.product_description" class="order-pdesc-card">
                    <div class="order-pdesc-head">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      <span class="order-pdesc-label">商品描述</span>
                    </div>
                    <p class="order-pdesc-text">{{ order.product_description }}</p>
                  </div>
                  <!-- 订单进度条 -->
                  <div class="oc-progress-wrap">
                    <div class="oc-progress-top">
                      <span>完成进度</span>
                      <strong :style="{ color: orderProgressTextColor(order) }">{{ orderProgress(order) }}%</strong>
                    </div>
                    <div class="oc-progress-bar">
                      <div
                        class="oc-progress-fill"
                        :style="{ width: orderProgress(order) + '%', background: orderProgressTone(order) }"
                      ></div>
                    </div>
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
              <EmptyState v-else compact text="暂无订单数据" class="drawer-empty" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

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
                <div class="drawer-order-count">
                  <span class="drawer-order-count-badge">{{ supDrawerRecords.length }}</span>
                  条补单
                </div>
                <div
                  v-for="(r, idx) in supDrawerRecords"
                  :key="r.id"
                  class="order-card sup-order-card"
                  :class="{ 'sup-order-card--approvable': canApproveRecord(r) }"
                >
                  <div class="oc-card-top">
                    <span class="oc-idx">#{{ idx + 1 }}</span>
                    <span
                      class="oc-status-pill"
                      :style="{ color: rsc(r.status).color, background: rsc(r.status).color + '14', borderColor: rsc(r.status).color + '40' }"
                    >{{ rsc(r.status).label }}</span>
                  </div>

                  <div class="oc-card-main">
                    <div class="oc-avatar-wrap">
                      <img
                        v-if="orderAvatarUrl(supAsOrder(r)) && !showOrderAvatarFallback(supAsOrder(r))"
                        class="oc-avatar"
                        :src="orderAvatarUrl(supAsOrder(r))"
                        :alt="orderAuthorName(supAsOrder(r)) || '笔记头像'"
                        loading="lazy"
                        @error="onOrderAvatarError(supAsOrder(r).id)"
                      />
                      <span v-if="showOrderAvatarFallback(supAsOrder(r))" class="oc-avatar-fallback">{{ orderAvatarInitial(supAsOrder(r)) }}</span>
                    </div>
                    <div class="oc-note-block">
                      <p v-if="orderNoteTitle(supAsOrder(r))" class="oc-title">{{ orderNoteTitle(supAsOrder(r)) }}</p>
                      <p v-else class="oc-title oc-title-muted">未获取笔记标题</p>
                      <p v-if="orderAuthorName(supAsOrder(r))" class="oc-author">{{ orderAuthorName(supAsOrder(r)) }}</p>
                    </div>
                  </div>

                  <p class="oc-order-no mono">{{ r.order_no }}</p>

                  <div v-if="supAsOrder(r).note_url" class="oc-url-row">
                    <a class="oc-url" :href="supAsOrder(r).note_url" target="_blank" rel="noopener" @click.stop>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span>{{ supAsOrder(r).note_url }}</span>
                    </a>
                    <button
                      type="button"
                      class="oc-url-copy"
                      :class="{ copied: copiedNoteUrlId === supAsOrder(r).id }"
                      :title="copiedNoteUrlId === supAsOrder(r).id ? '已复制' : '复制链接'"
                      aria-label="复制链接"
                      @click.stop="copyNoteUrl(supAsOrder(r).note_url, supAsOrder(r).id)"
                    >
                      <svg v-if="copiedNoteUrlId !== supAsOrder(r).id" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>

                  <div class="oc-details">
                    <div class="oc-detail">
                      <span class="oc-dl">类型</span>
                      <span class="tag type-tag">{{ r.product_name || '-' }}</span>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">下单数</span>
                      <strong>{{ r.ordered_quantity }}</strong>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">完成数</span>
                      <strong class="ok-num">{{ r.actual_quantity || 0 }}</strong>
                    </div>
                    <div class="oc-detail">
                      <span class="oc-dl">差额</span>
                      <strong class="fail-num">{{ r.shortage_quantity || 0 }}</strong>
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
                  <div v-else-if="r.status === 'rejected' && supRejectReason(r)" class="oc-fail-reason">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>{{ supRejectReason(r) }}</span>
                  </div>
                </div>
              </template>
              <EmptyState v-else compact text="暂无补单数据" class="drawer-empty" />
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
  --rp-primary: #2f6df6;
  --rp-primary-soft: rgba(47, 109, 246, 0.1);
  --rp-accent: #ee4d7a;
  --rp-purple: #5a8ef8;
  --rp-text: #152033;
  --rp-text-2: #425066;
  --rp-text-3: #8a95a8;
  --rp-border: #e8eef7;
  --rp-radius: 14px;
  --rp-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  --rp-shadow-lg: 0 12px 40px rgba(47, 109, 246, 0.08), 0 4px 12px rgba(21, 32, 51, 0.04);
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 20px 72px;
}

.records-page--user-orders .page-hero--user {
  margin-bottom: 14px;
}

/* ========== 页面头部 ========== */
.page-hero {
  position: relative;
  border-radius: var(--rp-radius);
  overflow: hidden;
  margin-bottom: 18px;
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow-lg);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 0% 0%, rgba(47, 109, 246, 0.12), transparent 55%),
    radial-gradient(ellipse 50% 40% at 100% 100%, rgba(47, 109, 246, 0.06), transparent 50%),
    linear-gradient(180deg, #fff 0%, #fafbff 100%);
}

.hero-inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px;
}

.hero-content {
  position: relative;
  z-index: 1;
  padding: 22px 26px;
}

.hero-inner .hero-content {
  min-width: 0;
  flex: 1;
  padding: 0;
}

.page-hero--user {
  margin-bottom: 12px;
  border-color: rgba(47, 109, 246, 0.12);
  box-shadow: var(--rp-shadow);
}

.user-hero-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.user-hero-main {
  min-width: 0;
  flex: 1;
}

.user-hero-cards {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  gap: 10px;
}

.user-stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 132px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(47, 109, 246, 0.1);
  box-shadow: 0 4px 14px rgba(47, 109, 246, 0.06);
}

.user-stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: #fff;
  flex-shrink: 0;
}

.user-stat-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-stat-val {
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-text);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.user-stat-val--money {
  font-size: 15px;
  color: var(--rp-primary);
}

.user-stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--rp-text-3);
  white-space: nowrap;
}

.hero-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--rp-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.hero-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--rp-text);
  letter-spacing: -0.3px;
  line-height: 1.2;
}

.hero-desc {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--rp-text-3);
  line-height: 1.55;
  max-width: 520px;
}

/* ========== 问题订单下载栏 ========== */
.problem-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px 18px;
  background: linear-gradient(135deg, #fffafa, #fff);
  border-radius: var(--rp-radius);
  box-shadow: var(--rp-shadow);
  border: 1px solid #ffe1df;
  border-left: 4px solid #ff4d4f;
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
  gap: 14px;
  margin-bottom: 18px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  min-height: 108px;
  background: #fff;
  border-radius: var(--rp-radius);
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, border-color 200ms ease;
  position: relative;
  overflow: hidden;
}

.stat-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  opacity: 0.85;
}

.card-batch::after { background: linear-gradient(90deg, #ee4d7a, #8b7bf7); }
.card-orders::after { background: linear-gradient(90deg, #42c978, #38b2ac); }
.card-processing::after { background: linear-gradient(90deg, #f5a623, #f09d3d); }
.card-spent::after { background: linear-gradient(90deg, #ff6b6b, #ee4d7a); }

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--rp-shadow-lg);
  border-color: #dfe7f3;
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
  font-size: 26px;
  font-weight: 900;
  color: var(--rp-text);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}

.stat-value.spent {
  color: var(--rp-accent);
  font-size: 22px;
}

/* ========== 移动端 tab ========== */

.mobile-tabs {
  display: none;
  border-bottom: 1px solid #edf1f6;
}

.mobile-tab {
  flex: 1;
  padding: 14px 0;
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text-3);
  background: none;
  border: none;
  border-bottom: 2.5px solid transparent;
  cursor: pointer;
  transition: all 180ms ease;
}

.mobile-tab.active {
  color: var(--rp-primary);
  border-bottom-color: var(--rp-primary);
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
.msg-val.accent { color: var(--rp-primary); font-size: 15px; }
.msg-cell.amount .msg-label { white-space: nowrap; }
.action-amount { display: none; }

/* ========== 主体卡片 ========== */

.records-body {
  background: #fff;
  border-radius: var(--rp-radius);
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow);
  overflow: visible;
}

.records-page--user-orders .records-body {
  background: #fff;
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow);
  border-radius: var(--rp-radius);
  overflow: hidden;
}

.records-page--user-orders .pagination-wrap {
  border-top: 1px solid #f0f2f7;
  padding: 12px 18px 16px;
  background: #fff;
}

/* ========== 用户端订单筛选 ========== */

.user-order-filter {
  width: 100%;
  padding: 16px 18px 14px;
  border-radius: 0;
  background: #fff;
  border: none;
  border-bottom: 1px solid #f0f2f7;
  box-shadow: none;
}

.user-order-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.user-order-filter-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text);
}

.user-order-filter-count {
  font-size: 12px;
  color: var(--rp-text-3);
}

.user-order-filter-count strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-primary);
}

.user-order-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-search-field {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  height: 40px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
  border: 1.5px solid #e4ebf5;
  background: #f8faff;
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.user-search-field:focus-within {
  border-color: var(--rp-primary);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(47, 109, 246, 0.1);
}

.user-search-icon {
  flex-shrink: 0;
  color: #9aa5b5;
}

.user-search-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  min-height: 36px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 14px;
  line-height: 1.4;
  color: var(--rp-text);
  box-sizing: border-box;
  -webkit-appearance: none;
  appearance: none;
}

.user-search-input::placeholder {
  color: #b0b8c6;
  font-size: 14px;
}

.user-search-input::-webkit-search-decoration,
.user-search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.user-search-clear {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: #e8edf4;
  color: #64748b;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.user-search-btn {
  flex-shrink: 0;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: var(--goosd-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(47, 109, 246, 0.22);
  transition: background 0.2s ease, transform 0.15s ease;
}

.user-search-btn:active {
  transform: scale(0.98);
}

.filter-bar--user {
  padding: 0;
  border-bottom: none;
  background: transparent;
}

/* ========== 筛选栏 ========== */

.filter-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid #f0f2f7;
  background: linear-gradient(180deg, #fcfdff, #fff);
}

.filter-toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.filter-toolbar > .module-select {
  align-self: flex-start;
}

/* 补单记录：第一行模块+条数，第二行状态+按钮 */
.filter-toolbar--sup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  gap: 10px 12px;
  align-items: center;
}

.filter-toolbar--sup > .module-select {
  grid-column: 1;
  grid-row: 1;
  align-self: stretch;
  width: 12%;
  min-width: 0;
}

.filter-toolbar--sup > .module-select .module-trigger {
  width: 100%;
  justify-content: flex-start;
}

.filter-toolbar--sup .filter-sup-head-total {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  white-space: nowrap;
}

.filter-toolbar--sup .filter-form--sup {
  grid-column: 1 / -1;
  grid-row: 2;
}

.filter-form--sup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 12px;
  width: 100%;
}

.filter-actions--btns-only {
  flex-direction: row;
  align-items: center;
}

.filter-sup-mobile-total {
  display: none;
}

.filter-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px 12px;
  width: 100%;
}

.filter-fields {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.filter-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  justify-self: end;
}

.filter-btns {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
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
  height: 38px;
  padding: 0 14px 0 16px;
  border-radius: 10px;
  border: 1.5px solid #e4ebf5;
  background: #fff;
  color: var(--rp-text);
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

.filter-input,
.filter-fields :deep(.filter-date.el-date-editor) {
  width: 152px;
  height: 38px;
  flex-shrink: 0;
}

.filter-input {
  padding: 0 14px;
  border: 1.5px solid #e4ebf5;
  border-radius: 10px;
  font-size: 13px;
  color: var(--rp-text-2);
  outline: none;
  background: #fff;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.filter-field-agent {
  min-width: 160px;
  max-width: 200px;
}

.filter-fields :deep(.filter-date.el-date-editor) {
  --el-date-editor-width: 152px;
}

.filter-fields :deep(.filter-date .el-input__wrapper) {
  min-height: 36px;
  padding: 0 10px 0 11px;
  border-radius: 10px;
  box-shadow: none !important;
  border: 1.5px solid #e4ebf5;
  background: #fff;
}

.filter-fields :deep(.filter-date .el-input__inner) {
  font-size: 13px;
  color: var(--rp-text-2);
}

.filter-fields :deep(.filter-date .el-input__inner::placeholder) {
  color: #b0b8c6;
  font-size: 13px;
}

.filter-fields :deep(.filter-date .el-input__prefix-inner),
.filter-fields :deep(.filter-date .el-input__suffix-inner) {
  font-size: 14px;
  color: #9aa5b5;
}

.filter-input:focus {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.1);
}

.filter-input::placeholder { color: #b0b8c6; }

.btn-search {
  height: 38px;
  min-width: 76px;
  padding: 0 20px;
  border-radius: 10px;
  background: var(--goosd-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: var(--goosd-btn-shadow);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, filter 240ms ease;
}

.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: var(--goosd-btn-shadow-hover);
  background: var(--goosd-primary-dark);
}

.btn-search:active { transform: scale(0.97); }

.btn-reset {
  height: 38px;
  min-width: 76px;
  padding: 0 18px;
  border-radius: 10px;
  background: #fff;
  color: #647184;
  font-size: 13px;
  font-weight: 700;
  border: 1.5px solid #e4ebf5;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
}

.btn-reset:hover { background: #eef3ff; color: #8b7bf7; }

.filter-total {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 13px;
  color: var(--rp-text-3);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.filter-total-num {
  font-size: 15px;
  font-weight: 900;
  color: var(--rp-primary);
  font-variant-numeric: tabular-nums;
}

/* ========== 批次列表 ========== */

.batch-list {
  padding: 12px 16px 20px;
  background: #fff;
}

.batch-list-head,
.batch-row {
  --batch-cols: minmax(260px, 1.5fr) 56px 56px 56px minmax(100px, 0.9fr) 88px;
  display: grid;
  grid-template-columns: var(--batch-cols);
  align-items: center;
  column-gap: 16px;
}

.batch-list-head.no-fail-col,
.batch-row.no-fail-col {
  --batch-cols: minmax(260px, 1.5fr) 56px 56px minmax(100px, 0.9fr) 88px;
}

.batch-list-head {
  padding: 0 18px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--rp-text-3);
}

.blh-stat {
  text-align: center;
}

.blh-amount {
  text-align: right;
}

.blh-action {
  text-align: right;
}

.batch-row {
  position: relative;
  padding: 14px 18px;
  margin-bottom: 6px;
  border-radius: 12px;
  border: 1px solid var(--rp-border);
  background: #fff;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
}

.batch-progress-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: var(--prog, 0%);
  background: var(--prog-color, var(--rp-primary));
  border-radius: 0 2px 2px 0;
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
  opacity: 0.85;
}

.batch-row:hover {
  border-color: rgba(47, 109, 246, 0.28);
  background: #fafbff;
  box-shadow: 0 4px 16px rgba(47, 109, 246, 0.06);
}

.batch-row:last-child { margin-bottom: 0; }

.batch-info {
  min-width: 0;
}

.batch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.batch-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.batch-chip {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  border: none;
}

.batch-chip--type {
  color: var(--rp-primary);
  background: var(--rp-primary-soft);
}

.batch-chip--live {
  color: #15803d;
  background: #ecfdf3;
}

.batch-chip--pgy {
  color: #db2777;
  background: #fdf2f8;
}

.batch-chip--status {
  font-weight: 700;
}

.batch-chip--user {
  color: var(--rp-text-2);
  background: #f1f5f9;
}

.batch-chip--agent {
  color: #b45309;
  background: #fffbeb;
}

.batch-chip--direct {
  color: #15803d;
  background: #f0fdf4;
}

.batch-chip--muted {
  color: var(--rp-text-3);
  background: #f8fafc;
  font-size: 11px;
}

.batch-chip--warn {
  color: #d97706;
  background: #fffbeb;
}

.batch-no {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--rp-text);
  letter-spacing: -0.15px;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  line-height: 1.3;
  white-space: nowrap;
}

.type-tag {
  color: var(--rp-primary);
  background: var(--rp-primary-soft);
}

.no-upstream-hint {
  color: #f59e0b;
  font-weight: 600;
  margin-left: 8px;
}

.batch-time {
  font-size: 12px;
  color: var(--rp-text-3);
  line-height: 1.45;
}

.batch-stat {
  text-align: center;
  padding: 0;
  background: transparent;
  border: none;
}

.batch-stat strong {
  font-size: 17px;
  font-weight: 700;
  color: var(--rp-text);
  font-variant-numeric: tabular-nums;
}

.batch-stat--ok strong {
  color: #16a34a;
}

.batch-stat--fail strong.is-hot {
  color: #dc2626;
}

.batch-amount {
  text-align: right;
  justify-self: end;
  padding: 0 4px;
  background: transparent;
  border: none;
}

.batch-amount strong {
  font-size: 15px;
  font-weight: 700;
  color: var(--rp-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.batch-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
}

.batch-action .flex_tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.2;
}

.export-icon-btn {
  width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center;
  border: none; background: transparent; color: #c0c8d4;
  cursor: pointer; transition: all 180ms ease; flex-shrink: 0;
}
.export-icon-btn:hover { background: var(--rp-primary-soft); color: var(--rp-primary); }
.export-icon-btn:active { transform: scale(.9); }
.export-icon-btn:disabled { pointer-events: none; }
.export-icon-btn.loading { color: var(--rp-primary); }
.spin-icon { animation: spin .8s linear infinite; }

.arrow-icon {
  color: #d0d7e2;
  flex-shrink: 0;
  transition: color 200ms ease, transform 200ms ease;
}

.batch-row:hover .arrow-icon {
  color: var(--rp-primary);
  transform: translateX(3px);
}

/* ========== 空状态 ========== */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 64px 24px;
  color: var(--rp-text-3);
  font-size: 14px;
  font-weight: 600;
}

.empty-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e8edf4;
  border-top-color: var(--rp-primary);
  border-radius: 50%;
  animation: rp-spin 0.7s linear infinite;
}

@keyframes rp-spin {
  to { transform: rotate(360deg); }
}

/* ========== 分页 ========== */

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 14px 22px 22px;
  border-top: 1px solid #f0f2f7;
  background: #fff;
}

.pagination-wrap :deep(.el-pagination.is-background .el-pager li.is-active) {
  background: var(--goosd-primary);
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

/* 补单列表表头 + 桌面列宽（标签在表头，行内仅数字） */
.sup-batch-list-head,
.sup-batch-row {
  --batch-cols: minmax(220px, 1.45fr) minmax(64px, 0.5fr) minmax(64px, 0.5fr) minmax(76px, 0.55fr) minmax(88px, 0.65fr) minmax(108px, 0.85fr);
}

.sup-batch-list-head.sup-batch-list-head--no-agent,
.sup-batch-row.sup-batch-row--no-agent {
  --batch-cols: minmax(240px, 1.5fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr) minmax(96px, 0.7fr) minmax(108px, 0.85fr);
}

.sup-batch-list-head {
  padding: 0 18px 8px;
}

.sup-batch-list-head .blh-stat,
.sup-batch-row .batch-stat {
  text-align: center;
}

.sup-batch-row .batch-stat strong {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sup-batch-row .batch-stat--pending strong:not(.fail-num) {
  color: var(--rp-text-3);
}

.sup-batch-row .batch-amount--shortage {
  text-align: right;
  justify-self: end;
}

.sup-batch-row .batch-amount--shortage strong {
  font-size: 15px;
  white-space: nowrap;
}

/* 补单批次行（与下单记录共用 batch-row 样式） */
.sup-batch-row .batch-no.sup-link {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--rp-primary);
  text-decoration: none;
}

.sup-batch-row .batch-no.sup-link:hover {
  text-decoration: underline;
}

/* 补单列表：统计区与下单记录移动端一致 */
.mobile-stat-grid.sup-grid .msg-cell.amount .msg-val.accent {
  color: #dc2626;
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

/* 补单抽屉明细（复用 order-card） */
.sup-order-card--approvable {
  border-left: 3px solid var(--rp-primary);
}

.sup-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sup-card-actions .btn-approve,
.sup-card-actions .btn-reject {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
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
  height: 38px;
  padding: 0 32px 0 14px;
  border: 1.5px solid #e4ebf5;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.25;
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

/* ========== 普通用户订单列表 ========== */

.user-order-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
  background: linear-gradient(180deg, #f8faff 0%, #f4f7fb 100%);
}

.user-order-list .empty-state {
  background: #fff;
  border: 1px dashed #dce4f0;
  border-radius: 14px;
}

.user-order-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
  text-align: left;
  box-shadow: 0 2px 10px rgba(21, 32, 51, 0.05);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  overflow: hidden;
}

.user-order-row.is-expanded {
  border-color: #b8ccfa;
  box-shadow: 0 10px 28px rgba(47, 109, 246, 0.1);
}

.user-order-row.is-detail-loading .uor-clickable {
  cursor: wait;
  opacity: 0.78;
}

.user-order-row.is-detail-loading .uor-chevron {
  animation: uor-chevron-pulse 0.85s ease-in-out infinite;
}

@keyframes uor-chevron-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.uor-clickable {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 12px 10px;
  cursor: pointer;
  font-family: inherit;
  background: transparent;
  border: none;
  text-align: left;
}

.uor-clickable:hover {
  background: linear-gradient(180deg, #fbfcff 0%, #fff 100%);
}

.uor-clickable:focus-visible {
  outline: 2px solid rgba(47, 109, 246, 0.35);
  outline-offset: -2px;
}

.uor-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.uor-avatar-wrap {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  overflow: hidden;
  background: #f1f5f9;
  border: 1px solid #eef2f7;
  box-shadow: 0 2px 8px rgba(21, 32, 51, 0.06);
}

.uor-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.uor-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 17px;
  font-weight: 800;
  color: #64748b;
  background: linear-gradient(145deg, #f8fafc, #eef2f7);
}

.uor-body {
  min-width: 0;
  flex: 1;
  padding-top: 2px;
}

.uor-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.uor-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--rp-text);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.uor-chevron {
  flex-shrink: 0;
  margin-top: 3px;
  color: #c0c9d6;
  transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1), color 280ms ease;
}

.uor-clickable:hover .uor-chevron {
  color: #2f6df6;
}

.uor-chevron--open {
  transform: rotate(90deg);
  color: #2f6df6;
}

.uor-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.uor-time {
  font-size: 12px;
  color: var(--rp-text-3);
}

.uor-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
}

.uor-metrics--detail {
  margin: 10px 0 12px;
  padding: 12px 8px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.uor-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 0 4px;
  position: relative;
}

.uor-metric + .uor-metric::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 28px;
  background: #eef2f7;
}

.uor-metric-label {
  font-size: 11px;
  color: #9aa5b5;
  white-space: nowrap;
}

.uor-metric strong {
  font-size: 15px;
  font-weight: 700;
  color: var(--rp-text);
  line-height: 1.2;
}

.uor-metric-type {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #2f6df6;
  background: rgba(47, 109, 246, 0.08);
}

.uor-metric .is-ok {
  color: #22a858;
}

/* 商品描述（订单详情 / 抽屉通用） */
.order-pdesc-card {
  margin: 12px 0 14px;
  padding: 10px 12px 11px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
}

.order-pdesc-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 7px;
}

.order-pdesc-head svg {
  flex-shrink: 0;
  color: #2f6df6;
}

.order-pdesc-label {
  font-size: 11px;
  font-weight: 800;
  color: #2f6df6;
  letter-spacing: 0.03em;
}

.order-pdesc-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #425066;
  word-break: break-word;
}

.uor-metric .is-pay {
  color: var(--rp-text);
  font-size: 14px;
}

.uor-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.uor-progress-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #eef2f7;
  overflow: hidden;
}

.uor-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--rp-primary);
  transition: width 400ms ease;
}

.uor-progress-pct {
  flex-shrink: 0;
  min-width: 32px;
  font-size: 12px;
  font-weight: 700;
  color: var(--rp-text-3);
  text-align: right;
}

.uor-detail-wrap {
  overflow: hidden;
}

.uor-detail {
  padding: 10px 10px 14px;
  border-top: 1px solid #eef2f7;
  background: linear-gradient(180deg, #f8faff 0%, #fff 100%);
}

.uor-detail-loading {
  padding: 16px 0;
  text-align: center;
  font-size: 13px;
  color: var(--rp-text-3);
}

.uor-detail-no {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--rp-text-3);
  word-break: break-all;
}

.uor-detail .order-pdesc-card + .oc-url-row {
  margin-top: 2px;
}

.uor-detail .oc-url-row {
  margin-bottom: 12px;
}

.uor-detail-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.uor-status {
  display: inline-flex;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.records-drawer-mask {
  z-index: 10050;
}

.records-drawer-mask .order-drawer {
  animation: recordsDrawerSlideIn 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes recordsDrawerSlideIn {
  from { transform: translateX(100%); }
}

.order-drawer--user .drawer-header {
  padding-bottom: 14px;
}

.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
  backdrop-filter: blur(2px);
  overscroll-behavior: none;
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
  border-bottom: 1px solid #f0f2f7;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f8faff, #fff);
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

.drawer-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drawer-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.drawer-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #eef2f7;
  min-width: 0;
}

.drawer-stat--wide {
  grid-column: 1 / -1;
}

.drawer-stat--time .drawer-stat-val {
  font-size: 11.5px;
  font-weight: 600;
  white-space: normal;
  line-height: 1.35;
}

.drawer-stat--accent {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border-color: #ffe4ec;
}

.drawer-stat--ok .drawer-stat-val { color: #42c978; }
.drawer-stat--fail .drawer-stat-val { color: #ff4d4f; }

.drawer-stat-label {
  font-size: 10px;
  font-weight: 800;
  color: #8a95a8;
  text-transform: uppercase;
  letter-spacing: 0.35px;
}

.drawer-stat-val {
  font-size: 15px;
  font-weight: 900;
  color: #152033;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.drawer-stat-val.mono {
  font-size: 12px;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
  font-weight: 600;
  color: #425066;
}

.drawer-stat-amount {
  font-size: 18px;
  color: #ee4d7a;
}

.drawer-stat-pill {
  align-self: flex-start;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
}

.dbi-progress-wrap {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.dbi-progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #8a95a8;
}

.dbi-progress-top strong {
  font-size: 13px;
  font-weight: 900;
  color: #152033;
}

.dbi-progress-bar {
  height: 8px;
  border-radius: 999px;
  background: #e8edf4;
  overflow: hidden;
}

.dbi-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--rp-primary);
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* 拖拽条（仅移动端可见） */
.drawer-drag-bar {
  display: none;
}

.drawer-order-count {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: #425066;
  margin-bottom: 12px;
}

.drawer-order-count-badge {
  display: inline-grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #8b7bf7, #2f6df6);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

/* 订单列表 */
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
  background: #f8faff;
  -webkit-overflow-scrolling: touch;
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 14px 16px;
  border: 1px solid #edf1f7;
  border-radius: 16px;
  margin-bottom: 12px;
  background: #fff;
  box-shadow: 0 2px 12px rgba(21, 32, 51, 0.04);
  transition: box-shadow 200ms ease, border-color 200ms ease;
}

.order-card:hover {
  border-color: #dfe7f3;
  box-shadow: 0 6px 20px rgba(47, 109, 246, 0.08);
}

.order-card:last-child { margin-bottom: 0; }

.oc-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.oc-card-top-end {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  margin-left: auto;
}

.oc-card-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.oc-avatar-wrap {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid #fff;
  box-shadow: 0 4px 14px rgba(21, 32, 51, 0.1);
  background: linear-gradient(135deg, #f3f0ff, #eef3ff);
}

.oc-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.oc-avatar-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 900;
  color: #8b7bf7;
  background: linear-gradient(135deg, #f3f0ff, #e8f0ff);
}

.oc-note-block {
  flex: 1;
  min-width: 0;
}

.oc-order-no {
  margin: -4px 0 0;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1.35;
  color: #8a95a8;
  word-break: break-all;
}

.oc-title {
  font-size: 14px;
  font-weight: 800;
  color: #152033;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.oc-title-muted {
  color: #8a95a8;
  font-weight: 600;
}

.oc-author {
  margin-top: 3px;
  font-size: 12px;
  color: #8a95a8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oc-idx {
  font-size: 12px;
  font-weight: 800;
  color: #2f6df6;
  background: #eef3ff;
  padding: 4px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.oc-refund-btn {
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
  font-size: 11px;
  font-weight: 600;
  color: #f59e0b;
  background: #fef3c7;
  padding: 3px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.oc-status-pill {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
  white-space: nowrap;
}

.oc-url-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 11px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  transition: background 180ms ease, border-color 180ms ease;
}

.oc-url-row:hover {
  background: #eef3ff;
  border-color: #c9d6ef;
}

.oc-url {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #2f6df6;
  text-decoration: none;
}

.oc-url svg { flex-shrink: 0; color: #8b7bf7; }

.oc-url span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.oc-url-copy {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: #fff;
  color: #2f6df6;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(47, 109, 246, 0.08);
  transition: background 180ms ease, color 180ms ease, transform 120ms ease;
}

.oc-url-copy:hover {
  background: #eef3ff;
}

.oc-url-copy:active {
  transform: scale(0.96);
}

.oc-url-copy.copied {
  color: #42c978;
  background: #f0fff4;
}

.oc-details {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.oc-detail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  border-radius: 11px;
  background: #f8faff;
  border: 1px solid #eef2f7;
  text-align: center;
}

.oc-detail:last-child {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border-color: #ffe4ec;
}

.oc-detail:last-child strong {
  color: #ee4d7a;
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
  padding: 12px 12px 2px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.oc-progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: #8a95a8;
}

.oc-progress-top strong {
  font-size: 12px;
  font-weight: 900;
}

.oc-progress-bar {
  height: 8px;
  border-radius: 999px;
  background: #e8edf4;
  overflow: hidden;
}

.oc-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--rp-primary);
  transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1);
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
  .batch-list-head,
  .batch-row {
    --batch-cols: minmax(200px, 1.2fr) minmax(56px, 0.5fr) minmax(56px, 0.5fr) minmax(56px, 0.5fr) minmax(96px, 0.75fr) minmax(132px, 0.95fr);
  }

  .batch-list-head.no-fail-col,
  .batch-row.no-fail-col {
    --batch-cols: minmax(200px, 1.2fr) minmax(56px, 0.5fr) minmax(56px, 0.5fr) minmax(96px, 0.75fr) minmax(132px, 0.95fr);
  }

  .sup-batch-list-head,
  .sup-batch-row {
    --batch-cols: minmax(180px, 1.2fr) minmax(56px, 0.48fr) minmax(56px, 0.48fr) minmax(68px, 0.52fr) minmax(80px, 0.6fr) minmax(100px, 0.8fr);
  }

  .sup-batch-list-head.sup-batch-list-head--no-agent,
  .sup-batch-row.sup-batch-row--no-agent {
    --batch-cols: minmax(200px, 1.25fr) minmax(60px, 0.5fr) minmax(60px, 0.5fr) minmax(88px, 0.65fr) minmax(100px, 0.8fr);
  }

  .batch-stat strong { font-size: 16px; }
  .batch-amount strong { font-size: 15px; }
}

@media (max-width: 1000px) {
  .stats-row { grid-template-columns: repeat(2, 1fr); }

  .batch-list-head { display: none; }

  .sup-batch-list-head { display: none; }

  .batch-row {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px 10px;
    padding: 16px 18px;
  }

  .batch-info { grid-column: 1 / -1; }

  .batch-stat,
  .batch-amount {
    padding: 8px 6px;
  }

  .batch-amount { text-align: center; }

  .batch-action {
    grid-column: 1 / -1;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px dashed #eef2f7;
    margin-top: 4px;
  }

  /* 补单记录：窄屏用卡片内统计，避免与右侧数字挤在一行 */
  .sup-batch-row {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 16px;
  }

  .sup-batch-row .batch-stat,
  .sup-batch-row .batch-amount {
    display: none;
  }

  .sup-batch-row .mobile-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--rp-border);
  }

  .sup-batch-row .mobile-stat-grid .msg-label {
    font-size: 10px;
  }

  .sup-batch-row .mobile-stat-grid .msg-val {
    font-size: 14px;
    font-weight: 700;
  }

  .sup-batch-row .mobile-stat-grid.sup-grid .msg-cell.amount {
    display: flex;
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: #fff6f6;
    border: 1px solid #ffe4e4;
  }

  .sup-batch-row .mobile-stat-grid.sup-grid .msg-cell.amount .msg-label {
    font-size: 11px;
    margin-bottom: 0;
  }

  .sup-batch-row .mobile-stat-grid.sup-grid .msg-cell.amount .msg-val {
    font-size: 14px;
  }

  .sup-batch-row .batch-action {
    position: absolute;
    top: 14px;
    right: 14px;
    grid-column: auto;
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .sup-batch-row .batch-action .arrow-icon {
    display: none;
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
  .stat-label { font-size: 11px; }
  .stat-value { font-size: 16px; }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 14px 16px;
    border-top: none;
  }

  .page-hero { margin-bottom: 10px; }
  .hero-inner { padding: 14px 12px; gap: 12px; }
  .hero-content { padding: 14px 14px 12px; }
  .user-hero-row {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }
  .user-hero-cards {
    width: 100%;
  }
  .user-stat-card {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
  }
  .user-stat-val { font-size: 16px; }
  .user-stat-val--money { font-size: 14px; }
  .hero-badge {
    font-size: 10px;
    padding: 3px 10px;
    margin-bottom: 6px;
  }
  .hero-title { font-size: 16px; }
  .hero-desc {
    font-size: 12px;
    line-height: 1.45;
    margin-top: 4px;
  }

  .filter-toolbar {
    width: 100%;
    gap: 12px;
  }

  .module-select { width: 100%; }

  .module-trigger { width: 100%; justify-content: flex-start; }

  .module-dropdown { min-width: 100%; }

  .filter-form {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .filter-fields {
    display: grid;
    grid-template-columns: 1fr;
    min-width: 0;
    gap: 8px;
  }

  .filter-input,
  .filter-fields .filter-select {
    width: 100% !important;
    min-width: 0;
    max-width: none;
    height: 34px;
    font-size: 12px !important;
    font-weight: 400;
    line-height: 1.25;
    border-radius: 8px;
    border-width: 1px;
  }

  .filter-input {
    padding: 0 11px;
  }

  .filter-input::placeholder {
    font-size: 12px;
    font-weight: 400;
  }

  .filter-fields .filter-select {
    padding: 0 28px 0 11px;
    background-position: right 10px center;
    background-size: 9px 5px;
  }

  .filter-fields .filter-select option {
    font-size: 12px;
    font-weight: 400;
  }

  .filter-fields :deep(.filter-date.el-date-editor) {
    width: 100% !important;
    min-width: 0;
    max-width: none;
    height: 34px !important;
    --el-date-editor-width: 100%;
  }

  .filter-fields :deep(.filter-date .el-input__wrapper) {
    min-height: 32px;
    padding: 0 8px 0 10px;
    border-radius: 8px;
    border-width: 1px;
  }

  .filter-fields :deep(.filter-date .el-input__inner) {
    height: 32px;
    line-height: 32px;
    font-size: 12px !important;
  }

  .filter-fields :deep(.filter-date .el-input__inner::placeholder) {
    font-size: 12px;
  }

  .filter-fields :deep(.filter-date .el-input__prefix-inner) {
    font-size: 13px;
  }

  .filter-field-agent { grid-column: auto; }

  .filter-actions {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
    gap: 8px;
  }

  .filter-total {
    padding: 4px 10px;
    font-size: 11px;
  }

  .filter-total-num {
    font-size: 13px;
  }

  .filter-btns {
    flex: 0 0 auto;
  }

  .filter-btns .btn-search,
  .filter-btns .btn-reset {
    width: auto;
    min-width: 72px;
    height: 34px;
    padding-left: 14px;
    padding-right: 14px;
    font-size: 12px;
    border-radius: 8px;
  }

  .batch-list { padding: 12px 14px 16px; }

  .batch-list-head { display: none; }

  .mobile-tabs {
    display: flex;
    gap: 4px;
    padding: 10px 12px 0;
    background: #f6f8fc;
    border-bottom: none;
  }

  .mobile-tab {
    flex: 1;
    padding: 8px 0;
    font-size: 12px;
    font-weight: 700;
    border-radius: 10px 10px 0 0;
    border-bottom: none;
    background: transparent;
  }

  .mobile-tab.active {
    background: #fff;
    color: var(--rp-primary);
    box-shadow: 0 -2px 8px rgba(21, 32, 51, 0.04);
  }

  .filter-bar {
    padding: 12px 14px 14px;
    border-bottom: 1px solid #f0f2f7;
  }

  .filter-toolbar .module-select { display: none; }

  .filter-toolbar--sup {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .filter-toolbar--sup .filter-sup-head-total {
    display: none;
  }

  .filter-form--sup {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .filter-sup-mobile-total {
    display: inline-flex;
  }

  .filter-actions--btns-only {
    justify-content: space-between;
    width: 100%;
  }

  .batch-row {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 14px 16px;
  }

  .batch-info { grid-column: 1 / -1; width: 100%; min-width: 0; margin-bottom: 0; }

  .batch-stat,
  .batch-amount { display: none; }

  .mobile-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--rp-border);
  }

  .mobile-stat-grid .msg-cell {
    padding: 8px 6px;
    border-radius: 8px;
    background: #f8fafc;
  }

  .mobile-stat-grid .msg-label {
    font-size: 10px;
    color: var(--rp-text-3);
  }

  .mobile-stat-grid .msg-val {
    font-size: 16px;
    font-weight: 700;
  }

  .mobile-stat-grid:not(.sup-grid) {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .mobile-stat-grid:not(.sup-grid) .msg-cell.amount {
    display: flex;
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: #f5f8ff;
    border: 1px solid #e4ecff;
  }

  .mobile-stat-grid:not(.sup-grid) .msg-cell.amount .msg-label {
    font-size: 11px;
    color: var(--rp-text-2);
  }

  .mobile-stat-grid:not(.sup-grid) .msg-cell.amount .msg-val {
    font-size: 15px;
  }

  .mobile-stat-grid.sup-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .mobile-stat-grid.sup-grid .msg-cell.amount {
    display: flex;
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    background: #fff6f6;
    border: 1px solid #ffe4e4;
  }

  .mobile-stat-grid.sup-grid .msg-cell.amount .msg-label {
    font-size: 11px;
    color: var(--rp-text-2);
    margin-bottom: 0;
  }

  .mobile-stat-grid.sup-grid .msg-cell.amount .msg-val {
    font-size: 14px;
    font-weight: 700;
  }

  .sup-batch-row .batch-no.sup-link {
    font-size: 12px;
    font-weight: 600;
  }

  .sup-batch-row .batch-time {
    font-size: 11px;
  }

  .action-amount {
    display: none;
  }

  .batch-head {
    width: 100%;
    box-sizing: border-box;
    padding-right: 36px;
    flex-wrap: wrap;
    gap: 6px;
  }

  .batch-meta-row {
    padding-right: 0;
    gap: 5px;
  }

  .batch-time {
    font-size: 11px;
    line-height: 1.45;
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

  .batch-head .batch-no {
    font-size: 12px;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batch-chip {
    font-size: 10px;
    padding: 2px 7px;
  }

  .pagination-wrap { padding: 8px 16px 16px; }

  /* 抽屉 → 底部 sheet */
  .drawer-mask {
    align-items: flex-end;
    justify-content: stretch;
    background: rgba(15, 23, 42, 0.52);
    backdrop-filter: blur(6px);
  }

  .order-drawer {
    width: 100%;
    height: min(92dvh, 92vh);
    max-height: 92dvh;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -12px 48px rgba(15, 23, 42, 0.18);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .drawer-drag-bar {
    display: flex;
    justify-content: center;
    padding: 10px 0 2px;
    flex-shrink: 0;
  }

  .drawer-drag-bar span {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: #d8dee9;
  }

  .drawer-header {
    padding: 10px 16px 14px;
  }

  .drawer-title-row { margin-bottom: 10px; }
  .drawer-title-row h3 { font-size: 17px; }

  .drawer-close {
    width: 36px;
    height: 36px;
    border-radius: 12px;
  }

  .drawer-stats {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .drawer-stat {
    padding: 10px 11px;
    border-radius: 11px;
  }

  .drawer-stat--wide {
    grid-column: 1 / -1;
  }

  .drawer-stat-amount {
    font-size: 20px;
  }

  .dbi-progress-wrap {
    padding: 10px 12px;
  }

  .drawer-actions-bar {
    padding: 0 16px 12px;
  }

  .verify-batch-btn {
    width: 100%;
    min-height: 44px;
    justify-content: center;
    border-radius: 12px;
  }

  .drawer-body {
    padding: 12px 14px calc(18px + env(safe-area-inset-bottom, 0));
  }

  .order-card {
    gap: 10px;
    padding: 14px;
    margin-bottom: 12px;
  }

  .oc-avatar-wrap {
    width: 52px;
    height: 52px;
  }

  .oc-title {
    font-size: 15px;
  }

  .oc-details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .oc-detail:last-child {
    grid-column: 1 / -1;
  }

  .oc-detail strong {
    font-size: 15px;
  }

  .oc-verify-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .refund-btn {
    min-height: 34px;
    padding: 0 14px;
    font-size: 12px;
  }

  .sup-batch-row .btn-approve-all {
    height: 28px;
    padding: 0 10px;
    font-size: 11px;
  }

  /* 补单抽屉 - 移动端 */
  .sup-drawer-meta { padding-top: 8px; }

  .sup-drawer-batch-link { font-size: 12px; margin-bottom: 8px; }

  .sup-drawer-chips { gap: 6px; }

  .sd-chip { padding: 4px 8px; font-size: 11px; }
  .sd-chip strong { font-size: 13px; }

  .sup-card-actions .btn-approve,
  .sup-card-actions .btn-reject {
    flex: 1;
    justify-content: center;
    min-width: 0;
    height: 34px;
  }

  /* 底部弹窗动画：上下滑动 */
  .records-drawer-mask .order-drawer {
    animation: recordsDrawerSlideUp 320ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  @keyframes recordsDrawerSlideUp {
    from { transform: translateY(100%); }
  }

  .user-order-row.is-expanded {
    box-shadow: 0 6px 18px rgba(47, 109, 246, 0.07);
  }

  .filter-bar--user {
    padding: 0;
  }

  .user-order-filter {
    padding: 14px 12px 16px;
  }

  .user-order-filter-head {
    margin-bottom: 16px;
  }

  .user-order-filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .user-search-field {
    flex: none;
    width: 100%;
    min-height: 40px;
    height: 40px;
    padding: 0 10px 0 12px;
  }

  .user-search-input {
    min-height: 38px;
    height: 38px;
    line-height: 38px;
    font-size: 13px;
  }

  .user-search-input::placeholder {
    font-size: 13px;
  }

  .user-search-btn {
    width: 100%;
    height: 38px;
    font-size: 13px;
  }

  .user-order-list {
    padding: 10px 10px 12px;
  }

  .records-page--user-orders .pagination-wrap {
    padding: 10px 12px 14px;
  }

  .uor-clickable {
    padding: 10px 8px;
    gap: 10px;
  }

  .uor-avatar-wrap {
    width: 46px;
    height: 46px;
    border-radius: 12px;
  }

  .uor-title {
    font-size: 13px;
    line-height: 1.4;
  }

  .uor-time {
    font-size: 11px;
  }

  .uor-metric-label {
    font-size: 10px;
  }

  .uor-metric-type {
    font-size: 11px;
    padding: 2px 8px;
  }

  .uor-metrics--detail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 12px;
    padding: 10px 8px;
  }

  .uor-metric:nth-child(3)::before,
  .uor-metric:nth-child(4)::before {
    display: none;
  }

  .uor-metric:nth-child(odd)::before {
    display: none;
  }

  .uor-metric:nth-child(even)::before {
    display: block;
  }

  .uor-metric strong {
    font-size: 13px;
  }

  .uor-metric .is-pay {
    font-size: 13px;
  }

  .uor-detail {
    padding: 8px 8px 12px;
  }

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
