<script setup>
import { useI18n } from '../i18n'
import logoSvg from '../assets/logo.svg'

const { t, locale, toggleLocale } = useI18n()
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <div class="logo">
        <img :src="logoSvg" alt="Phoenix" class="logo-icon" />
        <span class="logo-text">Phoenix</span>
      </div>
      <nav class="nav-links" aria-label="Primary">
        <a href="#features">{{ t('nav.features') }}</a>
        <a href="#workflow">{{ t('nav.workflow') }}</a>
      </nav>
      <div class="header-actions">
        <button class="btn-lang" @click="toggleLocale">
          <svg class="lang-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.3"/>
            <ellipse cx="10" cy="10" rx="4" ry="8.5" stroke="currentColor" stroke-width="1.3"/>
            <line x1="1.5" y1="10" x2="18.5" y2="10" stroke="currentColor" stroke-width="1.3"/>
          </svg>
          <span>{{ locale === 'zh' ? 'EN' : '中' }}</span>
        </button>
        <a href="/login" class="btn-start">{{ t('nav.getStarted') }}</a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border-bottom: 1px solid rgba(21, 30, 45, 0.08);
}

.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 80px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  width: 36px;
  height: 36px;
}

.logo-text {
  font-size: 18px;
  font-weight: 700;
  color: #152033;
  letter-spacing: 0;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 30px;
  margin-left: 48px;
  margin-right: auto;
}

.nav-links a {
  font-size: 14px;
  font-weight: 600;
  color: #526071;
  transition: color 0.2s;
}

.nav-links a:hover {
  color: #ee4d7a;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-lang {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #526071;
  background: #f4f7fb;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-lang:hover {
  background: #ecf1f7;
  color: #152033;
}

.lang-icon {
  width: 16px;
  height: 16px;
}

.btn-start {
  padding: 10px 24px;
  background: #152033;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  transition: all 0.2s;
}

.btn-start:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(21, 32, 51, 0.18);
}

@media (max-width: 768px) {
  .header-inner {
    padding: 0 20px;
  }

  .nav-links,
  .btn-start {
    display: none;
  }
}
</style>
