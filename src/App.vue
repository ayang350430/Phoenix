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
    : name === 'Dashboard' ? t('dashboard.siteTitle')
    : name === 'Login' ? t('login.siteTitle')
    : t('siteTitle')
}, { immediate: true })
</script>

<template>
  <div class="page">
    <router-view v-slot="{ Component }">
      <WorkspaceLayout v-if="isAuthPage">
        <component :is="Component" />
      </WorkspaceLayout>
      <component v-else :is="Component" />
    </router-view>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #ffffff;
}
</style>
