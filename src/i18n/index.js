import { ref, reactive, watchEffect } from 'vue'
import zhMessages from './zh.js'
import enMessages from './en.js'

const allMessages = { zh: zhMessages, en: enMessages }
const locale = ref('zh')

function resolve(obj, key) {
  return key.split('.').reduce((o, k) => o?.[k], obj) || key
}

const current = reactive({})

function sync() {
  const msgs = allMessages[locale.value] || allMessages.zh
  Object.keys(msgs).forEach(k => {
    current[k] = msgs[k]
  })
}
sync()

export function useI18n() {
  return {
    locale,
    current,
    t(key) {
      return resolve(current, key)
    },
    toggleLocale() {
      locale.value = locale.value === 'zh' ? 'en' : 'zh'
      sync()
    }
  }
}
