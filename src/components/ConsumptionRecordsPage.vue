<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ElDatePicker,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect
} from 'element-plus'
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/select/style/css'
import EmptyState from './EmptyState.vue'

const ws = inject('workspace')
const { getToken, isAdmin, isAgent, balance, fetchBalance, refreshKey } = ws

const loading = ref(false)
const records = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)

const filterType = ref('')
const filterDirection = ref('')
const filterOrderNo = ref('')
const dateRange = ref(null)
const mobileDateStart = ref('')
const mobileDateEnd = ref('')
const filterUserId = ref('')

const userKeyword = ref('')
const userOptions = ref([])
const userSearchLoading = ref(false)

// 窄屏状态
const isNarrow = ref(false)
let narrowMq = null

const recordTypeMap = {
  order_charge: '订单扣款',
  recharge: '充值',
  refund: '退款',
  admin_add: '管理员加款',
  admin_deduct: '管理员扣款',
  supplement_charge: '补单扣款',
  supplement_refund: '补单退款',
  agent_commission: '下级分润',
  agent_commission_refund: '分润扣回',
  agent_transfer_out: '划款转出',
  agent_transfer_in: '划款转入',
  register_bonus: '注册赠送'
}

const typeOptions = Object.entries(recordTypeMap).map(([value, label]) => ({ value, label }))
const typeSelectOptions = [{ value: '', label: '全部类型' }, ...typeOptions]
const directionOptions = [
  { value: '', label: '全部' },
  { value: 'in', label: '收入' },
  { value: 'out', label: '支出' }
]

const pageHeroDesc = computed(() =>
  isAdmin.value
    ? '查看全平台消费流水，可按用户筛选'
    : '查看您的消费、充值与退款流水'
)

const isRegularUser = computed(() => !isAdmin.value && !isAgent.value)
const showMobileFilter = computed(() => isNarrow.value)

function syncMobileDatesFromRange() {
  mobileDateStart.value = dateRange.value?.[0] || ''
  mobileDateEnd.value = dateRange.value?.[1] || ''
}

function syncRangeFromMobileDates() {
  if (!mobileDateStart.value && !mobileDateEnd.value) {
    dateRange.value = null
    return
  }
  dateRange.value = [mobileDateStart.value || '', mobileDateEnd.value || '']
}

watch(dateRange, syncMobileDatesFromRange, { immediate: true })

// 同步窄屏状态
function syncNarrow() {
  isNarrow.value = narrowMq?.matches ?? false
}

const filterSize = computed(() => (isNarrow.value ? 'small' : 'default')) // 过滤器大小

// 格式化时间
function fmtTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 格式化金额
function fmtMoney(v) {
  return (parseFloat(v) || 0).toFixed(2)
}

// 记录标签
function recordLabel(r) {
  if (isAgentCommissionType(r)) {
    const sub = subordinateName(r)
    const agent = displayUser(r)
    if (isAdmin.value && agent) {
      if (r.record_type === 'agent_commission_refund') {
        return sub ? `代理 ${agent} · 下级 ${sub} 分润扣回` : `代理 ${agent} 分润扣回`
      }
      return sub ? `代理 ${agent} · 下级 ${sub} 分润` : `代理 ${agent} 分润`
    }
    if (sub) {
      return r.record_type === 'agent_commission_refund'
        ? `下级 ${sub} 退款扣回分润`
        : `下级 ${sub} 下单分润`
    }
  }
  return r.remark || recordTypeMap[r.record_type] || r.record_type || '-'
}

// 是否收入
function isIncome(r) {
  return r.direction === 'in' || r.direction === 'credit'
}

// 记录金额
function recordAmount(r) {
  const raw = r.actual_paid_amount ?? r.net_amount ?? r.payable_amount ?? r.refund_amount ?? 0
  return Math.abs(parseFloat(raw) || 0)
}

// 显示用户
function displayUser(r) {
  return r.nickname || r.real_name || r.username || `用户#${r.user_id}`
}

function isAgentCommissionType(r) {
  return r?.record_type === 'agent_commission' || r?.record_type === 'agent_commission_refund'
}

function subordinateName(r) {
  return r.subordinate_nickname || r.subordinate_real_name || r.subordinate_username || ''
}

/** 该订单代理当初拿到的分润总额 */
function agentCommissionEarned(r) {
  const fromApi = parseFloat(r.commission_total)
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi
  if (r?.record_type === 'agent_commission') return recordAmount(r)
  return 0
}

function agentClawbackAmount(r) {
  if (r?.record_type !== 'agent_commission_refund') return 0
  const n = parseFloat(r.clawback_amount ?? r.actual_paid_amount ?? r.refund_amount ?? r.net_amount)
  return Number.isFinite(n) && n > 0 ? n : recordAmount(r)
}

// 格式化短时间
function fmtShortTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 类型标签
function typeBadgeLabel(r) {
  return recordTypeMap[r.record_type] || r.record_type || '其他'
}

const expandedRecordId = ref(null)

const CR_EXPAND_MS = 320
const CR_EXPAND_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function crExpandEl(el) {
  return el instanceof HTMLElement ? el : null
}

function crExpandClear(el) {
  const node = crExpandEl(el)
  if (!node) return
  node.style.height = ''
  node.style.overflow = ''
  node.style.transition = ''
}

function onCrBeforeEnter(el) {
  const node = crExpandEl(el)
  if (!node) return
  crExpandClear(node)
  node.style.height = '0'
  node.style.overflow = 'hidden'
}

// 展开记录
function onCrEnter(el, done) {
  const node = crExpandEl(el)
  if (!node) {
    done()
    return
  }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    node.removeEventListener('transitionend', onEnd)
    crExpandClear(node)
    node.style.height = 'auto'
    done()
  }
  const onEnd = (e) => {
    if (e.target === node && e.propertyName === 'height') finish()
  }
  const run = () => {
    const target = node.scrollHeight
    node.style.transition = `height ${CR_EXPAND_MS}ms ${CR_EXPAND_EASE}`
    void node.offsetHeight
    node.style.height = `${target}px`
    node.addEventListener('transitionend', onEnd)
    window.setTimeout(finish, CR_EXPAND_MS + 40)
  }
  requestAnimationFrame(() => requestAnimationFrame(run))
}

// 关闭记录
function onCrBeforeLeave(el) {
  const node = crExpandEl(el)
  if (!node) return
  crExpandClear(node)
  node.style.height = `${node.scrollHeight}px`
  node.style.overflow = 'hidden'
}

// 关闭记录
function onCrLeave(el, done) {
  const node = crExpandEl(el)
  if (!node) {
    done()
    return
  }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    node.removeEventListener('transitionend', onEnd)
    crExpandClear(node)
    done()
  }
  const onEnd = (e) => {
    if (e.target === node && e.propertyName === 'height') finish()
  }
  const run = () => {
    node.style.transition = `height ${CR_EXPAND_MS}ms ${CR_EXPAND_EASE}`
    void node.offsetHeight
    node.style.height = '0'
    node.addEventListener('transitionend', onEnd)
    window.setTimeout(finish, CR_EXPAND_MS + 40)
  }
  requestAnimationFrame(run)
}

// 是否有记录详情
function hasRecordDetail(r) {
  return !!(
    (isAdmin.value && displayUser(r)) ||
    (isAgentCommissionType(r) && subordinateName(r)) ||
    r.order_no ||
    r.record_no ||
    isAgentCommissionType(r) ||
    r.reason_message ||
    (r.remark && r.remark !== recordLabel(r))
  )
}

// 切换记录展开状态
function toggleRecord(r) {
  if (!hasRecordDetail(r)) return
  expandedRecordId.value = expandedRecordId.value === r.id ? null : r.id
}

// 是否显示类型标签
function showTypeTag(r) {
  return typeBadgeLabel(r) !== recordLabel(r)
}

// ========== 订单快捷预览 ==========
const previewVisible = ref(false)
const previewLoading = ref(false)
const previewOrder = ref(null)
const previewError = ref('')
const previewAvatarFailed = ref(false)

// 订单状态配置
const orderStatusConf = {
  pending: { label: '待处理', color: '#9aa5b5' },
  running: { label: '进行中', color: '#5b8def' },
  processing: { label: '处理中', color: '#5b8def' },
  completed: { label: '已完成', color: '#22a858' },
  partial_completed: { label: '部分完成', color: '#f5a623' },
  refunding: { label: '退款中', color: '#f5a623' },
  refunded: { label: '已退款', color: '#e8a735' },
  failed: { label: '失败', color: '#e85d5d' },
  cancelled: { label: '已取消', color: '#9aa5b5' },
  stopped: { label: '已停止', color: '#9aa5b5' }
}
const orderTypeMap = { read: '阅读', like: '点赞', impression: '曝光', collect: '收藏', comment: '评论', view: '阅读' }

function osc(s) { return orderStatusConf[s] || { label: s || '未知', color: '#9aa5b5' } }
// 预览订单类型标签
function previewTypeLabel(o) {
  if (o?.product_name) return o.product_name.replace(/^小红书/, '')
  return orderTypeMap[o?.target_type] || o?.target_type || '-'
}
function previewProgress(o) {
  if (typeof o?.progress === 'number') return o.progress
  const t = o?.ordered_quantity || 0
  return t ? Math.min(100, Math.round((o?.completed_quantity || 0) / t * 100)) : 0
}

async function openOrderPreview(r) {
  const orderNo = r?.order_no
  if (!orderNo) return
  previewVisible.value = true
  previewLoading.value = true
  previewOrder.value = null
  previewError.value = ''
  previewAvatarFailed.value = false
  try {
    let order = null
    // 主：按 order_no 查（稳定主键，天然排除 order_id 复用的孤儿；当前会返回含已退款订单）
    const res = await fetch('/api/batch/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ batch_nos: [orderNo] })
    })
    const data = await res.json()
    const list = data?.data?.orders || []
    order = list.find(o => o.order_no === orderNo) || (list.length === 1 ? list[0] : null)
    // 兜底：lookup 未命中时按 order_id 查，并校验 order_no 一致（避免历史孤儿指到错订单）
    if (!order && r.order_id) {
      const res2 = await fetch(`/api/tasks/orders/${r.order_id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      const d2 = await res2.json()
      const o2 = d2?.code === 0 ? d2.data : null
      if (o2 && o2.order_no === orderNo) order = o2
    }
    if (order) previewOrder.value = order
    else previewError.value = '未找到该订单'
  } catch {
    previewError.value = '加载失败，请重试'
  } finally {
    previewLoading.value = false
  }
}
function closeOrderPreview() { previewVisible.value = false }

// 汇总
const summary = computed(() => {
  let income = 0
  let expense = 0
  for (const r of records.value) {
    const amt = recordAmount(r)
    if (isIncome(r)) income += amt
    else expense += amt
  }
  return { income, expense }
})

// 用户选项标签
function userOptionLabel(u) {
  const name = u.nickname || u.real_name || u.username || `用户#${u.id}`
  return `${name} (#${u.id})`
}

// 搜索用户远程
async function searchUsersRemote(query) {
  if (!isAdmin.value) return
  const kw = (query || '').trim()
  if (!kw) {
    userOptions.value = []
    return
  }
  userSearchLoading.value = true
  try {
    const params = new URLSearchParams({ page: 1, pageSize: 30, keyword: kw })
    const res = await fetch(`/api/users?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) userOptions.value = data.data?.rows || data.data?.list || []
  } catch { /* ignore */ }
  finally { userSearchLoading.value = false }
}

// 用户过滤变化
function onUserFilterChange(val) {
  if (!val) clearUserFilter()
  else doSearch()
}

// 获取记录
async function fetchRecords() {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: page.value,
      pageSize: pageSize.value
    })
    if (filterType.value) params.append('record_type', filterType.value)
    if (filterDirection.value) params.append('direction', filterDirection.value)
    if (filterOrderNo.value.trim()) params.append('order_no', filterOrderNo.value.trim())
    if (isAdmin.value && filterUserId.value) params.append('user_id', filterUserId.value)
    if (dateRange.value?.[0]) params.append('start', dateRange.value[0])
    if (dateRange.value?.[1]) params.append('end', dateRange.value[1])

    const res = await fetch(`/api/tasks/account-records?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      records.value = data.data.rows || []
      total.value = data.data.total || 0
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

// 执行搜索
function doSearch() {
  page.value = 1
  expandedRecordId.value = null
  fetchRecords()
}

// 重置过滤器
function resetFilters() {
  filterType.value = ''
  filterDirection.value = ''
  filterOrderNo.value = ''
  dateRange.value = null
  filterUserId.value = ''
  userKeyword.value = ''
  userOptions.value = []
  page.value = 1
  fetchRecords()
}

// 分页变化
function onPageChange(p) {
  page.value = p
  expandedRecordId.value = null
  fetchRecords()
}

// 清除用户过滤
function clearUserFilter() {
  filterUserId.value = ''
  userKeyword.value = ''
  userOptions.value = []
  page.value = 1
  fetchRecords()
}

// 刷新键变化
watch(refreshKey, () => {
  fetchBalance()
  fetchRecords()
})

// 挂载
onMounted(() => {
  narrowMq = window.matchMedia('(max-width: 760px)')
  syncNarrow()
  narrowMq.addEventListener('change', syncNarrow)
  fetchBalance()
  fetchRecords()
})

// 卸载
onUnmounted(() => {
  narrowMq?.removeEventListener('change', syncNarrow)
})
</script>

<template>
  <div class="consumption-page">
    <header class="page-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-content">
        <span class="hero-badge">账务中心</span>
        <h1 class="hero-title">消费记录</h1>
        <p class="hero-desc">{{ pageHeroDesc }}</p>
      </div>
    </header>

    <div class="stats-row">
      <div class="stat-card stat-card--balance">
        <div class="stat-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">当前余额</span>
          <strong class="stat-value">¥{{ fmtMoney(balance) }}</strong>
        </div>
      </div>
      <div class="stat-card stat-card--in">
        <div class="stat-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">本页收入</span>
          <strong class="stat-value">+¥{{ fmtMoney(summary.income) }}</strong>
        </div>
      </div>
      <div class="stat-card stat-card--out">
        <div class="stat-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">本页支出</span>
          <strong class="stat-value">-¥{{ fmtMoney(summary.expense) }}</strong>
        </div>
      </div>
      <div class="stat-card stat-card--count">
        <div class="stat-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">记录总数</span>
          <strong class="stat-value">{{ total }}</strong>
        </div>
      </div>
    </div>

    <section class="panel">
      <div class="consumption-filter">
        <div class="consumption-filter-head">
          <span class="consumption-filter-title">流水明细</span>
          <span class="consumption-filter-count">共 <strong>{{ total }}</strong> 条</span>
        </div>
        <form class="consumption-filter-form" @submit.prevent="doSearch">
          <!-- 手机端：单列筛选，避免多列下拉挤成空条 -->
          <div v-if="showMobileFilter" class="consumption-filter-mobile">
            <el-select
              v-if="isAdmin"
              v-model="filterUserId"
              class="cf-control cf-mobile-full"
              size="small"
              filterable
              remote
              clearable
              placeholder="搜索用户"
              :remote-method="searchUsersRemote"
              :loading="userSearchLoading"
              @change="onUserFilterChange"
            >
              <el-option
                v-for="u in userOptions"
                :key="u.id"
                :label="userOptionLabel(u)"
                :value="String(u.id)"
              />
            </el-select>

            <div v-if="!isRegularUser" class="cf-mobile-row">
              <el-select
                v-model="filterType"
                class="cf-control cf-mobile-half"
                size="small"
                clearable
                placeholder="全部类型"
              >
                <el-option
                  v-for="opt in typeSelectOptions"
                  :key="opt.value || 'all'"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <el-select
                v-model="filterDirection"
                class="cf-control cf-mobile-half"
                size="small"
                clearable
                placeholder="全部方向"
              >
                <el-option
                  v-for="opt in directionOptions"
                  :key="opt.value || 'all'"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>

            <el-input
              v-if="!isRegularUser"
              v-model="filterOrderNo"
              class="cf-control cf-mobile-full"
              size="small"
              clearable
              placeholder="订单号"
              @keyup.enter="doSearch"
            />

            <div class="cf-date-row">
              <el-date-picker
                v-model="mobileDateStart"
                class="cf-control cf-date-single"
                type="date"
                size="small"
                placeholder="开始"
                value-format="YYYY-MM-DD"
                format="MM-DD"
                clearable
                :editable="false"
                popper-class="cp-mobile-date-popper"
                @change="syncRangeFromMobileDates"
              />
              <span class="cf-date-sep">至</span>
              <el-date-picker
                v-model="mobileDateEnd"
                class="cf-control cf-date-single"
                type="date"
                size="small"
                placeholder="结束"
                value-format="YYYY-MM-DD"
                format="MM-DD"
                clearable
                :editable="false"
                popper-class="cp-mobile-date-popper"
                @change="syncRangeFromMobileDates"
              />
            </div>
            <div class="cf-actions cf-actions--mobile">
              <button type="submit" class="cf-btn cf-btn--primary cf-btn--mobile">筛选</button>
              <button type="button" class="cf-btn cf-btn--ghost cf-btn--mobile" @click="resetFilters">重置</button>
            </div>
          </div>

          <div v-else class="consumption-filter-grid" :class="{ 'is-admin': isAdmin }">
            <el-select
              v-if="isAdmin"
              v-model="filterUserId"
              class="cf-control cf-user"
              :size="filterSize"
              filterable
              remote
              clearable
              placeholder="搜索用户"
              :remote-method="searchUsersRemote"
              :loading="userSearchLoading"
              @change="onUserFilterChange"
            >
              <el-option
                v-for="u in userOptions"
                :key="u.id"
                :label="userOptionLabel(u)"
                :value="String(u.id)"
              />
            </el-select>

            <el-select
              v-model="filterType"
              class="cf-control"
              :size="filterSize"
              clearable
              placeholder="全部类型"
            >
              <el-option
                v-for="opt in typeSelectOptions"
                :key="opt.value || 'all'"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>

            <el-select
              v-model="filterDirection"
              class="cf-control cf-direction"
              :size="filterSize"
              clearable
              placeholder="全部方向"
            >
              <el-option
                v-for="opt in directionOptions"
                :key="opt.value || 'all'"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>

            <el-input
              v-model="filterOrderNo"
              class="cf-control cf-order"
              :size="filterSize"
              clearable
              placeholder="订单号"
              @keyup.enter="doSearch"
            />

            <el-date-picker
              v-model="dateRange"
              class="cf-control cf-date"
              :size="filterSize"
              type="daterange"
              range-separator="至"
              :start-placeholder="isNarrow ? '开始' : '开始日期'"
              :end-placeholder="isNarrow ? '结束' : '结束日期'"
              value-format="YYYY-MM-DD"
              clearable
            />

            <div class="cf-actions">
              <button type="submit" class="cf-btn cf-btn--primary">{{ isNarrow ? '筛选' : '搜索' }}</button>
              <button type="button" class="cf-btn cf-btn--ghost" @click="resetFilters">重置</button>
            </div>
          </div>
        </form>
      </div>

      <div v-loading="loading" class="record-list">
        <template v-if="!loading && records.length">
          <article
            v-for="r in records"
            :key="r.id"
            class="record-card"
            :class="[
              isIncome(r) ? 'is-income' : 'is-expense',
              { 'is-expanded': expandedRecordId === r.id, 'is-clickable': hasRecordDetail(r) }
            ]"
          >
            <div
              class="record-clickable"
              :role="hasRecordDetail(r) ? 'button' : undefined"
              :tabindex="hasRecordDetail(r) ? 0 : undefined"
              @click="toggleRecord(r)"
              @keyup.enter="toggleRecord(r)"
            >
              <div class="record-head">
                <div class="record-icon" aria-hidden="true">
                  <svg v-if="isIncome(r)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                </div>

                <div class="record-body">
                  <div class="record-title-row">
                    <p class="record-title">{{ recordLabel(r) }}</p>
                    <span class="record-amount">{{ isIncome(r) ? '+' : '-' }}¥{{ fmtMoney(recordAmount(r)) }}</span>
                    <svg
                      v-if="hasRecordDetail(r)"
                      class="record-chevron"
                      :class="{ 'record-chevron--open': expandedRecordId === r.id }"
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
                  <div class="record-meta-line">
                    <time class="record-time">{{ fmtShortTime(r.created_at) }}</time>
                    <span
                      v-if="showTypeTag(r)"
                      class="record-type-tag"
                      :class="isIncome(r) ? 'is-in' : 'is-out'"
                    >{{ typeBadgeLabel(r) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <Transition
              :css="false"
              @before-enter="onCrBeforeEnter"
              @enter="onCrEnter"
              @before-leave="onCrBeforeLeave"
              @leave="onCrLeave"
            >
              <div v-if="expandedRecordId === r.id" class="record-detail-wrap">
                <div class="record-detail">
                  <div v-if="isAdmin || (isAgentCommissionType(r) && subordinateName(r))" class="record-meta">
                    <span v-if="isAdmin && isAgentCommissionType(r)" class="meta-chip meta-chip--agent">代理 {{ displayUser(r) }}</span>
                    <span v-else-if="isAdmin && !isAgentCommissionType(r)" class="meta-chip meta-chip--user">{{ displayUser(r) }}</span>
                    <span v-if="isAgentCommissionType(r) && subordinateName(r)" class="meta-chip meta-chip--sub">下级 {{ subordinateName(r) }}</span>
                  </div>

                  <div
                    v-if="r.order_no || r.record_no || isAgentCommissionType(r)"
                    class="record-ids"
                  >
                    <span
                      v-if="isAgentCommissionType(r) && agentCommissionEarned(r) > 0"
                      class="id-line id-line--comm"
                    >
                      <em>代理拿了</em>¥{{ fmtMoney(agentCommissionEarned(r)) }}
                    </span>
                    <span v-if="r.record_type === 'agent_commission_refund'" class="id-line id-line--claw">
                      <em>代理扣回</em>¥{{ fmtMoney(agentClawbackAmount(r)) }}
                    </span>
                    <span v-if="r.order_no" class="id-line id-line--order">
                      <em>订单</em>
                      <button
                        type="button"
                        class="op-trigger"
                        title="点击预览该订单"
                        @click.stop="openOrderPreview(r)"
                      >
                        <span class="op-trigger-no">{{ r.order_no }}</span>
                        <svg class="op-trigger-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      </button>
                    </span>
                    <span v-if="r.record_no" class="id-line">
                      <em>流水</em>{{ r.record_no }}
                    </span>
                  </div>

                  <p v-if="r.reason_message" class="record-remark">{{ r.reason_message }}</p>
                  <p v-else-if="r.remark && r.remark !== recordLabel(r)" class="record-remark">{{ r.remark }}</p>
                </div>
              </div>
            </Transition>
          </article>
        </template>
        <EmptyState
          v-else-if="!loading"
          class="empty-state"
          text="暂无消费记录"
          description="调整筛选条件或稍后再试"
        />
      </div>

      <div v-if="total > 0" class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          small
          @current-change="onPageChange"
        />
      </div>
    </section>

    <!-- 订单快捷预览 -->
    <Transition name="op-fade">
      <div v-if="previewVisible" class="op-mask" @click.self="closeOrderPreview">
        <div class="op-modal" role="dialog" aria-modal="true">
          <div class="op-head">
            <h3 class="op-title">订单预览</h3>
            <button type="button" class="op-close" aria-label="关闭" @click="closeOrderPreview">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="op-body">
            <div v-if="previewLoading" class="op-state">
              <span class="op-spinner" aria-hidden="true"></span>加载中…
            </div>
            <div v-else-if="previewError" class="op-state op-state--err">{{ previewError }}</div>
            <template v-else-if="previewOrder">
              <div class="op-note">
                <img
                  v-if="previewOrder.avatar_url && !previewAvatarFailed"
                  class="op-avatar"
                  :src="previewOrder.avatar_url"
                  alt=""
                  loading="lazy"
                  @error="previewAvatarFailed = true"
                />
                <div v-else class="op-avatar op-avatar--ph">{{ (previewOrder.title || '笔').trim().charAt(0) || '笔' }}</div>
                <div class="op-note-info">
                  <p class="op-note-title">{{ previewOrder.title || '未获取笔记标题' }}</p>
                  <p v-if="previewOrder.author_name" class="op-note-author">{{ previewOrder.author_name }}</p>
                </div>
                <span
                  class="op-status"
                  :style="{ color: osc(previewOrder.order_status).color, background: osc(previewOrder.order_status).color + '14', borderColor: osc(previewOrder.order_status).color + '40' }"
                >{{ osc(previewOrder.order_status).label }}</span>
              </div>

              <p class="op-order-no">{{ previewOrder.order_no }}</p>

              <div class="op-metrics">
                <div class="op-metric"><span>类型</span><strong>{{ previewTypeLabel(previewOrder) }}</strong></div>
                <div class="op-metric"><span>下单数</span><strong>{{ previewOrder.ordered_quantity || 0 }}</strong></div>
                <div class="op-metric"><span>完成数</span><strong>{{ previewOrder.completed_quantity || 0 }}</strong></div>
                <div class="op-metric"><span>进度</span><strong>{{ previewProgress(previewOrder) }}%</strong></div>
              </div>

              <div class="op-progress"><div class="op-progress-fill" :style="{ width: previewProgress(previewOrder) + '%' }"></div></div>

              <a
                v-if="previewOrder.note_url"
                class="op-link"
                :href="previewOrder.note_url"
                target="_blank"
                rel="noopener"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span>{{ previewOrder.note_url }}</span>
              </a>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.consumption-page {
  --cp-primary: #2f6df6;
  --cp-text: #152033;
  --cp-text-2: #425066;
  --cp-text-3: #8a95a8;
  --cp-border: #e8eef7;
  --cp-radius: 16px;
  --cp-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 20px 72px;
}

.page-hero {
  position: relative;
  border-radius: var(--cp-radius);
  overflow: hidden;
  margin-bottom: 16px;
  border: 1px solid rgba(47, 109, 246, 0.12);
  box-shadow: var(--cp-shadow);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 0% 0%, rgba(47, 109, 246, 0.12), transparent 55%),
    radial-gradient(ellipse 50% 40% at 100% 100%, rgba(47, 109, 246, 0.06), transparent 50%),
    linear-gradient(180deg, #fff 0%, #fafbff 100%);
}

.hero-content {
  position: relative;
  padding: 24px 28px;
}

.hero-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--cp-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.3px;
  margin-bottom: 10px;
}

.hero-title {
  font-size: 24px;
  font-weight: 900;
  color: var(--cp-text);
  letter-spacing: -0.3px;
  margin: 0;
  line-height: 1.2;
}

.hero-desc {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--cp-text-3);
  line-height: 1.5;
  max-width: 480px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.stat-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: var(--cp-radius);
  background: #fff;
  border: 1px solid var(--cp-border);
  box-shadow: var(--cp-shadow);
  overflow: hidden;
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--cp-primary);
  opacity: 0.75;
}

.stat-card--balance::before { background: linear-gradient(90deg, #2f6df6, #5a8ef8); }
.stat-card--in::before { background: linear-gradient(90deg, #22a858, #42c978); }
.stat-card--out::before { background: linear-gradient(90deg, #e85d5d, #f08a8a); }
.stat-card--count::before { background: linear-gradient(90deg, #8b7bf7, #a78bfa); }

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(47, 109, 246, 0.1);
  border-color: #d4e2f7;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: rgba(47, 109, 246, 0.08);
  color: var(--cp-primary);
}

.stat-card--in .stat-icon {
  background: #ecfdf3;
  color: #22a858;
}

.stat-card--out .stat-icon {
  background: #fff1f2;
  color: #e85d5d;
}

.stat-card--count .stat-icon {
  background: #f5f3ff;
  color: #7c6ee6;
}

.stat-body {
  min-width: 0;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: var(--cp-text-3);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--cp-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
  line-height: 1.2;
}

.stat-card--in .stat-value { color: #22a858; }
.stat-card--out .stat-value { color: #e85d5d; }

.panel {
  background: #fff;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius);
  box-shadow: var(--cp-shadow);
  overflow: hidden;
}

.consumption-filter {
  padding: 14px 16px 12px;
  border-bottom: 1px solid #f0f2f7;
  background: #fff;
}

.consumption-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.consumption-filter-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--cp-text);
}

.consumption-filter-count {
  font-size: 12px;
  color: var(--cp-text-3);
}

.consumption-filter-count strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--cp-primary);
}

.consumption-filter-mobile {
  display: flex;
  flex-direction: column;
  gap: 14px;
  --el-font-size-base: 11px;
  --el-component-size: 30px;
  font-size: 11px;
}

.cf-mobile-full {
  width: 100%;
  min-width: 0;
}

.cf-mobile-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.cf-mobile-half {
  width: 100%;
  min-width: 0;
}

.consumption-filter-mobile :deep(.cf-control) {
  --el-font-size-base: 11px;
  --el-component-size: 30px;
  font-size: 11px;
}

.consumption-filter-mobile :deep(.cf-control .el-input__wrapper),
.consumption-filter-mobile :deep(.cf-control .el-select__wrapper) {
  min-height: 30px;
  height: 30px;
  font-size: 11px;
  line-height: 28px;
}

.consumption-filter-mobile :deep(.cf-control input),
.consumption-filter-mobile :deep(.cf-control .el-input__inner),
.consumption-filter-mobile :deep(.cf-control .el-select__selected-item),
.consumption-filter-mobile :deep(.cf-control .el-select__placeholder),
.consumption-filter-mobile :deep(.cf-control .el-select__input),
.consumption-filter-mobile :deep(.cf-control .el-select__input-calculator) {
  font-size: 11px !important;
}

.consumption-filter-mobile :deep(.cf-control input::placeholder),
.consumption-filter-mobile :deep(.cf-control .el-input__inner::placeholder) {
  font-size: 11px !important;
  color: #b0b8c6;
}

.consumption-filter-mobile :deep(.cf-control .el-select__caret),
.consumption-filter-mobile :deep(.cf-control .el-input__prefix-inner),
.consumption-filter-mobile :deep(.cf-control .el-input__suffix-inner) {
  font-size: 12px;
}

.cf-date-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.cf-date-sep {
  font-size: 11px;
  font-weight: 600;
  color: var(--cp-text-3);
  flex-shrink: 0;
}

.consumption-filter-mobile .cf-date-single {
  width: 100% !important;
  min-width: 0;
}

.consumption-filter-mobile :deep(.cf-date-single.el-date-editor) {
  width: 100% !important;
  height: 32px !important;
  --el-date-editor-width: 100%;
  --el-font-size-base: 11px;
  --el-component-size: 32px;
  font-size: 11px;
}

.consumption-filter-mobile :deep(.cf-date-single .el-input__wrapper) {
  min-height: 32px;
  height: 32px;
  padding: 0 6px;
  font-size: 11px;
}

.consumption-filter-mobile :deep(.cf-date-single .el-input__inner) {
  height: 30px;
  line-height: 30px;
  font-size: 11px !important;
}

.consumption-filter-mobile :deep(.cf-date-single .el-input__inner::placeholder) {
  font-size: 11px;
  color: #b0b8c6;
}

.consumption-filter-mobile :deep(.cf-date-single .el-input__prefix-inner),
.consumption-filter-mobile :deep(.cf-date-single .el-input__suffix-inner) {
  font-size: 12px;
}

.consumption-filter-mobile .cf-actions--mobile {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 2px;
  padding-top: 2px;
}

.cf-btn--mobile {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
}

.consumption-filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
}

.consumption-filter-grid.is-admin {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.cf-control {
  width: 100%;
  min-width: 0;
}

.cf-date {
  grid-column: 1 / span 2;
  width: 100% !important;
  max-width: 100%;
}

.consumption-filter-grid.is-admin .cf-date {
  grid-column: 1 / span 3;
}

.consumption-filter-grid:not(.is-admin) .cf-actions {
  grid-column: 3;
  justify-self: end;
}

.consumption-filter-grid.is-admin .cf-actions {
  grid-column: 4;
  justify-self: end;
}

.consumption-filter-grid :deep(.cf-date.el-date-editor--daterange) {
  width: 100% !important;
  max-width: 100%;
  box-sizing: border-box;
}

.consumption-filter-grid :deep(.el-input__wrapper),
.consumption-filter-grid :deep(.el-select__wrapper) {
  border-radius: 10px;
  background: #f8faff;
  box-shadow: 0 0 0 1px #e4ebf5 inset;
  transition: box-shadow 0.2s ease, background 0.2s ease;
}

.consumption-filter-grid :deep(.el-input__wrapper:hover),
.consumption-filter-grid :deep(.el-select__wrapper:hover) {
  background: #fff;
  box-shadow: 0 0 0 1px rgba(47, 109, 246, 0.28) inset;
}

.consumption-filter-grid :deep(.el-input__wrapper.is-focus),
.consumption-filter-grid :deep(.el-select__wrapper.is-focused) {
  background: #fff;
  box-shadow: 0 0 0 1px var(--cp-primary) inset, 0 0 0 3px rgba(47, 109, 246, 0.1);
}

.cf-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.cf-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
}

.cf-btn--primary {
  border: none;
  background: var(--cp-primary);
  color: #fff;
}

.cf-btn--primary:hover {
  background: #2558d4;
}

.cf-btn--ghost {
  border: 1px solid #e4ebf5;
  background: #fff;
  color: var(--cp-text-2);
}

.cf-btn--ghost:hover {
  border-color: #c7d7ff;
  background: #f5f8ff;
  color: var(--cp-primary);
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 10px;
  min-height: 200px;
  background: linear-gradient(180deg, #f8faff 0%, #f4f7fb 100%);
}

.record-list :deep(.el-loading-mask) {
  border-radius: 0 0 12px 12px;
}

.record-card {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 2px 10px rgba(21, 32, 51, 0.05);
  overflow: hidden;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.record-card.is-expanded {
  border-color: #b8ccfa;
  box-shadow: 0 8px 24px rgba(47, 109, 246, 0.1);
}

.record-clickable {
  padding: 10px 12px;
  min-width: 0;
}

.record-card.is-clickable .record-clickable {
  cursor: pointer;
}

.record-card.is-clickable .record-clickable:hover {
  background: linear-gradient(180deg, #fbfcff 0%, #fff 100%);
}

.record-card.is-clickable .record-clickable:hover .record-chevron {
  color: var(--cp-primary);
}

.record-card.is-clickable .record-clickable:focus-visible {
  outline: 2px solid rgba(47, 109, 246, 0.35);
  outline-offset: -2px;
}

.record-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.record-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.record-card.is-income .record-icon {
  color: #22a858;
  background: linear-gradient(145deg, #ecfdf3, #d1fae5);
}

.record-card.is-expense .record-icon {
  color: #e85d5d;
  background: linear-gradient(145deg, #fff1f2, #ffe4e6);
}

.record-body {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
}

.record-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.record-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--cp-text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-chevron {
  flex-shrink: 0;
  margin-top: 2px;
  color: #c0c9d6;
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), color 200ms ease;
}

.record-chevron--open {
  transform: rotate(90deg);
  color: var(--cp-primary);
}

.record-meta-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.record-time {
  font-size: 12px;
  color: var(--cp-text-3);
}

.record-type-tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
}

.record-type-tag.is-in {
  color: #16a34a;
  background: #ecfdf3;
  border: 1px solid rgba(22, 163, 74, 0.15);
}

.record-type-tag.is-out {
  color: #dc2626;
  background: #fff1f2;
  border: 1px solid rgba(220, 38, 38, 0.12);
}

.record-amount {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.2px;
}

.record-detail-wrap {
  overflow: hidden;
}

.record-detail {
  padding: 10px 12px 12px;
  border-top: 1px solid #f0f2f7;
  background: linear-gradient(180deg, #f8faff 0%, #fff 100%);
}

.record-card.is-income .record-amount { color: #16a34a; }
.record-card.is-expense .record-amount { color: #dc2626; }

.record-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

.meta-chip {
  padding: 3px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: var(--cp-text-2);
  font-size: 12px;
  font-weight: 600;
}

.meta-chip--user {
  background: rgba(47, 109, 246, 0.08);
  color: var(--cp-primary);
}

.meta-chip--agent {
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
}

.meta-chip--sub {
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
}

.record-ids {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #eef2f7;
}

.id-line {
  font-size: 12px;
  color: var(--cp-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
  line-height: 1.45;
}

.id-line em {
  font-style: normal;
  font-weight: 600;
  color: var(--cp-text-3);
  margin-right: 6px;
  font-family: inherit;
}

.id-line--claw {
  font-size: 13px;
  font-weight: 700;
  color: #dc2626;
}

.id-line--claw em {
  color: #dc2626;
}

.id-line--comm {
  font-size: 13px;
  font-weight: 700;
  color: #059669;
}

.id-line--comm em {
  color: #059669;
}

.record-remark {
  margin: 8px 0 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  border-radius: 8px;
  background: #fff;
  border-left: 3px solid #c7d7ff;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 220px;
  padding: 32px 20px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #c0c9d6;
  background: #f8faff;
  margin-bottom: 4px;
}

.empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--cp-text-2);
}

.empty-hint {
  margin: 0;
  font-size: 13px;
  color: var(--cp-text-3);
}

.pagination-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 14px 22px 18px;
  border-top: 1px solid #f0f2f7;
  background: #fafbff;
}

.pagination-wrap :deep(.el-pagination.is-background .el-pager li.is-active) {
  background: var(--cp-primary);
}

@media (max-width: 1080px) {
  .consumption-filter-grid,
  .consumption-filter-grid.is-admin {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .consumption-filter-grid .cf-order,
  .consumption-filter-grid .cf-date {
    grid-column: 1 / -1;
  }

  .consumption-filter-grid .cf-actions {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .cf-actions {
    width: 100%;
  }

  .cf-btn {
    flex: 1;
  }
}

@media (max-width: 900px) {
  .stats-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .consumption-page {
    --cp-radius: 12px;
    padding: 10px 10px 76px;
  }

  .page-hero {
    margin-bottom: 10px;
  }

  .hero-content {
    padding: 14px 16px;
  }

  .hero-badge {
    font-size: 10px;
    padding: 3px 10px;
    margin-bottom: 6px;
  }

  .hero-title {
    font-size: 17px;
  }

  .hero-desc {
    font-size: 12px;
    margin-top: 4px;
  }

  .stats-row {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }

  .stat-card {
    padding: 10px 12px;
    gap: 8px;
  }

  .stat-card:hover {
    transform: none;
  }

  .stat-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  .stat-icon svg {
    width: 16px;
    height: 16px;
  }

  .stat-label {
    font-size: 11px;
    margin-bottom: 2px;
  }

  .stat-value {
    font-size: 14px;
  }

  .consumption-filter {
    padding: 14px 12px 16px;
  }

  .consumption-filter-head {
    margin-bottom: 16px;
  }

  .consumption-filter-mobile {
    gap: 14px;
    --el-font-size-base: 11px;
    --el-component-size: 28px;
    font-size: 11px;
  }

  .consumption-filter-mobile :deep(.cf-control) {
    --el-font-size-base: 11px;
    --el-component-size: 28px;
  }

  .consumption-filter-mobile :deep(.cf-control .el-input__wrapper),
  .consumption-filter-mobile :deep(.cf-control .el-select__wrapper) {
    min-height: 28px;
    height: 28px;
    font-size: 11px;
    line-height: 26px;
  }

  .consumption-filter-mobile :deep(.cf-control input),
  .consumption-filter-mobile :deep(.cf-control .el-input__inner),
  .consumption-filter-mobile :deep(.cf-control .el-select__selected-item),
  .consumption-filter-mobile :deep(.cf-control .el-select__placeholder),
  .consumption-filter-mobile :deep(.cf-control .el-select__input) {
    font-size: 11px !important;
  }

  .consumption-filter-mobile :deep(.cf-control input::placeholder),
  .consumption-filter-mobile :deep(.cf-control .el-input__inner::placeholder) {
    font-size: 11px !important;
  }

  .consumption-filter-mobile .cf-actions--mobile {
    margin-top: 4px;
    padding-top: 0;
    gap: 10px;
  }

  .cf-date-row {
    gap: 6px;
  }

  .cf-date-sep {
    font-size: 11px;
  }

  .consumption-filter-mobile :deep(.cf-date-single.el-date-editor) {
    height: 30px !important;
    --el-component-size: 30px;
    --el-font-size-base: 11px;
    font-size: 11px;
  }

  .consumption-filter-mobile :deep(.cf-date-single .el-input__wrapper) {
    min-height: 30px;
    height: 30px;
    padding: 0 5px;
    font-size: 11px;
  }

  .consumption-filter-mobile :deep(.cf-date-single .el-input__inner) {
    height: 28px;
    line-height: 28px;
    font-size: 11px !important;
  }

  .consumption-filter-mobile :deep(.cf-date-single .el-input__inner::placeholder) {
    font-size: 11px;
  }

  .consumption-filter-mobile :deep(.cf-date-single .el-input__prefix-inner) {
    font-size: 12px;
  }

  .cf-btn--mobile {
    height: 28px;
    font-size: 11px;
    font-weight: 600;
  }

  .consumption-filter-title {
    font-size: 12px;
  }

  .consumption-filter-count {
    font-size: 11px;
  }

  .consumption-filter-count strong {
    font-size: 12px;
  }

  .consumption-filter-grid,
  .consumption-filter-grid.is-admin {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .consumption-filter-grid .cf-control,
  .consumption-filter-grid .cf-user,
  .consumption-filter-grid .cf-order,
  .consumption-filter-grid .cf-date,
  .consumption-filter-grid .cf-direction,
  .consumption-filter-grid .cf-actions {
    grid-column: 1 / -1;
  }

  .consumption-filter-grid :deep(.el-select__wrapper),
  .consumption-filter-grid :deep(.el-input__wrapper) {
    min-height: 36px;
  }

  .cf-actions {
    width: 100%;
  }

  .cf-btn {
    flex: 1;
    height: 32px;
    padding: 0 10px;
    font-size: 12px;
    line-height: 1;
  }

  .consumption-filter-grid :deep(.cf-date.el-date-editor--daterange) {
    width: 100% !important;
    --el-date-editor-width: 100%;
  }

  .record-list {
    padding: 10px 10px 8px;
    gap: 8px;
    min-height: 160px;
  }

  .record-clickable {
    padding: 9px 10px;
  }

  .record-icon {
    width: 32px;
    height: 32px;
    border-radius: 9px;
  }

  .record-icon svg {
    width: 14px;
    height: 14px;
  }

  .record-title {
    font-size: 12px;
    font-weight: 600;
  }

  .record-type-tag {
    font-size: 10px;
    padding: 1px 6px;
  }

  .record-amount {
    font-size: 12px;
    font-weight: 700;
  }

  .record-time {
    font-size: 10px;
  }

  .record-detail {
    padding: 8px 10px 10px;
  }

  .record-meta {
    padding-top: 8px;
    gap: 6px;
  }

  .meta-chip {
    font-size: 11px;
    padding: 2px 8px;
  }

  .record-ids {
    margin-top: 6px;
    padding: 8px 10px;
  }

  .id-line {
    font-size: 11px;
  }

  .record-remark {
    margin-top: 6px;
    padding: 6px 10px;
    font-size: 11px;
  }

  .empty-state {
    min-height: 160px;
    padding: 24px 16px;
  }

  .empty-icon {
    width: 56px;
    height: 56px;
  }

  .empty-icon svg {
    width: 32px;
    height: 32px;
  }

  .empty-title {
    font-size: 13px;
  }

  .empty-hint {
    font-size: 12px;
  }

  .pagination-wrap {
    padding: 10px 12px 14px;
  }

  .pagination-wrap :deep(.el-pagination) {
    --el-pagination-font-size: 12px;
    font-size: 12px;
  }

  .pagination-wrap :deep(.el-pagination .btn-prev),
  .pagination-wrap :deep(.el-pagination .btn-next),
  .pagination-wrap :deep(.el-pagination .el-pager li) {
    min-width: 26px;
    height: 26px;
    line-height: 26px;
    font-size: 12px;
  }
}

/* ========== 订单号预览触发器 ========== */
.id-line--order {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}

.op-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--cp-primary);
  text-align: left;
  word-break: break-all;
}

.op-trigger:hover .op-trigger-no { text-decoration: underline; }
.op-trigger-icon { flex-shrink: 0; opacity: 0.85; }

/* ========== 订单快捷预览弹窗 ========== */
.op-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
}

.op-modal {
  width: 100%;
  max-width: 420px;
  max-height: 88vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.25);
}

.op-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid #f0f2f7;
}

.op-title { margin: 0; font-size: 16px; font-weight: 800; color: var(--cp-text); }

.op-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 9px;
  background: #f6f8fc;
  color: var(--cp-text-3);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.op-close:hover { background: #fff1f0; color: #e85d5d; }

.op-body { padding: 16px 18px 18px; }

.op-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 0;
  color: var(--cp-text-3);
  font-size: 14px;
}

.op-state--err { color: #e85d5d; }

.op-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #e8edf4;
  border-top-color: var(--cp-primary);
  border-radius: 50%;
  animation: op-spin 0.7s linear infinite;
}

@keyframes op-spin { to { transform: rotate(360deg); } }

.op-note { display: flex; align-items: flex-start; gap: 12px; }

.op-avatar {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: #f3f0ff;
}

.op-avatar--ph {
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 800;
  color: #7c6ee6;
  background: linear-gradient(135deg, #f3f0ff, #e8f0ff);
}

.op-note-info { flex: 1; min-width: 0; }

.op-note-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--cp-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.op-note-author {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--cp-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.op-status {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  border: 1px solid transparent;
  white-space: nowrap;
}

.op-order-no {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--cp-text-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.op-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.op-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 10px 6px;
  border-radius: 11px;
  background: #f8faff;
  border: 1px solid #eef2f7;
  text-align: center;
}

.op-metric span { font-size: 11px; color: var(--cp-text-3); }
.op-metric strong { font-size: 14px; font-weight: 800; color: var(--cp-text); font-variant-numeric: tabular-nums; }

.op-progress {
  height: 6px;
  margin-top: 12px;
  background: #eef2f7;
  border-radius: 999px;
  overflow: hidden;
}

.op-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--cp-primary);
  transition: width 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.op-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 11px;
  border-radius: 10px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 12px;
  color: var(--cp-primary);
  text-decoration: none;
  word-break: break-all;
}

.op-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.op-link svg { flex-shrink: 0; }
.op-link:hover { background: #eef3ff; }

.op-fade-enter-active, .op-fade-leave-active { transition: opacity 0.2s ease; }
.op-fade-enter-from, .op-fade-leave-to { opacity: 0; }
</style>

<style>
@media (max-width: 760px) {
  .cp-mobile-date-popper.el-picker__popper {
    max-width: min(300px, calc(100vw - 24px)) !important;
    --el-font-size-base: 12px;
  }

  .cp-mobile-date-popper .el-picker-panel {
    width: 100% !important;
    font-size: 12px;
  }

  .cp-mobile-date-popper .el-date-picker {
    width: 100% !important;
  }

  .cp-mobile-date-popper .el-date-picker__header-label,
  .cp-mobile-date-popper .el-date-table th,
  .cp-mobile-date-popper .el-date-table td .el-date-table-cell__text {
    font-size: 12px;
  }
}
</style>
