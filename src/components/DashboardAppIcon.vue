<script setup>
defineProps({
  type: { type: String, required: true },
  tone: { type: String, default: 'blue' }
})
</script>

<template>
  <span class="dash-app-icon" :class="`dash-app-icon--${tone}`" aria-hidden="true">
    <!-- 批量提交 -->
    <svg v-if="type === 'batch'" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5" width="14" height="16" rx="2.5" stroke="currentColor" stroke-width="1.7" />
      <path d="M8 9h6M8 12.5h6M8 16h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <path d="M16 8v11a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>

    <!-- 阅读任务 -->
    <svg v-else-if="type === 'read'" viewBox="0 0 24 24" fill="none">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      <path d="M9 7h6M9 10.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
    </svg>

    <!-- 点赞任务 -->
    <svg v-else-if="type === 'like'" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 21s-6.5-4.35-8.5-8.2C1.8 9.6 3.4 6.5 6.6 6c1.7-.3 3.2.4 4.1 1.6.9-1.2 2.4-1.9 4.1-1.6 3.2.5 4.8 3.6 3.1 6.8C18.5 16.65 12 21 12 21z"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
    </svg>

    <!-- 曝光任务 -->
    <svg v-else-if="type === 'impression'" viewBox="0 0 24 24" fill="none">
      <path d="M3 18V6a2 2 0 0 1 2-2h8l6 6v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      <path d="M13 4v6h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M7 14.5 9.5 17 13 12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <!-- 预校验 -->
    <svg v-else-if="type === 'validate'" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3 20 7v6c0 4.2-3.2 7.8-8 9-4.8-1.2-8-4.8-8-9V7l8-4z"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
      <path d="m9 12 2 2 4-4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <!-- 下单记录 -->
    <svg v-else viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3" width="14" height="18" rx="2.5" stroke="currentColor" stroke-width="1.7" />
      <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      <circle cx="17" cy="17" r="4.5" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.4" />
      <path d="M16 17l.75.75L18.25 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</template>

<style scoped>
.dash-app-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  color: #fff;
  box-shadow:
    0 8px 18px rgba(21, 32, 51, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.dash-app-icon svg {
  width: 24px;
  height: 24px;
}

.dash-app-icon--pink {
  background: linear-gradient(145deg, #ff6b93, #ee4d7a 55%, #d93662);
}

.dash-app-icon--blue {
  background: linear-gradient(145deg, #5b8def, #2f6df6 55%, #1d4ed8);
}

.dash-app-icon--purple {
  background: linear-gradient(145deg, #a78bfa, #8b7bf7 55%, #7c3aed);
}

.dash-app-icon--cyan {
  background: linear-gradient(145deg, #22d3ee, #06b6d4 55%, #0891b2);
}

.dash-app-icon--green {
  background: linear-gradient(145deg, #4ade80, #10b981 55%, #059669);
}

.dash-app-icon--orange {
  background: linear-gradient(145deg, #fbbf24, #f59e0b 55%, #d97706);
}
</style>
