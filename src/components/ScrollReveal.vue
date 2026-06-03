<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  from: { type: String, default: 'right' },
  delay: { type: Number, default: 0 },
  instant: { type: Boolean, default: false }
})

const root = ref(null)
const visible = ref(false)

let observer = null

function updateVisibility(entry) {
  const vh = window.innerHeight
  const { isIntersecting, intersectionRatio, boundingClientRect: rect } = entry

  if (!isIntersecting || rect.bottom <= 0 || rect.top >= vh) {
    visible.value = false
    return
  }

  // 进入视口一定比例，或顶部已进入可视区即显示（下滚更灵敏）
  visible.value = intersectionRatio >= 0.08 || rect.top < vh * 0.9
}

onMounted(() => {
  if (props.instant) {
    visible.value = true
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]) updateVisibility(entries[0])
    },
    {
      root: null,
      rootMargin: '0px 0px -5% 0px',
      threshold: [0, 0.05, 0.08, 0.12, 0.2, 0.35, 0.5, 0.75, 1]
    }
  )

  if (root.value) observer.observe(root.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div
    ref="root"
    class="scroll-reveal"
    :class="[
      `scroll-reveal--${from}`,
      { 'is-visible': visible, 'is-instant': instant }
    ]"
    :style="{ '--reveal-delay': `${delay}ms` }"
  >
    <slot />
  </div>
</template>

<style scoped>
.scroll-reveal {
  --reveal-x: 56px;
  --reveal-y: 16px;
  opacity: 0;
  transform: translate3d(var(--reveal-x), var(--reveal-y), 0);
  transition:
    opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.65s cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: 0ms;
}

.scroll-reveal--left {
  --reveal-x: -56px;
}

.scroll-reveal--up {
  --reveal-x: 0;
  --reveal-y: 32px;
}

.scroll-reveal.is-visible {
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transition-delay: var(--reveal-delay, 0ms);
}

@media (prefers-reduced-motion: reduce) {
  .scroll-reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
