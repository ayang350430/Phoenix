import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'

const _fetch = window.fetch
let kickHandled = false
window.fetch = async function (...args) {
  const res = await _fetch.apply(this, args)
  if (res.status === 401 && !kickHandled) {
    const cloned = res.clone()
    try {
      const body = await cloned.json()
      if (body.code === 4011) {
        kickHandled = true
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        const [{ ElMessageBox }] = await Promise.all([
          import('element-plus'),
          import('element-plus/es/components/message-box/style/css')
        ])
        ElMessageBox.alert(body.message || '账号已在其他地方登录，您已被迫下线', '下线通知', {
          confirmButtonText: '重新登录',
          type: 'warning',
          callback: () => {
            kickHandled = false
            window.location.href = '/login'
          }
        })
      }
    } catch { /* ignore */ }
  }
  return res
}

createApp(App).use(router).mount('#app')
