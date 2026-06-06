<script setup>
import kongImg from '../assets/kong.png'

defineProps({
  text: { type: String, default: '暂无数据' },
  description: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  loadingText: { type: String, default: '加载中...' },
  compact: { type: Boolean, default: false },
  mini: { type: Boolean, default: false }
})
</script>

<template>
  <div
    class="goosd-empty"
    :class="{
      'goosd-empty--compact': compact,
      'goosd-empty--mini': mini,
      'goosd-empty--loading': loading
    }"
  >
    <template v-if="loading">
      <div class="goosd-empty-spinner" aria-hidden="true" />
      <p class="goosd-empty-text">
        <slot>{{ loadingText }}</slot>
      </p>
    </template>
    <template v-else>
      <img class="goosd-empty-img" :src="kongImg" alt="" />
      <p v-if="text || $slots.default" class="goosd-empty-text">
        <slot>{{ text }}</slot>
      </p>
      <p v-if="description" class="goosd-empty-desc">{{ description }}</p>
    </template>
  </div>
</template>

<style scoped>
.goosd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 48px 24px;
  width: 100%;
  box-sizing: border-box;
}

.goosd-empty--compact {
  padding: 32px 16px;
  gap: 8px;
}

.goosd-empty--mini {
  padding: 20px 12px;
  gap: 6px;
  min-height: 0;
}

.goosd-empty-img {
  width: 160px;
  height: auto;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

.goosd-empty--compact .goosd-empty-img {
  width: 120px;
}

.goosd-empty--mini .goosd-empty-img {
  width: 88px;
}

.goosd-empty-text {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  line-height: 1.5;
}

.goosd-empty--mini .goosd-empty-text {
  font-size: 13px;
  font-weight: 500;
}

.goosd-empty-desc {
  margin: 0;
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  max-width: 280px;
}

.goosd-empty-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e8edf4;
  border-top-color: #2f6df6;
  border-radius: 50%;
  animation: goosd-empty-spin 0.7s linear infinite;
}

.goosd-empty--loading {
  gap: 12px;
}

@keyframes goosd-empty-spin {
  to { transform: rotate(360deg); }
}
</style>
