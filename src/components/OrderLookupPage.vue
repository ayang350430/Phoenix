<script setup>
import { ref, inject } from 'vue'

const { getToken, isAdmin } = inject('workspace')

const lookupInput = ref('')
const lookupResults = ref([])
const lookupNotFoundIds = ref([])
const lookupNotFoundUrls = ref([])
const lookupLoading = ref(false)
const lookupDone = ref(false)
const lookupQueryKinds = ref({ urls: false, ids: false, batchNos: false })
const avatarLoadFailed = ref({})
const toastMsg = ref('')
let toastTimer = null

const typeLabels = { read: '阅读', like: '点赞', impression: '曝光', collect: '收藏', comment: '评论' }
function ft(t) { return typeLabels[t] || t || '其他' }

const orderStatusConf = {
  pending:           { label: '待处理', color: '#9aa5b5' },
  running:           { label: '进行中', color: '#5b8def' },
  processing:        { label: '处理中', color: '#5b8def' },
  completed:         { label: '已完成', color: '#42c978' },
  failed:            { label: '失败',   color: '#ff4d4f' },
  refunding:         { label: '退款中', color: '#f5a623' },
  refund_requested:  { label: '退款中', color: '#f5a623' },
  refunded:          { label: '已退款', color: '#e8a735' },
  stopped:           { label: '已停止', color: '#9aa5b5' },
  cancelled:         { label: '已取消', color: '#9aa5b5' }
}
function osc(s) { return orderStatusConf[s] || { label: s || '未知', color: '#9aa5b5' } }

const extStatusLabels = {
  accepted: '已接受',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}
function extLabel(s) { return extStatusLabels[s] || s || '-' }

function fmtTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 3000)
}

function progressColor(p) {
  if (p >= 100) return '#42c978'
  if (p >= 50) return '#5b8def'
  return '#f5a623'
}

async function doLookup() {
  const raw = lookupInput.value.trim()
  if (!raw) return

  const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) { showToast('请输入有效内容'); return }
  if (parts.length > 200) { showToast('最多查询 200 条'); return }

  // 自动识别：链接 vs 订单ID vs 批次号/订单号
  const urls = []
  const ids = []
  const batchNos = []
  for (const p of parts) {
    if (p.startsWith('http://') || p.startsWith('https://')) {
      urls.push(p)
    } else if (/^[0-9]+$/.test(p)) {
      const n = parseInt(p)
      if (n > 0) ids.push(n)
    } else if (p.includes('-')) {
      // 包含横杠的当作批次号或订单号
      batchNos.push(p)
    }
  }

  if (ids.length === 0 && urls.length === 0 && batchNos.length === 0) { showToast('请输入有效的订单ID、链接或批次号'); return }

  lookupQueryKinds.value = {
    urls: urls.length > 0,
    ids: ids.length > 0,
    batchNos: batchNos.length > 0
  }

  lookupLoading.value = true
  lookupDone.value = false
  lookupResults.value = []
  lookupNotFoundIds.value = []
  lookupNotFoundUrls.value = []
  avatarLoadFailed.value = {}
  try {
    const body = {}
    if (ids.length > 0) body.ids = ids
    if (urls.length > 0) body.urls = urls
    if (batchNos.length > 0) body.batch_nos = batchNos

    const res = await fetch('/api/batch/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.code === 0) {
      lookupResults.value = data.data.orders || []
      lookupNotFoundIds.value = data.data.not_found_ids || []
      lookupNotFoundUrls.value = data.data.not_found_urls || []
      lookupDone.value = true
    } else {
      showToast(data.message || '查询失败')
    }
  } catch { showToast('网络错误') }
  finally { lookupLoading.value = false }
}

function clearLookup() {
  lookupInput.value = ''
  lookupResults.value = []
  lookupNotFoundIds.value = []
  lookupNotFoundUrls.value = []
  lookupDone.value = false
  lookupQueryKinds.value = { urls: false, ids: false, batchNos: false }
  avatarLoadFailed.value = {}
}

function orderAvatarUrl(order) {
  return order?.avatar_url || order?.avatar || ''
}

function orderAvatarInitial(order) {
  const name = (order?.author_name || order?.title || '笔').trim()
  return (name[0] || '笔').toUpperCase()
}

function orderNoteTitle(order) {
  return order?.title || ''
}

function orderAuthorName(order) {
  return order?.author_name || ''
}

function showOrderAvatarFallback(order) {
  if (!order?.id) return true
  return !orderAvatarUrl(order) || !!avatarLoadFailed.value[order.id]
}

function onOrderAvatarError(orderId) {
  if (!orderId) return
  avatarLoadFailed.value = { ...avatarLoadFailed.value, [orderId]: true }
}

/** 仅按链接查询时不展示订单号；按批次号查询时展示批次号 */
function showOrderNo() {
  const k = lookupQueryKinds.value
  if (k.urls && !k.ids && !k.batchNos) return false
  return true
}

function showBatchNo(order) {
  const k = lookupQueryKinds.value
  return !!(k.batchNos && order.batch_no)
}

/** 查询结果仅展示「已退款」状态 */
function lookupStatusDisplay(order) {
  if (order?.order_status !== 'refunded') return null
  return osc('refunded')
}

function showLookupCardTop(order) {
  return !!(
    lookupStatusDisplay(order) ||
    showBatchNo(order) ||
    showOrderNo() ||
    lookupQueryKinds.value.ids
  )
}

function pn(order) {
  return order.product_name ? order.product_name.replace(/^小红书/, '') : ft(order.target_type)
}

function exportCSV() {
  if (!lookupResults.value.length) return
  const header = ['订单ID','订单号','链接','类型','下单量','完成量','进度','订单状态','上游任务ID','上游状态','上游完成量','最后同步']
  const rows = lookupResults.value.map(o => [
    o.id,
    o.order_no,
    o.note_url || '-',
    o.product_name ? o.product_name.replace(/^小红书/, '') : ft(o.target_type),
    o.ordered_quantity,
    o.completed_quantity,
    o.progress + '%',
    lookupStatusDisplay(o)?.label || '-',
    o.external_task_id || '-',
    o.external_task_id ? extLabel(o.external_status) : '-',
    o.external_task_id ? (o.external_completed_quantity ?? '') : '-',
    o.external_last_synced_at ? fmtTime(o.external_last_synced_at) : '-'
  ])
  const BOM = '﻿'
  const csv = BOM + [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `订单查询_${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToast('导出成功')
}
</script>

<template>
  <div class="lookup-page">
    <div class="lookup-header">
      <div class="lookup-header-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <div>
        <h2>查询订单</h2>
        <p>输入订单ID、笔记链接或批次号，批量查询订单状态和进度</p>
      </div>
    </div>

    <section class="lookup-card">
      <div class="lookup-input-area">
        <label class="lookup-label">输入订单ID、笔记链接或批次号（每行一个，或用逗号分隔）</label>
        <textarea
          v-model="lookupInput"
          class="lookup-textarea"
          rows="5"
          placeholder="支持订单ID、笔记链接、批次号混合输入，示例：&#10;http://xhslink.com/o/xxxxx&#10;101&#10;BATCH-XXXXXXXX"
        ></textarea>
        <div class="lookup-bar">
          <span class="lookup-hint">最多查询 200 条</span>
          <div class="lookup-btns">
            <button type="button" class="lookup-btn reset" @click="clearLookup">清空</button>
            <button type="button" class="lookup-btn search" :disabled="lookupLoading" @click="doLookup">
              <svg v-if="!lookupLoading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span v-else class="spin-icon-sm"></span>
              {{ lookupLoading ? '查询中...' : '查询' }}
            </button>
          </div>
        </div>
      </div>

      <template v-if="lookupDone">
        <div v-if="lookupNotFoundIds.length" class="lookup-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          未找到的ID：{{ lookupNotFoundIds.join(', ') }}
        </div>
        <div v-if="lookupNotFoundUrls.length" class="lookup-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          未找到订单的链接：
          <span v-for="(u, i) in lookupNotFoundUrls" :key="i" class="nf-url">{{ u }}</span>
        </div>

        <div v-if="lookupResults.length === 0" class="empty-state">没有查到匹配的订单</div>

        <div v-else>
          <div class="result-toolbar">
            <span class="result-count">共查到 <strong>{{ lookupResults.length }}</strong> 条订单</span>
            <button type="button" class="export-btn" @click="exportCSV">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              导出 CSV
            </button>
          </div>

          <!-- 订单卡片列表 -->
          <div class="order-cards">
            <div v-for="o in lookupResults" :key="o.id" class="order-card">
              <div v-if="showLookupCardTop(o)" class="oc-card-top">
                <span
                  v-if="lookupStatusDisplay(o)"
                  class="status-pill"
                  :style="{
                    color: lookupStatusDisplay(o).color,
                    background: lookupStatusDisplay(o).color + '14',
                    borderColor: lookupStatusDisplay(o).color + '40'
                  }"
                >{{ lookupStatusDisplay(o).label }}</span>
                <span v-if="showBatchNo(o)" class="oc-batch-no">{{ o.batch_no }}</span>
                <span v-else-if="showOrderNo()" class="oc-order-no">{{ o.order_no }}</span>
                <span v-else-if="lookupQueryKinds.ids" class="oc-order-id">ID {{ o.id }}</span>
              </div>

              <div class="oc-card-main">
                <div class="oc-avatar-wrap">
                  <img
                    v-if="orderAvatarUrl(o) && !showOrderAvatarFallback(o)"
                    class="oc-avatar"
                    :src="orderAvatarUrl(o)"
                    :alt="orderAuthorName(o) || '笔记头像'"
                    loading="lazy"
                    @error="onOrderAvatarError(o.id)"
                  />
                  <span v-if="showOrderAvatarFallback(o)" class="oc-avatar-fallback">{{ orderAvatarInitial(o) }}</span>
                </div>
                <div class="oc-note-block">
                  <p v-if="orderNoteTitle(o)" class="oc-title">{{ orderNoteTitle(o) }}</p>
                  <p v-else class="oc-title oc-title-muted">未获取笔记标题</p>
                  <p v-if="orderAuthorName(o)" class="oc-author">{{ orderAuthorName(o) }}</p>
                </div>
              </div>

              <a v-if="o.note_url" class="oc-url" :href="o.note_url" target="_blank" rel="noopener">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span>{{ o.note_url }}</span>
              </a>

              <div class="oc-metrics">
                <div class="oc-metric">
                  <span class="oc-metric-label">类型</span>
                  <strong class="oc-metric-tag">{{ pn(o) }}</strong>
                </div>
                <div class="oc-metric">
                  <span class="oc-metric-label">下单</span>
                  <strong>{{ o.ordered_quantity }}</strong>
                </div>
                <div class="oc-metric">
                  <span class="oc-metric-label">完成</span>
                  <strong :class="{ 'ok-num': o.completed_quantity > 0 }">{{ o.completed_quantity }}</strong>
                </div>
                <div class="oc-metric oc-metric-id" v-if="!showOrderNo() && lookupQueryKinds.urls">
                  <span class="oc-metric-label">订单号</span>
                  <strong class="oc-metric-mono">{{ o.order_no }}</strong>
                </div>
              </div>

              <div class="oc-progress-wrap">
                <div class="oc-progress-top">
                  <span>完成进度</span>
                  <strong :style="{ color: progressColor(o.progress) }">{{ o.progress }}%</strong>
                </div>
                <div class="oc-progress-bar">
                  <div class="oc-progress-fill" :style="{ width: o.progress + '%', background: progressColor(o.progress) }"></div>
                </div>
              </div>

              <div v-if="isAdmin && o.external_task_id" class="oc-ext">
                <span class="oc-ext-label">上游</span>
                <span class="ext-id">{{ o.external_task_id }}</span>
                <span class="ext-status" :class="o.external_status">{{ extLabel(o.external_status) }}</span>
                <span v-if="o.external_completed_quantity != null" class="oc-ext-qty">完成 {{ o.external_completed_quantity }}</span>
                <span v-if="o.external_last_synced_at" class="oc-ext-time">{{ fmtTime(o.external_last_synced_at) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <Transition name="toast-slide">
      <div v-if="toastMsg" class="custom-toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.lookup-page { padding: 18px 28px 28px; }

.lookup-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.lookup-header-icon {
  width: 48px; height: 48px; border-radius: 50%;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  display: grid; place-items: center; flex-shrink: 0;
}
.lookup-header h2 { font-size: 20px; font-weight: 800; color: #152033; margin: 0; }
.lookup-header p { font-size: 13px; color: #9aa5b5; margin: 2px 0 0; }

.lookup-card {
  background: #fff; border-radius: 14px;
  box-shadow: 0 4px 18px rgba(21,32,51,.06);
  padding: 24px; overflow: hidden;
  border-top: 3px solid transparent;
  background-clip: padding-box;
  position: relative;
}
.lookup-card::before {
  content: '';
  position: absolute; top: -3px; left: 0; right: 0; height: 3px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  border-radius: 14px 14px 0 0;
}

.lookup-input-area {
  background: #fbfcff; border-radius: 12px; border: 1px solid #edf1f6;
  padding: 20px; box-shadow: 0 2px 8px rgba(21,32,51,.02);
}
.lookup-label { display: block; font-size: 13px; font-weight: 700; color: #425066; margin-bottom: 10px; }
.lookup-textarea {
  width: 100%; box-sizing: border-box; border: 1.5px solid #e3e8f0;
  border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #152033;
  background: #fff; resize: vertical; outline: none;
  font-family: 'SF Mono', Consolas, monospace; line-height: 1.7;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.lookup-textarea:focus { border-color: #8b7bf7; box-shadow: 0 0 0 3px rgba(139,123,247,.1); }
.lookup-bar { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.lookup-hint { font-size: 12px; color: #9aa5b5; }
.lookup-btns { display: flex; gap: 8px; }
.lookup-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 18px; border-radius: 9px; font-size: 13px; font-weight: 700;
  border: none; cursor: pointer; transition: all 160ms ease;
}
.lookup-btn.reset { background: #f4f7fb; color: #647184; }
.lookup-btn.reset:hover { background: #edf1f6; }
.lookup-btn.search {
  background: linear-gradient(135deg, #8b7bf7, #5b8def); color: #fff;
  box-shadow: 0 4px 14px rgba(139,123,247,.2);
}
.lookup-btn.search:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(139,123,247,.3); }
.lookup-btn.search:disabled { opacity: .6; pointer-events: none; }
.spin-icon-sm {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.lookup-warn {
  display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap;
  margin-top: 16px; padding: 10px 14px; border-radius: 10px;
  background: #fff7e6; color: #d48806; font-size: 13px; font-weight: 600;
}
.nf-url {
  display: block; font-size: 12px; font-weight: 400; word-break: break-all;
  color: #b8860b; margin-left: 20px;
}

.empty-state {
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px; color: #9aa5b5; font-size: 14px;
}

.result-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 18px; margin-bottom: 14px;
}
.result-count { font-size: 13px; color: #9aa5b5; }
.result-count strong { color: #425066; font-weight: 800; }
.export-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-radius: 9px; font-size: 13px; font-weight: 700;
  border: 1.5px solid #42c978; background: #f0fdf4; color: #16a34a;
  cursor: pointer; transition: all 160ms ease;
}
.export-btn:hover { background: #dcfce7; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(34,197,94,.15); }

/* ===== 卡片列表 ===== */
.order-cards { display: flex; flex-direction: column; gap: 12px; }

.order-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #fff;
  border: 1px solid #edf1f7;
  border-radius: 16px;
  padding: 14px 16px;
  box-shadow: 0 2px 12px rgba(21, 32, 51, 0.04);
  transition: box-shadow 200ms ease, border-color 200ms ease;
}

.order-card:hover {
  border-color: #dfe7f3;
  box-shadow: 0 6px 20px rgba(47, 109, 246, 0.08);
}

.oc-card-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.status-pill {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
}

.oc-batch-no,
.oc-order-no,
.oc-order-id {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  color: #8a95a8;
  word-break: break-all;
}

.oc-card-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.oc-avatar-wrap {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
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

.oc-url {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 12px;
  color: #2f6df6;
  text-decoration: none;
}

.oc-url span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.oc-url:hover {
  background: #eef3ff;
  border-color: #c9d6ef;
}

.oc-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.oc-metrics:has(.oc-metric-id) {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.oc-metric {
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

.oc-metric-label {
  font-size: 10px;
  font-weight: 700;
  color: #8a95a8;
}

.oc-metric strong {
  font-size: 14px;
  font-weight: 800;
  color: #152033;
  font-variant-numeric: tabular-nums;
}

.oc-metric-tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef3ff;
  color: #2f6df6;
  font-size: 12px;
}

.oc-metric strong.ok-num {
  color: #42c978;
}

.oc-metric-mono {
  font-size: 10px;
  font-family: 'SF Mono', Consolas, monospace;
  font-weight: 600;
  color: #425066;
  word-break: break-all;
}

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
  background: #e8edf4;
  border-radius: 999px;
  overflow: hidden;
}

.oc-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 400ms ease;
  min-width: 0;
}

/* 失败原因 */
.oc-reason {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 8px 12px; border-radius: 8px;
  background: #fff1f0; color: #ff4d4f; font-size: 12px; font-weight: 600;
  margin-bottom: 8px; line-height: 1.5;
}

/* 上游信息 */
.oc-ext {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 8px; border-top: 1px solid #edf1f6;
}
.oc-ext-label { font-size: 11px; color: #9aa5b5; font-weight: 600; }
.ext-id {
  font-size: 11px; background: #f0f4ff; color: #5b8def;
  padding: 2px 8px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace;
}
.ext-status { font-size: 12px; font-weight: 700; }
.ext-status.running { color: #5b8def; }
.ext-status.completed { color: #42c978; }
.ext-status.accepted { color: #9aa5b5; }
.ext-status.failed { color: #ff4d4f; }
.ext-status.cancelled { color: #9aa5b5; }
.oc-ext-qty { font-size: 12px; color: #425066; font-weight: 700; }
.oc-ext-time { font-size: 11px; color: #c8cfd8; }

.custom-toast {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  padding: 10px 28px; border-radius: 10px; background: rgba(0,0,0,.72);
  color: #fff; font-size: 14px; font-weight: 600; z-index: 10000;
  pointer-events: none; backdrop-filter: blur(6px);
}
.toast-slide-enter-active, .toast-slide-leave-active { transition: all .3s; }
.toast-slide-enter-from { opacity: 0; transform: translate(-50%, -20px); }
.toast-slide-leave-to { opacity: 0; transform: translate(-50%, -20px); }

@media (max-width: 760px) {
  .lookup-page { padding: 12px 12px 24px; }
  .lookup-header { gap: 12px; }
  .lookup-header-icon { width: 40px; height: 40px; }
  .lookup-header-icon svg { width: 20px; height: 20px; }
  .lookup-header h2 { font-size: 17px; }
  .lookup-card { padding: 16px; }
  .lookup-input-area { padding: 14px; }
  .lookup-bar { flex-direction: column; align-items: flex-end; gap: 8px; }
  .oc-metrics,
  .oc-metrics:has(.oc-metric-id) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .oc-metric-id {
    grid-column: 1 / -1;
  }
  .oc-ext { font-size: 11px; }
}
</style>
