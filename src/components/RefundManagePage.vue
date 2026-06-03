<script setup>
import { inject, onMounted, ref, computed } from 'vue'

const ws = inject('workspace')
const { getToken, isAdmin, fetchBalance } = ws

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 15
const loading = ref(false)
const filterStatus = ref('')
const totalPages = computed(() => Math.ceil(total.value / pageSize) || 1)

async function fetchList() {
  loading.value = true
  try {
    const params = new URLSearchParams({ page: page.value, pageSize })
    if (filterStatus.value) params.append('status', filterStatus.value)
    const res = await fetch(`/api/refund?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      list.value = data.data.list
      total.value = data.data.total
    }
  } catch { /* */ }
  finally { loading.value = false }
}

function changeFilter(s) {
  filterStatus.value = s
  page.value = 1
  fetchList()
}

function goPage(p) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  fetchList()
}

const pageNums = computed(() => {
  const t = totalPages.value
  const c = page.value
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const pages = [1]
  if (c > 3) pages.push('...')
  for (let i = Math.max(2, c - 1); i <= Math.min(t - 1, c + 1); i++) pages.push(i)
  if (c < t - 2) pages.push('...')
  pages.push(t)
  return pages
})

const statusMap = {
  pending: { label: '待审批', color: '#f59e0b', bg: '#fef3c7' },
  approved: { label: '已通过', color: '#10b981', bg: '#d1fae5' },
  rejected: { label: '已驳回', color: '#ef4444', bg: '#fee2e2' }
}

function sc(s) { return statusMap[s] || { label: s, color: '#6b7280', bg: '#f3f4f6' } }

function fmtTime(t) {
  if (!t) return '-'
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtMoney(v) {
  return (parseFloat(v) || 0).toFixed(2)
}

function displayName(row) {
  return row.real_name || row.nickname || row.username || '-'
}

// 审批
const processing = ref(null)
const approvingAll = ref(false)
const confirmModal = ref({ show: false, msg: '', onOk: null })
const toastMsg = ref('')
let toastTimer = null

function showConfirm(msg, onOk) { confirmModal.value = { show: true, msg, onOk } }
function confirmOk() { const fn = confirmModal.value.onOk; confirmModal.value = { show: false, msg: '', onOk: null }; if (fn) fn() }
function confirmCancel() { confirmModal.value = { show: false, msg: '', onOk: null } }
function showToast(msg) { toastMsg.value = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMsg.value = '' }, 3000) }

const pendingCount = computed(() => list.value.filter(i => i.status === 'pending').length)

function handleApprove(item) {
  showConfirm(`确认通过退款申请？将按未完成部分退还约 ¥${fmtMoney(item.refund_amount)}。`, () => doApprove(item, false))
}

function handleFullRefund(item) {
  showConfirm(`确认全额退款？将退还该订单全部金额，不扣除已完成部分。`, () => doApprove(item, true))
}

async function doApprove(item, fullRefund) {
  processing.value = item.id
  try {
    const res = await fetch(`/api/refund/${item.id}/approve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ remark: '', fullRefund })
    })
    const data = await res.json()
    showToast(data.message || (data.code === 0 ? '已通过' : '操作失败'))
    if (data.code === 0) { fetchList(); closeDrawer(); fetchBalance() }
  } catch { showToast('请求失败') }
  finally { processing.value = null }
}

function handleReject(item) {
  showConfirm('确认驳回该退款申请？', () => doReject(item))
}

async function doReject(item) {
  processing.value = item.id
  try {
    const res = await fetch(`/api/refund/${item.id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ remark: '' })
    })
    const data = await res.json()
    showToast(data.message || (data.code === 0 ? '已驳回' : '操作失败'))
    if (data.code === 0) { fetchList(); closeDrawer() }
  } catch { showToast('请求失败') }
  finally { processing.value = null }
}

function handleApproveAll() {
  showConfirm(`确认一键同意所有 ${pendingCount.value} 条待处理退款申请？`, doApproveAll)
}

async function doApproveAll() {
  approvingAll.value = true
  try {
    const res = await fetch('/api/refund/approve-all', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({})
    })
    const data = await res.json()
    showToast(data.message || '操作完成')
    if (data.code === 0) fetchList()
  } catch { showToast('请求失败') }
  finally { approvingAll.value = false }
}

// ========== 订单详情抽屉 ==========
const showDrawer = ref(false)
const drawerItem = ref(null)
const drawerOrders = ref([])
const drawerLoading = ref(false)
const drawerPage = ref(1)
const drawerPageSize = 10
const drawerTotalPages = computed(() => Math.ceil(drawerOrders.value.length / drawerPageSize) || 1)
const pagedDrawerOrders = computed(() => {
  const start = (drawerPage.value - 1) * drawerPageSize
  return drawerOrders.value.slice(start, start + drawerPageSize)
})
function goDrawerPage(p) {
  if (p < 1 || p > drawerTotalPages.value) return
  drawerPage.value = p
}

async function openDetail(item) {
  drawerItem.value = item
  showDrawer.value = true
  drawerLoading.value = true
  drawerOrders.value = []
  drawerPage.value = 1
  avatarLoadFailed.value = {}
  try {
    const res = await fetch(`/api/batch/${item.batch_id}/orders`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) drawerOrders.value = data.data.orders || []
  } catch { /* */ }
  finally { drawerLoading.value = false }
}

function closeDrawer() { showDrawer.value = false }

const typeMap = { read: '阅读', like: '点赞', impression: '曝光', collect: '收藏', comment: '评论', view: '阅读' }
function ft(t) { return typeMap[t] || t }
function pn(item) {
  if (item.product_name) return item.product_name.replace(/^小红书/, '')
  return ft(item.target_type)
}

const orderStatusConf = {
  pending: { label: '待处理', color: '#9aa5b5' },
  running: { label: '进行中', color: '#5b8def' },
  processing: { label: '处理中', color: '#5b8def' },
  completed: { label: '已完成', color: '#10b981' },
  partial_completed: { label: '部分完成', color: '#f59e0b' },
  failed: { label: '失败', color: '#ef4444' },
  refunded: { label: '已退款', color: '#8b5cf6' },
  cancelled: { label: '已取消', color: '#6b7280' },
  stopped: { label: '已停止', color: '#6b7280' }
}
function osc(s) { return orderStatusConf[s] || { label: s || '-', color: '#9aa5b5' } }

function orderProgress(o) {
  const ordered = o.ordered_quantity || 0
  if (!ordered) return 0
  return Math.min(100, Math.round(((o.completed_quantity || 0) / ordered) * 100))
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

onMounted(fetchList)
</script>

<template>
  <div class="refund-page">
    <header class="page-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-content">
        <div class="hero-text">
          <span class="hero-badge">财务审核</span>
          <h1 class="hero-title">退款申请</h1>
          <p class="hero-desc">审核用户退款请求，支持按状态筛选、批量通过及全额退款操作。</p>
        </div>
        <button
          v-if="pendingCount > 0"
          type="button"
          class="approve-all-btn"
          :disabled="approvingAll"
          @click="handleApproveAll"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {{ approvingAll ? '处理中...' : `一键同意 (${pendingCount})` }}
        </button>
      </div>
    </header>

    <section class="refund-panel">
      <div class="panel-toolbar">
        <div class="toolbar-left">
          <span class="total-badge">
            共 <strong>{{ total }}</strong> 条
          </span>
          <span v-if="pendingCount > 0" class="pending-badge">{{ pendingCount }} 待审批</span>
        </div>
        <div class="filter-tabs" role="tablist">
          <button type="button" class="filter-btn" :class="{ active: filterStatus === '' }" @click="changeFilter('')">全部</button>
          <button type="button" class="filter-btn" data-tone="pending" :class="{ active: filterStatus === 'pending' }" @click="changeFilter('pending')">待审批</button>
          <button type="button" class="filter-btn" data-tone="approved" :class="{ active: filterStatus === 'approved' }" @click="changeFilter('approved')">已通过</button>
          <button type="button" class="filter-btn" data-tone="rejected" :class="{ active: filterStatus === 'rejected' }" @click="changeFilter('rejected')">已驳回</button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="refund-table">
          <colgroup>
            <col class="col-user" />
            <col class="col-batch" />
            <col class="col-money" />
            <col class="col-reason" />
            <col class="col-status" />
            <col class="col-time" />
            <col class="col-reviewer" />
            <col class="col-remark" />
            <col class="col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>申请人</th>
              <th>批次号</th>
              <th>预估退款</th>
              <th>申请理由</th>
              <th>状态</th>
              <th>申请时间</th>
              <th>审批人</th>
              <th>备注</th>
              <th class="th-action">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in list" :key="item.id" class="data-row" @click="openDetail(item)">
              <td class="user-cell">{{ displayName(item) }}</td>
              <td class="mono batch-cell">{{ item.batch_no || '-' }}</td>
              <td class="money-cell">¥{{ fmtMoney(item.refund_amount) }}</td>
              <td class="reason-cell" :title="item.reason || ''">{{ item.reason || '-' }}</td>
              <td>
                <span class="status-pill" :style="{ color: sc(item.status).color, background: sc(item.status).bg, borderColor: sc(item.status).color + '33' }">
                  {{ sc(item.status).label }}
                </span>
              </td>
              <td class="time-cell">{{ fmtTime(item.created_at) }}</td>
              <td class="reviewer-cell">{{ item.reviewer_name || '-' }}</td>
              <td class="reason-cell" :title="item.review_remark || ''">{{ item.review_remark || '-' }}</td>
              <td class="action-cell" @click.stop>
                <div class="action-btns">
                  <template v-if="item.status === 'pending'">
                    <button type="button" class="tbl-act-btn approve" :disabled="processing === item.id" @click="handleApprove(item)">通过</button>
                    <button type="button" class="tbl-act-btn reject" :disabled="processing === item.id" @click="handleReject(item)">驳回</button>
                  </template>
                  <button v-if="isAdmin" type="button" class="tbl-act-btn full-refund" :disabled="processing === item.id" @click="handleFullRefund(item)">全额退款</button>
                  <span v-if="item.status !== 'pending' && !isAdmin" class="action-placeholder">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loading" class="empty-state">
          <div class="empty-spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-if="!loading && list.length === 0" class="empty-state">暂无退款申请</div>
      </div>
    </section>

    <div v-if="total > pageSize" class="pagination-wrap">
      <div class="pagination">
      <button class="page-btn" :disabled="page <= 1" @click="goPage(page - 1)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <template v-for="p in pageNums" :key="'rp-' + p">
        <span v-if="typeof p === 'string'" class="page-dots">{{ p }}</span>
        <button v-else class="page-btn" :class="{ active: page === p }" @click="goPage(p)">{{ p }}</button>
      </template>
      <button class="page-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      </div>
    </div>

    <!-- 订单详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showDrawer" class="drawer-mask" @click.self="closeDrawer">
        <Transition name="drawer-slide">
          <div v-if="showDrawer" class="order-drawer">
            <div class="drawer-handle" aria-hidden="true"></div>
            <div class="drawer-header">
              <div class="drawer-title-row">
                <h3>批次订单明细</h3>
                <div class="drawer-title-actions">
                  <template v-if="drawerItem?.status === 'pending' && !drawerItem?.order_id">
                    <button type="button" class="act-btn approve" :disabled="processing === drawerItem.id" @click="handleApprove(drawerItem)">通过</button>
                    <button type="button" class="act-btn reject" :disabled="processing === drawerItem.id" @click="handleReject(drawerItem)">驳回</button>
                  </template>
                  <span v-else-if="drawerItem" class="done-hint-tag" :style="{ color: sc(drawerItem.status).color, background: sc(drawerItem.status).bg }">{{ sc(drawerItem.status).label }}</span>
                  <button type="button" class="drawer-close" aria-label="关闭" @click="closeDrawer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div v-if="drawerItem" class="drawer-summary">
                <div class="drawer-stats">
                  <div class="drawer-stat">
                    <span class="drawer-stat-label">申请人</span>
                    <span class="drawer-stat-val">{{ displayName(drawerItem) }}</span>
                  </div>
                  <div class="drawer-stat drawer-stat--wide">
                    <span class="drawer-stat-label">批次号</span>
                    <span class="drawer-stat-val mono">{{ drawerItem.batch_no }}</span>
                  </div>
                  <div class="drawer-stat drawer-stat--accent">
                    <span class="drawer-stat-label">预估退款</span>
                    <span class="drawer-stat-val drawer-stat-amount">¥{{ fmtMoney(drawerItem.refund_amount) }}</span>
                  </div>
                  <div class="drawer-stat">
                    <span class="drawer-stat-label">状态</span>
                    <span class="status-pill drawer-stat-pill" :style="{ color: sc(drawerItem.status).color, background: sc(drawerItem.status).bg }">{{ sc(drawerItem.status).label }}</span>
                  </div>
                </div>
                <button
                  v-if="isAdmin"
                  type="button"
                  class="drawer-full-refund-btn"
                  :disabled="processing === drawerItem.id"
                  @click="handleFullRefund(drawerItem)"
                >全额退款</button>
              </div>
            </div>
            <div class="drawer-body">
              <div v-if="drawerLoading" class="drawer-loading">
                <div class="spinner"></div><span>加载中...</span>
              </div>
              <template v-else-if="drawerOrders.length">
                <div class="drawer-order-count">
                  <span class="drawer-order-count-badge">{{ drawerOrders.length }}</span>
                  条订单
                </div>
                <div
                  v-for="(order, idx) in pagedDrawerOrders"
                  :key="order.id"
                  class="od-card"
                  :class="{ 'od-card-target': drawerItem?.order_id === order.id }"
                >
                  <div class="od-card-top">
                    <span class="od-idx">#{{ (drawerPage - 1) * drawerPageSize + idx + 1 }}</span>
                    <div v-if="drawerItem?.order_id === order.id && drawerItem?.status === 'pending'" class="od-actions">
                      <button type="button" class="od-act-btn approve" :disabled="processing === drawerItem.id" @click.stop="handleApprove(drawerItem)">通过</button>
                      <button type="button" class="od-act-btn reject" :disabled="processing === drawerItem.id" @click.stop="handleReject(drawerItem)">驳回</button>
                    </div>
                    <span
                      v-else
                      class="od-status-pill"
                      :style="{
                        color: osc(order.order_status).color,
                        background: osc(order.order_status).color + '14',
                        borderColor: osc(order.order_status).color + '40'
                      }"
                    >{{ osc(order.order_status).label }}</span>
                  </div>

                  <div class="od-card-main">
                    <div class="od-avatar-wrap">
                      <img
                        v-if="orderAvatarUrl(order) && !showOrderAvatarFallback(order)"
                        class="od-avatar"
                        :src="orderAvatarUrl(order)"
                        :alt="orderAuthorName(order) || '笔记头像'"
                        loading="lazy"
                        @error="onOrderAvatarError(order.id)"
                      />
                      <span v-if="showOrderAvatarFallback(order)" class="od-avatar-fallback">{{ orderAvatarInitial(order) }}</span>
                    </div>
                    <div class="od-note-block">
                      <p v-if="orderNoteTitle(order)" class="od-title">{{ orderNoteTitle(order) }}</p>
                      <p v-else class="od-title od-title-muted">未获取笔记标题</p>
                      <p v-if="orderAuthorName(order)" class="od-author">{{ orderAuthorName(order) }}</p>
                    </div>
                  </div>

                  <p class="od-order-no mono">{{ order.order_no }}</p>

                  <a v-if="order.note_url" class="od-url" :href="order.note_url" target="_blank" rel="noopener" @click.stop>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <span>{{ order.note_url }}</span>
                  </a>

                  <div class="od-metrics">
                    <div class="od-metric">
                      <span class="od-metric-label">类型</span>
                      <strong class="od-metric-tag">{{ pn(order) }}</strong>
                    </div>
                    <div class="od-metric">
                      <span class="od-metric-label">下单数</span>
                      <strong>{{ order.ordered_quantity }}</strong>
                    </div>
                    <div class="od-metric">
                      <span class="od-metric-label">完成数</span>
                      <strong class="ok-num">{{ order.completed_quantity || 0 }}</strong>
                    </div>
                    <div class="od-metric od-metric-accent">
                      <span class="od-metric-label">付款</span>
                      <strong>¥{{ fmtMoney(order.actual_paid_amount || 0) }}</strong>
                    </div>
                  </div>

                  <div class="od-progress">
                    <div class="od-progress-top">
                      <span>完成进度</span>
                      <strong :style="{ color: osc(order.order_status).color }">{{ orderProgress(order) }}%</strong>
                    </div>
                    <div class="od-progress-bar">
                      <div
                        class="od-progress-fill"
                        :style="{ width: orderProgress(order) + '%', background: osc(order.order_status).color }"
                      ></div>
                    </div>
                  </div>
                </div>
                <div v-if="drawerOrders.length > drawerPageSize" class="drawer-pager">
                  <button class="page-btn" :disabled="drawerPage <= 1" @click="goDrawerPage(drawerPage - 1)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <span class="drawer-page-info">{{ drawerPage }} / {{ drawerTotalPages }}</span>
                  <button class="page-btn" :disabled="drawerPage >= drawerTotalPages" @click="goDrawerPage(drawerPage + 1)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </template>
              <div v-else class="drawer-empty">暂无订单数据</div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

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

    <Transition name="toast-slide">
      <div v-if="toastMsg" class="custom-toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.refund-page {
  --rp-primary: #2f6df6;
  --rp-accent: #ee4d7a;
  --rp-purple: #8b7bf7;
  --rp-text: #152033;
  --rp-text-2: #425066;
  --rp-text-3: #8a95a8;
  --rp-border: #e8eef7;
  --rp-radius: 14px;
  --rp-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  --rp-shadow-lg: 0 12px 40px rgba(47, 109, 246, 0.08), 0 4px 12px rgba(21, 32, 51, 0.04);
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px 20px 40px;
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
  background: #fff;
}

.hero-content {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px;
  flex-wrap: wrap;
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
  max-width: 480px;
}

.approve-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 20px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #42c978, #38b2ac);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(66, 201, 120, 0.28);
  transition: transform 200ms ease, box-shadow 200ms ease, opacity 200ms ease;
}

.approve-all-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(66, 201, 120, 0.35);
}

.approve-all-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ========== 主面板 ========== */
.refund-panel {
  background: #fff;
  border-radius: var(--rp-radius);
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow);
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-bottom: 1px solid #f0f2f7;
  background: linear-gradient(180deg, #fcfdff, #fff);
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.total-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 13px;
  color: var(--rp-text-3);
  font-weight: 600;
}

.total-badge strong {
  font-size: 15px;
  font-weight: 900;
  color: var(--rp-primary);
}

.pending-badge {
  display: inline-flex;
  padding: 6px 12px;
  border-radius: 999px;
  background: #fff9ef;
  border: 1px solid #ffe1ad;
  color: #b96b00;
  font-size: 12px;
  font-weight: 800;
}

.filter-tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: #f6f8fc;
  border: 1px solid #eef2f7;
}

.filter-btn {
  min-height: 34px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--rp-text-3);
  cursor: pointer;
  white-space: nowrap;
  transition: all 200ms ease;
}

.filter-btn:hover {
  color: var(--rp-text-2);
  background: rgba(255, 255, 255, 0.7);
}

.filter-btn.active {
  background: var(--goosd-primary);
  color: #fff;
  box-shadow: var(--goosd-btn-shadow);
}

.filter-btn.active[data-tone="pending"] {
  background: linear-gradient(135deg, #f5a623, #f09d3d);
  box-shadow: 0 4px 12px rgba(245, 166, 35, 0.25);
}

.filter-btn.active[data-tone="approved"] {
  background: linear-gradient(135deg, #42c978, #38b2ac);
  box-shadow: 0 4px 12px rgba(66, 201, 120, 0.25);
}

.filter-btn.active[data-tone="rejected"] {
  background: linear-gradient(135deg, #ff6b6b, #ef4444);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.22);
}

/* ========== 表格 ========== */
.table-wrap {
  overflow-x: auto;
  background: #f8faff;
}

.refund-table {
  width: 100%;
  min-width: 980px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  table-layout: fixed;
}

.col-user { width: 88px; }
.col-batch { width: 18%; }
.col-money { width: 96px; }
.col-reason { width: 12%; }
.col-status { width: 92px; }
.col-time { width: 132px; }
.col-reviewer { width: 80px; }
.col-remark { width: 10%; }
.col-action { width: 220px; }

.refund-table th {
  text-align: left;
  padding: 14px 16px;
  font-weight: 800;
  color: var(--rp-text-3);
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  background: #fff;
  border-bottom: 1px solid #eef2f7;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

.th-action,
.action-cell {
  text-align: right;
}

.refund-table td {
  padding: 16px;
  color: var(--rp-text-2);
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
  background: #fff;
}

.data-row {
  cursor: pointer;
  transition: background 180ms ease;
}

.data-row:hover td {
  background: #fafbff;
}

.data-row:last-child td {
  border-bottom: none;
}

.mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
}

.batch-cell {
  word-break: break-all;
  line-height: 1.45;
  color: var(--rp-text);
  font-weight: 600;
}

.user-cell {
  font-weight: 800;
  color: var(--rp-text);
  white-space: nowrap;
}

.money-cell {
  font-weight: 900;
  color: var(--rp-accent);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.reason-cell {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rp-text-3);
}

.reviewer-cell {
  white-space: nowrap;
}

.time-cell {
  white-space: nowrap;
  color: var(--rp-text-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  border: 1px solid transparent;
}

.action-cell {
  width: 220px;
  padding-right: 18px !important;
}

.action-btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.action-placeholder {
  color: #d0d7e2;
  font-size: 13px;
}

.tbl-act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  min-width: 64px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 700;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}

.tbl-act-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.tbl-act-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.tbl-act-btn.approve {
  background: linear-gradient(135deg, #42c978, #38b2ac);
  color: #fff;
  box-shadow: 0 3px 10px rgba(66, 201, 120, 0.22);
}

.tbl-act-btn.reject {
  background: #fff1f0;
  color: #ef4444;
  border: 1px solid #ffccc7;
}

.tbl-act-btn.full-refund {
  background: linear-gradient(135deg, #f5a623, #f09d3d);
  color: #fff;
  min-width: 84px;
  box-shadow: 0 3px 10px rgba(245, 166, 35, 0.22);
}

/* ========== 抽屉 / 弹窗按钮（复用） ========== */
.act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 700;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 200ms ease, transform 200ms ease;
}

.act-btn:hover:not(:disabled) { transform: translateY(-1px); opacity: 0.92; }
.act-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.act-btn.approve { background: linear-gradient(135deg, #42c978, #38b2ac); color: #fff; }
.act-btn.reject { background: #fff1f0; color: #ef4444; border: 1px solid #ffccc7; }
.act-btn.full-refund { background: linear-gradient(135deg, #f5a623, #f09d3d); color: #fff; }


.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 56px 24px;
  color: var(--rp-text-3);
  font-size: 14px;
  font-weight: 600;
  background: #fff;
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

.pagination-wrap {
  display: flex;
  justify-content: center;
  padding: 18px 22px 22px;
  background: #fff;
  border-top: 1px solid #f0f2f7;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 6px;
}

.page-btn {
  min-width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #e4ebf5;
  border-radius: 10px;
  background: #fff;
  color: var(--rp-text-2);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 180ms ease;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--rp-purple);
  color: var(--rp-primary);
}

.page-btn.active {
  background: var(--goosd-primary);
  color: #fff;
  border-color: transparent;
  box-shadow: var(--goosd-btn-shadow);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-dots {
  min-width: 36px;
  text-align: center;
  color: var(--rp-text-3);
  font-size: 13px;
}

.custom-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.custom-modal {
  background: #fff;
  border-radius: 16px;
  padding: 28px 28px 22px;
  min-width: 340px;
  max-width: 420px;
  box-shadow: var(--rp-shadow-lg);
}

.custom-modal-body {
  font-size: 15px;
  color: var(--rp-text);
  line-height: 1.65;
  margin-bottom: 24px;
  text-align: center;
}

.custom-modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.cm-btn {
  min-height: 40px;
  padding: 0 32px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all 200ms ease;
}

.cm-btn.cancel {
  background: #f6f8fc;
  color: var(--rp-text-3);
  border: 1px solid #e4ebf5;
}

.cm-btn.cancel:hover { background: #eef2f7; }

.cm-btn.ok {
  background: var(--goosd-primary);
  color: #fff;
  box-shadow: var(--goosd-btn-shadow);
}

.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }

.custom-toast {
  position: fixed;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--rp-text);
  color: #fff;
  padding: 12px 28px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  z-index: 10000;
  box-shadow: var(--rp-shadow-lg);
}

.toast-slide-enter-active,
.toast-slide-leave-active { transition: all 0.3s; }
.toast-slide-enter-from,
.toast-slide-leave-to { opacity: 0; transform: translate(-50%, -20px); }

.data-row { cursor: pointer; }

.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 9990;
  display: flex;
  justify-content: flex-end;
  backdrop-filter: blur(2px);
}

.order-drawer {
  width: 520px;
  max-width: 92vw;
  height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 40px rgba(15, 23, 42, 0.12);
}

.drawer-header {
  padding: 22px 24px 18px;
  border-bottom: 1px solid #f0f2f7;
  background: linear-gradient(180deg, #f8faff, #fff);
}

.drawer-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}

.drawer-title-row h3 {
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-text);
  white-space: nowrap;
}

.drawer-title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.done-hint-tag {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.drawer-close {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: none;
  background: #f6f8fc;
  cursor: pointer;
  color: var(--rp-text-3);
  transition: background 180ms ease, color 180ms ease;
}

.drawer-close:hover {
  background: #fff1f0;
  color: #ef4444;
}

.drawer-handle {
  display: none;
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
  grid-column: span 2;
}

.drawer-stat--accent {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border-color: #ffe4ec;
}

.drawer-stat-label {
  font-size: 10px;
  font-weight: 800;
  color: var(--rp-text-3);
  text-transform: uppercase;
  letter-spacing: 0.35px;
}

.drawer-stat-val {
  font-size: 13px;
  font-weight: 800;
  color: var(--rp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-stat-val.mono {
  font-size: 12px;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
  font-weight: 600;
  color: var(--rp-text-2);
}

.drawer-stat-amount {
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-accent);
  font-variant-numeric: tabular-nums;
}

.drawer-stat-pill {
  align-self: flex-start;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.drawer-full-refund-btn {
  width: 100%;
  min-height: 42px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(135deg, #f5a623, #f09d3d);
  box-shadow: 0 6px 18px rgba(245, 166, 35, 0.28);
  transition: transform 200ms ease, box-shadow 200ms ease, opacity 200ms ease;
}

.drawer-full-refund-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(245, 166, 35, 0.35);
}

.drawer-full-refund-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
  background: #f8faff;
}

.drawer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 0;
  color: var(--rp-text-3);
}

.drawer-empty {
  text-align: center;
  padding: 48px 0;
  color: var(--rp-text-3);
}

.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid #e8edf4;
  border-top-color: var(--rp-primary);
  border-radius: 50%;
  animation: rp-spin 0.7s linear infinite;
}

.od-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #fff;
  border: 1px solid #edf1f7;
  border-radius: 16px;
  padding: 14px 14px 16px;
  margin-bottom: 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.od-card:hover {
  border-color: #dfe7f3;
  box-shadow: 0 6px 20px rgba(47, 109, 246, 0.08);
}

.od-card-target {
  border-color: #c9b8f5;
  background: linear-gradient(135deg, #faf8ff 0%, #fff 60%);
  box-shadow: 0 0 0 1px rgba(139, 123, 247, 0.12);
}

.od-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.od-card-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.od-avatar-wrap {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid #fff;
  box-shadow: 0 4px 14px rgba(21, 32, 51, 0.1);
  background: linear-gradient(135deg, #f3f0ff, #eef3ff);
  position: relative;
}

.od-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.od-avatar-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-purple);
  background: linear-gradient(135deg, #f3f0ff, #e8f0ff);
}

.od-note-block {
  flex: 1;
  min-width: 0;
}

.od-idx {
  font-size: 12px;
  font-weight: 800;
  color: var(--rp-primary);
  background: #eef3ff;
  padding: 4px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.od-order-no {
  margin: -4px 0 0;
  padding: 0 2px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--rp-text-3);
  word-break: break-all;
}

.od-status-pill {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
  white-space: nowrap;
}

.od-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.od-title-muted {
  color: var(--rp-text-3);
  font-weight: 600;
}

.od-author {
  margin-top: 3px;
  font-size: 12px;
  color: var(--rp-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.od-url {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 12px;
  color: var(--rp-primary);
  text-decoration: none;
  transition: background 180ms ease, border-color 180ms ease;
}

.od-url span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.od-url:hover {
  background: #eef3ff;
  border-color: #c9d6ef;
}

.od-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.od-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 8px;
  border-radius: 11px;
  background: #f8faff;
  border: 1px solid #eef2f7;
  text-align: center;
}

.od-metric-label {
  font-size: 11px;
  color: var(--rp-text-3);
  font-weight: 600;
}

.od-metric strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text);
  font-variant-numeric: tabular-nums;
}

.od-metric-tag {
  display: inline-flex;
  align-self: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef3ff;
  color: var(--rp-primary);
  font-size: 12px;
}

.od-metric-accent {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border-color: #ffe4ec;
}

.od-metric-accent strong {
  color: var(--rp-accent);
}

.ok-num {
  color: #42c978 !important;
}

.od-progress {
  padding: 12px 12px 2px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.od-progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--rp-text-3);
  font-weight: 600;
}

.od-progress-top strong {
  font-size: 12px;
  font-weight: 900;
}

.od-progress-bar {
  height: 6px;
  background: #eef2f7;
  border-radius: 999px;
  overflow: hidden;
}

.od-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.od-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

.od-act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 200ms ease;
}

.od-act-btn:hover { opacity: 0.88; }
.od-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.od-act-btn.approve { background: linear-gradient(135deg, #42c978, #38b2ac); color: #fff; }
.od-act-btn.full-refund { background: linear-gradient(135deg, #f5a623, #f09d3d); color: #fff; }
.od-act-btn.reject { background: #fff1f0; color: #ef4444; border: 1px solid #ffccc7; }

.drawer-order-count {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--rp-text-2);
  margin-bottom: 14px;
  font-weight: 800;
}

.drawer-order-count-badge {
  display: inline-grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--rp-purple), var(--rp-primary));
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.drawer-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 0 4px;
}

.drawer-page-info {
  font-size: 13px;
  color: var(--rp-text-3);
  font-weight: 700;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active { transition: opacity 0.25s; }
.drawer-fade-enter-from,
.drawer-fade-leave-to { opacity: 0; }

.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.drawer-slide-enter-from,
.drawer-slide-leave-to { transform: translateX(100%); }

@media (max-width: 768px) {
  .refund-page { padding: 12px 12px 32px; }

  .hero-content {
    flex-direction: column;
    align-items: stretch;
    padding: 18px 16px;
  }

  .hero-title { font-size: 19px; }

  .approve-all-btn { width: 100%; justify-content: center; }

  .panel-toolbar {
    flex-direction: column;
    align-items: stretch;
    padding: 14px 16px;
  }

  .filter-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .filter-btn {
    flex: 1;
    padding: 0 10px;
    font-size: 12px;
  }

  .refund-table { min-width: 860px; }

  .refund-table th,
  .refund-table td {
    padding: 12px 10px;
    font-size: 12px;
  }

  .col-action { width: 200px; }

  /* ========== 抽屉：手机底部 sheet ========== */
  .drawer-mask {
    align-items: flex-end;
    justify-content: center;
    background: rgba(15, 23, 42, 0.52);
    backdrop-filter: blur(6px);
  }

  .order-drawer {
    width: 100%;
    max-width: 100%;
    height: min(92dvh, 92vh);
    max-height: 92dvh;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -12px 48px rgba(15, 23, 42, 0.18);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .drawer-handle {
    display: block;
    flex-shrink: 0;
    width: 40px;
    height: 4px;
    margin: 10px auto 0;
    border-radius: 999px;
    background: #d8dee9;
  }

  .drawer-header {
    padding: 12px 16px 14px;
    flex-shrink: 0;
  }

  .drawer-title-row {
    margin-bottom: 12px;
  }

  .drawer-title-row h3 {
    font-size: 17px;
  }

  .drawer-title-actions {
    gap: 6px;
  }

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

  .drawer-full-refund-btn {
    min-height: 44px;
    border-radius: 12px;
    font-size: 15px;
  }

  .drawer-body {
    padding: 12px 14px calc(20px + env(safe-area-inset-bottom, 0));
    -webkit-overflow-scrolling: touch;
  }

  .drawer-slide-enter-from,
  .drawer-slide-leave-to {
    transform: translateY(100%);
  }

  /* ========== 订单卡片 ========== */
  .od-card {
    gap: 10px;
    padding: 14px;
    margin-bottom: 12px;
  }

  .od-avatar-wrap {
    width: 52px;
    height: 52px;
  }

  .od-title {
    font-size: 15px;
    line-height: 1.45;
  }

  .od-author {
    font-size: 12.5px;
    margin-top: 4px;
  }

  .od-url {
    padding: 10px 12px;
    font-size: 12.5px;
  }

  .od-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .od-metric-accent {
    grid-column: 1 / -1;
  }

  .od-status-pill {
    padding: 5px 11px;
    font-size: 11.5px;
  }

  .od-act-btn {
    min-height: 32px;
    padding: 6px 14px;
    font-size: 12px;
  }

  .od-metric-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .od-metric strong {
    font-size: 15px;
  }

  .od-progress {
    padding-top: 12px;
  }

  .od-progress-top {
    margin-bottom: 8px;
    font-size: 12px;
  }

  .od-progress-top strong {
    font-size: 13px;
  }

  .od-progress-bar {
    height: 8px;
    background: #e8edf4;
  }

  .drawer-pager {
    position: sticky;
    bottom: 0;
    padding: 12px 0 4px;
    margin: 0 -2px;
    background: linear-gradient(180deg, transparent, #f8faff 24%);
  }

  .drawer-pager .page-btn {
    min-width: 44px;
    min-height: 44px;
    border-radius: 12px;
  }
}

@media (max-width: 380px) {
  .od-metrics {
    grid-template-columns: 1fr 1fr;
  }

  .od-metric-accent {
    grid-column: 1 / -1;
  }
}
</style>
