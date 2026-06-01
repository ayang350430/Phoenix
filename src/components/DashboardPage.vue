<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])
import bannerBg from '../assets/banner_gzt.png'
import iconPin from '../assets/batch-submit_pl.png'
import iconYuedu from '../assets/read-task_yd.png'
import iconDianzan from '../assets/like-task_dz.png'
import iconBao from '../assets/exposure-task_bg.png'
import iconYan from '../assets/pre-check_jy.png'
import iconXiadan from '../assets/order-record_xd.png'

const router = useRouter()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { activeNav, isAdmin, isAgent, roleLabel, userName, userInitial, userAvatar, balance, getToken, fetchBalance, openUserDrawer, refreshKey } = ws
const showActivityAndFlow = computed(() => isAdmin.value || isAgent.value)

// ========== 应用 & 导航 ==========
const allApps = [
  { name: '批量提交', tone: 'pink', icon: '批', img: iconPin },
  { name: '阅读任务', tone: 'blue', icon: '阅', img: iconYuedu },
  { name: '点赞任务', tone: 'purple', icon: '赞', img: iconDianzan },
  { name: '曝光任务', tone: 'cyan', icon: '曝', img: iconBao },
  { name: '预校验', tone: 'green', icon: '验', img: iconYan },
  { name: '下单记录', tone: 'orange', icon: '单', img: iconXiadan, adminOnly: true }
]
const apps = computed(() => isAdmin.value ? allApps : allApps.filter(a => !a.adminOnly))

const activeTodo = ref('全部')
const dashLoading = ref(false)


// 底部卡片导航
const bottomNavs = ['数据概览', '类型汇总', '最近订单', '最近批次']
const activeBottomNav = ref('数据概览')


const appTypeMap = {
  '批量提交': 'read',
  '阅读任务': 'read',
  '点赞任务': 'like',
  '曝光任务': 'impression',
  '预校验': 'read'
}

function handleApp(app) {
  const type = appTypeMap[app.name]
  if (type) { router.push({ path: '/batch', query: { type } }); return }
  if (app.name === '下单记录') { router.push('/records'); return }
}

// ========== 仪表盘真实数据 ==========
const notifications = ref([])
const recentOrders = ref([])
const recentRecords = ref([])
const recentBatches = ref([])
const stats = ref({ total_batches: 0, total_orders: 0, by_type: [], by_status: [], balance: 0 })
const totalOrders = ref(0)
const totalBatches = ref(0)
const dailyStats = ref([])

// 类型映射
const typeMap = { read: '阅读', like: '点赞', impression: '曝光', collect: '收藏', comment: '评论' }
const statusMap = {
  pending: '待处理', processing: '进行中', completed: '已完成',
  failed: '失败', refunded: '已退款', partial_completed: '部分完成',
  cancelled: '已取消', stopped: '已停止'
}

const recordTypeMap = {
  order_charge: '订单扣款', recharge: '充值', refund: '退款',
  admin_add: '管理员加款', admin_deduct: '管理员扣款',
  supplement_charge: '补单扣款', supplement_refund: '补单退款',
  agent_commission: '下级下单分润', agent_commission_refund: '下级退款扣回分润',
  agent_transfer_out: '划款给下级', agent_transfer_in: '上级代理划款'
}

function formatType(t) { return typeMap[t] || t || '其他' }
function pn(item) {
  if (item.product_name) return item.product_name.replace(/^小红书/, '')
  return formatType(item.target_type)
}
function formatStatus(s) { return statusMap[s] || s || '-' }
function formatRecordType(r) { return r.remark || recordTypeMap[r.record_type] || r.record_type || '-' }
function isIncomeRecord(r) { return r.direction === 'in' || r.direction === 'credit' }
function recordAmount(r) { return parseFloat(r.actual_paid_amount || 0).toFixed(2) }
function recordTone(r) { return isIncomeRecord(r) ? 'income' : 'expense' }

// 通知类型配置
const notifyConf = {
  recharge:         { icon: '💰', label: '充值', color: '#42c978', bg: '#e8faf0' },
  order_ok:         { icon: '✅', label: '订单', color: '#42c978', bg: '#e8faf0' },
  order_fail:       { icon: '❌', label: '订单', color: '#ff4d4f', bg: '#fff1f0' },
  batch_ok:         { icon: '📦', label: '批次', color: '#42c978', bg: '#e8faf0' },
  batch_fail:       { icon: '📦', label: '批次', color: '#ff4d4f', bg: '#fff1f0' },
  admin_supplement: { icon: '📋', label: '审核', color: '#f5a623', bg: '#fff7e6' }
}
function nc(type) { return notifyConf[type] || notifyConf.order_ok }

const notifyTabs = computed(() => {
  const list = notifications.value
  const all = list.length
  const recharge = list.filter(n => n.type === 'recharge').length
  const order = list.filter(n => n.type.startsWith('order_') || n.type.startsWith('batch_')).length
  const admin = list.filter(n => n.type === 'admin_supplement').length
  const tabs = [['全部', all], ['充值', recharge], ['订单', order]]
  if (admin > 0) tabs.push(['审核', admin])
  return tabs
})

const filteredNotifications = computed(() => {
  const tab = activeTodo.value
  if (tab === '全部') return notifications.value
  if (tab === '充值') return notifications.value.filter(n => n.type === 'recharge')
  if (tab === '订单') return notifications.value.filter(n => n.type.startsWith('order_') || n.type.startsWith('batch_'))
  if (tab === '审核') return notifications.value.filter(n => n.type === 'admin_supplement')
  return notifications.value
})

// 统计卡片
const statCards = computed(() => {
  const byStatus = stats.value.by_status || []
  const completed = byStatus.find(s => s.order_status === 'completed')?.count || 0
  const failed = byStatus.find(s => s.order_status === 'failed')?.count || 0
  const cards = [
    { value: stats.value.total_orders || 0, label: '总订单数' },
    { value: stats.value.total_batches || 0, label: '总批次数' },
    { value: completed, label: '已完成' }
  ]
  // 代理端不显示「异常订单」
  if (!isAgent.value) cards.push({ value: failed, label: '异常订单' })
  return cards
})

// ========== ECharts 折线图 ==========
const chartRef = ref(null)
let chartInstance = null

function initChart() {
  if (!chartRef.value) return
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartRef.value)
  updateChart()
}

function updateChart() {
  if (!chartInstance) return
  const data = dailyStats.value
  const dates = data.map(d => {
    const dt = new Date(d.date + 'T00:00:00')
    return `${dt.getMonth() + 1}/${dt.getDate()}`
  })
  const counts = data.map(d => d.count)

  chartInstance.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#e8edf4',
      borderWidth: 1,
      textStyle: { color: '#425066', fontSize: 13 },
      formatter: params => {
        const p = params[0]
        return `<strong>${p.name}</strong><br/>订单数：<strong style="color:#8b7bf7">${p.value}</strong>`
      }
    },
    grid: { left: 45, right: 20, top: 25, bottom: 30, containLabel: false },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e8edf4' } },
      axisLabel: { color: '#9aa5b5', fontSize: 12 },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#f0f2f5', type: 'dashed' } },
      axisLabel: { color: '#9aa5b5', fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    series: [{
      name: '订单数',
      data: counts,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 8,
      showSymbol: true,
      lineStyle: { color: '#8b7bf7', width: 3 },
      itemStyle: { color: '#8b7bf7', borderColor: '#fff', borderWidth: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(139, 123, 247, 0.35)' },
          { offset: 1, color: 'rgba(139, 123, 247, 0.03)' }
        ])
      },
      label: { show: true, position: 'top', color: '#8b7bf7', fontWeight: 700, fontSize: 12 }
    }]
  })
}

function handleChartResize() {
  chartInstance?.resize()
}

watch(dailyStats, () => {
  if (activeBottomNav.value === '数据概览') {
    nextTick(() => { if (!chartInstance) initChart(); else updateChart() })
  }
})

watch(activeBottomNav, val => {
  if (val === '数据概览') {
    nextTick(() => {
      if (chartInstance) { chartInstance.dispose(); chartInstance = null }
      initChart()
    })
  }
})

// 按类型汇总
const typeCards = computed(() => {
  const byType = stats.value.by_type || []
  return byType.map(t => [t.product_name ? t.product_name.replace(/^小红书/, '') : formatType(t.target_type), `${t.count} 单`])
})

async function fetchDashboard() {
  dashLoading.value = true
  try {
    const res = await fetch('/api/tasks/dashboard', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      const d = data.data
      stats.value = d.stats || stats.value
      notifications.value = d.notifications || []
      recentOrders.value = d.recent_orders || []
      recentRecords.value = d.recent_records || []
      recentBatches.value = d.recent_batches || []
      totalOrders.value = d.total_orders || 0
      totalBatches.value = d.total_batches || 0
      dailyStats.value = d.daily_stats || []
    }
  } catch { /* ignore */ }
  finally { dashLoading.value = false }
}

function formatTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return isToday ? `今天 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

// ========== 响应刷新 ==========
watch(refreshKey, () => {
  activeTodo.value = '全部'
  fetchDashboard()
})

// ========== 生命周期 ==========
onMounted(() => {
  fetchDashboard()
  window.addEventListener('resize', handleChartResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleChartResize)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <section class="dash-grid" :class="{ 'regular-user-dashboard': !showActivityAndFlow }">
    <!-- Mobile Hero Banner -->
    <section class="mobile-hero">
      <div class="mh-content">
        <h2>智能与数字化<br/>工具</h2>
        <p>数据工作台专业版</p>
        <button type="button" @click="router.push('/batch')">立即开始</button>
      </div>
      <div class="mh-deco"></div>
    </section>

    <!-- Banner (desktop) -->
    <section class="dash-banner">
      <img :src="bannerBg" alt="Banner" class="banner-img" />
    </section>

    <section class="desktop-overview">
      <div class="overview-copy">
        <span class="overview-eyebrow">工作概览</span>
        <h1>{{ userName }}，今天继续推进任务</h1>
        <p>快速查看账户余额、任务数据和最新动态，常用工具都在这里。</p>
      </div>
      <div class="overview-metrics" aria-label="首页数据概览"
        :style="{ gridTemplateColumns: `minmax(130px, 1.25fr) repeat(${statCards.length}, minmax(82px, 1fr))` }">
        <div class="overview-balance">
          <span>账户余额</span>
          <strong>¥{{ balance.toFixed(2) }}</strong>
        </div>
        <div v-for="stat in statCards" :key="stat.label" class="overview-stat">
          <strong>{{ stat.value }}</strong>
          <span>{{ stat.label }}</span>
        </div>
      </div>
      <button type="button" class="overview-action" @click="router.push('/batch')">去下单</button>
    </section>

    <section class="card apps-card">
      <div class="card-title">
        <h2>我的应用</h2>
        <button type="button" @click="router.push('/batch')">全部应用</button>
      </div>
      <div class="app-grid">
        <button v-for="app in apps" :key="app.name" type="button" class="app-item" @click="handleApp(app)">
          <span class="app-icon">
            <img :src="app.img" :alt="app.name" />
          </span>
          <strong>{{ app.name }}</strong>
          <span class="app-arrow" aria-hidden="true">›</span>
        </button>
      </div>
    </section>

    <!-- 最新动态 -->
    <section v-if="showActivityAndFlow" class="card todo-card">
      <div class="card-title">
        <h2>最新动态</h2>
        <div class="todo-tabs">
          <button
            v-for="tab in notifyTabs"
            :key="tab[0]"
            :class="{ active: activeTodo === tab[0] }"
            @click="activeTodo = tab[0]"
          >{{ tab[0] }}<span class="tab-count">({{ tab[1] }})</span></button>
        </div>
      </div>
      <ul class="notify-list" v-if="filteredNotifications.length">
        <li v-for="n in filteredNotifications" :key="n.id" :class="'ntype-' + n.type">
          <span class="notify-icon" :style="{ background: nc(n.type).bg, color: nc(n.type).color }">{{ nc(n.type).icon }}</span>
          <div class="notify-body">
            <div class="notify-head">
              <p class="notify-title">{{ n.title }}</p>
              <span class="notify-time">{{ formatTime(n.time) }}</span>
            </div>
            <p v-if="n.desc" class="notify-desc">{{ n.desc }}</p>
          </div>
        </li>
      </ul>
      <p v-else class="empty-hint">暂无通知</p>
    </section>

    <aside v-if="showActivityAndFlow" class="side-column">
      <section class="profile-card">
        <button type="button" class="avatar large avatar-button" @click="openUserDrawer()">
          <img v-if="userAvatar" :src="userAvatar" :alt="userName" class="avatar-img" />
          <span v-else class="avatar-initial">{{ userInitial }}</span>
        </button>
        <div>
          <h2>{{ userName }} <span class="role-badge small" :class="isAdmin ? 'admin' : isAgent ? 'agent' : 'user'">{{ roleLabel }}</span></h2>
          <p>余额 ¥{{ balance.toFixed(2) }}</p>
        </div>
        <time>{{ new Date().toLocaleTimeString() }}<br />{{ ['日','一','二','三','四','五','六'][new Date().getDay()] }}</time>
      </section>

      <!-- 最近账务记录 -->
      <section v-if="showActivityAndFlow" class="card list-card">
        <div class="card-title">
          <h2>余额流水</h2>
        </div>
        <div v-if="recentRecords.length" class="balance-flow-list">
          <div
            v-for="r in recentRecords"
            :key="r.id"
            class="balance-flow-item"
            :class="recordTone(r)"
          >
            <span class="flow-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" focusable="false">
                <path class="bag-body" d="M9.4 13.8c1.2-2.1 3.1-3.4 6.6-3.4s5.4 1.3 6.6 3.4l2.4 4.3c2.3 4.1-.2 8.1-5 8.1h-8c-4.8 0-7.3-4-5-8.1l2.4-4.3Z" />
                <path class="bag-neck" d="M12.2 7.4c1.2.8 6.4.8 7.6 0l-1.9 3.2h-3.8l-1.9-3.2Z" />
                <path class="coin" d="M22.6 10.9a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Z" />
                <path class="yuan" d="M13 15.3h2.1l1 1.6 1-1.6h2.1l-1.7 2.6h1.4v1.4h-1.8v1h1.8v1.4h-1.8v1.5h-2v-1.5h-1.8v-1.4h1.8v-1h-1.8v-1.4h1.4L13 15.3Z" />
              </svg>
            </span>
            <div class="flow-main">
              <strong>{{ formatRecordType(r) }}</strong>
              <time>{{ formatTime(r.created_at) }}</time>
            </div>
            <strong class="flow-amount">
              {{ isIncomeRecord(r) ? '+' : '-' }}¥{{ recordAmount(r) }}
            </strong>
          </div>
        </div>
        <p v-else class="empty-hint">暂无记录</p>
      </section>
    </aside>

    <!-- 底部导航卡片 -->
    <section class="card bottom-card">
      <div class="bottom-tabs">
        <button
          v-for="nav in bottomNavs"
          :key="nav"
          type="button"
          :class="{ active: activeBottomNav === nav }"
          @click="activeBottomNav = nav"
        >{{ nav }}</button>
      </div>

      <!-- 数据概览 -->
      <div v-if="activeBottomNav === '数据概览'" class="bottom-content">
        <div class="chart-stats-row">
          <div v-for="stat in statCards" :key="stat.label" class="chart-stat-item">
            <strong>{{ stat.value }}</strong>
            <span>{{ stat.label }}</span>
          </div>
        </div>
        <div v-if="dailyStats.some(d => d.count > 0)" ref="chartRef" class="echarts-container"></div>
        <p v-else class="empty-hint">暂无数据</p>
      </div>

      <!-- 类型汇总 -->
      <div v-else-if="activeBottomNav === '类型汇总'" class="bottom-content">
        <div class="yearly-grid" v-if="typeCards.length">
          <span v-for="item in typeCards" :key="item[0]"><strong>{{ item[0] }}</strong>{{ item[1] }}</span>
        </div>
        <p v-else class="empty-hint">暂无类型数据</p>
      </div>

      <!-- 最近订单 -->
      <div v-else-if="activeBottomNav === '最近订单'" class="bottom-content bottom-list">
        <ul v-if="recentOrders.length">
          <li v-for="o in recentOrders" :key="o.id">
            <span>{{ pn(o) }} — {{ o.title || o.note_url || o.order_no }}</span>
            <time>{{ formatTime(o.created_at) }}</time>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无订单</p>
      </div>

      <!-- 最近批次 -->
      <div v-else-if="activeBottomNav === '最近批次'" class="bottom-content bottom-list">
        <ul v-if="recentBatches.length">
          <li v-for="b in recentBatches" :key="b.id">
            <span>批次 {{ b.batch_no || b.batch_id }}</span>
            <time>{{ formatTime(b.created_at) }}</time>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无批次</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dash-grid {
  --dashboard-main-row-height: clamp(380px, calc(100vh - 260px), 460px);
  padding: 18px 28px 30px;
  display: grid;
  grid-template-columns: 1.05fr 1.35fr 0.92fr;
  gap: 16px;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

/* ========== Banner ========== */

.mobile-hero {
  display: none;
}

.dash-banner {
  grid-column: 1 / -1;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(21, 32, 51, 0.08);
  display: none;
}

.banner-img {
  display: block;
  width: 100%;
  height: auto;
}

.card,
.profile-card {
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e9eef6;
  box-shadow: 0 12px 30px rgba(21, 32, 51, 0.045);
  align-self: start;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, border-color 240ms ease;
}

.card:hover,
.profile-card:hover {
  transform: translateY(-2px);
  border-color: #dde5f1;
  box-shadow: 0 18px 36px rgba(21, 32, 51, 0.075);
}

.card {
  padding: 20px;
  align-self: start;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.card-title h2 {
  position: relative;
  padding-left: 10px;
  font-size: 18px;
  line-height: 1.2;
}

.card-title h2::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ee4d7a, #5b8def);
  transform: translateY(-50%);
}

.card-title button {
  color: #8b7bf7;
  font-weight: 800;
  transition: color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.card-title button:hover { color: #ee4d7a; transform: translateX(2px); }
.card-title button:active { transform: translateX(2px) scale(0.96); }

.desktop-overview {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(260px, 1.05fr) minmax(460px, 1.55fr) auto;
  align-items: center;
  gap: 18px;
  padding: 18px 22px;
  border: 1px solid #e6ecf5;
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(248, 251, 255, 0.98) 58%, rgba(255, 247, 250, 0.94)),
    radial-gradient(circle at 86% 0%, rgba(91, 141, 239, 0.12), transparent 34%);
  box-shadow: 0 14px 34px rgba(21, 32, 51, 0.055);
}

.overview-copy {
  min-width: 0;
}

.overview-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5b8def;
  font-size: 12px;
  font-weight: 900;
}

.overview-eyebrow::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #42c978;
  box-shadow: 0 0 0 4px rgba(66, 201, 120, 0.12);
}

.overview-copy h1 {
  margin: 6px 0 5px;
  color: #152033;
  font-size: 22px;
  line-height: 1.25;
}

.overview-copy p {
  margin: 0;
  color: #647184;
  font-size: 13px;
  line-height: 1.6;
}

.overview-metrics {
  display: grid;
  grid-template-columns: minmax(130px, 1.25fr) repeat(4, minmax(82px, 1fr));
  gap: 10px;
  min-width: 0;
}

.overview-balance,
.overview-stat {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 8px 20px rgba(21, 32, 51, 0.035);
}

.overview-balance span,
.overview-stat span {
  display: block;
  color: #8a95a8;
  font-size: 12px;
  line-height: 1.3;
}

.overview-balance strong,
.overview-stat strong {
  display: block;
  margin-top: 5px;
  color: #152033;
  font-size: 20px;
  line-height: 1.15;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-balance strong {
  color: #ee4d7a;
}

.overview-action {
  justify-self: end;
  min-width: 96px;
  height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  color: #fff;
  font-weight: 900;
  background: linear-gradient(135deg, #2f6df6, #5b8def);
  box-shadow: 0 12px 24px rgba(47, 109, 246, 0.24);
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease;
}

.overview-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 28px rgba(47, 109, 246, 0.28);
}

.overview-action:active {
  transform: translateY(0) scale(0.97);
}

.app-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px 8px 0;
}

.app-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  justify-items: start;
  gap: 12px;
  min-height: 74px;
  padding: 12px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fbfcff;
  color: #425066;
  text-align: left;
  transition: color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1), border-color 240ms ease, background 240ms ease, box-shadow 240ms ease;
}

.app-item:hover {
  border-color: #dfe7f4;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(21, 32, 51, 0.055);
}

.app-item:active { transform: translateY(-1px) scale(0.97); }

.app-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.app-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.app-item:hover .app-icon {
  transform: scale(1.06);
}

.app-item strong {
  min-width: 0;
  color: #243149;
  font-size: 14px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-arrow {
  color: #b4bdcb;
  font-size: 20px;
  line-height: 1;
}

.todo-card .card-title {
  padding-bottom: 12px;
  border-bottom: 1px solid #e8edf4;
}

.todo-tabs {
  display: flex;
  gap: 6px;
}

.todo-tabs button {
  position: relative;
  padding: 5px 9px;
  border-radius: 999px;
  color: #647184;
  font-weight: 700;
  transition: color 240ms ease, background 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.todo-tabs .active {
  background: #fff1f5;
  color: #ee4d7a;
  box-shadow: 0 8px 18px rgba(238, 77, 122, 0.12);
}

.todo-tabs button:hover { color: #ee4d7a; background: #fff7fa; }
.todo-tabs button:active { transform: scale(0.96); }

.notify-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px 8px 0;
}

.notify-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fbfcff;
  transition: background 200ms ease, transform 200ms ease, border-color 200ms ease;
  cursor: default;
}

.notify-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notify-list li:hover {
  border-color: #dfe7f4;
  background: #fff;
  transform: translateX(2px);
}

.notify-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 16px;
  flex-shrink: 0;
}

.notify-body {
  flex: 1;
  min-width: 0;
}

.notify-title {
  font-size: 13px;
  font-weight: 700;
  color: #152033;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-desc {
  font-size: 12px;
  color: #9aa5b5;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-time {
  font-size: 11px;
  color: #b0b8c6;
  white-space: nowrap;
  flex-shrink: 0;
}

.apps-card,
.todo-card {
  align-self: start;
  height: var(--dashboard-main-row-height);
  min-height: 0;
}

.empty-hint {
  text-align: center;
  min-height: 118px;
  padding: 24px 0;
  color: #9aa5b5;
  font-size: 14px;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.empty-hint::before {
  content: '';
  width: 34px;
  height: 34px;
  border: 1px dashed #d9e1ee;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(91, 141, 239, 0.08), rgba(238, 77, 122, 0.06));
}

.order-status {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  font-style: normal;
  margin-left: 6px;
}

.order-status.completed { background: #f0fff4; color: #42c978; }
.order-status.pending { background: #fff7e6; color: #f5a623; }
.order-status.processing { background: #eef3ff; color: #5b8def; }
.order-status.failed { background: #fff1f0; color: #ff4d4f; }
.order-status.refunded { background: #f6f8fc; color: #9aa5b5; }

.side-column {
  display: grid;
  gap: 16px;
  grid-template-rows: auto minmax(0, 1fr);
  height: var(--dashboard-main-row-height);
  min-height: 0;
  overflow: hidden;
}

.side-column .list-card {
  align-self: stretch;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.side-column .list-card ul {
  flex: 1;
  overflow-y: auto;
}

.balance-flow-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px 8px 0;
}

.app-grid,
.notify-list,
.balance-flow-list {
  scrollbar-width: thin;
  scrollbar-color: #cfd8e8 transparent;
}

.app-grid::-webkit-scrollbar,
.notify-list::-webkit-scrollbar,
.balance-flow-list::-webkit-scrollbar {
  width: 6px;
}

.app-grid::-webkit-scrollbar-thumb,
.notify-list::-webkit-scrollbar-thumb,
.balance-flow-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #cfd8e8;
}

.balance-flow-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 10px 12px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fbfcff;
  box-shadow: 0 6px 18px rgba(21, 32, 51, 0.035);
  transition: border-color 180ms ease, background 180ms ease, transform 180ms ease, box-shadow 180ms ease;
}

.balance-flow-item:hover {
  border-color: #dfe7f4;
  background: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(21, 32, 51, 0.06);
}

.flow-mark {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
}

.flow-mark svg {
  width: 24px;
  height: 24px;
  display: block;
  overflow: visible;
}

.balance-flow-item.income .flow-mark {
  background: #eafaf1;
}

.balance-flow-item.expense .flow-mark {
  background: #fff0f1;
}

.balance-flow-item.income .bag-body { fill: #28c57c; }
.balance-flow-item.income .bag-neck { fill: #14a864; }
.balance-flow-item.income .coin { fill: #ffd35a; }
.balance-flow-item.income .yuan { fill: #ffffff; }

.balance-flow-item.expense .bag-body { fill: #ff6b75; }
.balance-flow-item.expense .bag-neck { fill: #ef4756; }
.balance-flow-item.expense .coin { fill: #ffc85a; }
.balance-flow-item.expense .yuan { fill: #ffffff; }

.flow-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.flow-main strong {
  min-width: 0;
  color: #425066;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-main time {
  color: #9aa5b5;
  font-size: 12px;
  line-height: 1.2;
}

.flow-amount {
  justify-self: end;
  font-size: 15px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.balance-flow-item.income .flow-amount { color: #18b66e; }
.balance-flow-item.expense .flow-amount { color: #ff4d4f; }

.profile-card {
  padding: 18px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  color: #fff;
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.2), transparent 26%),
    linear-gradient(135deg, #ee4d7a, #8b7bf7 50%, #5b8def);
  overflow: hidden;
  min-height: 94px;
  min-width: 0;
}

.profile-card:active { transform: translateY(-1px) scale(0.995); }

.profile-card .avatar {
  width: 58px;
  height: 58px;
  border: 2.5px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  font-weight: 900;
  overflow: hidden;
  cursor: pointer;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.profile-card .avatar:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 8px 20px rgba(21, 32, 51, 0.18);
}

.profile-card .avatar .avatar-img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.profile-card .avatar .avatar-initial {
  font-size: 24px;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;
}

.profile-card h2 { font-size: 20px; }

.profile-card p,
.profile-card time { color: rgba(255, 255, 255, 0.82); }

/* ========== 角色徽章 ========== */

.role-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.role-badge.admin { background: linear-gradient(135deg, #ee4d7a, #ff7eb3); color: #fff; }
.role-badge.agent { background: linear-gradient(135deg, #8b7bf7, #a78bfa); color: #fff; }
.role-badge.user { background: rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.9); }

/* ========== 折线图 ========== */

.chart-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.chart-stat-item {
  text-align: center;
  padding: 12px 8px;
  border: 1px solid rgba(223, 231, 244, 0.72);
  border-radius: 8px;
  background: #f9fafc;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, border-color 240ms ease;
}

.chart-stat-item:hover {
  border-color: #d5deed;
  transform: translateY(-2px);
  box-shadow: 0 10px 22px rgba(21, 32, 51, 0.06);
}
.chart-stat-item:nth-child(1) { background: #fff3f7; }
.chart-stat-item:nth-child(2) { background: #eff8f3; }
.chart-stat-item:nth-child(3) { background: #f1eeff; }
.chart-stat-item:nth-child(4) { background: #fff1f0; }

.chart-stat-item strong { display: block; font-size: 22px; color: #152033; line-height: 1.3; font-variant-numeric: tabular-nums; }
.chart-stat-item span { font-size: 12px; color: #9aa5b5; }

.echarts-container {
  width: 100%;
  height: 240px;
  border-radius: 8px;
}

.yearly-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.yearly-grid span {
  padding: 14px;
  border: 1px solid #e8eef8;
  border-radius: 8px;
  background: #f4f7ff;
  color: #425066;
  text-align: center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), background 240ms ease, box-shadow 240ms ease;
}

.yearly-grid span:hover {
  transform: translateY(-2px);
  background: #eef3ff;
  box-shadow: 0 10px 22px rgba(91, 141, 239, 0.1);
}

.yearly-grid strong { margin-right: 6px; color: #152033; }

.list-card ul {
  list-style: none;
  display: flex;
  flex-direction: column;

  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.list-card li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  color: #647184;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), color 240ms ease;
}

.list-card li:hover { color: #425066; transform: translateX(4px); }

.list-card li::before {
  content: '';
  flex: 0 0 auto;
  width: 5px; height: 5px;
  margin-top: 8px;
  border-radius: 50%;
  background: #dbe3f0;
}

.list-card li span { flex: 1 1 auto; min-width: 0; line-height: 1.7; }
.list-card time { flex: 0 0 auto; color: #9aa5b5; }

/* ========== 底部导航卡片 ========== */

.bottom-card {
  grid-column: 1 / -1;
  min-height: 246px;
  max-height: none;
  overflow: visible;
  margin-top: 4px;
  padding: 20px 22px 24px;
}

.bottom-tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e8edf4;
  margin-bottom: 16px;
}

.bottom-tabs button {
  position: relative;
  padding: 7px 18px;
  border-radius: 999px;
  color: #647184;
  font-weight: 700;
  font-size: 14px;
  transition: color 240ms ease, background 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.bottom-tabs button:hover { color: #8b7bf7; background: #f6f3ff; }
.bottom-tabs button:active { transform: scale(0.96); }

.bottom-tabs button.active {
  color: #fff;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  box-shadow: 0 6px 16px rgba(139, 123, 247, 0.22);
}

.bottom-content {
  min-height: 148px;
  animation: fadeSlideIn 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.bottom-content > .empty-hint {
  min-height: 132px;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.bottom-list ul { list-style: none; display: grid; gap: 10px; }

.bottom-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fbfcff;
  color: #647184;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), color 240ms ease, border-color 240ms ease, background 240ms ease;
}

.bottom-list li:hover {
  border-color: #dfe7f4;
  background: #fff;
  color: #425066;
  transform: translateX(2px);
}

.bottom-list li::before {
  content: '';
  flex: 0 0 auto;
  width: 5px; height: 5px;
  margin-top: 8px;
  border-radius: 50%;
  background: #dbe3f0;
}

.bottom-list li span { flex: 1 1 auto; min-width: 0; line-height: 1.7; }
.bottom-list time { flex: 0 0 auto; color: #9aa5b5; }

/* ========== 普通用户 PC 首页 ========== */

.dash-grid.regular-user-dashboard {
  --dashboard-main-row-height: clamp(360px, calc(100vh - 292px), 430px);
  grid-template-columns: minmax(420px, 0.86fr) minmax(0, 1.72fr);
  gap: 18px;
}

.regular-user-dashboard .desktop-overview {
  border-radius: 12px;
  padding: 20px 22px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.96) 55%, rgba(255, 246, 250, 0.94)),
    radial-gradient(circle at 94% 12%, rgba(47, 109, 246, 0.16), transparent 30%);
}

.regular-user-dashboard .apps-card,
.regular-user-dashboard .bottom-card {
  height: var(--dashboard-main-row-height);
  border-radius: 12px;
  box-shadow: 0 16px 38px rgba(21, 32, 51, 0.065);
}

.regular-user-dashboard .apps-card {
  grid-column: 1;
}

.regular-user-dashboard .bottom-card {
  grid-column: 2 / -1;
  margin-top: 0;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 252, 255, 0.96)),
    radial-gradient(circle at 100% 0%, rgba(91, 141, 239, 0.12), transparent 30%);
}

.regular-user-dashboard .bottom-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.regular-user-dashboard .chart-stats-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.regular-user-dashboard .echarts-container {
  height: min(210px, calc(var(--dashboard-main-row-height) - 176px));
}

.regular-user-dashboard .bottom-content > .empty-hint {
  min-height: 0;
  height: calc(var(--dashboard-main-row-height) - 164px);
}

/* ========== 响应式 ========== */

@media (max-width: 1180px) {
  .dash-grid { grid-template-columns: 1fr 1fr; }
  .dash-grid.regular-user-dashboard {
    grid-template-columns: 1fr 1fr;
  }

  .regular-user-dashboard .bottom-card {
    grid-column: auto;
  }

  .side-column {
    grid-column: span 2;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: minmax(0, 1fr);
  }

  .side-column .profile-card,
  .side-column .list-card {
    height: 100%;
  }

  .desktop-overview {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .overview-action {
    justify-self: start;
  }

  .dash-banner { border-radius: 10px; }
}

@media (max-width: 760px) {
  .dash-grid,
  .side-column { grid-template-columns: 1fr; }
  .dash-grid { padding: 14px; max-width: 100vw; box-sizing: border-box; gap: 14px; }
  .dash-grid.regular-user-dashboard {
    grid-template-columns: 1fr;
  }

  .regular-user-dashboard .apps-card,
  .regular-user-dashboard .bottom-card {
    grid-column: auto;
    height: auto;
  }

  .regular-user-dashboard .bottom-content > .empty-hint {
    height: auto;
    min-height: 132px;
  }

  .regular-user-dashboard .echarts-container {
    height: 240px;
  }

  .side-column {
    grid-column: auto;
    grid-template-rows: auto;
    height: auto;
  }
  .card { padding: 18px; min-width: 0; border-radius: 16px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
  .card:hover { transform: none; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
  .apps-card,
  .todo-card,
  .side-column .profile-card,
  .side-column .list-card {
    height: auto;
    min-height: auto;
  }

  .desktop-overview,
  .dash-banner { display: none; }

  /* ---- Mobile Hero Banner ---- */
  .mobile-hero {
    display: flex;
    grid-column: 1 / -1;
    position: relative;
    overflow: hidden;
    border-radius: 16px;
    background: linear-gradient(135deg, #1e40af 0%, #2563eb 40%, #3b82f6 100%);
    padding: 28px 24px;
    color: #fff;
    min-height: 155px;
    box-shadow: 0 8px 28px rgba(37, 99, 235, 0.25);
  }

  .mh-content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mh-content h2 {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.4;
    letter-spacing: 1px;
    margin: 0;
  }

  .mh-content p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    margin: 0;
  }

  .mh-content button {
    margin-top: 14px;
    width: fit-content;
    padding: 8px 24px;
    border-radius: 20px;
    background: #fff;
    color: #2563eb;
    font-size: 13px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .mh-deco {
    position: absolute;
    right: -20px;
    top: 50%;
    transform: translateY(-50%);
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid rgba(255, 255, 255, 0.12);
  }

  .mh-deco::after {
    content: '';
    position: absolute;
    right: -30px;
    top: -30px;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
  }

  /* ---- App grid mobile ---- */
  .app-grid {
    flex: initial;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px 14px;
    overflow: visible;
    padding: 0;
  }

  .app-item {
    grid-template-columns: 1fr;
    justify-items: center;
    min-height: auto;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: center;
    box-shadow: none;
  }

  .app-item:hover {
    background: transparent;
    box-shadow: none;
    transform: none;
  }

  .app-icon {
    width: 54px;
    height: 54px;
    border-radius: 16px;
  }

  .app-item:hover .app-icon {
    transform: none;
  }

  .app-item strong {
    font-size: 12px;
    color: #425066;
    white-space: normal;
  }

  .app-arrow {
    display: none;
  }

  .card-title h2 { font-size: 16px; }
  .card-title button { font-size: 13px; color: #9aa5b5; font-weight: 600; }

  /* ---- Notifications mobile ---- */
  .todo-card {
    display: flex;
    min-height: auto;
    max-height: none;
    overflow: visible;
  }
  .notify-list {
    max-height: 420px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0;
  }
  .tab-count {
    display: inline;
    font-size: 12px;
    opacity: 0.9;
  }
  .todo-tabs button { font-size: 13px; padding: 4px 8px; gap: 4px; }

  .notify-list { gap: 10px; }

  .notify-list li {
    padding: 14px 16px;
    border-radius: 14px;
    background: #f8fafc;
    border: 1px solid #eef1f5;
  }

  .notify-list li:hover { background: #f4f7fb; transform: none; }

  .notify-list li.ntype-recharge {
    background: linear-gradient(135deg, #eef8ff, #f0faff);
    border-color: #d6ecfa;
  }

  .notify-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    font-size: 18px;
    margin-top: 2px;
  }

  .notify-title {
    font-size: 15px;
    font-weight: 700;
    white-space: normal;
  }

  .notify-desc {
    white-space: normal;
    line-height: 1.5;
    margin-top: 6px;
    font-size: 13px;
  }

  .notify-time { font-size: 12px; }

  .chart-stats-row,
  .yearly-grid { grid-template-columns: repeat(2, 1fr); }

  .list-card li { align-items: flex-start; }
  .list-card li span { overflow-wrap: anywhere; word-break: normal; }
  .list-card time { font-size: 12px; }

  .balance-flow-item {
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 9px;
  }

  .flow-amount {
    grid-column: auto;
    justify-self: end;
    margin-top: 0;
    font-size: 14px;
  }

  .side-column { overflow: visible; }

  .side-column .list-card {
    display: flex;
  }

  .balance-flow-list {
    max-height: 360px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0;
  }

  .profile-card { border-radius: 16px; }

  .bottom-tabs {
    gap: 4px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
  }

  .bottom-tabs button {
    font-size: 13px;
    padding: 6px 14px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .bottom-list li span { overflow-wrap: anywhere; word-break: normal; }
  .bottom-list time { font-size: 12px; }
}
</style>
