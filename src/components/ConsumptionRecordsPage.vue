<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect
} from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/form/style/css'
import 'element-plus/es/components/form-item/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/select/style/css'

const ws = inject('workspace')
const { getToken, isAdmin, balance, fetchBalance, refreshKey } = ws

const loading = ref(false)
const records = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)

const filterType = ref('')
const filterDirection = ref('')
const filterOrderNo = ref('')
const dateRange = ref(null)
const filterUserId = ref('')

const userKeyword = ref('')
const userOptions = ref([])
const userSearchLoading = ref(false)

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

// 窄屏状态
const isNarrow = ref(false)
let narrowMq = null

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
      <div class="panel-toolbar">
      <el-form
        class="filter-form"
        :class="{ 'filter-form--narrow': isNarrow }"
        inline
        label-position="top"
        :size="filterSize"
        @submit.prevent="doSearch"
      >
        <el-form-item v-if="isAdmin" label="用户" class="filter-item filter-item--full filter-item--user">
          <el-select
            v-model="filterUserId"
            class="filter-control"
            :size="filterSize"
            filterable
            remote
            clearable
            placeholder="搜索用户名/昵称"
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
        </el-form-item>

        <el-form-item label="类型" class="filter-item filter-item--half">
          <el-select v-model="filterType" class="filter-control" :size="filterSize" placeholder="全部类型">
            <el-option
              v-for="opt in typeSelectOptions"
              :key="opt.value || 'all'"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="方向" class="filter-item filter-item--half">
          <el-select v-model="filterDirection" class="filter-control" :size="filterSize" placeholder="全部">
            <el-option
              v-for="opt in directionOptions"
              :key="opt.value || 'all'"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="订单号" class="filter-item filter-item--full filter-item--order">
          <el-input
            v-model="filterOrderNo"
            class="filter-control filter-order-input"
            :size="filterSize"
            clearable
            placeholder="订单号"
            @keyup.enter="doSearch"
          />
        </el-form-item>

        <el-form-item label="时间范围" class="filter-item filter-item--full filter-item--date">
          <el-date-picker
            v-model="dateRange"
            class="filter-control filter-date"
            :size="filterSize"
            type="daterange"
            range-separator="至"
            :start-placeholder="isNarrow ? '开始' : '开始日期'"
            :end-placeholder="isNarrow ? '结束' : '结束日期'"
            value-format="YYYY-MM-DD"
            clearable
          />
        </el-form-item>

        <el-form-item label=" " class="filter-item filter-item--full filter-item--actions">
          <div class="filter-actions">
            <el-button type="primary" @click="doSearch">搜索</el-button>
            <el-button @click="resetFilters">重置</el-button>
          </div>
        </el-form-item>
      </el-form>
      </div>

      <div class="list-header">
        <h2 class="list-title">流水明细</h2>
        <span class="list-count">共 {{ total }} 条</span>
      </div>

      <div v-loading="loading" class="record-list">
        <template v-if="!loading && records.length">
          <article
            v-for="r in records"
            :key="r.id"
            class="record-card"
            :class="isIncome(r) ? 'is-income' : 'is-expense'"
          >
            <div class="record-icon" aria-hidden="true">
              <svg v-if="isIncome(r)" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
            </div>

            <div class="record-main">
              <div class="record-head">
                <div class="record-title-wrap">
                  <strong class="record-title">{{ recordLabel(r) }}</strong>
                  <span class="record-type-tag">{{ typeBadgeLabel(r) }}</span>
                </div>
                <div class="record-amount-wrap">
                  <span class="record-amount">{{ isIncome(r) ? '+' : '-' }}¥{{ fmtMoney(recordAmount(r)) }}</span>
                </div>
              </div>

              <div class="record-meta">
                <span v-if="isAdmin" class="meta-chip meta-chip--user">{{ displayUser(r) }}</span>
                <time class="meta-time">{{ fmtShortTime(r.created_at) }}</time>
              </div>

              <div v-if="r.order_no || r.record_no" class="record-ids">
                <span v-if="r.order_no" class="id-line">
                  <em>订单</em>{{ r.order_no }}
                </span>
                <span v-if="r.record_no" class="id-line">
                  <em>流水</em>{{ r.record_no }}
                </span>
              </div>

              <p v-if="r.reason_message" class="record-remark">{{ r.reason_message }}</p>
              <p v-else-if="r.remark && r.remark !== recordLabel(r)" class="record-remark">{{ r.remark }}</p>
            </div>
          </article>
        </template>
        <div v-else-if="!loading" class="empty-state">
          <div class="empty-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <p class="empty-title">暂无消费记录</p>
          <p class="empty-hint">调整筛选条件或稍后再试</p>
        </div>
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

.panel-toolbar {
  background: linear-gradient(180deg, #fcfdff 0%, #f8faff 100%);
  border-bottom: 1px solid #eef2f7;
}

.filter-form {
  padding: 18px 22px 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0 14px;
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 12px;
  margin-right: 0;
}

.filter-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: var(--cp-text-3);
  line-height: 1.2;
  padding-bottom: 6px;
}

.filter-item {
  margin-bottom: 12px;
}

.filter-item--user {
  min-width: 220px;
}

.filter-item--date {
  min-width: 280px;
}

.filter-item--actions :deep(.el-form-item__label) {
  visibility: hidden;
}

.filter-control {
  width: 160px;
}

.filter-item--user .filter-control {
  width: 220px;
}

.filter-item--date .filter-control,
.filter-date {
  width: 280px !important;
}

.filter-form :deep(.el-input__wrapper),
.filter-form :deep(.el-select__wrapper) {
  border-radius: 10px;
  box-shadow: 0 0 0 1px var(--cp-border) inset;
}

.filter-form :deep(.el-input__wrapper:hover),
.filter-form :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(47, 109, 246, 0.35) inset;
}

.filter-form :deep(.el-input__wrapper.is-focus),
.filter-form :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--cp-primary) inset;
}

.filter-actions {
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
}

.filter-form :deep(.el-button--primary) {
  --el-button-bg-color: var(--cp-primary);
  --el-button-border-color: var(--cp-primary);
  --el-button-hover-bg-color: #2558d4;
  --el-button-hover-border-color: #2558d4;
  border-radius: 10px;
  padding: 0 22px;
  font-weight: 600;
}

.filter-form :deep(.el-button:not(.el-button--primary)) {
  border-radius: 10px;
  font-weight: 600;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px 12px;
  border-bottom: 1px solid #f0f2f7;
}

.list-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--cp-text);
}

.list-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--cp-text-3);
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
}

.record-list {
  padding: 14px 16px 8px;
  min-height: 200px;
}

.record-list :deep(.el-loading-mask) {
  border-radius: 0 0 12px 12px;
}

.record-card {
  display: flex;
  gap: 16px;
  padding: 16px 18px;
  margin-bottom: 10px;
  border-radius: 14px;
  border: 1px solid #eef2f7;
  background: #fff;
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.record-card:last-child {
  margin-bottom: 0;
}

.record-card:hover {
  border-color: #c7d7ff;
  box-shadow: 0 8px 24px rgba(47, 109, 246, 0.08);
  transform: translateY(-1px);
}

.record-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.record-card.is-income .record-icon {
  color: #22a858;
  background: linear-gradient(145deg, #ecfdf3, #d1fae5);
}

.record-card.is-expense .record-icon {
  color: #e85d5d;
  background: linear-gradient(145deg, #fff1f2, #ffe4e6);
}

.record-main {
  min-width: 0;
  flex: 1;
}

.record-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.record-title-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.record-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--cp-text);
  line-height: 1.3;
}

.record-type-tag {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--cp-primary);
  background: rgba(47, 109, 246, 0.08);
}

.record-amount-wrap {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 10px;
  background: #f8fafc;
}

.record-card.is-income .record-amount-wrap {
  background: #ecfdf3;
}

.record-card.is-expense .record-amount-wrap {
  background: #fff1f2;
}

.record-amount {
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.2px;
}

.record-card.is-income .record-amount { color: #16a34a; }
.record-card.is-expense .record-amount { color: #dc2626; }

.record-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
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

.meta-time {
  font-size: 12px;
  color: var(--cp-text-3);
}

.record-ids {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8faff;
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

.record-remark {
  margin: 10px 0 0;
  padding: 8px 12px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  border-radius: 8px;
  background: #fafbff;
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
    font-size: 15px;
  }

  .panel-toolbar {
    border-bottom: none;
  }

  .filter-form.filter-form--narrow {
    --el-font-size-base: 12px;
    --el-form-label-font-size: 10px;
    --el-component-size-small: 26px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 8px;
    row-gap: 0;
    padding: 8px 10px 4px;
    align-items: end;
  }

  .filter-form.filter-form--narrow .filter-item--full {
    grid-column: 1 / -1;
  }

  .filter-form.filter-form--narrow .filter-item--half {
    min-width: 0;
    width: auto;
  }

  .filter-form.filter-form--narrow.el-form--inline :deep(.el-form-item) {
    display: flex;
    flex-direction: column;
    margin-right: 0;
    vertical-align: unset;
  }

  .filter-form.filter-form--narrow :deep(.el-form-item) {
    margin-bottom: 6px;
    width: 100%;
  }

  .filter-form.filter-form--narrow :deep(.el-form-item__label) {
    font-size: 10px !important;
    font-weight: 500 !important;
    line-height: 1.15;
    padding-bottom: 2px !important;
    height: auto !important;
  }

  .filter-form.filter-form--narrow :deep(.el-form-item__content) {
    line-height: 1;
  }

  .filter-form.filter-form--narrow :deep(.el-input__wrapper),
  .filter-form.filter-form--narrow :deep(.el-select__wrapper) {
    min-height: 26px !important;
    height: 26px;
    padding: 0 8px;
    font-size: 12px !important;
  }

  .filter-form.filter-form--narrow :deep(.el-select__placeholder),
  .filter-form.filter-form--narrow :deep(.el-select__selected-item),
  .filter-form.filter-form--narrow :deep(.el-input__inner) {
    font-size: 12px !important;
  }

  /* 订单号输入框 */
  .filter-form.filter-form--narrow :deep(.filter-order-input .el-input__wrapper) {
    min-height: 26px !important;
    height: 26px;
    padding: 0 8px;
    font-size: 12px !important;
  }

  .filter-form.filter-form--narrow :deep(.filter-order-input .el-input__wrapper input),
  .filter-form.filter-form--narrow :deep(.filter-order-input .el-input__inner) {
    font-size: 12px !important;
    height: 24px;
    line-height: 24px;
  }

  .filter-form.filter-form--narrow :deep(.filter-order-input .el-input__wrapper input::placeholder),
  .filter-form.filter-form--narrow :deep(.filter-order-input .el-input__inner::placeholder) {
    font-size: 12px !important;
    color: #b0b8c6;
  }

  .filter-form.filter-form--narrow :deep(.filter-item--order .el-form-item__label),
  .filter-form.filter-form--narrow :deep(.filter-item--date .el-form-item__label) {
    font-size: 10px !important;
  }

  /* 时间范围 */
  .filter-form.filter-form--narrow :deep(.filter-date.el-date-editor--daterange) {
    width: 100% !important;
    max-width: 100%;
    height: 26px !important;
    --el-date-editor-width: 100%;
    font-size: 12px !important;
  }

  .filter-form.filter-form--narrow :deep(.filter-date.el-date-editor .el-input__wrapper) {
    min-height: 26px !important;
    height: 26px;
    padding: 0 6px;
    width: 100% !important;
    box-sizing: border-box;
    font-size: 12px !important;
  }

  .filter-form.filter-form--narrow :deep(.filter-date .el-input__inner) {
    font-size: 12px !important;
    height: 24px;
    line-height: 24px;
  }

  .filter-form.filter-form--narrow :deep(.filter-date .el-input__inner::placeholder) {
    font-size: 11px !important;
    color: #b0b8c6;
  }

  .filter-form.filter-form--narrow :deep(.el-date-editor.el-input__wrapper) {
    min-height: 26px !important;
    height: 26px;
    padding: 0 6px;
    width: 100% !important;
    box-sizing: border-box;
  }

  .filter-form.filter-form--narrow :deep(.el-range-input) {
    font-size: 11px !important;
    height: 22px;
    line-height: 22px;
    width: 38% !important;
  }

  .filter-form.filter-form--narrow :deep(.el-range-input::placeholder) {
    font-size: 11px !important;
    color: #b0b8c6;
  }

  .filter-form.filter-form--narrow :deep(.el-range-separator) {
    font-size: 10px !important;
    line-height: 24px;
    padding: 0 2px;
    flex: none;
  }

  .filter-form.filter-form--narrow :deep(.el-range__icon),
  .filter-form.filter-form--narrow :deep(.el-range__close-icon) {
    font-size: 12px;
    line-height: 24px;
  }

  .filter-form.filter-form--narrow :deep(.el-button) {
    font-size: 12px !important;
    height: 28px !important;
    padding: 0 10px !important;
    font-weight: 500;
  }

  .filter-form.filter-form--narrow .filter-control,
  .filter-form.filter-form--narrow .filter-item--user .filter-control,
  .filter-form.filter-form--narrow .filter-item--date .filter-control,
  .filter-form.filter-form--narrow .filter-date {
    width: 100% !important;
  }

  .filter-form.filter-form--narrow .filter-item--actions :deep(.el-form-item__label) {
    display: none;
  }

  .filter-form.filter-form--narrow .filter-actions {
    width: 100%;
    gap: 6px;
  }

  .filter-form.filter-form--narrow .filter-actions .el-button {
    flex: 1;
  }

  .list-header {
    padding: 10px 12px 8px;
  }

  .list-title {
    font-size: 13px;
  }

  .list-count {
    font-size: 11px;
    padding: 2px 8px;
  }

  .record-list {
    padding: 8px 10px 6px;
    min-height: 160px;
  }

  .record-card {
    padding: 10px 12px;
    gap: 10px;
    margin-bottom: 8px;
    border-radius: 10px;
  }

  .record-card:hover {
    transform: none;
  }

  .record-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }

  .record-icon svg {
    width: 18px;
    height: 18px;
  }

  .record-head {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .record-title {
    font-size: 14px;
  }

  .record-type-tag {
    font-size: 10px;
    padding: 1px 6px;
  }

  .record-amount-wrap {
    align-self: center;
    padding: 4px 8px;
  }

  .record-amount {
    font-size: 14px;
  }

  .record-meta {
    margin-top: 6px;
    gap: 6px;
  }

  .meta-chip {
    font-size: 11px;
    padding: 2px 8px;
  }

  .meta-time {
    font-size: 11px;
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
</style>
