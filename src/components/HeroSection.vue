<script setup>
import { useI18n } from '../i18n'
import bannerImg from '../assets/banner.png'

const { t } = useI18n()
</script>

<template>
  <section class="hero" id="top">
    <div class="hero-inner">
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

      <div class="hero-visual">
        <img :src="bannerImg" alt="Phoenix product illustration" class="banner-img" />
      </div>
    </div>

    <div class="metrics">
      <div v-for="metric in t('hero.metrics')" :key="metric.label">
        <strong>{{ metric.value }}</strong>
        <span>{{ metric.label }}</span>
      </div>
    </div>
  </section>

  <section class="features" id="features">
    <div class="section-heading">
      <h2>{{ t('sections.featuresTitle') }}</h2>
      <p>{{ t('sections.featuresSubtitle') }}</p>
    </div>
    <div class="feature-grid">
      <article v-for="feature in t('sections.features')" :key="feature.title" class="feature-card">
        <span class="feature-mark"></span>
        <h3>{{ feature.title }}</h3>
        <p>{{ feature.text }}</p>
      </article>
    </div>
  </section>

  <section class="workflow" id="workflow">
    <h2>{{ t('sections.workflowTitle') }}</h2>
    <div class="workflow-track">
      <div v-for="(step, index) in t('sections.workflow')" :key="step" class="workflow-step">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <strong>{{ step }}</strong>
      </div>
    </div>
  </section>

  <section class="cta" id="contact">
    <div>
      <h2>{{ t('sections.ctaTitle') }}</h2>
      <p>{{ t('sections.ctaText') }}</p>
    </div>
    <a href="/login">{{ t('sections.ctaBtn') }}</a>
  </section>
</template>

<style scoped>
.hero {
  min-height: 92vh;
  padding-top: 72px;
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(120deg, rgba(255, 238, 244, 0.92), rgba(242, 248, 255, 0.95) 48%, #ffffff 100%),
    #ffffff;
}

.hero-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 96px 80px 42px;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(460px, 1.1fr);
  align-items: center;
  gap: 72px;
  width: 100%;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 22px;
  border: 1px solid rgba(238, 77, 122, 0.18);
  border-radius: 999px;
  color: #d93d6d;
  background: rgba(255, 255, 255, 0.76);
  font-size: 13px;
  font-weight: 700;
}

.hero-title {
  max-width: 660px;
  font-size: 58px;
  font-weight: 800;
  line-height: 1.08;
  color: #152033;
  letter-spacing: 0;
  margin-bottom: 22px;
}

.hero-subtitle {
  max-width: 590px;
  font-size: 18px;
  line-height: 1.8;
  color: #647184;
  font-weight: 400;
  margin-bottom: 34px;
}

.hero-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.hero-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 10px;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
}

.hero-btn.primary {
  color: #fff;
  background: #ee4d7a;
  box-shadow: 0 16px 36px rgba(238, 77, 122, 0.25);
}

.hero-btn.secondary {
  color: #152033;
  background: #fff;
  border: 1px solid rgba(21, 32, 51, 0.12);
}

.hero-btn:hover {
  transform: translateY(-2px);
}

.hero-points {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  list-style: none;
}

.hero-points li {
  padding: 8px 12px;
  color: #425066;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(21, 32, 51, 0.08);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
}

.hero-visual {
  display: flex;
  align-items: center;
  justify-content: center;
}

.banner-img {
  position: relative;
  max-width: 560px;
  width: 100%;
  height: auto;
  opacity: 0.94;
  filter: drop-shadow(0 24px 44px rgba(68, 89, 123, 0.18));
}

.metrics {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 80px 64px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.metrics div {
  padding: 24px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(21, 32, 51, 0.08);
}

.metrics strong {
  display: block;
  color: #152033;
  font-size: 32px;
  margin-bottom: 6px;
}

.metrics span {
  color: #647184;
  font-weight: 700;
}

.features,
.workflow,
.cta {
  max-width: 1240px;
  margin: 0 auto;
  padding: 92px 80px;
  scroll-margin-top: 88px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 34px;
}

.section-heading h2,
.workflow h2 {
  max-width: 560px;
  color: #152033;
  font-size: 38px;
  line-height: 1.2;
}

.section-heading p {
  max-width: 360px;
  color: #647184;
  line-height: 1.7;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.feature-card {
  padding: 28px;
  border: 1px solid #e6ecf2;
  border-radius: 8px;
  background: #fff;
}

.feature-mark {
  display: block;
  width: 42px;
  height: 6px;
  margin-bottom: 28px;
  border-radius: 999px;
  background: #ee4d7a;
}

.feature-card h3 {
  color: #152033;
  font-size: 20px;
  margin-bottom: 12px;
}

.feature-card p {
  color: #647184;
  line-height: 1.75;
}

.workflow {
  padding-top: 28px;
}

.workflow-track {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-top: 30px;
  border-top: 1px solid #dce3ec;
}

.workflow-step {
  padding: 24px 18px 0 0;
  position: relative;
}

.workflow-step::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ee4d7a;
}

.workflow-step span {
  display: block;
  margin-bottom: 10px;
  color: #ee4d7a;
  font-weight: 800;
}

.workflow-step strong {
  color: #152033;
  font-size: 18px;
}

.cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 72px;
  border-radius: 8px;
  background: #152033;
  color: #fff;
}

.cta h2 {
  font-size: 32px;
  margin-bottom: 12px;
}

.cta p {
  max-width: 640px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.75;
}

.cta a {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 10px;
  background: #fff;
  color: #152033;
  font-weight: 800;
}

@media (max-width: 960px) {
  .hero-inner {
    grid-template-columns: 1fr;
    padding: 58px 24px 28px;
    gap: 30px;
  }

  .hero-title {
    font-size: 40px;
  }

  .hero-visual {
    min-height: auto;
  }

  .banner-img {
    display: block;
    max-width: min(460px, 86vw);
    opacity: 0.72;
  }

  .metrics,
  .features,
  .workflow,
  .cta {
    padding-left: 24px;
    padding-right: 24px;
  }

  .metrics,
  .feature-grid,
  .workflow-track {
    grid-template-columns: 1fr;
  }

  .section-heading {
    display: block;
  }

  .section-heading h2,
  .workflow h2 {
    font-size: 30px;
    margin-bottom: 14px;
  }

  .workflow-track {
    gap: 14px;
    margin-top: 24px;
    border-top: none;
    border-left: 1px solid #dce3ec;
    padding-left: 18px;
  }

  .workflow-step {
    padding: 0 0 18px 18px;
  }

  .workflow-step::before {
    top: 8px;
    left: -23px;
  }

  .cta {
    display: block;
    margin-left: 24px;
    margin-right: 24px;
  }

  .cta a {
    margin-top: 22px;
  }
}

@media (max-width: 700px) {
  .hero-title {
    font-size: 34px;
  }

  .hero-subtitle {
    font-size: 16px;
  }

  .hero-visual {
    margin-top: 18px;
  }

}
</style>
