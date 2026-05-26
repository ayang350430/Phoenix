<script setup>
import { ref, inject } from 'vue'

const { getToken, isAdmin } = inject('workspace')

const lookupInput = ref('')
const lookupResults = ref([])
const lookupNotFound = ref([])
const lookupLoading = ref(false)
const lookupDone = ref(false)
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

async function doLookup() {
  const raw = lookupInput.value.trim()
  if (!raw) return
  const ids = raw.split(/[\n,\s]+/).map(s => parseInt(s.trim())).filter(n => n > 0)
  if (ids.length === 0) { showToast('请输入有效的订单ID'); return }
  if (ids.length > 200) { showToast('最多查询 200 条'); return }
  lookupLoading.value = true
  lookupDone.value = false
  lookupResults.value = []
  lookupNotFound.value = []
  try {
    const res = await fetch('/api/batch/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ids })
    })
    const data = await res.json()
    if (data.code === 0) {
      lookupResults.value = data.data.orders || []
      lookupNotFound.value = data.data.not_found || []
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
  lookupNotFound.value = []
  lookupDone.value = false
}

function exportCSV() {
  if (!lookupResults.value.length) return
  const header = ['订单ID','订单号','类型','下单量','完成量','订单状态','上游','上游任务ID','上游状态','上游完成量','最后同步']
  const rows = lookupResults.value.map(o => [
    o.id,
    o.order_no,
    o.product_name ? o.product_name.replace(/^小红书/, '') : ft(o.target_type),
    o.ordered_quantity,
    o.completed_quantity,
    osc(o.order_status).label,
    o.has_upstream ? '有上游' : '没有上游',
    o.external_task_id || (o.has_upstream ? '未派单' : '-'),
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
        <p>输入订单ID批量查询订单状态和上游信息</p>
      </div>
    </div>

    <section class="lookup-card">
      <div class="lookup-input-area">
        <label class="lookup-label">输入订单ID（每行一个，或用逗号/空格分隔）</label>
        <textarea
          v-model="lookupInput"
          class="lookup-textarea"
          rows="5"
          placeholder="示例：&#10;101&#10;102&#10;103"
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
        <div v-if="lookupNotFound.length" class="lookup-warn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          未找到的ID：{{ lookupNotFound.join(', ') }}
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
          <div class="lookup-table-wrap">
          <table class="lookup-table">
            <thead>
              <tr>
                <th>订单ID</th>
                <th>订单号</th>
                <th>类型</th>
                <th>下单量</th>
                <th>完成量</th>
                <th>订单状态</th>
                <th>上游</th>
                <th>上游任务ID</th>
                <th>上游状态</th>
                <th>上游完成量</th>
                <th>最后同步</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in lookupResults" :key="o.id">
                <td class="mono">{{ o.id }}</td>
                <td class="mono">{{ o.order_no }}</td>
                <td><span class="tag type-tag">{{ o.product_name ? o.product_name.replace(/^小红书/, '') : ft(o.target_type) }}</span></td>
                <td class="center">{{ o.ordered_quantity }}</td>
                <td class="center">{{ o.completed_quantity }}</td>
                <td>
                  <span
                    class="status-pill small"
                    :style="{ color: osc(o.order_status).color, background: osc(o.order_status).color + '16', borderColor: osc(o.order_status).color }"
                  >{{ osc(o.order_status).label }}</span>
                </td>
                <td>
                  <span v-if="o.has_upstream" class="upstream-yes">有上游</span>
                  <span v-else class="upstream-no">没有上游</span>
                </td>
                <td>
                  <span v-if="o.external_task_id" class="mono ext-id">{{ o.external_task_id }}</span>
                  <span v-else-if="!o.has_upstream" class="muted">-</span>
                  <span v-else class="muted">未派单</span>
                </td>
                <td>
                  <span v-if="o.external_task_id" :class="['ext-status', o.external_status]">{{ extLabel(o.external_status) }}</span>
                  <span v-else class="muted">-</span>
                </td>
                <td class="center">
                  <template v-if="o.external_task_id">{{ o.external_completed_quantity }}</template>
                  <span v-else class="muted">-</span>
                </td>
                <td class="time-cell">{{ o.external_last_synced_at ? fmtTime(o.external_last_synced_at) : '-' }}</td>
              </tr>
            </tbody>
          </table>
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
.lookup-page {
  padding: 18px 28px 28px;
}

.lookup-header {
  display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
}
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
.lookup-label {
  display: block; font-size: 13px; font-weight: 700; color: #425066; margin-bottom: 10px;
}
.lookup-textarea {
  width: 100%; box-sizing: border-box; border: 1.5px solid #e3e8f0;
  border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #152033;
  background: #fff; resize: vertical; outline: none;
  font-family: 'SF Mono', Consolas, monospace; line-height: 1.7;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.lookup-textarea:focus { border-color: #8b7bf7; box-shadow: 0 0 0 3px rgba(139,123,247,.1); }
.lookup-bar {
  display: flex; align-items: center; justify-content: space-between; margin-top: 12px;
}
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
  display: flex; align-items: center; gap: 6px;
  margin-top: 16px; padding: 10px 14px; border-radius: 10px;
  background: #fff7e6; color: #d48806; font-size: 13px; font-weight: 600;
}

.empty-state {
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px; color: #9aa5b5; font-size: 14px;
}

.result-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 18px; margin-bottom: 10px;
}
.result-count {
  font-size: 13px; color: #9aa5b5;
}
.result-count strong {
  color: #425066; font-weight: 800;
}
.export-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 16px; border-radius: 9px; font-size: 13px; font-weight: 700;
  border: 1.5px solid #42c978; background: #f0fdf4; color: #16a34a;
  cursor: pointer; transition: all 160ms ease;
}
.export-btn:hover {
  background: #dcfce7; transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34,197,94,.15);
}
.export-btn:active { transform: scale(.97); }

.lookup-table-wrap {
  border-radius: 14px; background: #fff;
  border: 1px solid #edf1f6; box-shadow: 0 2px 12px rgba(21,32,51,.04);
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.lookup-table {
  width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px;
}
.lookup-table th {
  text-align: left; padding: 12px 14px; font-size: 11px; font-weight: 700;
  color: #9aa5b5; background: #f8faff; border-bottom: 1px solid #edf1f6;
  white-space: nowrap; text-transform: uppercase; letter-spacing: .3px;
}
.lookup-table td {
  padding: 12px 14px; border-bottom: 1px solid #f4f7fb; vertical-align: middle;
}
.lookup-table tr:last-child td { border-bottom: none; }
.lookup-table tr:hover { background: #fbfcff; }
.lookup-table .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; color: #425066; }
.lookup-table .center { text-align: center; }
.lookup-table .time-cell { font-size: 12px; color: #9aa5b5; white-space: nowrap; }
.lookup-table .muted { color: #c8cfd8; }

.tag { display: inline-block; padding: 2px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; }
.type-tag { background: #f3f0ff; color: #8b7bf7; }

.status-pill {
  display: inline-flex; padding: 3px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 700; border: 1px solid;
}
.status-pill.small { padding: 2px 10px; font-size: 11px; }

.ext-id {
  font-size: 11px; background: #f0f4ff; color: #5b8def;
  padding: 2px 8px; border-radius: 4px;
}
.no-upstream {
  font-size: 11px; background: #fff1f0; color: #ff4d4f;
  padding: 2px 8px; border-radius: 4px; font-weight: 600;
}
.upstream-yes {
  font-size: 11px; background: #f0fff4; color: #42c978;
  padding: 2px 8px; border-radius: 4px; font-weight: 600;
}
.upstream-no {
  font-size: 11px; background: #fff1f0; color: #ff4d4f;
  padding: 2px 8px; border-radius: 4px; font-weight: 600;
}
.ext-status { font-size: 12px; font-weight: 700; }
.ext-status.running { color: #5b8def; }
.ext-status.completed { color: #42c978; }
.ext-status.accepted { color: #9aa5b5; }
.ext-status.failed { color: #ff4d4f; }
.ext-status.cancelled { color: #9aa5b5; }

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
  .lookup-table { min-width: 800px; }
}
</style>
