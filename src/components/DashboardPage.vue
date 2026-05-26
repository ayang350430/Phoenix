<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
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

// ========== 应用 & 导航 ==========
const apps = [
  { name: '批量提交', tone: 'pink', icon: '批', img: iconPin },
  { name: '阅读任务', tone: 'blue', icon: '阅', img: iconYuedu },
  { name: '点赞任务', tone: 'purple', icon: '赞', img: iconDianzan },
  { name: '曝光任务', tone: 'cyan', icon: '曝', img: iconBao },
  { name: '预校验', tone: 'green', icon: '验', img: iconYan },
  { name: '下单记录', tone: 'orange', icon: '单', img: iconXiadan }
]

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
  supplement_charge: '补单扣款', supplement_refund: '补单退款'
}

function formatType(t) { return typeMap[t] || t || '其他' }
function pn(item) {
  if (item.product_name) return item.product_name.replace(/^小红书/, '')
  return formatType(item.target_type)
}
function formatStatus(s) { return statusMap[s] || s || '-' }
function formatRecordType(r) { return r.remark || recordTypeMap[r.record_type] || r.record_type || '-' }

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
  return [
    { value: stats.value.total_orders || 0, label: '总订单数' },
    { value: stats.value.total_batches || 0, label: '总批次数' },
    { value: completed, label: '已完成' },
    { value: failed, label: '异常订单' }
  ]
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
  <section class="dash-grid">
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
        </button>
      </div>
    </section>

    <!-- 最新动态 -->
    <section class="card todo-card">
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

    <aside class="side-column">
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
      <section class="card list-card">
        <div class="card-title">
          <h2>余额流水</h2>
        </div>
        <ul v-if="recentRecords.length">
          <li v-for="r in recentRecords" :key="r.id">
            <span>{{ formatRecordType(r) }} <strong :style="{ color: r.direction === 'in' ? '#42c978' : '#ff4d4f' }">{{ r.direction === 'in' ? '+' : '-' }}¥{{ parseFloat(r.actual_paid_amount || 0).toFixed(2) }}</strong></span>
            <time>{{ formatTime(r.created_at) }}</time>
          </li>
        </ul>
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
            <span>{{ pn(o) }} — {{ o.title || o.note_url || o.order_no }} <em class="order-status" :class="o.order_status">{{ formatStatus(o.order_status) }}</em></span>
            <time>{{ formatTime(o.created_at) }}</time>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无订单</p>
      </div>

      <!-- 最近批次 -->
      <div v-else-if="activeBottomNav === '最近批次'" class="bottom-content bottom-list">
        <ul v-if="recentBatches.length">
          <li v-for="b in recentBatches" :key="b.id">
            <span>批次 {{ b.batch_no || b.batch_id }} — {{ b.status }} ({{ b.succeeded_count || 0 }}/{{ b.total_count || 0 }})</span>
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
  padding: 18px 28px 28px;
  display: grid;
  grid-template-columns: 1fr 1.3fr 0.88fr;
  gap: 18px;
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
  box-shadow: 0 8px 26px rgba(21, 32, 51, 0.06);
  align-self: start;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.card:hover,
.profile-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 34px rgba(21, 32, 51, 0.09);
}

.card {
  padding: 22px;
  align-self: start;
  min-height: 380px;
  max-height: 520px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.card-title h2 { font-size: 18px; }

.card-title button {
  color: #8b7bf7;
  font-weight: 800;
  transition: color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.card-title button:hover { color: #ee4d7a; transform: translateX(2px); }
.card-title button:active { transform: translateX(2px) scale(0.96); }

.app-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px 12px;
}

.app-item {
  display: grid;
  justify-items: center;
  gap: 10px;
  color: #425066;
  transition: color 240ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.app-item:hover { transform: translateY(-3px); }
.app-item:active { transform: translateY(-1px) scale(0.97); }

.app-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 50%;
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

.todo-card .card-title {
  padding-bottom: 14px;
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
  gap: 6px;
  margin-top: 14px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.notify-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  transition: background 200ms ease, transform 200ms ease;
  cursor: default;
}

.notify-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notify-list li:hover {
  background: #f9fafc;
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
  align-self: stretch;
  min-height: 380px;
}

.empty-hint {
  text-align: center;
  padding: 28px 0;
  color: #9aa5b5;
  font-size: 14px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
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
  gap: 18px;
  grid-template-rows: auto 1fr;
}

.side-column .list-card {
  min-height: 410px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.side-column .list-card ul {
  flex: 1;
  overflow-y: auto;
}

.profile-card {
  padding: 18px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  color: #fff;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7 50%, #5b8def);
  overflow: hidden;
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
  gap: 10px;
  margin-bottom: 14px;
}

.chart-stat-item {
  text-align: center;
  padding: 10px 6px;
  border-radius: 8px;
  background: #f9fafc;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}

.chart-stat-item:hover { transform: translateY(-2px); box-shadow: 0 8px 18px rgba(21, 32, 51, 0.06); }
.chart-stat-item:nth-child(1) { background: #fff3f7; }
.chart-stat-item:nth-child(2) { background: #eff8f3; }
.chart-stat-item:nth-child(3) { background: #f1eeff; }
.chart-stat-item:nth-child(4) { background: #fff1f0; }

.chart-stat-item strong { display: block; font-size: 22px; color: #152033; line-height: 1.3; }
.chart-stat-item span { font-size: 12px; color: #9aa5b5; }

.echarts-container { width: 100%; height: 280px; border-radius: 8px; }

.yearly-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.yearly-grid span {
  padding: 14px;
  border-radius: 6px;
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
  display: grid;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.list-card li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
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
  min-height: auto;
  max-height: none;
  overflow: visible;
}

.bottom-tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e8edf4;
  margin-bottom: 18px;
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

.bottom-content { animation: fadeSlideIn 240ms cubic-bezier(0.22, 1, 0.36, 1); }

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.bottom-list ul { list-style: none; display: grid; gap: 16px; }

.bottom-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: #647184;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), color 240ms ease;
}

.bottom-list li:hover { color: #425066; transform: translateX(4px); }

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

/* ========== 响应式 ========== */

@media (max-width: 1180px) {
  .dash-grid { grid-template-columns: 1fr 1fr; }
  .side-column { grid-column: span 2; grid-template-columns: 1fr 1fr; }

  .dash-banner { border-radius: 10px; }
}

@media (max-width: 760px) {
  .dash-grid,
  .side-column { grid-template-columns: 1fr; }
  .dash-grid { padding: 14px; max-width: 100vw; box-sizing: border-box; gap: 14px; }
  .side-column { grid-column: auto; }
  .card { padding: 18px; min-width: 0; border-radius: 16px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
  .card:hover { transform: none; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
  .apps-card { min-height: auto; }

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
    grid-template-columns: repeat(3, 1fr);
    gap: 20px 14px;
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
  }

  .card-title h2 { font-size: 16px; }
  .card-title button { font-size: 13px; color: #9aa5b5; font-weight: 600; }

  /* ---- Notifications mobile ---- */
  .todo-card { min-height: auto; max-height: none; }
  .tab-count { display: none; }
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
