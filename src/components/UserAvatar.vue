<script setup>
import { computed, ref, watch } from 'vue'
import { displayUserName, getUserInitial, getAvatarColors } from '../utils/userAvatar.js'

const props = defineProps({
  name: { type: [String, Object], default: '' },
  src: { type: String, default: '' },
  size: { type: [Number, String], default: 34 },
  shape: { type: String, default: 'circle' },
  alt: { type: String, default: '' },
  bordered: { type: Boolean, default: false }
})

const imgFailed = ref(false)

watch(() => props.src, () => {
  imgFailed.value = false
})

const label = computed(() => displayUserName(props.name))
const initial = computed(() => getUserInitial(label.value))
const showImg = computed(() => !!props.src?.trim() && !imgFailed.value)

const colors = computed(() => getAvatarColors(label.value))

const rootStyle = computed(() => {
  const n = Number(props.size) || 34
  const { bg, fg } = colors.value
  return {
    background: bg,
    color: fg,
    width: `${n}px`,
    height: `${n}px`,
    minWidth: `${n}px`,
    minHeight: `${n}px`,
    fontSize: `${Math.max(12, Math.round(n * 0.42))}px`
  }
})

const initialStyle = computed(() => ({ color: colors.value.fg }))
</script>

<template>
  <span
    class="user-avatar"
    :class="[`user-avatar--${shape}`, { 'user-avatar--bordered': bordered }]"
    :style="rootStyle"
    role="img"
    :aria-label="alt || label"
  >
    <img
      v-if="showImg"
      :src="src"
      :alt="alt || label"
      class="user-avatar__img"
      @error="imgFailed = true"
    />
    <span v-else class="user-avatar__initial" :style="initialStyle">{{ initial }}</span>
  </span>
</template>

<style scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  font-weight: 800;
  line-height: 1;
  user-select: none;
  vertical-align: middle;
  aspect-ratio: 1;
  box-sizing: border-box;
}

.user-avatar--circle {
  border-radius: 50%;
}

.user-avatar--rounded {
  border-radius: 12px;
}

.user-avatar--bordered {
  box-shadow: 0 0 0 2px #fff, 0 2px 8px rgba(21, 32, 51, 0.1);
}

.user-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.user-avatar__initial {
  text-transform: uppercase;
  letter-spacing: -0.02em;
  line-height: 1;
}
</style>
