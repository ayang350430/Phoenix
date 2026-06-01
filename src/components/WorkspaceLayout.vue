<script setup>
import { computed, onMounted, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElNotification, ElMessageBox } from 'element-plus'
import { House, Search, ShoppingCart, Tickets, UserFilled } from '@element-plus/icons-vue'
import logoSvg from '../assets/logo.svg'
import ChatWidget from './ChatWidget.vue'
import { getMobileUserTabAction, isMobileUserTabSelected } from '../utils/mobileUserTabs.js'
import { canShowReferralLink } from '../utils/referralVisibility.js'

const route = useRoute()
const router = useRouter()

// ========== 用户信息 & 登录态 ==========
const currentUser = ref(null)

function loadUser() {
  const token = localStorage.getItem('token')
  const userStr = localStorage.getItem('user')
  if (!token || !userStr) {
    router.push('/login')
    return
  }
  try {
    currentUser.value = JSON.parse(userStr)
  } catch {
    router.push('/login')
  }
}

function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push('/login')
}

function getToken() {
  return localStorage.getItem('token') || ''
}

const userName = computed(() => currentUser.value?.real_name || currentUser.value?.nickname || currentUser.value?.username || '用户')
const userInitial = computed(() => (userName.value || '用')[0])
const userAvatar = computed(() => currentUser.value?.avatar || currentUser.value?.avatar_url || '')

// ========== 角色 ==========
const userRoles = computed(() => currentUser.value?.roles || [])
const isAdmin = computed(() => userRoles.value.includes('admin') || userRoles.value.includes('super'))
const isAgent = computed(() => userRoles.value.includes('agent'))
const isSupport = computed(() => userRoles.value.includes('support'))
const roleLabel = computed(() => {
  if (userRoles.value.includes('super')) return '超级管理员'
  if (userRoles.value.includes('admin')) return '管理员'
  if (isAgent.value) return '代理'
  if (isSupport.value) return '客服'
  return '普通用户'
})
const referralCode = computed(() => currentUser.value?.referral_code || '')
const showReferralLink = computed(() => canShowReferralLink(userRoles.value, referralCode.value))
const referralLink = computed(() => {
  if (!referralCode.value) return ''
  return `${window.location.origin}/login?ref=${referralCode.value}`
})
const copySuccess = ref(false)

function copyReferralLink() {
  if (!referralLink.value) return
  const text = referralLink.value
  // 优先使用 clipboard API（需要 HTTPS），不支持时用 execCommand 兜底
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      copySuccess.value = true
      setTimeout(() => { copySuccess.value = false }, 2000)
    }).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  } catch { /* ignore */ }
  document.body.removeChild(ta)
}

// ========== 导航 ==========
const baseNavs = ['首页', '批量下单', '查询订单']
const navs = computed(() => {
  if (isAdmin.value) return ['首页', '批量下单', '记录中心', '查询订单', '退款申请', '在线客服', '聊天记录', '客服配置', '嵌入指南', '权限管理']
  if (isAgent.value) {
    const items = [...baseNavs, '下单记录', '商品管理']
    if (isSupport.value) items.push('在线客服')
    return items
  }
  if (isSupport.value) return ['在线客服']
  return ['首页', '批量下单', '下单记录', '查询订单']
})
const activeNav = ref('首页')

// 根据路由设置初始激活导航
if (route.path === '/admin') activeNav.value = '权限管理'
else if (route.path === '/batch') activeNav.value = '批量下单'
else if (route.path === '/records') activeNav.value = '记录中心'
else if (route.path === '/my-orders') activeNav.value = '下单记录'
else if (route.path === '/products') activeNav.value = '商品管理'
else if (route.path === '/support') activeNav.value = '在线客服'
else if (route.path === '/chat-history') activeNav.value = '聊天记录'
else if (route.path === '/cs-config') activeNav.value = '客服配置'
else if (route.path === '/refund') activeNav.value = '退款申请'
else if (route.path === '/order-lookup') activeNav.value = '查询订单'
else if (route.path === '/embed-guide') activeNav.value = '嵌入指南'

const displayActiveNav = computed(() => {
  if (route.path === '/dashboard') return '首页'
  if (route.path === '/admin') return '权限管理'
  if (route.path === '/batch') return '批量下单'
  if (route.path === '/records') return '记录中心'
  if (route.path === '/my-orders') return '下单记录'
  if (route.path === '/products') return '商品管理'
  if (route.path === '/support') return '在线客服'
  if (route.path === '/chat-history') return '聊天记录'
  if (route.path === '/cs-config') return '客服配置'
  if (route.path === '/refund') return '退款申请'
  if (route.path === '/order-lookup') return '查询订单'
  if (route.path === '/embed-guide') return '嵌入指南'
  return activeNav.value
})

function handleNav(nav) {
  if (nav === '权限管理') { router.push('/admin'); return }
  if (nav === '商品管理') { router.push('/products'); return }
  if (nav === '批量下单') { router.push('/batch'); return }
  if (nav === '记录中心') { router.push('/records'); return }
  if (nav === '下单记录') { router.push('/my-orders'); return }
  if (nav === '在线客服') { router.push('/support'); return }
  if (nav === '聊天记录') { router.push('/chat-history'); return }
  if (nav === '客服配置') { router.push('/cs-config'); return }
  if (nav === '退款申请') { router.push('/refund'); return }
  if (nav === '查询订单') { router.push('/order-lookup'); return }
  if (nav === '嵌入指南') { router.push('/embed-guide'); return }
  if (route.path !== '/dashboard') {
    router.push('/dashboard')
    return
  }
  activeNav.value = nav
}

const showMobileNav = ref(false)
const showUserDrawer = ref(false)
const isRegularUser = computed(() => !isAdmin.value && !isAgent.value && !isSupport.value)
const mobileUserTabs = [
  { key: 'home', label: '首页', nav: '首页', icon: House },
  { key: 'orders', label: '记录', nav: '下单记录', icon: Tickets },
  { key: 'batch', label: '下单', nav: '批量下单', icon: ShoppingCart, primary: true },
  { key: 'lookup', label: '查询', nav: '查询订单', icon: Search },
  { key: 'mine', label: '我的', action: 'profile', icon: UserFilled }
]
const isAnyOverlayOpen = computed(() => showMobileNav.value || showUserDrawer.value || showRecharge.value || showTeam.value)
let scrollLockState = null

function lockPageScroll() {
  if (scrollLockState) return
  scrollLockState = {
    top: window.scrollY,
    htmlOverflow: document.documentElement.style.overflow,
    overflow: document.body.style.overflow,
    position: document.body.style.position,
    width: document.body.style.width,
    topStyle: document.body.style.top
  }
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.width = '100%'
  document.body.style.top = `-${scrollLockState.top}px`
}

function unlockPageScroll() {
  if (!scrollLockState) return
  const { top, htmlOverflow, overflow, position, width, topStyle } = scrollLockState
  document.documentElement.style.overflow = htmlOverflow
  document.body.style.overflow = overflow
  document.body.style.position = position
  document.body.style.width = width
  document.body.style.top = topStyle
  scrollLockState = null
  window.scrollTo(0, top)
}

function handleMobileNav(nav) {
  showMobileNav.value = false
  handleNav(nav)
}

function handleMobileUserTab(tab) {
  const action = getMobileUserTabAction(tab)
  if (action.openProfile) {
    showUserDrawer.value = true
    return
  }
  if (action.closeProfile) showUserDrawer.value = false
  if (action.nav) handleNav(action.nav)
}

function isMobileUserTabActive(tab) {
  return isMobileUserTabSelected(tab, displayActiveNav.value, showUserDrawer.value)
}

// ========== 我的团队（下级用户） ==========
const showTeam = ref(false)
const teamList = ref([])
const teamTotal = ref(0)
const teamPage = ref(1)
const teamLoading = ref(false)

async function openTeam() {
  showTeam.value = true
  teamPage.value = 1
  await fetchTeam()
}

async function fetchTeam() {
  teamLoading.value = true
  try {
    const res = await fetch(`/api/users/referred?page=${teamPage.value}&pageSize=20`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      teamList.value = data.data.rows
      teamTotal.value = data.data.total
    }
  } catch { /* ignore */ }
  finally { teamLoading.value = false }
}

function teamPrev() {
  if (teamPage.value > 1) { teamPage.value--; fetchTeam() }
}

function teamNext() {
  if (teamPage.value * 20 < teamTotal.value) { teamPage.value++; fetchTeam() }
}

// ========== 余额 & 充值 ==========
const balance = ref(0)
const showRecharge = ref(false)
const rechargeAmount = ref('')
const rechargeLoading = ref(false)
const rechargeError = ref('')
const pollingOrderNo = ref('')
const pollingTimer = ref(null)

const presetAmounts = [10, 50, 100, 200, 500, 1000]

async function fetchBalance() {
  try {
    const res = await fetch('/api/recharge/records?page=1&pageSize=1', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) balance.value = parseFloat(data.data.balance) || 0
  } catch { /* ignore */ }
}

function openRecharge() {
  rechargeAmount.value = ''
  rechargeError.value = ''
  showRecharge.value = true
}

function selectAmount(val) {
  rechargeAmount.value = String(val)
}

async function submitRecharge() {
  rechargeError.value = ''
  const num = parseFloat(rechargeAmount.value)
  if (!num || num < 1) {
    rechargeError.value = '请输入有效金额（最少 1 元）'
    return
  }
  rechargeLoading.value = true
  try {
    const res = await fetch('/api/recharge/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({ amount: num.toFixed(2) })
    })
    const data = await res.json()
    if (data.code !== 0) {
      rechargeError.value = data.message || '创建订单失败'
      return
    }
    const payUrl = data.data.payment_url
    const orderNo = data.data.order_no
    showRecharge.value = false
    pollingOrderNo.value = orderNo
    sessionStorage.setItem('pending_recharge_order', orderNo)
    window.location.href = payUrl
  } catch {
    rechargeError.value = '网络错误，请重试'
  } finally {
    rechargeLoading.value = false
  }
}

// 检查一次充值状态；query 为 'order_no=X' 或 'merchant_order_id=Y'
// 返回 true 表示已到达终态（已支付/已取消/已过期），无需再轮询
async function checkRechargeStatus(query) {
  try {
    const res = await fetch(`/api/recharge/status?${query}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code !== 0) return false
    const st = data.data.status
    if (st === 'paid') {
      stopPolling()
      sessionStorage.removeItem('pending_recharge_order')
      try {
        await fetchBalance()
        refreshKey.value++
      } catch { }
      ElMessageBox.alert(`¥${data.data.amount} 已成功到账，余额已更新`, '充值成功', {
        type: 'success',
        center: true,
        confirmButtonText: '我知道了'
      }).catch(() => {})
      return true
    }
    if (st === 'cancelled' || st === 'expired' || st === 'failed') {
      stopPolling()
      sessionStorage.removeItem('pending_recharge_order')
      ElNotification.warning({ title: '充值未完成', message: st === 'cancelled' ? '订单已取消' : '订单已过期', duration: 4000 })
      return true
    }
  } catch { /* ignore */ }
  return false
}

function startPolling(orderId, byMerchant = false) {
  stopPolling()
  const query = byMerchant
    ? `merchant_order_id=${encodeURIComponent(orderId)}`
    : `order_no=${encodeURIComponent(orderId)}`
  // 立即检查一次：支付返回时通常已到账，可秒弹通知
  checkRechargeStatus(query)
  let count = 0
  pollingTimer.value = setInterval(async () => {
    count++
    if (count > 120) {
      stopPolling()
      sessionStorage.removeItem('pending_recharge_order')
      return
    }
    await checkRechargeStatus(query)
  }, 3000)
}

function stopPolling() {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
}

// ========== 全屏 ==========
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => { })
    isFullscreen.value = true
  } else {
    document.exitFullscreen().catch(() => { })
    isFullscreen.value = false
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

// ========== 刷新 ==========
const refreshKey = ref(0)

function refreshPage() {
  fetchBalance()
  loadUser()
  refreshKey.value++
}

// ========== 生命周期 ==========
loadUser()

// 纯客服角色（无admin/agent）只能访问 /support
if (isSupport.value && !isAdmin.value && !isAgent.value && route.path !== '/support') {
  router.replace('/support')
}

const balancePollTimer = ref(null)
const BALANCE_POLL_INTERVAL = 30_000

onMounted(() => {
  fetchBalance()
  balancePollTimer.value = setInterval(fetchBalance, BALANCE_POLL_INTERVAL)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  // 充值返回检测：
  // 1) 优先用重定向 URL 上的 ?recharge=<merchant_order_id>（跨域重定向也能带回，最可靠）
  // 2) 兜底用 sessionStorage 里的 order_no（同源时可用）
  // sessionStorage 不在此处提前清除，改由轮询到终态/超时时清，避免刷新丢失导致漏弹
  const rechargeMerchant = route.query.recharge
  const pendingOrder = sessionStorage.getItem('pending_recharge_order')
  if (rechargeMerchant) {
    const cleaned = { ...route.query }
    delete cleaned.recharge
    router.replace({ path: route.path, query: cleaned }).catch(() => {})
    startPolling(String(rechargeMerchant), true)
  } else if (pendingOrder) {
    pollingOrderNo.value = pendingOrder
    startPolling(pendingOrder)
  }
})

watch(isAnyOverlayOpen, (open) => {
  if (open) lockPageScroll()
  else unlockPageScroll()
})

watch(isRegularUser, (active) => {
  document.body.classList.toggle('has-mobile-user-tabbar', active)
}, { immediate: true })

onBeforeUnmount(() => {
  stopPolling()
  unlockPageScroll()
  document.body.classList.remove('has-mobile-user-tabbar')
  if (balancePollTimer.value) clearInterval(balancePollTimer.value)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})

// ========== Provide ==========
provide('workspace', {
  currentUser,
  userName,
  userInitial,
  userAvatar,
  userRoles,
  isAdmin,
  isAgent,
  isSupport,
  roleLabel,
  balance,
  activeNav,
  getToken,
  fetchBalance,
  openRecharge,
  openUserDrawer: () => { showUserDrawer.value = true },
  logout,
  refreshKey
})
</script>

<template>
  <main class="workspace-layout" :class="{ 'has-mobile-user-tabbar': isRegularUser }">
    <div class="site-bar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
      <span>现代数字化工作台</span>
    </div>
    <header class="ws-topbar">
      <a class="ws-brand" href="/">
        <img :src="logoSvg" alt="Phoenix" />
        <strong>工作桌面</strong>
      </a>
      <nav class="ws-nav" aria-label="Main navigation">
        <button v-for="nav in navs" :key="nav" type="button" :class="{ active: displayActiveNav === nav }"
          @click="handleNav(nav)">{{ nav }}</button>
      </nav>
      <button v-if="!isRegularUser" type="button" class="mobile-menu-btn" @click="showMobileNav = !showMobileNav"
        :class="{ open: showMobileNav }">
        <span /><span /><span />
      </button>
      <div class="ws-actions">
        <div class="balance-pill" @click="openRecharge">
          <span class="balance-label">余额</span>
          <strong class="balance-value">¥{{ balance.toFixed(2) }}</strong>
          <span class="recharge-btn">充值</span>
        </div>
        <button type="button" class="topbar-btn" @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
          <svg v-if="!isFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        </button>
        <button type="button" class="topbar-btn" @click="showUserDrawer = true" title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button type="button" class="topbar-btn" @click="refreshPage" title="刷新">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button type="button" class="avatar avatar-button" @click="showUserDrawer = true">
          <img v-if="userAvatar" :src="userAvatar" :alt="userName" class="avatar-img" />
          <span v-else class="avatar-initial">{{ userInitial }}</span>
        </button>
      </div>
    </header>

    <!-- 手机端导航抽屉 -->
    <Teleport to="body">
      <Transition name="mobile-nav">
        <div v-if="showMobileNav" class="mobile-nav-overlay" @click.self="showMobileNav = false"
          @touchmove.self.prevent>
          <aside class="mobile-nav-drawer" @touchmove.stop>
            <div class="mobile-nav-header">
              <div class="mobile-nav-user">
                <span class="avatar" style="width:40px;height:40px;font-size:16px;">
                  <img v-if="userAvatar" :src="userAvatar" class="avatar-img" />
                  <span v-else class="avatar-initial">{{ userInitial }}</span>
                </span>
                <div>
                  <strong>{{ userName }}</strong>
                  <small>{{ roleLabel }}</small>
                </div>
              </div>
              <button type="button" class="mobile-nav-close" @click="showMobileNav = false">✕</button>
            </div>
            <nav class="mobile-nav-list">
              <button v-for="nav in navs" :key="nav" type="button" :class="{ active: displayActiveNav === nav }"
                @click="handleMobileNav(nav)">
                <svg v-if="nav === '首页'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <svg v-else-if="nav === '批量下单'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                <svg v-else-if="nav === '记录中心'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <svg v-else-if="nav === '商品管理'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                <svg v-else-if="nav === '在线客服'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <svg v-else-if="nav === '聊天记录'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <line x1="9" y1="9" x2="15" y2="9" />
                  <line x1="9" y1="13" x2="13" y2="13" />
                </svg>
                <svg v-else-if="nav === '客服配置'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path
                    d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg v-else-if="nav === '查询订单'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <svg v-else-if="nav === '嵌入指南'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                <svg v-else-if="nav === '退款申请'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                <svg v-else-if="nav === '权限管理'" width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {{ nav }}
              </button>
            </nav>
            <div class="mobile-nav-footer">
              <button type="button" @click="showMobileNav = false; logout()">退出登录</button>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <!-- 用户操作选项卡 手机端 用户 -->
    <nav v-if="isRegularUser" class="mobile-user-tabbar" aria-label="Mobile navigation">
      <button v-for="tab in mobileUserTabs" :key="tab.key" type="button"
        :class="{ active: isMobileUserTabActive(tab), primary: tab.primary }" @click="handleMobileUserTab(tab)">
        <span class="mobile-tab-icon">
          <component :is="tab.icon" aria-hidden="true" />
        </span>
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <!-- 页面内容插槽 -->
    <slot />

    <!-- 用户信息抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showUserDrawer" class="drawer-mask" @click.self="showUserDrawer = false">
        <aside class="user-drawer">
          <button type="button" class="drawer-close" @click="showUserDrawer = false">×</button>
          <div class="drawer-hero">
            <div class="drawer-head">
              <div class="avatar large drawer-avatar">
                <img v-if="userAvatar" :src="userAvatar" :alt="userName" class="avatar-img" />
                <span v-else class="avatar-initial">{{ userInitial }}</span>
              </div>
              <div class="drawer-head-copy">
                <span class="drawer-eyebrow">用户中心</span>
                <h2>{{ userName }}</h2>
                <p>{{ currentUser?.username }}</p>
              </div>
            </div>

            <div class="drawer-badges">
              <span class="drawer-badge" :class="isAdmin ? 'admin' : isAgent ? 'agent' : 'user'">{{ roleLabel }}</span>
              <span class="drawer-badge muted">账号状态 · 正常</span>
              <span class="drawer-badge muted">余额 ¥{{ balance.toFixed(2) }}</span>
            </div>
          </div>

          <div class="drawer-section">
            <dl class="user-detail">
              <div>
                <dt>账号</dt>
                <dd>{{ currentUser?.username }}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd><span class="role-badge" :class="isAdmin ? 'admin' : isAgent ? 'agent' : 'user'">{{ roleLabel
                    }}</span></dd>
              </div>
              <div>
                <dt>账户余额</dt>
                <dd>¥{{ balance.toFixed(2) }}</dd>
              </div>
              <div>
                <dt>账号状态</dt>
                <dd>正常</dd>
              </div>
            </dl>
          </div>

          <div v-if="showReferralLink" class="referral-section drawer-section">
            <div class="referral-header">
              <span class="referral-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </span>
              <div>
                <strong>推荐链接</strong>
                <small>邀请注册后会成为你的下级</small>
              </div>
            </div>
            <div class="referral-link-box">
              <span class="referral-url">{{ referralLink }}</span>
              <button type="button" class="referral-copy" :class="{ copied: copySuccess }" @click="copyReferralLink">
                <svg v-if="!copySuccess" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {{ copySuccess ? '已复制' : '复制' }}
              </button>
            </div>
          </div>

          <div class="drawer-actions">
            <button type="button" class="drawer-action primary"
              @click="showUserDrawer = false; openRecharge()">充值</button>
            <button v-if="isAgent" type="button" class="drawer-action team-btn"
              @click="showUserDrawer = false; openTeam()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              我的团队
            </button>
            <button type="button" class="drawer-action secondary" @click="logout()">退出登录</button>
          </div>
        </aside>
      </div>
    </Transition>

    <!-- 充值弹窗 -->
    <Transition name="drawer-fade">
      <div v-if="showRecharge" class="drawer-mask" @click.self="showRecharge = false">
        <div class="recharge-dialog">
          <button type="button" class="drawer-close" @click="showRecharge = false">×</button>
          <h2 class="recharge-title">账户充值</h2>
          <p class="recharge-balance">当前余额：<strong>¥{{ balance.toFixed(2) }}</strong></p>
          <div class="preset-grid">
            <button v-for="val in presetAmounts" :key="val" type="button"
              :class="['preset-item', { active: rechargeAmount === String(val) }]" @click="selectAmount(val)">¥{{ val
              }}</button>
          </div>
          <div class="custom-amount">
            <label>自定义金额</label>
            <div class="amount-input-wrap">
              <span class="amount-prefix">¥</span>
              <input v-model="rechargeAmount" type="number" min="1" step="0.01" placeholder="输入充值金额"
                @keyup.enter="submitRecharge" />
            </div>
          </div>
          <p v-if="rechargeError" class="recharge-error">{{ rechargeError }}</p>
          <button type="button" class="drawer-action recharge-submit" :class="{ loading: rechargeLoading }"
            :disabled="rechargeLoading" @click="submitRecharge">{{ rechargeLoading ? '创建订单中...' : `确认充值
            ¥${rechargeAmount || '0'}` }}</button>
          <p class="recharge-hint">支持支付宝、微信、TRX、USDT 多种支付方式</p>
        </div>
      </div>
    </Transition>

    <!-- 我的团队弹窗 -->
    <Transition name="drawer-fade">
      <div v-if="showTeam" class="drawer-mask" @click.self="showTeam = false">
        <div class="team-dialog">
          <!-- 头部 -->
          <div class="team-header">
            <div class="team-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <h2 class="team-title">我的团队</h2>
              <p class="team-summary">共 <strong>{{ teamTotal }}</strong> 个下级用户</p>
            </div>
            <button type="button" class="team-close" @click="showTeam = false">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- 内容 -->
          <div class="team-body">
            <div v-if="teamLoading" class="team-loading">
              <div class="team-spinner"></div>
              <span>加载中...</span>
            </div>
            <div v-else-if="teamList.length === 0" class="team-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d0d7e2" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <p>暂无下级用户</p>
              <small>分享您的推荐链接邀请用户注册</small>
            </div>
            <template v-else>
              <div v-for="u in teamList" :key="u.id" class="team-member">
                <div class="member-avatar">
                  <span>{{ (u.username || '?')[0].toUpperCase() }}</span>
                </div>
                <div class="member-info">
                  <div class="member-name">{{ u.username }}<span v-if="u.nickname || u.real_name" class="member-nick">{{
                    u.nickname || u.real_name }}</span></div>
                  <div class="member-meta">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {{ new Date(u.created_at).toLocaleDateString() }} 注册
                  </div>
                </div>
                <span class="member-status" :class="u.status === 'active' ? 'on' : 'off'">
                  <span class="member-status-dot"></span>
                  {{ u.status === 'active' ? '正常' : '禁用' }}
                </span>
              </div>
            </template>
          </div>

          <!-- 分页 -->
          <div v-if="teamTotal > 20" class="team-pager">
            <button type="button" :disabled="teamPage <= 1" @click="teamPrev">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              上一页
            </button>
            <span>{{ teamPage }} / {{ Math.ceil(teamTotal / 20) }}</span>
            <button type="button" :disabled="teamPage * 20 >= teamTotal" @click="teamNext">
              下一页
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 客服聊天 -->
    <ChatWidget v-if="route.path !== '/support'" />
  </main>
</template>

<style scoped>
.workspace-layout {
  --motion-fast: 160ms;
  --motion-base: 240ms;
  --motion-soft: cubic-bezier(0.22, 1, 0.36, 1);
  min-height: 100vh;
  background: #f4f7fb;
  color: #152033;
  overflow-x: hidden;
  max-width: 100vw;
}

.site-bar {
  display: none;
}

.mobile-user-tabbar {
  display: none;
}

.mobile-query-fab {
  display: none;
}

/* ========== 顶栏 ========== */

.ws-topbar {
  min-height: 72px;
  margin: 12px 16px 0;
  padding: 0 18px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 22px;
  border-radius: 8px;
  background: linear-gradient(135deg, #ee4d7a 0%, #8b7bf7 52%, #5b8def 100%);
  color: #fff;
  box-shadow: 0 18px 42px rgba(139, 123, 247, 0.24);
}

.ws-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  transition: transform var(--motion-base) var(--motion-soft), opacity var(--motion-base) ease;
}

.ws-brand:hover {
  transform: translateY(-1px);
}

.ws-brand img {
  width: 38px;
  height: 38px;
}

.ws-brand strong {
  font-size: 24px;
  letter-spacing: 3px;
}

.ws-nav {
  display: flex;
  gap: 24px;
  align-self: stretch;
  align-items: center;
}

.ws-nav button {
  position: relative;
  height: 100%;
  display: inline-flex;
  align-items: center;
  color: rgba(255, 255, 255, 0.82);
  font-weight: 700;
  transition: color var(--motion-base) ease, transform var(--motion-base) var(--motion-soft);
}

.ws-nav button::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 999px 999px 0 0;
  background: #fff;
  transform: scaleX(0);
  transform-origin: center;
  transition: transform var(--motion-base) var(--motion-soft), opacity var(--motion-base) ease;
  opacity: 0;
}

.ws-nav button:hover {
  color: #fff;
  transform: translateY(-1px);
}

.ws-nav button.active {
  color: #fff;
}

.ws-nav button.active::after {
  transform: scaleX(1);
  opacity: 1;
}

.ws-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.topbar-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: color var(--motion-fast) ease, transform var(--motion-base) var(--motion-soft), background var(--motion-base) ease, box-shadow var(--motion-base) ease;
}

.topbar-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.topbar-btn:active {
  transform: translateY(0) scale(0.92);
  background: rgba(255, 255, 255, 0.3);
}

/* ========== 头像 ========== */

.avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  font-weight: 900;
  overflow: hidden;
  transition: transform var(--motion-base) var(--motion-soft), box-shadow var(--motion-base) ease, background var(--motion-base) ease;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.avatar-initial {
  font-size: 14px;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;
}

.avatar-button {
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.6);
}

.avatar-button:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 8px 20px rgba(21, 32, 51, 0.18);
  border-color: rgba(255, 255, 255, 0.9);
}

.avatar-button:active {
  transform: scale(0.96);
}

.drawer-head .avatar {
  border: none;
}

.avatar.large {
  width: 58px;
  height: 58px;
}

.avatar.large .avatar-initial {
  font-size: 24px;
}

/* ========== 余额 & 充值 ========== */

.balance-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.32);
  cursor: pointer;
  transition: background var(--motion-base) ease, transform var(--motion-base) var(--motion-soft);
}

.balance-pill:hover {
  background: rgba(255, 255, 255, 0.28);
  transform: translateY(-1px);
}

.balance-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

.balance-value {
  font-size: 14px;
  color: #fff;
}

.recharge-btn {
  padding: 3px 10px;
  border-radius: 999px;
  background: #fff;
  color: #8b7bf7;
  font-size: 12px;
  font-weight: 800;
  transition: transform var(--motion-fast) var(--motion-soft);
}

.balance-pill:hover .recharge-btn {
  transform: scale(1.04);
}

/* ========== 抽屉 & 弹窗 ========== */

.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  background: rgba(21, 32, 51, 0.42);
  backdrop-filter: blur(10px);
}

.user-drawer {
  width: min(420px, 92vw);
  height: 100%;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(circle at top right, rgba(91, 141, 239, 0.18), transparent 36%),
    linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  box-shadow: -28px 0 60px rgba(21, 32, 51, 0.22);
  border-left: 1px solid rgba(223, 229, 236, 0.85);
  overflow-y: auto;
}

.drawer-close {
  align-self: flex-end;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: #647184;
  background: #f4f7fb;
  font-size: 22px;
  transition: transform var(--motion-base) var(--motion-soft), background var(--motion-base) ease, color var(--motion-base) ease;
}

.drawer-close:hover {
  color: #ee4d7a;
  background: #fff1f5;
  transform: rotate(90deg);
}

.drawer-hero {
  padding: 18px;
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(238, 77, 122, 0.12), rgba(139, 123, 247, 0.12) 52%, rgba(91, 141, 239, 0.12)),
    #fff;
  box-shadow: 0 18px 34px rgba(21, 32, 51, 0.06);
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.drawer-avatar {
  flex: 0 0 auto;
  box-shadow: 0 14px 28px rgba(139, 123, 247, 0.18);
}

.drawer-head-copy {
  min-width: 0;
}

.drawer-eyebrow {
  display: inline-flex;
  margin-bottom: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(139, 123, 247, 0.12);
  color: #8b7bf7;
  font-size: 12px;
  font-weight: 800;
}

.drawer-head h2 {
  font-size: 28px;
  line-height: 1.1;
}

.drawer-head p {
  margin-top: 4px;
  color: #647184;
  word-break: break-all;
}

.drawer-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.drawer-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.drawer-badge.admin,
.drawer-badge.agent,
.drawer-badge.user {
  color: #fff;
}

.drawer-badge.admin {
  background: linear-gradient(135deg, #ee4d7a, #ff7eb3);
}

.drawer-badge.agent {
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
}

.drawer-badge.user {
  background: linear-gradient(135deg, #42c978, #2fb86e);
}

.drawer-badge.muted {
  background: #f4f7fb;
  color: #647184;
}

.drawer-section {
  padding: 14px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 26px rgba(21, 32, 51, 0.05);
  border: 1px solid #edf1f6;
}

.user-detail {
  display: grid;
  gap: 12px;
}

.user-detail div {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f8faff, #f5f7fc);
  transition: transform var(--motion-base) var(--motion-soft), background var(--motion-base) ease;
}

.user-detail div:hover {
  transform: translateX(4px);
  background: linear-gradient(180deg, #f3f6ff, #eef3ff);
}

.user-detail dt {
  color: #647184;
}

.user-detail dd {
  color: #152033;
  font-weight: 800;
}

.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.section-title label {
  color: #425066;
  font-size: 13px;
  font-weight: 800;
}

.section-title small {
  color: #9aa5b5;
  font-size: 12px;
  text-align: right;
  line-height: 1.45;
}

.section-title p {
  margin: 0;
}

.drawer-actions {
  display: grid;
  gap: 10px;
  padding-top: 2px;
}

.drawer-action {
  width: 100%;
  height: 44px;
  margin-top: 0;
  border-radius: 14px;
  color: #fff;
  font-weight: 800;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7 54%, #5b8def);
  transition: transform var(--motion-base) var(--motion-soft), box-shadow var(--motion-base) ease, filter var(--motion-base) ease;
}

.drawer-action.primary {
  box-shadow: 0 14px 28px rgba(139, 123, 247, 0.22);
}

.drawer-action:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 28px rgba(139, 123, 247, 0.24);
  filter: saturate(1.05);
}

.drawer-action:active {
  transform: scale(0.98);
}

.drawer-action.secondary {
  background: #f4f7fb;
  color: #425066;
  box-shadow: none;
  border: 1px solid #e6ebf2;
}

.drawer-action.secondary:hover {
  background: #eef3ff;
  color: #8b7bf7;
  box-shadow: 0 8px 18px rgba(139, 123, 247, 0.12);
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity var(--motion-base) ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-fade-enter-active .user-drawer,
.drawer-fade-leave-active .user-drawer {
  transition: transform var(--motion-base) var(--motion-soft), opacity var(--motion-base) ease;
}

.drawer-fade-enter-from .user-drawer,
.drawer-fade-leave-to .user-drawer {
  transform: translateX(100%) scale(0.98);
  opacity: 0.92;
}

.drawer-fade-enter-active .team-dialog,
.drawer-fade-enter-active .recharge-dialog,
.drawer-fade-leave-active .team-dialog,
.drawer-fade-leave-active .recharge-dialog {
  transition: transform 280ms var(--motion-soft), opacity 220ms ease;
}

.drawer-fade-enter-from .team-dialog,
.drawer-fade-enter-from .recharge-dialog,
.drawer-fade-leave-to .team-dialog,
.drawer-fade-leave-to .recharge-dialog {
  transform: scale(0.92) translateY(18px);
  opacity: 0;
}

/* ========== 角色徽章 ========== */

.role-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
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
  background: #f0f2f5;
  color: #647184;
}

/* ========== 推荐链接 ========== */

.referral-section {
  margin-top: 0;
  background: #fff;
}

.referral-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.referral-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(139, 123, 247, 0.12), rgba(91, 141, 239, 0.12));
  color: #8b7bf7;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.referral-header strong {
  display: block;
  font-size: 14px;
  color: #152033;
}

.referral-header small {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #9aa5b5;
}

.referral-link-box {
  display: flex;
  align-items: center;
  gap: 0;
  border-radius: 12px;
  border: 1px solid #e8edf4;
  background: #f8faff;
  overflow: hidden;
  transition: border-color var(--motion-base) ease, box-shadow var(--motion-base) ease;
}

.referral-link-box:hover {
  border-color: #d0c8fd;
  box-shadow: 0 4px 14px rgba(139, 123, 247, 0.08);
}

.referral-url {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  font-size: 13px;
  color: #647184;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
}

.referral-copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 10px 18px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  border: none;
  transition: filter var(--motion-fast) ease, transform var(--motion-fast) var(--motion-soft);
}

.referral-copy:hover {
  filter: brightness(1.08);
  transform: translateX(-1px);
}

.referral-copy:active {
  transform: scale(0.97);
}

.referral-copy.copied {
  background: linear-gradient(135deg, #42c978, #2fb86e);
}

/* ========== 团队 ========== */

.team-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7) !important;
}

.team-dialog {
  width: min(520px, 94vw);
  margin: auto;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 32px 80px rgba(21, 32, 51, 0.28);
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  overflow: hidden;
}

/* 头部 */
.team-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 28px 20px;
  background: linear-gradient(135deg, rgba(91, 141, 239, 0.08), rgba(139, 123, 247, 0.08));
  border-bottom: 1px solid #edf1f6;
}

.team-header-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  color: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: 0 8px 20px rgba(91, 141, 239, 0.28);
}

.team-title {
  font-size: 18px;
  font-weight: 800;
  color: #152033;
  margin: 0;
  line-height: 1.2;
}

.team-summary {
  color: #647184;
  font-size: 13px;
  margin: 2px 0 0;
}

.team-summary strong {
  color: #8b7bf7;
  font-weight: 800;
}

.team-close {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #9aa5b5;
  background: rgba(0, 0, 0, 0.04);
  display: grid;
  place-items: center;
  cursor: pointer;
  border: none;
  transition: all var(--motion-fast) ease;
}

.team-close:hover {
  color: #ee4d7a;
  background: #fff1f5;
  transform: rotate(90deg);
}

/* 内容区 */
.team-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.team-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 52px 0;
  color: #9aa5b5;
  font-size: 14px;
}

.team-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #edf1f6;
  border-top-color: #8b7bf7;
  border-radius: 50%;
  animation: team-spin 0.7s linear infinite;
}

@keyframes team-spin {
  to {
    transform: rotate(360deg);
  }
}

.team-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 52px 0;
  color: #9aa5b5;
}

.team-empty p {
  font-size: 15px;
  color: #647184;
  font-weight: 600;
  margin: 6px 0 0;
}

.team-empty small {
  font-size: 13px;
  color: #b0b8c6;
}

/* 成员卡片 */
.team-member {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: #f8faff;
  border: 1px solid transparent;
  margin-bottom: 10px;
  transition: all var(--motion-base) var(--motion-soft);
}

.team-member:last-child {
  margin-bottom: 0;
}

.team-member:hover {
  background: #fff;
  border-color: #e3e8f0;
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(21, 32, 51, 0.06);
}

.member-avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(139, 123, 247, 0.2);
}

.member-info {
  flex: 1;
  min-width: 0;
}

.member-name {
  font-size: 14px;
  font-weight: 700;
  color: #152033;
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-nick {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 6px;
  background: rgba(139, 123, 247, 0.1);
  color: #8b7bf7;
  font-size: 11px;
  font-weight: 600;
}

.member-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: #9aa5b5;
}

.member-meta svg {
  color: #c4cdd8;
}

.member-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.member-status.on {
  background: rgba(66, 201, 120, 0.1);
  color: #2fb86e;
}

.member-status.off {
  background: rgba(255, 107, 107, 0.1);
  color: #ff6b6b;
}

.member-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.member-status.on .member-status-dot {
  background: #42c978;
  box-shadow: 0 0 6px rgba(66, 201, 120, 0.5);
}

.member-status.off .member-status-dot {
  background: #ff6b6b;
}

/* 分页 */
.team-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 14px 20px 18px;
  border-top: 1px solid #f0f2f5;
}

.team-pager button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border-radius: 10px;
  background: #f6f8fc;
  color: #425066;
  font-weight: 700;
  font-size: 13px;
  border: 1px solid #edf1f6;
  cursor: pointer;
  transition: all var(--motion-fast) ease;
}

.team-pager button:hover:not(:disabled) {
  background: #eef3ff;
  color: #8b7bf7;
  border-color: #d8d0fd;
}

.team-pager button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.team-pager span {
  color: #647184;
  font-size: 13px;
  font-weight: 600;
}

/* ========== 充值弹窗 ========== */

.recharge-dialog {
  width: min(440px, 92vw);
  margin: auto;
  padding: 32px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 32px 64px rgba(21, 32, 51, 0.24);
  position: relative;
}

.recharge-dialog>.drawer-close {
  position: absolute;
  top: 16px;
  right: 16px;
}

.recharge-title {
  font-size: 24px;
  color: #152033;
  margin-bottom: 6px;
}

.recharge-balance {
  color: #647184;
  margin-bottom: 22px;
}

.recharge-balance strong {
  color: #152033;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.preset-item {
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 2px solid #e8edf3;
  background: #f6f8fc;
  color: #152033;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: all var(--motion-base) var(--motion-soft);
}

.preset-item:hover {
  border-color: #c4b8fd;
  background: #f3f0ff;
  color: #8b7bf7;
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(139, 123, 247, 0.12);
}

.preset-item.active {
  border-color: #8b7bf7;
  background: linear-gradient(135deg, #f3f0ff, #ece8ff);
  color: #8b7bf7;
  box-shadow: 0 8px 20px rgba(139, 123, 247, 0.18);
}

.custom-amount {
  margin-bottom: 18px;
}

.custom-amount label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #425066;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  border: 2px solid #dfe5ec;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color var(--motion-base) ease, box-shadow var(--motion-base) ease;
}

.amount-input-wrap:focus-within {
  border-color: #8b7bf7;
  box-shadow: 0 0 0 4px rgba(139, 123, 247, 0.12);
}

.amount-prefix {
  padding: 0 12px;
  font-size: 18px;
  font-weight: 800;
  color: #8b7bf7;
  background: #f6f8fc;
  height: 44px;
  display: grid;
  place-items: center;
}

.amount-input-wrap input {
  flex: 1;
  height: 44px;
  padding: 0 14px;
  border: 0;
  outline: 0;
  font-size: 18px;
  font-weight: 700;
  color: #152033;
  background: transparent;
}

.amount-input-wrap input::placeholder {
  color: #b0b8c6;
  font-weight: 400;
}

.amount-input-wrap input::-webkit-outer-spin-button,
.amount-input-wrap input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.recharge-error {
  color: #ee4d7a;
  font-size: 13px;
  margin: 0 0 12px;
}

.recharge-submit {
  margin-top: 4px;
}

.recharge-submit.loading {
  opacity: 0.7;
  pointer-events: none;
}

.recharge-hint {
  text-align: center;
  color: #9aa5b5;
  font-size: 12px;
  margin-top: 14px;
}

/* ========== 手机端菜单按钮 ========== */

.mobile-menu-btn {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 36px;
  height: 36px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: background 0.2s ease;
}

.mobile-menu-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.mobile-menu-btn span {
  display: block;
  width: 18px;
  height: 2px;
  background: #fff;
  border-radius: 2px;
  transition: transform 0.25s ease, opacity 0.2s ease;
}

.mobile-menu-btn.open span:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}

.mobile-menu-btn.open span:nth-child(2) {
  opacity: 0;
}

.mobile-menu-btn.open span:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}

/* ========== 响应式 ========== */

@media (prefers-reduced-motion: reduce) {

  .workspace-layout *,
  .workspace-layout *::before,
  .workspace-layout *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}

@media (max-width: 1180px) {
  .ws-topbar {
    grid-template-columns: auto 1fr;
    padding: 16px;
  }

  .ws-actions {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
}

@media (max-width: 760px) {
  .site-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    background: #111827;
    color: rgba(255, 255, 255, 0.88);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  .site-bar svg {
    opacity: 0.7;
  }

  .ws-topbar {
    margin: 0;
    border-radius: 0;
    grid-template-columns: auto 1fr auto;
    padding: 0 14px;
    min-height: 52px;
    gap: 10px;
    background: #fff;
    color: #152033;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .mobile-menu-btn {
    display: flex !important;
    background: rgba(0, 0, 0, 0.04);
  }

  .mobile-menu-btn span {
    background: #425066;
  }

  .mobile-menu-btn:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  .ws-nav {
    display: none !important;
  }

  .ws-brand {
    min-width: 0;
    white-space: nowrap;
  }

  .ws-brand img {
    width: 26px;
    height: 26px;
  }

  .ws-brand strong {
    font-size: 16px;
    letter-spacing: 0.5px;
    color: #152033;
  }

  .ws-actions .topbar-btn {
    display: none !important;
  }

  .ws-actions {
    grid-column: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .ws-actions .balance-pill {
    font-size: 12px;
    padding: 4px 4px 4px 10px;
    gap: 6px;
    background: transparent;
    border-color: transparent;
  }

  .ws-actions .balance-pill:hover {
    background: rgba(0, 0, 0, 0.03);
  }

  .ws-actions .balance-pill .balance-label {
    color: #9aa5b5;
    font-size: 9px;
    letter-spacing: 0.5px;
  }

  .ws-actions .balance-value {
    color: #152033;
    font-size: 14px;
  }

  .ws-actions .recharge-btn {
    padding: 3px 10px;
    font-size: 11px;
    background: #2563eb;
    color: #fff;
  }

  .ws-actions .avatar-button {
    display: grid;
    width: 32px;
    height: 32px;
    font-size: 13px;
    border-color: rgba(0, 0, 0, 0.1);
  }

  .workspace-layout.has-mobile-user-tabbar .ws-topbar {
    grid-template-columns: minmax(0, 1fr) auto;
    justify-content: space-between;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-brand {
    justify-self: start;
    overflow: hidden;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-brand strong {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions {
    justify-self: end;
    gap: 6px;
    min-width: 0;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions .balance-pill {
    min-width: 0;
    max-width: min(170px, calc(100vw - 188px));
    padding: 5px 5px 5px 8px;
    gap: 5px;
    border-radius: 999px;
    background: #f7f9ff;
    border: 1px solid #e8eefc;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions .balance-label {
    flex: 0 0 auto;
    color: #7a879b;
    font-size: 10px;
    letter-spacing: 0;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions .balance-value {
    min-width: 0;
    color: #111827;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions .recharge-btn {
    flex: 0 0 auto;
    padding: 3px 8px;
  }

  .workspace-layout.has-mobile-user-tabbar .ws-actions .avatar-button {
    flex: 0 0 auto;
  }

  @media (max-width: 380px) {
    .workspace-layout.has-mobile-user-tabbar .ws-brand strong {
      max-width: 68px;
    }

    .workspace-layout.has-mobile-user-tabbar .ws-actions .balance-label {
      display: none;
    }

    .workspace-layout.has-mobile-user-tabbar .ws-actions .balance-pill {
      max-width: calc(100vw - 174px);
    }
  }

  .workspace-layout.has-mobile-user-tabbar {
    --mobile-user-tabbar-clearance: calc(92px + env(safe-area-inset-bottom, 0px));
    padding-bottom: var(--mobile-user-tabbar-clearance);
  }

  .mobile-user-tabbar {
    position: fixed;
    left: 50%;
    right: auto;
    bottom: calc(11px + env(safe-area-inset-bottom, 0px));
    z-index: 900;
    width: min(calc(100vw - 16px), 450px);
    height: 64px;
    display: grid;
    grid-template-columns:
      repeat(2, minmax(62px, 82px))
      minmax(74px, 88px)
      repeat(2, minmax(62px, 82px));
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 7px 8px;
    border: 1px solid rgba(255, 255, 255, 0.64);
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.72) 100%),
      rgba(255, 255, 255, 0.64);
    box-shadow:
      0 -12px 36px rgba(15, 23, 42, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(22px) saturate(1.25);
    -webkit-backdrop-filter: blur(22px) saturate(1.25);
    transform: translateX(-50%);
    overflow: visible;
  }

  .mobile-user-tabbar button {
    position: relative;
    z-index: 1;
    min-width: 0;
    height: 50px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 1px solid transparent;
    border-radius: 14px;
    color: #728094;
    font-size: 10.5px;
    font-weight: 800;
    line-height: 1;
    transition: color var(--motion-fast) ease, background var(--motion-fast) ease, border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease, transform var(--motion-fast) ease;
  }

  .mobile-user-tabbar button:not(.primary) {
    transform: translateY(-6px);
  }

  .mobile-user-tabbar button:not(.primary)::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 2px;
    width: 24px;
    height: 3px;
    border-radius: 999px;
    background: transparent;
    transform: translateX(-50%);
    transition: background var(--motion-fast) ease, opacity var(--motion-fast) ease;
  }

  .mobile-user-tabbar button:active {
    transform: scale(0.96);
  }

  .mobile-user-tabbar button:not(.primary):active {
    transform: translateY(-6px) scale(0.96);
  }

  .mobile-user-tabbar button.active {
    color: #2f6df6;
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  .mobile-user-tabbar button:not(.primary).active::before {
    background: linear-gradient(90deg, #ec4f8b 0%, #2f6df6 100%);
  }

  .mobile-user-tabbar button.primary {
    position: relative;
    justify-self: center;
    align-self: center;
    width: 56px;
    height: 56px;
    color: #fff;
    border-color: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    background: linear-gradient(135deg, #ec4f8b 0%, #2f6df6 100%);
    box-shadow:
      0 14px 24px rgba(47, 109, 246, 0.28),
      0 6px 14px rgba(236, 79, 139, 0.18),
      0 4px 10px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.5);
    transform: translateY(-16px);
  }

  .mobile-user-tabbar button.primary.active {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.96);
    background: linear-gradient(135deg, #ec4f8b 0%, #2f6df6 100%);
    box-shadow:
      0 16px 30px rgba(47, 109, 246, 0.34),
      0 8px 18px rgba(236, 79, 139, 0.22),
      0 5px 12px rgba(15, 23, 42, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.52);
  }

  .mobile-user-tabbar button.primary:active {
    transform: translateY(-16px) scale(0.96);
  }

  .mobile-tab-icon {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
  }

  .mobile-tab-icon svg {
    width: 21px;
    height: 21px;
    fill: currentColor;
  }

  .mobile-user-tabbar button.primary .mobile-tab-icon {
    width: 24px;
    height: 24px;
  }

  .mobile-user-tabbar button.primary .mobile-tab-icon svg {
    width: 23px;
    height: 23px;
  }

  .mobile-user-tabbar button.primary span:last-child {
    margin-top: -1px;
    color: rgba(255, 255, 255, 0.96);
    font-size: 10px;
  }

  .mobile-user-tabbar::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 5px;
    width: 74px;
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(236, 79, 139, 0.18), rgba(47, 109, 246, 0.2));
    transform: translateX(-50%);
  }

  @media (max-width: 360px) {
    .mobile-user-tabbar {
      width: calc(100vw - 16px);
      padding-inline: 7px;
      grid-template-columns:
        repeat(2, minmax(44px, 1fr))
        minmax(64px, 74px)
        repeat(2, minmax(44px, 1fr));
    }

    .mobile-user-tabbar button {
      font-size: 10px;
    }

    .mobile-user-tabbar button.primary {
      width: 54px;
      height: 54px;
    }
  }

  :global(body.has-mobile-user-tabbar .chat-fab) {
    bottom: calc(98px + env(safe-area-inset-bottom, 0px)) !important;
  }

  .mobile-query-fab {
    position: fixed;
    left: 18px;
    bottom: calc(98px + env(safe-area-inset-bottom, 0px));
    z-index: 901;
    width: 58px;
    height: 58px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 1px solid rgba(255, 255, 255, 0.72);
    border-radius: 20px;
    color: #516079;
    font-size: 11px;
    font-weight: 900;
    line-height: 1;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(247, 250, 255, 0.72) 100%),
      rgba(255, 255, 255, 0.58);
    box-shadow:
      0 14px 34px rgba(15, 23, 42, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(20px) saturate(1.25);
    -webkit-backdrop-filter: blur(20px) saturate(1.25);
    transition: color var(--motion-fast) ease, transform var(--motion-fast) ease, box-shadow var(--motion-fast) ease, background var(--motion-fast) ease;
  }

  .mobile-query-fab svg {
    width: 23px;
    height: 23px;
    fill: currentColor;
  }

  .mobile-query-fab.active {
    color: #fff;
    background: linear-gradient(135deg, #5b8def 0%, #8b7bf7 100%);
    box-shadow:
      0 16px 32px rgba(91, 141, 239, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.44);
  }

  .mobile-query-fab:active {
    transform: scale(0.95);
  }

  @media (max-width: 360px) {
    .mobile-query-fab {
      left: 12px;
      bottom: calc(94px + env(safe-area-inset-bottom, 0px));
      width: 54px;
      height: 54px;
      border-radius: 18px;
      font-size: 10px;
    }
  }

  .drawer-mask {
    justify-content: center;
    align-items: flex-end;
    background: rgba(21, 32, 51, 0.48);
  }

  .user-drawer {
    width: 100%;
    max-width: 100%;
    height: auto;
    max-height: calc(100vh - 12px);
    padding: 14px 14px calc(16px + env(safe-area-inset-bottom));
    border-left: 0;
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    box-shadow: 0 -20px 54px rgba(21, 32, 51, 0.24);
  }

  .workspace-layout.has-mobile-user-tabbar .user-drawer {
    margin-bottom: var(--mobile-user-tabbar-clearance);
    max-height: calc(100vh - var(--mobile-user-tabbar-clearance) - 12px);
    border-bottom-left-radius: 22px;
    border-bottom-right-radius: 22px;
  }

  .drawer-hero {
    padding: 14px;
    border-radius: 16px;
  }

  .drawer-head h2 {
    font-size: 24px;
  }

  .drawer-badges {
    gap: 6px;
    margin-top: 12px;
  }

  .drawer-badge {
    padding: 5px 9px;
  }

  .drawer-section {
    padding: 12px;
    border-radius: 14px;
  }

  .user-detail div {
    padding: 12px 14px;
  }

  .section-title {
    flex-direction: column;
    align-items: flex-start;
  }

  .section-title small {
    text-align: left;
  }

  .drawer-actions {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  /* 手机端：底部上滑/下滑动画 */
  .drawer-fade-enter-active .user-drawer,
  .drawer-fade-leave-active .user-drawer {
    transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms ease;
  }

  .drawer-fade-enter-from .user-drawer,
  .drawer-fade-leave-to .user-drawer {
    transform: translateY(100%);
    opacity: 1;
  }

  /* 手机端：团队弹窗 —— 从下往上弹出（与用户中心一致） */
  .team-dialog {
    width: 100%;
    max-width: 100%;
    max-height: calc(100vh - 12px);
    margin: 0;
    border-radius: 22px 22px 0 0;
    align-self: flex-end;
    box-shadow: 0 -20px 54px rgba(21, 32, 51, 0.24);
  }

  .drawer-fade-enter-active .team-dialog,
  .drawer-fade-leave-active .team-dialog {
    transition: transform 320ms cubic-bezier(.22, 1, .36, 1), opacity 200ms ease;
  }

  .drawer-fade-enter-from .team-dialog,
  .drawer-fade-leave-to .team-dialog {
    transform: translateY(100%);
    opacity: 1;
  }

  .team-header {
    padding: 18px 16px 14px;
  }

  .team-header-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
  }

  .team-body {
    padding: 12px 14px calc(14px + env(safe-area-inset-bottom));
  }

  .team-member {
    padding: 12px 14px;
    border-radius: 12px;
    gap: 12px;
    margin-bottom: 8px;
  }

  .member-avatar {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    font-size: 14px;
  }

  .member-name {
    font-size: 13px;
  }

  .member-status {
    padding: 3px 10px;
    font-size: 11px;
  }

  .team-pager {
    padding: 12px 14px calc(14px + env(safe-area-inset-bottom));
  }
}
</style>

<!-- Teleport 内容不受 scoped 限制 -->
<style>
.mobile-nav-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, .45);
  backdrop-filter: blur(4px);
  overscroll-behavior: none;
  touch-action: none;
}

.mobile-nav-drawer {
  position: absolute;
  top: 0;
  right: 0;
  width: min(300px, 82vw);
  height: 100%;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, .18);
  overscroll-behavior: contain;
  touch-action: pan-y;
}

.mobile-nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 18px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.mobile-nav-user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mobile-nav-user strong {
  display: block;
  font-size: 16px;
}

.mobile-nav-user small {
  display: block;
  font-size: 12px;
  opacity: .8;
  margin-top: 2px;
}

.mobile-nav-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, .2);
  color: #fff;
  border: none;
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.mobile-nav-list {
  flex: 1;
  padding: 12px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.mobile-nav-list button {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 22px;
  border: none;
  font-size: 15px;
  font-weight: 600;
  color: #425066;
  background: none;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}

.mobile-nav-list button:hover {
  background: #f6f8fc;
}

.mobile-nav-list button.active {
  color: #8b7bf7;
  background: linear-gradient(90deg, #f3f0ff, transparent);
  border-right: 3px solid #8b7bf7;
}

.mobile-nav-list button svg {
  flex-shrink: 0;
}

.mobile-nav-footer {
  padding: 16px 22px;
  border-top: 1px solid #f0f2f5;
}

.mobile-nav-footer button {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: #fff1f0;
  color: #ff4d4f;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: background .15s ease;
}

.mobile-nav-footer button:hover {
  background: #ffe4e3;
}

.mobile-nav-enter-active,
.mobile-nav-leave-active {
  transition: opacity .25s ease;
}

.mobile-nav-enter-active .mobile-nav-drawer,
.mobile-nav-leave-active .mobile-nav-drawer {
  transition: transform .3s cubic-bezier(.22, 1, .36, 1);
}

.mobile-nav-enter-from,
.mobile-nav-leave-to {
  opacity: 0;
}

.mobile-nav-enter-from .mobile-nav-drawer,
.mobile-nav-leave-to .mobile-nav-drawer {
  transform: translateX(100%);
}
</style>
