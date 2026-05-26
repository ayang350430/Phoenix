<script setup>
import { inject, onMounted, ref, computed } from 'vue'

const ws = inject('workspace')
const { getToken } = ws

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
    if (data.code === 0) { fetchList(); closeDrawer() }
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

onMounted(fetchList)
</script>

<template>
  <div class="refund-page">
    <div class="page-header">
      <div class="header-left">
        <h2>退款申请</h2>
        <span class="total-badge">共 {{ total }} 条</span>
        <button
          v-if="pendingCount > 0"
          class="approve-all-btn"
          :disabled="approvingAll"
          @click="handleApproveAll"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {{ approvingAll ? '处理中...' : `一键同意所有 (${pendingCount})` }}
        </button>
      </div>
      <div class="filter-tabs">
        <button
          class="filter-btn"
          :class="{ active: filterStatus === '' }"
          @click="changeFilter('')"
        >全部</button>
        <button
          class="filter-btn pending"
          :class="{ active: filterStatus === 'pending' }"
          @click="changeFilter('pending')"
        >待审批</button>
        <button
          class="filter-btn approved"
          :class="{ active: filterStatus === 'approved' }"
          @click="changeFilter('approved')"
        >已通过</button>
        <button
          class="filter-btn rejected"
          :class="{ active: filterStatus === 'rejected' }"
          @click="changeFilter('rejected')"
        >已驳回</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="refund-table">
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
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in list" :key="item.id" class="clickable-row" @click="openDetail(item)">
            <td class="user-cell">{{ displayName(item) }}</td>
            <td class="mono">{{ item.batch_no || '-' }}</td>
            <td class="money-cell">¥{{ fmtMoney(item.refund_amount) }}</td>
            <td class="reason-cell">{{ item.reason || '-' }}</td>
            <td>
              <span class="status-pill" :style="{ color: sc(item.status).color, background: sc(item.status).bg }">
                {{ sc(item.status).label }}
              </span>
            </td>
            <td class="time-cell">{{ fmtTime(item.created_at) }}</td>
            <td>{{ item.reviewer_name || '-' }}</td>
            <td class="reason-cell">{{ item.review_remark || '-' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-if="!loading && list.length === 0" class="empty-state">暂无退款申请</div>
    </div>

    <div v-if="total > pageSize" class="pagination">
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

    <!-- 订单详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showDrawer" class="drawer-mask" @click.self="closeDrawer">
        <Transition name="drawer-slide">
          <div v-if="showDrawer" class="order-drawer">
            <div class="drawer-header">
              <div class="drawer-title-row">
                <h3>批次订单明细</h3>
                <div class="drawer-title-actions">
                  <template v-if="drawerItem?.status === 'pending' && !drawerItem?.order_id">
                    <button class="act-btn approve" :disabled="processing === drawerItem.id" @click="handleApprove(drawerItem)">通过</button>
                    <button class="act-btn reject" :disabled="processing === drawerItem.id" @click="handleReject(drawerItem)">驳回</button>
                  </template>
                  <span v-else-if="drawerItem" class="done-hint-tag" :style="{ color: sc(drawerItem.status).color, background: sc(drawerItem.status).bg }">{{ sc(drawerItem.status).label }}</span>
                  <button class="drawer-close" @click="closeDrawer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div v-if="drawerItem" class="drawer-info">
                <div class="di-row"><span class="di-label">申请人</span><span>{{ displayName(drawerItem) }}</span></div>
                <div class="di-row"><span class="di-label">批次号</span><span class="mono">{{ drawerItem.batch_no }}</span></div>
                <div class="di-row"><span class="di-label">预估退款</span><span class="di-amount">¥{{ fmtMoney(drawerItem.refund_amount) }}</span></div>
                <div class="di-row">
                  <span class="di-label">状态</span>
                  <span class="status-pill" :style="{ color: sc(drawerItem.status).color, background: sc(drawerItem.status).bg }">{{ sc(drawerItem.status).label }}</span>
                  <button v-if="drawerItem.status === 'pending'" class="act-btn full-refund di-full-refund" :disabled="processing === drawerItem.id" @click="handleFullRefund(drawerItem)">全额退款</button>
                </div>
              </div>
            </div>
            <div class="drawer-body">
              <div v-if="drawerLoading" class="drawer-loading">
                <div class="spinner"></div><span>加载中...</span>
              </div>
              <template v-else-if="drawerOrders.length">
                <div class="drawer-order-count">共 {{ drawerOrders.length }} 条订单</div>
                <div v-for="(order, idx) in pagedDrawerOrders" :key="order.id" class="od-card" :class="{ 'od-card-target': drawerItem?.order_id === order.id }">
                  <div class="od-head">
                    <span class="od-idx">#{{ (drawerPage - 1) * drawerPageSize + idx + 1 }}</span>
                    <span class="od-no mono">{{ order.order_no }}</span>
                    <div v-if="drawerItem?.order_id === order.id && drawerItem?.status === 'pending'" class="od-actions">
                      <button class="od-act-btn approve" :disabled="processing === drawerItem.id" @click.stop="handleApprove(drawerItem)">通过</button>
                      <button class="od-act-btn reject" :disabled="processing === drawerItem.id" @click.stop="handleReject(drawerItem)">驳回</button>
                    </div>
                    <span v-else class="od-status" :style="{ color: osc(order.order_status).color }">{{ osc(order.order_status).label }}</span>
                  </div>
                  <div class="od-url">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    <a :href="order.note_url" target="_blank" rel="noopener" @click.stop>{{ order.note_url }}</a>
                  </div>
                  <div class="od-details">
                    <div class="od-detail"><span>类型</span><strong>{{ pn(order) }}</strong></div>
                    <div class="od-detail"><span>下单数</span><strong>{{ order.ordered_quantity }}</strong></div>
                    <div class="od-detail"><span>完成数</span><strong class="ok-num">{{ order.completed_quantity || 0 }}</strong></div>
                    <div class="od-detail"><span>付款</span><strong>¥{{ fmtMoney(order.actual_paid_amount || 0) }}</strong></div>
                  </div>
                  <div class="od-progress">
                    <div class="od-progress-bar">
                      <div class="od-progress-fill" :style="{ width: orderProgress(order) + '%', background: osc(order.order_status).color }"></div>
                    </div>
                    <span :style="{ color: osc(order.order_status).color }">{{ orderProgress(order) }}%</span>
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
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h2 {
  font-size: 20px;
  font-weight: 800;
  color: #152033;
  margin: 0;
}

.total-badge {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 3px 10px;
  border-radius: 20px;
  font-weight: 500;
}

.filter-tabs {
  display: flex;
  gap: 6px;
}

.filter-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  transition: all .2s;
}
.filter-btn:hover { border-color: #a78bfa; color: #7c3aed; }
.filter-btn.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.filter-btn.pending.active { background: #f59e0b; border-color: #f59e0b; }
.filter-btn.approved.active { background: #10b981; border-color: #10b981; }
.filter-btn.rejected.active { background: #ef4444; border-color: #ef4444; }

.table-wrap {
  background: #fff;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  overflow-x: auto;
}

.refund-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.refund-table th {
  text-align: left;
  padding: 14px 16px;
  font-weight: 700;
  color: #6b7280;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .03em;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap;
}

.refund-table td {
  padding: 14px 16px;
  color: #374151;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}

.refund-table tbody tr:hover { background: #f8f7ff; }

.mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 12px; }

.user-cell { font-weight: 600; color: #152033; white-space: nowrap; }

.money-cell {
  font-weight: 700;
  color: #7c3aed;
  white-space: nowrap;
}

.reason-cell {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-cell { white-space: nowrap; color: #9ca3af; font-size: 12px; }

.status-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.action-cell { white-space: nowrap; }

.act-btn {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity .2s;
  margin-right: 6px;
}
.act-btn:hover { opacity: .85; }
.act-btn:disabled { opacity: .5; cursor: not-allowed; }

.act-btn.approve {
  background: linear-gradient(135deg, #10b981, #34d399);
  color: #fff;
}

.act-btn.reject {
  background: #fee2e2;
  color: #ef4444;
}

.done-hint {
  font-size: 12px;
  color: #9ca3af;
}

.empty-state {
  text-align: center;
  padding: 48px 0;
  color: #9ca3af;
  font-size: 14px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 20px;
}

.page-btn {
  min-width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
}
.page-btn:hover:not(:disabled) { border-color: #a78bfa; color: #7c3aed; }
.page-btn.active { background: #7c3aed; color: #fff; border-color: #7c3aed; }
.page-btn:disabled { opacity: .4; cursor: not-allowed; }

.page-dots {
  min-width: 34px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

.approve-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #10b981, #34d399);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity .2s;
  white-space: nowrap;
}
.approve-all-btn:hover { opacity: .85; }
.approve-all-btn:disabled { opacity: .5; cursor: not-allowed; }

.act-btn.full-refund {
  background: linear-gradient(135deg, #f59e0b, #fbbf24);
  color: #fff;
}
.di-full-refund {
  margin-left: 12px;
  padding: 3px 14px !important;
  font-size: 11px !important;
  border-radius: 6px !important;
}

.custom-modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  z-index: 9999; display: flex; align-items: center; justify-content: center;
}
.custom-modal {
  background: #fff; border-radius: 16px; padding: 28px 28px 20px;
  min-width: 340px; max-width: 420px; box-shadow: 0 20px 60px rgba(0,0,0,.18);
}
.custom-modal-body {
  font-size: 15px; color: #1f2937; line-height: 1.6; margin-bottom: 24px; text-align: center;
}
.custom-modal-actions { display: flex; gap: 12px; justify-content: center; }
.cm-btn {
  padding: 9px 32px; font-size: 14px; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: all .2s;
}
.cm-btn.cancel { background: #f3f4f6; color: #6b7280; }
.cm-btn.cancel:hover { background: #e5e7eb; }
.cm-btn.ok { background: linear-gradient(135deg, #7c3aed, #6366f1); color: #fff; }
.cm-btn.ok:hover { opacity: .9; }
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity .2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

.custom-toast {
  position: fixed; top: 28px; left: 50%; transform: translateX(-50%);
  background: #1f2937; color: #fff; padding: 12px 28px; border-radius: 12px;
  font-size: 14px; font-weight: 500; z-index: 10000; box-shadow: 0 8px 30px rgba(0,0,0,.18);
}
.toast-slide-enter-active, .toast-slide-leave-active { transition: all .3s; }
.toast-slide-enter-from { opacity: 0; transform: translate(-50%, -20px); }
.toast-slide-leave-to { opacity: 0; transform: translate(-50%, -20px); }

.clickable-row { cursor: pointer; }

.drawer-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 9990;
  display: flex; justify-content: flex-end;
}
.order-drawer {
  width: 520px; max-width: 92vw; height: 100vh; background: #fff;
  display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0,0,0,.12);
}
.drawer-header { padding: 24px 24px 16px; border-bottom: 1px solid #f0f2f5; }
.drawer-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.drawer-title-row h3 { font-size: 17px; font-weight: 800; color: #152033; white-space: nowrap; }
.drawer-title-actions { display: flex; align-items: center; gap: 8px; }
.done-hint-tag { padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.drawer-close {
  width: 32px; height: 32px; display: grid; place-items: center;
  border-radius: 8px; border: none; background: #f3f4f6; cursor: pointer; color: #6b7280;
}
.drawer-close:hover { background: #e5e7eb; }
.drawer-info { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.di-row { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #6b7280; }
.di-label { font-weight: 600; color: #374151; }
.di-amount { font-weight: 700; color: #7c3aed; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px 24px; }
.drawer-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px 0; color: #9ca3af; }
.drawer-empty { text-align: center; padding: 48px 0; color: #9ca3af; }

.spinner {
  width: 20px; height: 20px; border: 2.5px solid #e5e7eb; border-top-color: #7c3aed;
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.od-card {
  background: #fafbfc; border: 1px solid #f0f2f5; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 10px;
}
.od-card:hover { border-color: #e0dbf8; }
.od-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.od-idx { font-size: 12px; font-weight: 800; color: #8b7bf7; background: #f3f0ff; padding: 1px 7px; border-radius: 4px; }
.od-no { font-size: 12px; color: #647184; }
.od-status { margin-left: auto; font-size: 12px; font-weight: 700; }
.od-url { display: flex; align-items: center; gap: 5px; font-size: 12px; margin-bottom: 8px; }
.od-url a { color: #5b8def; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.od-url a:hover { text-decoration: underline; }
.od-details { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.od-detail { font-size: 12px; color: #6b7280; }
.od-detail span { display: block; font-size: 11px; color: #9ca3af; }
.od-detail strong { font-size: 13px; color: #374151; }
.ok-num { color: #10b981 !important; }
.od-progress { display: flex; align-items: center; gap: 8px; }
.od-progress-bar { flex: 1; height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden; }
.od-progress-fill { height: 100%; border-radius: 2px; transition: width .3s; }
.od-progress span { font-size: 11px; font-weight: 700; min-width: 32px; text-align: right; }

.od-card-target { border-color: #d4c8f8; background: #faf8ff; }
.od-actions { display: flex; gap: 5px; margin-left: auto; }
.od-act-btn {
  padding: 3px 10px; font-size: 11px; font-weight: 600;
  border: none; border-radius: 5px; cursor: pointer; transition: opacity .2s; white-space: nowrap;
}
.od-act-btn:hover { opacity: .85; }
.od-act-btn:disabled { opacity: .5; cursor: not-allowed; }
.od-act-btn.approve { background: linear-gradient(135deg, #10b981, #34d399); color: #fff; }
.od-act-btn.full-refund { background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #fff; }
.od-act-btn.reject { background: #fee2e2; color: #ef4444; }

.drawer-order-count { font-size: 12px; color: #9ca3af; margin-bottom: 10px; font-weight: 500; }

.drawer-pager {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 14px 0 4px;
}
.drawer-page-info { font-size: 13px; color: #6b7280; font-weight: 500; }

.drawer-fade-enter-active, .drawer-fade-leave-active { transition: opacity .25s; }
.drawer-fade-enter-from, .drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: transform .3s cubic-bezier(.22,1,.36,1); }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform: translateX(100%); }

@media (max-width: 768px) {
  .refund-page { padding: 16px 12px; }
  .page-header { flex-direction: column; align-items: flex-start; }
  .refund-table th, .refund-table td { padding: 10px 10px; font-size: 12px; }
}
</style>
