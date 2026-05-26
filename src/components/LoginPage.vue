<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ArrowRight, Hide, Lock, Message, User, View } from '@element-plus/icons-vue'
import { useI18n } from '../i18n'
import logoSvg from '../assets/logo.svg'
import bannerImg from '../assets/banner.png'

const { t, locale, toggleLocale } = useI18n()

// ========== 登录 ==========
const loginUsername = ref('')
const loginPassword = ref('')
const loginLoading = ref(false)
const loginError = ref('')
const showPassword = ref(false)
const remember = ref(false)

// ========== 注册 ==========
const regUsername = ref('')
const regPassword = ref('')
const regConfirm = ref('')
const regLoading = ref(false)
const regError = ref('')
const sliderRef = ref(null)
const dragging = ref(false)
const verified = ref(false)
const dragStartX = ref(0)
const dragStartOffset = ref(0)
const sliderOffset = ref(0)
const handleWidth = 48
const authMode = ref('login')
const forgotEmail = ref('')
const forgotLoading = ref(false)
const forgotStep = ref(1)           // 1=输邮箱  2=输验证码+新密码
const forgotError = ref('')
const forgotCode = ref('')
const forgotPassword = ref('')
const forgotConfirm = ref('')
const resetLoading = ref(false)
const resetDone = ref(false)
const countdown = ref(0)
let countdownTimer = null

function startCountdown(sec = 60) {
  countdown.value = sec
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearInterval(countdownTimer)
  }, 1000)
}

async function handleSendCode() {
  forgotError.value = ''
  if (!forgotEmail.value || !forgotEmail.value.includes('@')) {
    forgotError.value = '请输入有效的邮箱地址'
    return
  }
  forgotLoading.value = true
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail.value })
    })
    const data = await res.json()
    if (data.code !== 0) {
      forgotError.value = data.message || '发送失败'
      return
    }
    forgotStep.value = 2
    startCountdown(60)
  } catch {
    forgotError.value = '网络错误，请重试'
  } finally {
    forgotLoading.value = false
  }
}

async function handleResendCode() {
  if (countdown.value > 0) return
  forgotError.value = ''
  forgotLoading.value = true
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail.value })
    })
    const data = await res.json()
    if (data.code !== 0) {
      forgotError.value = data.message || '发送失败'
      return
    }
    startCountdown(60)
  } catch {
    forgotError.value = '网络错误，请重试'
  } finally {
    forgotLoading.value = false
  }
}

async function handleResetPassword() {
  forgotError.value = ''
  if (!forgotCode.value || forgotCode.value.length !== 6) {
    forgotError.value = '请输入 6 位验证码'
    return
  }
  if (!forgotPassword.value || forgotPassword.value.length < 6) {
    forgotError.value = '密码至少 6 位'
    return
  }
  if (forgotPassword.value !== forgotConfirm.value) {
    forgotError.value = '两次输入的密码不一致'
    return
  }
  resetLoading.value = true
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: forgotEmail.value,
        code: forgotCode.value,
        password: forgotPassword.value
      })
    })
    const data = await res.json()
    if (data.code !== 0) {
      forgotError.value = data.message || '重置失败'
      return
    }
    resetDone.value = true
  } catch {
    forgotError.value = '网络错误，请重试'
  } finally {
    resetLoading.value = false
  }
}

const sliderMax = computed(() => {
  const width = sliderRef.value?.clientWidth || 0
  return Math.max(0, width - handleWidth)
})

const sliderProgress = computed(() => {
  if (verified.value) return '100%'
  return `${sliderOffset.value + handleWidth}px`
})

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function pointX(event) {
  return event.touches?.[0]?.clientX ?? event.clientX
}

function startDrag(event) {
  if (verified.value) return
  dragging.value = true
  dragStartX.value = pointX(event)
  dragStartOffset.value = sliderOffset.value
  window.addEventListener('mousemove', moveDrag)
  window.addEventListener('mouseup', endDrag)
  window.addEventListener('touchmove', moveDrag, { passive: false })
  window.addEventListener('touchend', endDrag)
}

function moveDrag(event) {
  if (!dragging.value) return
  event.preventDefault?.()
  const nextOffset = dragStartOffset.value + pointX(event) - dragStartX.value
  sliderOffset.value = clamp(nextOffset, 0, sliderMax.value)
}

function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  if (sliderOffset.value >= sliderMax.value * 0.86) {
    sliderOffset.value = sliderMax.value
    verified.value = true
  } else {
    sliderOffset.value = 0
  }
  window.removeEventListener('mousemove', moveDrag)
  window.removeEventListener('mouseup', endDrag)
  window.removeEventListener('touchmove', moveDrag)
  window.removeEventListener('touchend', endDrag)
}

function resetSlider() {
  verified.value = false
  nextTick(() => {
    sliderOffset.value = 0
  })
}

function switchMode(mode) {
  authMode.value = mode
  resetSlider()
  // 重置各表单状态
  loginError.value = ''
  regError.value = ''
  forgotStep.value = 1
  forgotError.value = ''
  forgotCode.value = ''
  forgotPassword.value = ''
  forgotConfirm.value = ''
  resetDone.value = false
  countdown.value = 0
  clearInterval(countdownTimer)
}

async function handleLogin() {
  loginError.value = ''
  if (!loginUsername.value) { loginError.value = '请输入用户名'; return }
  if (!loginPassword.value) { loginError.value = '请输入密码'; return }
  if (!verified.value) { loginError.value = '请先完成滑块验证'; return }

  loginLoading.value = true
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: loginUsername.value, password: loginPassword.value })
    })
    const data = await res.json()
    if (data.code !== 0) {
      loginError.value = data.message || '登录失败'
      return
    }
    // 存储 token 和用户信息
    localStorage.setItem('token', data.data.token)
    localStorage.setItem('user', JSON.stringify(data.data.user))
    if (remember.value) {
      localStorage.setItem('remember_user', loginUsername.value)
    } else {
      localStorage.removeItem('remember_user')
    }
    window.location.href = '/dashboard'
  } catch {
    loginError.value = '网络错误，请重试'
  } finally {
    loginLoading.value = false
  }
}

// 从 URL 获取推荐码 ?ref=XXXX
function getRefCode() {
  const params = new URLSearchParams(window.location.search)
  return params.get('ref') || ''
}

async function handleRegister() {
  regError.value = ''
  if (!regUsername.value) { regError.value = '请输入用户名'; return }
  if (!regPassword.value || regPassword.value.length < 6) { regError.value = '密码至少 6 位'; return }
  if (regPassword.value !== regConfirm.value) { regError.value = '两次输入的密码不一致'; return }

  regLoading.value = true
  try {
    const body = { username: regUsername.value, password: regPassword.value }
    const refCode = getRefCode()
    if (refCode) body.ref = refCode

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.code !== 0) {
      regError.value = data.message || '注册失败'
      return
    }
    localStorage.setItem('token', data.data.token)
    localStorage.setItem('user', JSON.stringify(data.data.user))
    window.location.href = '/dashboard'
  } catch {
    regError.value = '网络错误，请重试'
  } finally {
    regLoading.value = false
  }
}

// 初始化：自动填充记住的用户名
;(() => {
  const saved = localStorage.getItem('remember_user')
  if (saved) {
    loginUsername.value = saved
    remember.value = true
  }
})()

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', moveDrag)
  window.removeEventListener('mouseup', endDrag)
  window.removeEventListener('touchmove', moveDrag)
  window.removeEventListener('touchend', endDrag)
  clearInterval(countdownTimer)
})
</script>

<template>
  <main class="login-page">
    <a class="login-logo" href="/" aria-label="Phoenix home">
      <img :src="logoSvg" alt="Phoenix" />
      <span>Phoenix</span>
    </a>

    <div class="login-tools" aria-label="Page tools">
      <el-button class="tool-btn lang-btn" @click="toggleLocale">
        {{ locale === 'zh' ? 'EN' : '中' }}
      </el-button>
    </div>

    <section class="login-visual">
      <img :src="bannerImg" alt="" />
      <h1>{{ t('login.visualTitle') }}</h1>
      <p>{{ t('login.visualSubtitle') }}</p>
    </section>

    <section class="login-panel">
      <Transition name="auth-swap" mode="out-in">
        <div v-if="authMode === 'login'" key="login" class="auth-pane" aria-labelledby="login-title">
          <div class="login-copy">
            <h2 id="login-title">{{ t('login.title') }}</h2>
            <p>{{ t('login.subtitle') }}</p>
          </div>

          <el-form class="login-form" label-position="top" @submit.prevent="handleLogin">
            <el-form-item :label="t('login.usernameLabel')">
              <el-input v-model="loginUsername" :placeholder="t('login.usernamePlaceholder')" autocomplete="username" size="large">
                <template #prefix>
                  <el-icon><User /></el-icon>
                </template>
              </el-input>
            </el-form-item>

            <el-form-item :label="t('login.passwordLabel')">
              <el-input
                v-model="loginPassword"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="t('login.passwordPlaceholder')"
                autocomplete="current-password"
                size="large"
                @keyup.enter="handleLogin"
              >
                <template #prefix>
                  <el-icon><Lock /></el-icon>
                </template>
                <template #suffix>
                  <button type="button" class="password-toggle" @click="showPassword = !showPassword">
                    <el-icon><View v-if="showPassword" /><Hide v-else /></el-icon>
                  </button>
                </template>
              </el-input>
            </el-form-item>

            <div
              ref="sliderRef"
              class="slider-check"
              :class="{ verified, dragging }"
              role="slider"
              :aria-valuemin="0"
              :aria-valuemax="100"
              :aria-valuenow="verified ? 100 : Math.round((sliderOffset / Math.max(sliderMax, 1)) * 100)"
              tabindex="0"
              @dblclick="resetSlider"
            >
              <div class="slider-fill" :style="{ width: sliderProgress }"></div>
              <button
                type="button"
                class="slider-handle"
                :style="{ transform: `translateX(${sliderOffset}px)` }"
                @mousedown="startDrag"
                @touchstart.prevent="startDrag"
              >
                <el-icon><ArrowRight /></el-icon>
              </button>
              <strong>{{ verified ? t('login.sliderDone') : t('login.slider') }}</strong>
            </div>

            <div class="form-row">
              <el-checkbox v-model="remember">{{ t('login.remember') }}</el-checkbox>
              <button type="button" class="text-link" @click="switchMode('forgot')">{{ t('login.forgot') }}</button>
            </div>

            <p v-if="loginError" class="error-text">{{ loginError }}</p>

            <el-button type="primary" size="large" class="login-submit" :loading="loginLoading" @click="handleLogin">{{ t('login.submit') }}</el-button>

            <p class="signup">
              {{ t('login.noAccount') }}
              <button type="button" class="text-link" @click="switchMode('register')">{{ t('login.create') }}</button>
            </p>
          </el-form>
        </div>

        <div v-else-if="authMode === 'forgot'" key="forgot" class="auth-pane" aria-labelledby="forgot-title">
          <!-- 重置成功 -->
          <template v-if="resetDone">
            <div class="login-copy">
              <h2 id="forgot-title">密码重置成功</h2>
              <p>您的密码已更新，请使用新密码登录。</p>
            </div>
            <div class="action-stack">
              <el-button type="primary" size="large" class="login-submit" @click="switchMode('login')">返回登录</el-button>
            </div>
          </template>

          <!-- 第二步：输入验证码 + 新密码 -->
          <template v-else-if="forgotStep === 2">
            <div class="login-copy">
              <h2 id="forgot-title">重置密码</h2>
              <p>验证码已发送到 <strong>{{ forgotEmail }}</strong></p>
            </div>

            <el-form class="login-form" label-position="top" @submit.prevent="handleResetPassword">
              <el-form-item label="验证码">
                <el-input
                  v-model="forgotCode"
                  placeholder="请输入 6 位验证码"
                  size="large"
                  maxlength="6"
                >
                  <template #prefix>
                    <el-icon><Message /></el-icon>
                  </template>
                  <template #append>
                    <el-button :disabled="countdown > 0" :loading="forgotLoading" @click="handleResendCode">
                      {{ countdown > 0 ? `${countdown}s` : '重新发送' }}
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>

              <el-form-item label="新密码">
                <el-input
                  v-model="forgotPassword"
                  type="password"
                  placeholder="请输入新密码（至少 6 位）"
                  size="large"
                  show-password
                >
                  <template #prefix>
                    <el-icon><Lock /></el-icon>
                  </template>
                </el-input>
              </el-form-item>

              <el-form-item label="确认密码">
                <el-input
                  v-model="forgotConfirm"
                  type="password"
                  placeholder="请再次输入新密码"
                  size="large"
                  show-password
                  @keyup.enter="handleResetPassword"
                >
                  <template #prefix>
                    <el-icon><Lock /></el-icon>
                  </template>
                </el-input>
              </el-form-item>

              <p v-if="forgotError" class="error-text">{{ forgotError }}</p>
              <div class="action-stack">
                <el-button type="primary" size="large" class="login-submit" :loading="resetLoading" @click="handleResetPassword">确认重置</el-button>
                <el-button size="large" class="secondary-submit" @click="switchMode('login')">{{ t('login.backLogin') }}</el-button>
              </div>
            </el-form>
          </template>

          <!-- 第一步：输入邮箱 -->
          <template v-else>
            <div class="login-copy">
              <h2 id="forgot-title">{{ t('login.forgotTitle') }}</h2>
              <p>{{ t('login.forgotSubtitle') }}</p>
            </div>

            <el-form class="login-form" label-position="top" @submit.prevent="handleSendCode">
              <el-form-item :label="t('login.emailLabel')">
                <el-input
                  v-model="forgotEmail"
                  :placeholder="t('login.emailPlaceholder')"
                  size="large"
                  autocomplete="email"
                  @keyup.enter="handleSendCode"
                >
                  <template #prefix>
                    <el-icon><Message /></el-icon>
                  </template>
                </el-input>
              </el-form-item>
              <p v-if="forgotError" class="error-text">{{ forgotError }}</p>
              <div class="action-stack">
                <el-button type="primary" size="large" class="login-submit" :loading="forgotLoading" @click="handleSendCode">发送验证码</el-button>
                <el-button size="large" class="secondary-submit" @click="switchMode('login')">{{ t('login.backLogin') }}</el-button>
              </div>
            </el-form>
          </template>
        </div>

        <div v-else key="register" class="auth-pane" aria-labelledby="register-title">
          <div class="login-copy">
            <h2 id="register-title">{{ t('login.registerTitle') }}</h2>
            <p>{{ t('login.registerSubtitle') }}</p>
          </div>

          <el-form class="login-form" label-position="top" @submit.prevent="handleRegister">
            <el-form-item :label="t('login.usernameLabel')">
              <el-input v-model="regUsername" :placeholder="t('login.usernamePlaceholder')" size="large">
                <template #prefix>
                  <el-icon><User /></el-icon>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item :label="t('login.passwordLabel')">
              <el-input v-model="regPassword" type="password" :placeholder="t('login.passwordPlaceholder')" size="large" show-password>
                <template #prefix>
                  <el-icon><Lock /></el-icon>
                </template>
              </el-input>
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input v-model="regConfirm" type="password" placeholder="请再次输入密码" size="large" show-password @keyup.enter="handleRegister">
                <template #prefix>
                  <el-icon><Lock /></el-icon>
                </template>
              </el-input>
            </el-form-item>
            <p v-if="regError" class="error-text">{{ regError }}</p>
            <el-button type="primary" size="large" class="login-submit" :loading="regLoading" @click="handleRegister">{{ t('login.registerSubmit') }}</el-button>
            <p class="signup">
              <button type="button" class="text-link" @click="switchMode('login')">{{ t('login.backLogin') }}</button>
            </p>
          </el-form>
        </div>
      </Transition>
    </section>

    <p class="copyright">{{ t('login.copyright') }}</p>
  </main>
</template>

<style scoped>
.login-page {
  --el-color-primary: #ee4d7a;
  --el-color-primary-light-3: #f37598;
  --el-color-primary-light-5: #f59ab3;
  --el-color-primary-light-7: #f9c0d0;
  --el-color-primary-light-8: #fbd5df;
  --el-color-primary-light-9: #fdebf0;
  --el-color-primary-dark-2: #c93662;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(420px, 0.9fr);
  background: #fff;
  position: relative;
  overflow: hidden;
}

.login-logo {
  position: absolute;
  top: 28px;
  left: 32px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #152033;
  font-size: 20px;
  font-weight: 800;
}

.login-logo img {
  width: 40px;
  height: 40px;
}

.login-tools {
  position: absolute;
  top: 24px;
  right: 24px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: 999px;
  background: #f4f7fb;
  box-shadow: 0 10px 30px rgba(21, 32, 51, 0.08);
}

.tool-btn {
  min-width: 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  color: #526071;
  font-weight: 800;
  border: none;
  background: transparent;
  margin-left: 0 !important;
}

.lang-btn {
  width: auto;
  padding: 0 10px;
}

.login-visual {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 120px 56px 80px;
  background:
    linear-gradient(135deg, rgba(255, 238, 244, 0.78), rgba(235, 245, 255, 0.96)),
    #f2f7fd;
}

.login-visual img {
  width: min(460px, 72%);
  margin-bottom: 42px;
  filter: drop-shadow(0 34px 58px rgba(68, 89, 123, 0.18));
}

.login-visual h1 {
  color: #152033;
  font-size: 28px;
  line-height: 1.25;
  text-align: center;
  margin-bottom: 12px;
}

.login-visual p {
  color: #647184;
  font-size: 16px;
  text-align: center;
}

.login-panel {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 112px 84px 92px;
}

.auth-pane {
  width: 100%;
}

.auth-swap-enter-active,
.auth-swap-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.auth-swap-enter-from {
  opacity: 0;
  transform: translateX(22px);
}

.auth-swap-leave-to {
  opacity: 0;
  transform: translateX(-22px);
}

.login-copy {
  margin-bottom: 28px;
}

.login-copy h2 {
  color: #152033;
  font-size: 38px;
  line-height: 1.15;
  margin-bottom: 10px;
}

.login-copy p {
  color: #647184;
}

.login-form {
  display: grid;
  gap: 4px;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.login-form :deep(.el-form-item__label) {
  color: #425066;
  font-size: 13px;
  font-weight: 700;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #dfe5ec inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #8b7bf7 inset, 0 0 0 4px rgba(139, 123, 247, 0.12);
}

.password-toggle {
  display: inline-flex;
  align-items: center;
  color: #647184;
}

.slider-check {
  position: relative;
  height: 44px;
  border: 1px solid #dfe5ec;
  border-radius: 8px;
  overflow: hidden;
  background: #f4f7fb;
  user-select: none;
}

.slider-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 48px;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7 58%, #5b8def);
  transition: width 0.2s;
}

.slider-handle {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 2;
  width: 48px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(21, 32, 51, 0.12);
  color: #8b7bf7;
  font-size: 18px;
  transition: transform 0.2s;
  cursor: grab;
}

.slider-handle,
.slider-check strong {
  height: 100%;
  display: grid;
  place-items: center;
}

.slider-check strong {
  position: relative;
  z-index: 1;
  height: 100%;
  text-align: center;
  color: #425066;
  font-size: 13px;
  pointer-events: none;
}

.slider-check.dragging .slider-fill,
.slider-check.dragging .slider-handle {
  transition: none;
}

.slider-check.dragging .slider-handle {
  cursor: grabbing;
}

.slider-check.verified {
  border-color: rgba(22, 129, 90, 0.32);
  background: #eefaf4;
}

.slider-check.verified .slider-fill {
  background: linear-gradient(135deg, #44d083, #35b978);
}

.slider-check.verified .slider-handle {
  color: #16815a;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #526071;
  font-size: 14px;
}

.text-link {
  color: #ee4d7a;
  font-weight: 700;
}

.text-link {
  display: inline-flex;
}

.login-submit {
  width: 100%;
  height: 46px;
  border-radius: 8px;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7 54%, #5b8def);
  border: none;
  color: #fff;
  font-weight: 800;
  box-shadow: 0 14px 30px rgba(139, 123, 247, 0.24);
}

.error-text {
  color: #ee4d7a;
  font-size: 13px;
  margin: 0 0 8px;
}

.action-stack {
  display: grid;
  gap: 12px;
  margin-top: 2px;
}

.secondary-submit {
  width: 100%;
  height: 44px;
  margin-left: 0 !important;
  border-radius: 8px;
  border-color: #dfe5ec;
  background: #fff;
  color: #152033;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(21, 32, 51, 0.05);
}

.signup {
  text-align: center;
  color: #526071;
  font-size: 14px;
  margin-top: 10px;
}

.copyright {
  position: absolute;
  right: 84px;
  bottom: 28px;
  color: #647184;
  font-size: 13px;
}

@media (max-width: 960px) {
  .login-page {
    display: block;
    min-height: 100vh;
    background:
      linear-gradient(135deg, rgba(255, 238, 244, 0.82), rgba(242, 248, 255, 0.95)),
      #fff;
  }

  .login-logo {
    position: relative;
    top: auto;
    left: auto;
    padding: 22px 24px 0;
  }

  .login-tools {
    top: 18px;
    right: 18px;
  }

  .login-visual {
    min-height: auto;
    padding: 36px 24px 12px;
    background: transparent;
  }

  .login-visual img {
    width: min(320px, 78vw);
    margin-bottom: 20px;
  }

  .login-visual h1 {
    font-size: 24px;
  }

  .login-panel {
    min-height: auto;
    padding: 32px 24px 84px;
  }

  .login-copy h2 {
    font-size: 32px;
  }

  .copyright {
    left: 24px;
    right: 24px;
    bottom: 22px;
    text-align: center;
  }
}

@media (max-width: 520px) {
  .login-tools {
    padding: 6px;
  }

  .login-visual {
    align-items: flex-start;
  }

  .login-visual img {
    align-self: center;
  }

  .login-visual h1,
  .login-visual p {
    text-align: left;
  }

  .form-row {
    align-items: flex-start;
  }
}
</style>
