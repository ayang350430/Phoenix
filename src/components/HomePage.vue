<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../i18n'
import bannerImg from '../assets/banner.png'
import HeaderNav from './HeaderNav.vue'
import ScrollReveal from './ScrollReveal.vue'

const { t } = useI18n()
const pageRef = ref(null)
const headerScrolled = ref(false)

function onPageScroll() {
  headerScrolled.value = window.scrollY > 24
}

onMounted(() => {
  window.addEventListener('scroll', onPageScroll, { passive: true })
  onPageScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onPageScroll)
})
</script>

<template>
  <div ref="pageRef" class="home-page" :class="{ 'is-scrolled': headerScrolled }">
    <HeaderNav />

    <main class="home-main">
      <!-- Hero -->
      <section class="hero" id="top">
        <div class="hero-bg-grid" aria-hidden="true" />
        <div class="hero-glow hero-glow--a" aria-hidden="true" />
        <div class="hero-glow hero-glow--b" aria-hidden="true" />
        <div class="hero-glow hero-glow--c" aria-hidden="true" />

        <div class="hero-inner">
          <ScrollReveal from="left" instant class="hero-content-wrap">
            <div class="hero-content">
              <p class="hero-eyebrow">{{ t('hero.eyebrow') }}</p>
              <h1 class="hero-title">{{ t('hero.title') }}</h1>
              <p class="hero-subtitle">{{ t('hero.subtitle') }}</p>
              <div class="hero-actions">
                <a href="/login" class="hero-btn primary">{{ t('hero.primaryBtn') }}</a>
                <a href="#features" class="hero-btn secondary">{{ t('hero.secondaryBtn') }}</a>
              </div>
              <ul class="hero-points">
                <li v-for="point in t('hero.points')" :key="point">{{ point }}</li>
              </ul>
            </div>
          </ScrollReveal>

          <ScrollReveal from="right" instant :delay="120" class="hero-visual-wrap">
            <div class="hero-visual">
              <div class="hero-visual-ring" aria-hidden="true" />
              <img :src="bannerImg" alt="Phoenix product illustration" class="banner-img" loading="lazy" decoding="async" />
            </div>
          </ScrollReveal>
        </div>

        <div class="metrics">
          <ScrollReveal
            v-for="(metric, i) in t('hero.metrics')"
            :key="metric.label"
            from="right"
            :delay="i * 90"
            class="metric-reveal"
          >
            <div class="metric-card">
              <span class="metric-index">{{ String(i + 1).padStart(2, '0') }}</span>
              <strong>{{ metric.value }}</strong>
              <span>{{ metric.label }}</span>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <!-- Features -->
      <section class="features-band" id="features">
      <div class="features">
        <ScrollReveal from="right" class="section-heading-wrap">
          <div class="section-heading">
            <div class="section-heading-main">
              <p class="section-eyebrow">{{ t('nav.features') }}</p>
              <h2>{{ t('sections.featuresTitle') }}</h2>
            </div>
            <p class="section-desc">{{ t('sections.featuresSubtitle') }}</p>
          </div>
        </ScrollReveal>

        <div class="feature-grid">
          <ScrollReveal
            v-for="(feature, i) in t('sections.features')"
            :key="feature.title"
            from="right"
            :delay="i * 100"
          >
            <article class="feature-card">
              <div class="feature-card-top">
                <span class="feature-index">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="feature-mark" />
              </div>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.text }}</p>
            </article>
          </ScrollReveal>
        </div>
      </div>
      </section>

      <!-- Workflow -->
      <section class="workflow-band" id="workflow">
      <div class="workflow">
        <ScrollReveal from="right" class="workflow-heading-wrap">
          <div class="workflow-heading">
            <div class="workflow-heading-main">
              <p class="section-eyebrow">{{ t('nav.workflow') }}</p>
              <h2 class="workflow-title">{{ t('sections.workflowTitle') }}</h2>
            </div>
            <p class="workflow-lead">{{ t('sections.workflowLead') }}</p>
          </div>
        </ScrollReveal>

        <div class="workflow-board">
          <div class="workflow-rail" aria-hidden="true">
            <span class="workflow-rail-line" />
          </div>

          <div class="workflow-track">
            <ScrollReveal
              v-for="(step, index) in t('sections.workflow')"
              :key="step.title"
              from="right"
              :delay="index * 90"
              class="workflow-item"
            >
              <article class="workflow-card">
                <div class="workflow-card-accent" aria-hidden="true" />
                <div class="workflow-card-head">
                  <div class="workflow-icon" aria-hidden="true">
                    <svg v-if="index === 0" viewBox="0 0 24 24" fill="none">
                      <path d="M10 13a5 5 0 0 1 0-7l1.4-1.4a5 5 0 1 1 7.1 7.1L17 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                      <path d="M14 11a5 5 0 0 1 0 7l-1.4 1.4a5 5 0 1 1-7.1-7.1L7 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    </svg>
                    <svg v-else-if="index === 1" viewBox="0 0 24 24" fill="none">
                      <rect x="4" y="5" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.8" />
                      <rect x="4" y="14" width="16" height="5" rx="1.5" stroke="currentColor" stroke-width="1.8" />
                      <circle cx="8" cy="7.5" r="1" fill="currentColor" />
                      <circle cx="8" cy="16.5" r="1" fill="currentColor" />
                    </svg>
                    <svg v-else-if="index === 2" viewBox="0 0 24 24" fill="none">
                      <path d="M9 12.5 11 14.5 15.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M12 21a9 9 0 1 0-9-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                      <path d="M3 12h2.5M12 3v2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" fill="none">
                      <path d="M12 3v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                      <path d="m8 9 4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    </svg>
                  </div>
                  <span class="workflow-order">{{ String(index + 1).padStart(2, '0') }}</span>
                </div>
                <h3 class="workflow-card-title">{{ step.title }}</h3>
                <p class="workflow-card-hint">{{ step.hint }}</p>
                <span v-if="index < t('sections.workflow').length - 1" class="workflow-connector" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="m13 7 5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </article>
            </ScrollReveal>
          </div>
        </div>
      </div>
      </section>

      <!-- CTA -->
      <ScrollReveal from="right" class="cta-wrap">
        <section class="cta" id="contact">
          <div class="cta-glow" aria-hidden="true" />
          <div class="cta-copy">
            <p class="section-eyebrow section-eyebrow--light">Phoenix</p>
            <h2>{{ t('sections.ctaTitle') }}</h2>
            <p>{{ t('sections.ctaText') }}</p>
          </div>
          <a href="/login" class="cta-btn">{{ t('sections.ctaBtn') }}</a>
        </section>
      </ScrollReveal>
    </main>

    <footer class="home-footer">
      <div class="home-footer-inner">
        <span class="home-footer-brand">Phoenix</span>
        <span class="home-footer-dot" aria-hidden="true">·</span>
        <span>小红书任务批量提交平台</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.home-page {
  --home-primary: #2f6df6;
  --home-accent: #ee4d7a;
  --home-purple: #8b7bf7;
  --home-ink: #152033;
  --home-muted: #647184;
  --home-line: rgba(21, 32, 51, 0.08);
  min-height: 100vh;
  background: #fafbfd;
  color: var(--home-ink);
  overflow-x: clip;
  font-feature-settings: 'kern' 1, 'liga' 1;
  -webkit-font-smoothing: antialiased;
}

.home-page :deep(.header) {
  transition:
    background 0.35s ease,
    border-color 0.35s ease,
    box-shadow 0.35s ease;
}

.home-page.is-scrolled :deep(.header) {
  background: rgba(255, 255, 255, 0.88);
  border-bottom-color: rgba(21, 32, 51, 0.06);
  box-shadow: 0 8px 32px rgba(21, 32, 51, 0.06);
}

.home-page :deep(.btn-start) {
  border-radius: 999px;
  background: linear-gradient(135deg, #152033 0%, #243552 100%);
  box-shadow: 0 8px 24px rgba(21, 32, 51, 0.18);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.home-page :deep(.btn-start:hover) {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(21, 32, 51, 0.22);
}

.home-main {
  position: relative;
}

/* ========== Shared section chrome ========== */

.section-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--home-accent);
}

.section-eyebrow::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--home-accent), var(--home-purple));
  box-shadow: 0 0 0 3px rgba(238, 77, 122, 0.12);
}

.section-eyebrow--light {
  color: rgba(255, 255, 255, 0.55);
}

.section-eyebrow--light::before {
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
}

.section-desc {
  max-width: 22em;
  font-size: 16px;
  line-height: 1.7;
  color: var(--home-muted);
}

/* ========== Hero ========== */

.hero {
  position: relative;
  min-height: 100vh;
  padding-top: 72px;
  overflow: hidden;
  background: #fafbfd;
}

.hero-bg-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(47, 109, 246, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(47, 109, 246, 0.035) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, #000 20%, transparent 75%);
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.55;
}

.hero-glow--a {
  width: min(520px, 70vw);
  height: min(520px, 70vw);
  top: -120px;
  right: -80px;
  background: radial-gradient(circle, rgba(238, 77, 122, 0.35), transparent 68%);
}

.hero-glow--b {
  width: min(480px, 65vw);
  height: min(480px, 65vw);
  bottom: 10%;
  left: -120px;
  background: radial-gradient(circle, rgba(47, 109, 246, 0.28), transparent 70%);
}

.hero-glow--c {
  width: min(360px, 50vw);
  height: min(360px, 50vw);
  top: 40%;
  left: 45%;
  opacity: 0.35;
  background: radial-gradient(circle, rgba(139, 123, 247, 0.22), transparent 70%);
}

.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 1320px;
  margin: 0 auto;
  padding: clamp(48px, 8vh, 96px) clamp(24px, 5vw, 80px) 40px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 1.05fr);
  align-items: center;
  gap: clamp(32px, 5vw, 72px);
}

.hero-content-wrap,
.hero-visual-wrap {
  display: block;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 12px;
  margin-bottom: 20px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #d93d6d;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(238, 77, 122, 0.18);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 20px rgba(238, 77, 122, 0.08);
}

.hero-eyebrow::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--home-accent), #ff7aa0);
  animation: hero-pulse 2.4s ease-in-out infinite;
}

@keyframes hero-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.65; transform: scale(0.85); }
}

.hero-title {
  max-width: 11ch;
  font-size: clamp(36px, 5.2vw, 58px);
  font-weight: 800;
  line-height: 1.06;
  letter-spacing: -0.03em;
  color: var(--home-ink);
  margin-bottom: 20px;
}

.hero-subtitle {
  max-width: 36em;
  font-size: clamp(16px, 1.6vw, 18px);
  line-height: 1.75;
  color: var(--home-muted);
  margin-bottom: 32px;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 26px;
}

.hero-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  padding: 0 26px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.hero-btn.primary {
  color: #fff;
  background: linear-gradient(135deg, #f05f8a, var(--home-accent));
  box-shadow: 0 18px 40px rgba(238, 77, 122, 0.32);
}

.hero-btn.secondary {
  color: var(--home-ink);
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--home-line);
  backdrop-filter: blur(8px);
}

.hero-btn:hover {
  transform: translateY(-2px) scale(1.02);
}

.hero-points {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
}

.hero-points li {
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #425066;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid var(--home-line);
}

.hero-visual {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: hero-float 7s ease-in-out infinite;
}

@keyframes hero-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}

.hero-visual-ring {
  position: absolute;
  inset: 8% 4%;
  border-radius: 32px;
  background: linear-gradient(145deg, rgba(139, 123, 247, 0.14), rgba(47, 109, 246, 0.1));
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow:
    0 32px 64px rgba(47, 109, 246, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.hero-visual-ring::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(238, 77, 122, 0.25), rgba(47, 109, 246, 0.2));
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

.banner-img {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 540px;
  height: auto;
  filter: drop-shadow(0 28px 48px rgba(68, 89, 123, 0.22));
}

.metrics {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px clamp(24px, 5vw, 80px) clamp(48px, 6vh, 72px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.metrics::before {
  content: '';
  position: absolute;
  top: 0;
  left: clamp(24px, 5vw, 80px);
  right: clamp(24px, 5vw, 80px);
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(21, 32, 51, 0.08), transparent);
}

.metric-reveal {
  display: block;
  height: 100%;
}

.metric-card {
  position: relative;
  height: 100%;
  padding: 28px 24px 26px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 12px 40px rgba(21, 32, 51, 0.06);
  backdrop-filter: blur(16px);
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  overflow: hidden;
}

.metric-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--home-accent), var(--home-purple));
  opacity: 0;
  transition: opacity 0.3s ease;
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 48px rgba(47, 109, 246, 0.12);
  border-color: rgba(47, 109, 246, 0.12);
}

.metric-card:hover::before {
  opacity: 1;
}

.metric-index {
  display: block;
  margin-bottom: 14px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(238, 77, 122, 0.75);
}

.metric-card strong {
  display: block;
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--home-ink);
  margin-bottom: 6px;
}

.metric-card span:last-child {
  font-size: 13px;
  font-weight: 700;
  color: var(--home-muted);
}

/* ========== Features ========== */

.features-band {
  position: relative;
  background: linear-gradient(180deg, #f4f6fb 0%, #eef1f8 50%, #f8f9fc 100%);
  border-top: 1px solid rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(21, 32, 51, 0.04);
}

.features-band::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 20% 30%, rgba(47, 109, 246, 0.04), transparent 45%),
    radial-gradient(circle at 80% 70%, rgba(238, 77, 122, 0.04), transparent 40%);
  pointer-events: none;
}

.features,
.workflow {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  padding: clamp(64px, 10vh, 100px) clamp(24px, 5vw, 80px);
  scroll-margin-top: 88px;
}

.section-heading-wrap {
  display: block;
  margin-bottom: 40px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
}

.section-heading-main h2,
.workflow-title {
  max-width: 14ch;
  font-size: clamp(28px, 3.5vw, 42px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--home-ink);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.feature-card {
  position: relative;
  height: 100%;
  padding: 32px 28px 30px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 36px rgba(21, 32, 51, 0.05);
  transition: transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease;
  overflow: hidden;
}

.feature-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(145deg, rgba(47, 109, 246, 0.04), transparent 55%);
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;
}

.feature-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 28px 56px rgba(47, 109, 246, 0.12);
  border-color: rgba(47, 109, 246, 0.1);
}

.feature-card:hover::after {
  opacity: 1;
}

.feature-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}

.feature-index {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: rgba(21, 32, 51, 0.28);
}

.feature-mark {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--home-accent), var(--home-purple));
}

.feature-card h3 {
  font-size: 20px;
  font-weight: 800;
  margin-bottom: 12px;
  color: var(--home-ink);
}

.feature-card p {
  font-size: 15px;
  line-height: 1.75;
  color: var(--home-muted);
}

/* ========== Workflow ========== */

.workflow-band {
  position: relative;
  background: linear-gradient(180deg, #fafbfd 0%, #f3f6fb 100%);
  overflow: hidden;
}

.workflow-band::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 15% 20%, rgba(47, 109, 246, 0.06), transparent 42%),
    radial-gradient(circle at 85% 80%, rgba(139, 123, 247, 0.05), transparent 38%);
  pointer-events: none;
}

.workflow {
  padding-top: 20px;
}

.workflow-heading-wrap {
  display: block;
  margin-bottom: 44px;
}

.workflow-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
}

.workflow-heading-main .workflow-title {
  max-width: 14ch;
  margin-bottom: 0;
}

.workflow-lead {
  max-width: 20em;
  font-size: 15px;
  line-height: 1.75;
  color: var(--home-muted);
}

.workflow-board {
  position: relative;
}

.workflow-rail {
  display: none;
}

.workflow-track {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  position: relative;
}

.workflow-item {
  display: block;
  height: 100%;
}

.workflow-card {
  position: relative;
  height: 100%;
  min-height: 196px;
  padding: 22px 22px 24px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(47, 109, 246, 0.08);
  box-shadow:
    0 10px 32px rgba(21, 32, 51, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
  transition: transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease;
  overflow: visible;
}

.workflow-card-accent {
  position: absolute;
  top: 0;
  left: 22px;
  right: 22px;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--home-primary), rgba(139, 123, 247, 0.85));
  opacity: 0.85;
}

.workflow-card:hover {
  transform: translateY(-6px);
  border-color: rgba(47, 109, 246, 0.18);
  box-shadow:
    0 22px 48px rgba(47, 109, 246, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

.workflow-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 18px;
}

.workflow-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  color: var(--home-primary);
  background: linear-gradient(145deg, rgba(47, 109, 246, 0.12), rgba(47, 109, 246, 0.04));
  border: 1px solid rgba(47, 109, 246, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.workflow-icon svg {
  width: 22px;
  height: 22px;
}

.workflow-order {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(21, 32, 51, 0.28);
  padding-top: 4px;
}

.workflow-card-title {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.45;
  color: var(--home-ink);
  margin-bottom: 8px;
}

.workflow-card-hint {
  font-size: 13px;
  line-height: 1.65;
  color: var(--home-muted);
}

.workflow-connector {
  position: absolute;
  top: 50%;
  right: -18px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--home-primary);
  background: #fff;
  border: 1px solid rgba(47, 109, 246, 0.12);
  box-shadow: 0 6px 16px rgba(47, 109, 246, 0.1);
  transform: translate(50%, -50%);
}

.workflow-connector svg {
  width: 14px;
  height: 14px;
}

@media (min-width: 961px) {
  .workflow-rail {
    display: block;
    position: absolute;
    top: 54px;
    left: 10%;
    right: 10%;
    height: 2px;
    z-index: 0;
  }

  .workflow-rail-line {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      rgba(47, 109, 246, 0.08),
      rgba(47, 109, 246, 0.28) 50%,
      rgba(47, 109, 246, 0.08)
    );
  }

  .workflow-track {
    z-index: 1;
  }
}

/* ========== CTA ========== */

.cta-wrap {
  display: block;
  padding: 0 clamp(24px, 5vw, 80px);
}

.cta {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  max-width: 1200px;
  margin: clamp(48px, 8vh, 72px) auto 80px;
  padding: clamp(40px, 5vw, 56px) clamp(32px, 4vw, 52px);
  border-radius: 28px;
  background: linear-gradient(135deg, #121a2b 0%, #1a2744 45%, #152033 100%);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 32px 64px rgba(21, 32, 51, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.cta-glow {
  position: absolute;
  width: 320px;
  height: 320px;
  top: -120px;
  right: -60px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(47, 109, 246, 0.35), transparent 68%);
  filter: blur(40px);
  pointer-events: none;
}

.cta-copy {
  position: relative;
  z-index: 1;
}

.cta h2 {
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}

.cta p {
  max-width: 36em;
  font-size: 16px;
  line-height: 1.75;
  color: rgba(255, 255, 255, 0.72);
}

.cta-btn {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 32px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  color: var(--home-ink);
  background: #fff;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.cta-btn:hover {
  transform: scale(1.04);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
}

/* ========== Footer ========== */

.home-footer {
  border-top: 1px solid var(--home-line);
  background: linear-gradient(180deg, #fafbfd 0%, #f4f6fa 100%);
}

.home-footer-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px calc(48px + env(safe-area-inset-bottom, 0px));
  font-size: 13px;
  font-weight: 600;
  color: #8a95a8;
}

.home-footer-brand {
  font-weight: 800;
  background: linear-gradient(135deg, var(--home-purple), var(--home-primary));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.home-footer-dot {
  opacity: 0.45;
}

/* ========== Responsive ========== */

@media (max-width: 960px) {
  .hero-inner {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .hero-content {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .hero-title {
    max-width: none;
  }

  .hero-subtitle {
    max-width: 32em;
  }

  .hero-actions,
  .hero-points {
    justify-content: center;
  }

  .metrics,
  .feature-grid,
  .workflow-track {
    grid-template-columns: 1fr;
  }

  .section-heading {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .workflow-heading {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .workflow-board {
    padding-left: 4px;
  }

  .workflow-track {
    gap: 0;
    padding-left: 18px;
    border-left: 2px solid rgba(47, 109, 246, 0.12);
  }

  .workflow-item {
    padding-bottom: 18px;
  }

  .workflow-item:last-child {
    padding-bottom: 0;
  }

  .workflow-card {
    min-height: 0;
  }

  .workflow-connector {
    display: none;
  }

  .workflow-card::before {
    content: '';
    position: absolute;
    top: 28px;
    left: -27px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--home-primary);
    box-shadow: 0 0 0 4px rgba(47, 109, 246, 0.1);
  }

  .cta {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 700px) {
  .hero-btn {
    width: 100%;
    max-width: 280px;
  }

  .cta-btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-visual,
  .hero-eyebrow::before {
    animation: none;
  }
}
</style>
