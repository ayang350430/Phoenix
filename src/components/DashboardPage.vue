<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import DashboardAppIcon from './DashboardAppIcon.vue'

const router = useRouter()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { activeNav, isAdmin, isAgent, roleLabel, userName, userInitial, userAvatar, balance, getToken, fetchBalance, openUserDrawer, refreshKey } = ws
const showActivityAndFlow = computed(() => isAdmin.value || isAgent.value)

// ========== 应用 & 导航 ==========
const allApps = [
  { name: '批量提交', tone: 'pink', icon: 'batch' },
  { name: '阅读任务', tone: 'blue', icon: 'read' },
  { name: '点赞任务', tone: 'purple', icon: 'like' },
  { name: '曝光任务', tone: 'cyan', icon: 'impression' },
  { name: '预校验', tone: 'green', icon: 'validate' },
  { name: '下单记录', tone: 'orange', icon: 'records', adminOnly: true }
]
const apps = computed(() => isAdmin.value ? allApps : allApps.filter(a => !a.adminOnly))

const activeTodo = ref('全部')
const dashLoading = ref(false)


// 底部卡片导航
const bottomNavs = ['数据概览', '类型汇总']
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
const recentRecords = ref([])
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
function formatStatus(s) { return statusMap[s] || s || '-' }
function formatRecordType(r) { return r.remark || recordTypeMap[r.record_type] || r.record_type || '-' }
function isIncomeRecord(r) { return r.direction === 'in' || r.direction === 'credit' }

function recordAmount(r) {
  const raw = r.actual_paid_amount ?? r.net_amount ?? r.payable_amount ?? r.refund_amount ?? 0
  return Math.abs(parseFloat(raw) || 0).toFixed(2)
}
function recordTone(r) { return isIncomeRecord(r) ? 'income' : 'expense' }

// 通知类型配置
const notifyConf = {
  recharge: { icon: '💰', label: '充值', color: '#42c978', bg: '#e8faf0' },
  order_ok: { icon: '✅', label: '订单', color: '#42c978', bg: '#e8faf0' },
  order_fail: { icon: '❌', label: '订单', color: '#ff4d4f', bg: '#fff1f0' },
  batch_ok: { icon: '📦', label: '批次', color: '#42c978', bg: '#e8faf0' },
  batch_fail: { icon: '📦', label: '批次', color: '#ff4d4f', bg: '#fff1f0' },
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

// ========== ECharts 折线图（按需加载，避免首屏解析整包 echarts） ==========
const chartRef = ref(null)
let chartInstance = null
let echartsApi = null

async function loadEcharts() {
  if (echartsApi) return echartsApi
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers')
  ])
  core.use([
    charts.LineChart,
    components.GridComponent,
    components.TooltipComponent,
    renderers.CanvasRenderer
  ])
  echartsApi = core
  return echartsApi
}

async function initChart() {
  if (!chartRef.value) return
  const echarts = await loadEcharts()
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartRef.value)
  updateChart()
}

function updateChart() {
  if (!chartInstance || !echartsApi) return
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
        return `<strong>${p.name}</strong><br/>订单数：<strong style="color:#2f6df6">${p.value}</strong>`
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
      lineStyle: { color: '#2f6df6', width: 3 },
      itemStyle: { color: '#2f6df6', borderColor: '#fff', borderWidth: 2 },
      areaStyle: {
        color: new echartsApi.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(47, 109, 246, 0.28)' },
          { offset: 1, color: 'rgba(47, 109, 246, 0.03)' }
        ])
      },
      label: { show: true, position: 'top', color: '#2f6df6', fontWeight: 700, fontSize: 12 }
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
      recentRecords.value = d.recent_records || []
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
  echartsApi = null
})
</script>

<template>
  <section class="dash-grid" :class="{ 'regular-user-dashboard': !showActivityAndFlow }">
    <!-- 普通用户移动端横幅（管理员/代理首页不展示，避免顶栏下出现蓝色细线） -->
    <section v-if="!showActivityAndFlow" class="mobile-hero">
      <div class="mh-content">
        <h2>智能与数字化<br />工具</h2>
        <p>数据工作台专业版</p>
        <button type="button" @click="router.push('/batch')">立即开始</button>
      </div>
      <div class="mh-deco"></div>
    </section>

    <section class="dash-hero">
      <div class="dash-hero-text">
        <span class="dash-hero-badge">工作概览</span>
        <h1>{{ userName }}，欢迎回来</h1>
        <p>账户余额、任务数据与常用工具，一页掌握。</p>
        <button type="button" class="dash-hero-cta" @click="router.push('/batch')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          去下单
        </button>
      </div>
      <div class="dash-stat-grid" aria-label="首页数据概览">
        <div class="dash-stat-card dash-stat-card--balance">
          <span class="dash-stat-label">账户余额</span>
          <strong class="dash-stat-value">¥{{ balance.toFixed(2) }}</strong>
        </div>
        <div v-for="stat in statCards" :key="stat.label" class="dash-stat-card">
          <span class="dash-stat-label">{{ stat.label }}</span>
          <strong class="dash-stat-value">{{ stat.value }}</strong>
        </div>
      </div>
    </section>

    <section class="card apps-card">
      <div class="card-title">
        <h2>我的应用</h2>
        <button type="button" @click="router.push('/batch')">全部应用</button>
      </div>
      <div class="app-grid">
        <button v-for="app in apps" :key="app.name" type="button" class="app-item" @click="handleApp(app)">
          <DashboardAppIcon :type="app.icon" :tone="app.tone" />
          <strong>{{ app.name }}</strong>
        </button>
      </div>
    </section>

    <!-- 最新动态 -->
    <section v-if="showActivityAndFlow" class="card todo-card">
      <div class="card-title">
        <h2>最新动态</h2>
        <div class="todo-tabs">
          <button v-for="tab in notifyTabs" :key="tab[0]" :class="{ active: activeTodo === tab[0] }"
            @click="activeTodo = tab[0]">{{ tab[0] }}<span class="tab-count">({{ tab[1] }})</span></button>
        </div>
      </div>
      <ul class="notify-list" v-if="filteredNotifications.length">
        <li v-for="n in filteredNotifications" :key="n.id" :class="'ntype-' + n.type">
          <span class="notify-icon" :style="{ background: nc(n.type).bg, color: nc(n.type).color }">{{ nc(n.type).icon
            }}</span>
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
      <!-- <section class="profile-card">
        <button type="button" class="avatar large avatar-button" @click="openUserDrawer()">
          <img v-if="userAvatar" :src="userAvatar" :alt="userName" class="avatar-img" />
          <span v-else class="avatar-initial">{{ userInitial }}</span>
        </button>
        <div>
          <h2>{{ userName }} <span class="role-badge small" :class="isAdmin ? 'admin' : isAgent ? 'agent' : 'user'">{{
              roleLabel }}</span></h2>
          <p style="color: #333;margin-top: 6px; font-size: 14px;">余额 ¥{{ balance.toFixed(2) }}</p>
        </div>
        <time style="color:#333;font-weight: 600;">{{ new Date().toLocaleTimeString() }}<br />{{
          ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()] }}</time>
      </section> -->

      <!-- 最近账务记录 -->
      <section v-if="showActivityAndFlow" class="card list-card">
        <div class="card-title">
          <h2>余额流水</h2>
        </div>
        <div v-if="recentRecords.length" class="balance-flow-list">
          <div v-for="r in recentRecords" :key="r.id" class="balance-flow-item" :class="recordTone(r)">
            <span class="flow-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" focusable="false">
                <path class="bag-body"
                  d="M9.4 13.8c1.2-2.1 3.1-3.4 6.6-3.4s5.4 1.3 6.6 3.4l2.4 4.3c2.3 4.1-.2 8.1-5 8.1h-8c-4.8 0-7.3-4-5-8.1l2.4-4.3Z" />
                <path class="bag-neck" d="M12.2 7.4c1.2.8 6.4.8 7.6 0l-1.9 3.2h-3.8l-1.9-3.2Z" />
                <path class="coin" d="M22.6 10.9a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Z" />
                <path class="yuan"
                  d="M13 15.3h2.1l1 1.6 1-1.6h2.1l-1.7 2.6h1.4v1.4h-1.8v1h1.8v1.4h-1.8v1.5h-2v-1.5h-1.8v-1.4h1.8v-1h-1.8v-1.4h1.4L13 15.3Z" />
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
      <div class="bottom-card-toolbar">
        <div class="bottom-tabs" role="tablist" aria-label="数据视图切换">
          <button
            v-for="nav in bottomNavs"
            :key="nav"
            type="button"
            role="tab"
            class="bottom-tab"
            :class="{ active: activeBottomNav === nav }"
            :aria-selected="activeBottomNav === nav"
            @click="activeBottomNav = nav"
          >{{ nav }}</button>
        </div>
        <p class="bottom-toolbar-hint">
          {{ activeBottomNav === '数据概览' ? '近 7 日订单趋势' : '按任务类型统计' }}
        </p>
      </div>

      <!-- 数据概览 -->
      <div v-if="activeBottomNav === '数据概览'" class="bottom-content bottom-chart">
        <div v-if="dailyStats.some(d => d.count > 0)" ref="chartRef" class="echarts-container"></div>
        <p v-else class="empty-hint">暂无趋势数据</p>
      </div>

      <!-- 类型汇总 -->
      <div v-else-if="activeBottomNav === '类型汇总'" class="bottom-content">
        <div v-if="typeCards.length" class="type-stat-grid">
          <div v-for="item in typeCards" :key="item[0]" class="type-stat-card">
            <span class="type-stat-label">{{ item[0] }}</span>
            <strong class="type-stat-value">{{ item[1] }}</strong>
          </div>
        </div>
        <p v-else class="empty-hint">暂无类型数据</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dash-grid {
  --dash-primary: #2f6df6;
  --dash-text: #152033;
  --dash-muted: #647184;
  --dash-text-2: #425066;
  --dash-border: #e8edf4;
  --dash-radius: 14px;
  --dashboard-main-row-height: clamp(380px, calc(100vh - 260px), 460px);
  padding: 20px 24px 28px;
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(320px, 1.2fr) minmax(260px, 0.85fr);
  gap: 18px;
  max-width: 100%;
  overflow-x: hidden;
  box-sizing: border-box;
}

.mobile-hero {
  display: none;
}

.card,
.profile-card {
  border-radius: var(--dash-radius);
  background: #fff;
  border: 1px solid var(--dash-border);
  box-shadow: 0 8px 24px rgba(21, 32, 51, 0.04);
  align-self: start;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease, border-color 240ms ease;
}

.card {
  padding: 18px 20px 20px;
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
  font-size: 16px;
  font-weight: 700;
  color: var(--dash-text);
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
  background: var(--dash-primary);
  transform: translateY(-50%);
}

.card-title button {
  color: var(--dash-primary);
  font-size: 13px;
  font-weight: 700;
  transition: opacity 200ms ease;
}

.card-title button:hover {
  opacity: 0.8;
}

.card-title button:active {
  transform: translateX(2px) scale(0.96);
}

.dash-hero {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 20px;
  padding: 22px 24px;
  border: 1px solid var(--dash-border);
  border-radius: var(--dash-radius);
  background: #fff;
  box-shadow: 0 10px 28px rgba(21, 32, 51, 0.05);
}

.dash-hero-text {
  flex: 1 1 240px;
  min-width: 0;
}

.dash-hero-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--dash-primary);
  font-size: 12px;
  font-weight: 700;
}

.dash-hero-text h1 {
  margin: 10px 0 6px;
  color: var(--dash-text);
  font-size: 24px;
  font-weight: 800;
  line-height: 1.3;
}

.dash-hero-text p {
  margin: 0;
  color: var(--dash-muted);
  font-size: 14px;
  line-height: 1.55;
}

.dash-hero-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  height: 40px;
  padding: 0 20px;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  background: var(--goosd-primary);
  box-shadow: var(--goosd-btn-shadow);
  transition: transform 180ms ease, box-shadow 180ms ease, filter 180ms ease;
}

.dash-hero-cta:hover {
  transform: translateY(-1px);
  background: var(--goosd-primary-dark);
  box-shadow: var(--goosd-btn-shadow-hover);
}

.dash-stat-grid {
  flex: 2 1 420px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
  gap: 10px;
  min-width: 0;
  align-content: center;
}

.dash-stat-card {
  padding: 14px 16px;
  border: 1px solid var(--dash-border);
  border-radius: 12px;
  background: #f8fafc;
}

.dash-stat-card--balance {
  background: linear-gradient(135deg, rgba(47, 109, 246, 0.08), rgba(47, 109, 246, 0.02));
  border-color: rgba(47, 109, 246, 0.15);
}

.dash-stat-label {
  display: block;
  color: #8a95a8;
  font-size: 12px;
  font-weight: 600;
}

.dash-stat-value {
  display: block;
  margin-top: 6px;
  color: var(--dash-text);
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dash-stat-card--balance .dash-stat-value {
  color: var(--dash-primary);
}

.app-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
}

.app-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 86px;
  padding: 12px 8px;
  border: 1px solid var(--dash-border);
  border-radius: 12px;
  background: #f8fafc;
  color: var(--dash-text-2);
  text-align: center;
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.app-item:hover {
  border-color: rgba(47, 109, 246, 0.28);
  background: #fff;
  box-shadow: 0 4px 14px rgba(47, 109, 246, 0.1);
}

.app-item:active {
  transform: scale(0.98);
}

.app-item strong {
  width: 100%;
  color: var(--dash-text);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-card .card-title {
  flex-wrap: wrap;
  align-items: center;
  row-gap: 10px;
  margin-bottom: 12px;
}

.todo-tabs {
  display: flex;
  flex: 1 1 100%;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: #f1f5f9;
}

.todo-tabs button {
  flex: 1;
  padding: 7px 6px;
  border-radius: 8px;
  color: var(--dash-muted);
  font-size: 12px;
  font-weight: 600;
  transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}

.todo-tabs .active {
  color: var(--dash-primary);
  background: #fff;
  box-shadow: 0 1px 4px rgba(21, 32, 51, 0.08);
}

.todo-tabs button:hover:not(.active) {
  color: var(--dash-text);
}

.notify-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.notify-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 4px;
  border: none;
  border-bottom: 1px solid #f0f2f5;
  border-radius: 0;
  background: transparent;
  transition: background 160ms ease;
  cursor: default;
}

.notify-list li:last-child {
  border-bottom: none;
}

.notify-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.notify-list li:hover {
  background: #f8fafc;
  border-radius: 8px;
}

.notify-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 15px;
  flex-shrink: 0;
}

.notify-body {
  flex: 1;
  min-width: 0;
}

.notify-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dash-text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-desc {
  font-size: 12px;
  color: var(--dash-muted);
  margin-top: 2px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notify-time {
  font-size: 11px;
  color: #9aa5b5;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.4;
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

.order-status.completed {
  background: #f0fff4;
  color: #42c978;
}

.order-status.pending {
  background: #fff7e6;
  color: #f5a623;
}

.order-status.processing {
  background: #eef3ff;
  color: #5b8def;
}

.order-status.failed {
  background: #fff1f0;
  color: #ff4d4f;
}

.order-status.refunded {
  background: #f6f8fc;
  color: #9aa5b5;
}

.side-column {
  display: flex;
  flex-direction: column;
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
  gap: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 2px 8px 0;
}

.app-grid,
.notify-list,
.balance-flow-list,
.side-column .list-card ul,
.bottom-tabs,
.bottom-list .feed-list {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.app-grid::-webkit-scrollbar,
.notify-list::-webkit-scrollbar,
.balance-flow-list::-webkit-scrollbar,
.side-column .list-card ul::-webkit-scrollbar,
.bottom-tabs::-webkit-scrollbar,
.bottom-list .feed-list::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.balance-flow-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border: none;
  border-bottom: 1px solid #f0f2f5;
  border-radius: 0;
  background: transparent;
  transition: background 160ms ease;
}

.balance-flow-item:last-child {
  border-bottom: none;
}

.balance-flow-item:hover {
  background: #f8fafc;
  border-radius: 8px;
}

.flow-mark {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
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

.balance-flow-item.income .bag-body {
  fill: #28c57c;
}

.balance-flow-item.income .bag-neck {
  fill: #14a864;
}

.balance-flow-item.income .coin {
  fill: #ffd35a;
}

.balance-flow-item.income .yuan {
  fill: #ffffff;
}

.balance-flow-item.expense .bag-body {
  fill: #ff6b75;
}

.balance-flow-item.expense .bag-neck {
  fill: #ef4756;
}

.balance-flow-item.expense .coin {
  fill: #ffc85a;
}

.balance-flow-item.expense .yuan {
  fill: #ffffff;
}

.flow-main {
  flex: 1;
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
  flex-shrink: 0;
  margin-left: auto;
  text-align: right;
  font-size: 15px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.balance-flow-item.income .flow-amount {
  color: #18b66e;
}

.balance-flow-item.expense .flow-amount {
  color: #ff4d4f;
}

.profile-card {
  padding: 18px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  color: #333;
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.2), transparent 26%),
    linear-gradient(135deg, #ffffff, #ffffff 50%, #ffffff);
  overflow: hidden;
  min-height: 94px;
  min-width: 0;
}

.profile-card:active {
  transform: translateY(-1px) scale(0.995);
}

.profile-card .avatar {
  width: 58px;
  height: 58px;
  border: 2.5px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffffff 0%, #ffffff 100%);
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
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.profile-card .avatar .avatar-initial {
  font-size: 24px;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;
  color: #333;
}

.profile-card h2 {
  font-size: 20px;
}

.profile-card p,
.profile-card time {
  color: rgba(255, 255, 255, 0.82);
}

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

.role-badge.admin {
  background: linear-gradient(135deg, #ee4d7a, #ff7eb3);
  color: #fff;
}

.role-badge.agent {
  background: linear-gradient(135deg, #8b7bf7, #a78bfa);
  color: #fff;
}

.role-badge.user {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

/* ========== 折线图 ========== */

.bottom-chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-section-title {
  margin: 0;
  color: var(--dash-muted);
  font-size: 13px;
  font-weight: 600;
}

.echarts-container {
  width: 100%;
  height: 280px;
  border-radius: 12px;
  background: linear-gradient(180deg, #fafbff 0%, #f8fafc 100%);
  border: 1px solid var(--dash-border);
}

.type-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.type-stat-card {
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--dash-border);
  background: #f8fafc;
  text-align: left;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.type-stat-card:hover {
  border-color: rgba(47, 109, 246, 0.22);
  box-shadow: 0 4px 12px rgba(47, 109, 246, 0.08);
}

.type-stat-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--dash-muted);
}

.type-stat-value {
  display: block;
  margin-top: 8px;
  font-size: 22px;
  font-weight: 800;
  color: var(--dash-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

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

.list-card li:hover {
  color: #425066;
  transform: translateX(4px);
}

.list-card li::before {
  content: '';
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  margin-top: 8px;
  border-radius: 50%;
  background: #dbe3f0;
}

.list-card li span {
  flex: 1 1 auto;
  min-width: 0;
  line-height: 1.7;
}

.list-card time {
  flex: 0 0 auto;
  color: #9aa5b5;
}

/* ========== 底部导航卡片 ========== */

.bottom-card {
  grid-column: 1 / -1;
  min-height: 280px;
  max-height: none;
  overflow: visible;
  margin-top: 0;
  padding: 18px 20px 22px;
}

.bottom-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.bottom-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
}

.bottom-tab {
  flex: none;
  min-width: 96px;
  padding: 8px 20px;
  border-radius: 999px;
  border: 1px solid var(--dash-border);
  background: #fff;
  color: var(--dash-text-2);
  font-weight: 600;
  font-size: 13px;
  text-align: center;
  white-space: nowrap;
  transition:
    color 220ms ease,
    background 220ms ease,
    border-color 220ms ease,
    box-shadow 220ms ease,
    transform 220ms ease;
}

.bottom-tab:hover {
  color: var(--dash-primary);
  border-color: rgba(47, 109, 246, 0.28);
  background: #f8faff;
}

.bottom-tab.active {
  color: #fff;
  background: var(--dash-primary);
  border-color: var(--dash-primary);
  box-shadow: 0 4px 14px rgba(47, 109, 246, 0.28);
}

.bottom-tab.active:hover {
  color: #fff;
  background: #2558d4;
  border-color: #2558d4;
}

.bottom-toolbar-hint {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dash-muted);
  white-space: nowrap;
}

.bottom-content {
  min-height: 148px;
  animation: fadeSlideIn 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.bottom-content>.empty-hint {
  min-height: 132px;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dash-border);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.feed-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f2f5;
  transition: background 160ms ease;
}

.feed-row:last-child {
  border-bottom: none;
}

.feed-row:hover {
  background: #f8fafc;
}

.feed-chip {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dash-primary);
  background: rgba(47, 109, 246, 0.1);
}

.feed-chip--batch {
  color: var(--dash-muted);
  background: #f1f5f9;
}

.feed-text {
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dash-text);
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-text--mono {
  font-family: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}

.feed-row time {
  flex-shrink: 0;
  font-size: 12px;
  color: #9aa5b5;
  white-space: nowrap;
}

.bottom-list .feed-list {
  max-height: 320px;
  overflow-y: auto;
}

/* ========== 普通用户 PC 首页 ========== */

.dash-grid.regular-user-dashboard {
  --dashboard-main-row-height: clamp(360px, calc(100vh - 292px), 430px);
  grid-template-columns: minmax(420px, 0.86fr) minmax(0, 1.72fr);
  gap: 18px;
}

.regular-user-dashboard .dash-hero {
  padding: 20px 22px;
}

.regular-user-dashboard .apps-card,
.regular-user-dashboard .bottom-card {
  height: var(--dashboard-main-row-height);
}

.regular-user-dashboard .apps-card {
  grid-column: 1;
}

.regular-user-dashboard .bottom-card {
  grid-column: 2 / -1;
  margin-top: 0;
  overflow: hidden;
}

.regular-user-dashboard .bottom-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.regular-user-dashboard .echarts-container {
  height: min(220px, calc(var(--dashboard-main-row-height) - 120px));
}

.regular-user-dashboard .bottom-content>.empty-hint {
  min-height: 0;
  height: calc(var(--dashboard-main-row-height) - 164px);
}

/* ========== 响应式 ========== */

@media (max-width: 1180px) {
  .dash-grid {
    grid-template-columns: 1fr 1fr;
  }

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

  .dash-stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {

  .dash-grid,
  .side-column {
    grid-template-columns: 1fr;
  }

  .dash-grid {
    padding: 12px 14px 14px;
    max-width: 100vw;
    box-sizing: border-box;
    gap: 14px;
  }

  .dash-grid:not(.regular-user-dashboard) {
    padding-top: 10px;
  }

  .dash-grid.regular-user-dashboard {
    grid-template-columns: 1fr;
  }

  .regular-user-dashboard .apps-card,
  .regular-user-dashboard .bottom-card {
    grid-column: auto;
    height: auto;
  }

  .regular-user-dashboard .bottom-content>.empty-hint {
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

  .card {
    padding: 18px;
    min-width: 0;
    border-radius: 16px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }

  .card:hover {
    transform: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }

  .apps-card,
  .todo-card,
  .side-column .profile-card,
  .side-column .list-card {
    height: auto;
    min-height: auto;
  }

  .dash-hero {
    flex-direction: column;
    padding: 16px;
    gap: 14px;
  }

  .dash-hero-text {
    display: none;
  }

  .dash-stat-grid {
    flex: none;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

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
    color: #2f6df6;
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
    min-height: 80px;
    padding: 10px 6px;
    border: 1px solid var(--dash-border);
    background: #f8fafc;
  }

  .app-item strong {
    font-size: 11px;
    white-space: normal;
  }

  .card-title h2 {
    font-size: 15px;
  }

  .card-title button {
    font-size: 13px;
    color: #9aa5b5;
    font-weight: 600;
  }

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

  .todo-tabs button {
    font-size: 13px;
    padding: 4px 8px;
    gap: 4px;
  }

  .notify-list li {
    padding: 8px 2px;
    gap: 8px;
  }

  .notify-list li.ntype-recharge {
    background: rgba(47, 109, 246, 0.04);
  }

  .notify-icon {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    font-size: 13px;
    margin-top: 0;
  }

  .notify-head {
    gap: 6px;
  }

  .notify-title {
    font-size: 12px;
    font-weight: 600;
    white-space: normal;
    line-height: 1.35;
  }

  .notify-desc {
    white-space: normal;
    line-height: 1.4;
    margin-top: 3px;
    font-size: 11px;
  }

  .notify-time {
    font-size: 10px;
  }

  .type-stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .type-stat-value {
    font-size: 18px;
  }

  .feed-row {
    grid-template-columns: 1fr;
    gap: 6px;
    align-items: flex-start;
  }

  .feed-row time {
    grid-column: 1 / -1;
    font-size: 11px;
  }

  .list-card li {
    align-items: flex-start;
  }

  .list-card li span {
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .list-card time {
    font-size: 12px;
  }

  .balance-flow-item {
    gap: 8px;
    padding: 8px 0;
  }

  .flow-mark {
    width: 30px;
    height: 30px;
    border-radius: 9px;
  }

  .flow-mark svg {
    width: 20px;
    height: 20px;
  }

  .flow-main strong {
    font-size: 12px;
    font-weight: 700;
  }

  .flow-main time {
    font-size: 10px;
  }

  .flow-amount {
    font-size: 12px;
    font-weight: 800;
  }

  .side-column {
    overflow: visible;
  }

  .side-column .list-card {
    display: flex;
  }

  .balance-flow-list {
    max-height: 360px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0;
  }

  .profile-card {
    border-radius: 16px;
  }

  .bottom-card-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .bottom-tabs {
    width: 100%;
    justify-content: stretch;
  }

  .bottom-tab {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    padding: 9px 12px;
  }

  .bottom-toolbar-hint {
    text-align: center;
    font-size: 12px;
  }

  .bottom-list li span {
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .bottom-list time {
    font-size: 12px;
  }
}
</style>
