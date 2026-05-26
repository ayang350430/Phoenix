import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../components/HomePage.vue'),
    meta: { layout: 'public' }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../components/LoginPage.vue'),
    meta: { layout: 'public' }
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../components/DashboardPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../components/AdminPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/records',
    name: 'Records',
    component: () => import('../components/RecordsPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/batch',
    name: 'Batch',
    component: () => import('../components/BatchSubmitPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/products',
    name: 'Products',
    component: () => import('../components/ProductPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/support',
    name: 'Support',
    component: () => import('../components/CustomerServicePage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/cs-config',
    name: 'CsConfig',
    component: () => import('../components/CsConfigPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/refund',
    name: 'Refund',
    component: () => import('../components/RefundManagePage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/order-lookup',
    name: 'OrderLookup',
    component: () => import('../components/OrderLookupPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/embed-guide',
    name: 'EmbedGuide',
    component: () => import('../components/EmbedGuidePage.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const hasToken = !!localStorage.getItem('token')

  // 未登录访问需要认证的页面 → 跳登录
  if (to.meta.requiresAuth && !hasToken) {
    next('/login')
    return
  }

  // 已登录访问公开页面 → 跳仪表盘
  if (hasToken && (to.path === '/' || to.path === '/login')) {
    next('/dashboard')
    return
  }

  next()
})

export default router
