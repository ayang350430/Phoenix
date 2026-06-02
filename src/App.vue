<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from './i18n'
import WorkspaceLayout from './components/WorkspaceLayout.vue'

const { t, locale } = useI18n()
const route = useRoute()

const isAuthPage = computed(() => !!route.meta.requiresAuth)

watch([locale, () => route.name], () => {
  const name = route.name
  document.title = name === 'Admin' ? '权限管理 - Phoenix'
    : name === 'Batch' ? '批量下单 - Phoenix'
    : name === 'MyOrders' ? '下单记录 - Phoenix'
    : name === 'Dashboard' ? t('dashboard.siteTitle')
    : name === 'Login' ? t('login.siteTitle')
    : t('siteTitle')
}, { immediate: true })
</script>

<template>
  <div class="page">
    <router-view v-slot="{ Component, route }">
      <WorkspaceLayout v-if="isAuthPage">
        <Transition name="page-fade" mode="out-in">
          <div :key="route.path" class="page-transition-wrap">
            <component :is="Component" />
          </div>
        </Transition>
      </WorkspaceLayout>
      <Transition v-else name="page-fade" mode="out-in">
        <div :key="route.path" class="page-transition-wrap">
          <component :is="Component" />
        </div>
      </Transition>
    </router-view>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #ffffff;
}

.page-transition-wrap {
  width: 100%;
  min-height: 0;
}
</style>

<style>
/* 路由切换进场动画（需全局，作用于 Transition 包裹层） */
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: none;
  }

  .page-fade-enter-from,
  .page-fade-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
