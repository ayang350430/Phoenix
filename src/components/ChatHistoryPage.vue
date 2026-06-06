<script setup>
import { ref, computed, onMounted, inject, nextTick } from 'vue'
import { ElPagination, ElSelect, ElOption } from 'element-plus'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'
import EmptyState from './EmptyState.vue'
import UserAvatar from './UserAvatar.vue'

const { getToken, isAdmin } = inject('workspace')

const conversations = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 15
const loading = ref(false)
const searchKey = ref('')
const filterStatus = ref('')

const showDrawer = ref(false)
const drawerConv = ref(null)
const drawerMessages = ref([])
const drawerLoading = ref(false)
const previewImg = ref('')

const totalOpen = computed(() => conversations.value.filter(c => c.status === 'open').length)

function displayName(c) {
  return c.real_name || c.nickname || c.username || `用户${c.user_id}`
}

function fmtTime(dt) {
  if (!dt) return '-'
  const d = new Date(dt)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtShortTime(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${time}`
}

function statusInfo(s) {
  if (s === 'open') return { label: '进行中', color: '#16a34a', bg: '#ecfdf5', border: '#bbf7d0' }
  if (s === 'closed') return { label: '已结束', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' }
  return { label: s || '未知', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' }
}

function formatLastMessage(msg) {
  if (!msg) return '暂无消息'
  const text = String(msg).trim()
  if (!text) return '暂无消息'
  if (text === '[图片]' || text.startsWith('data:image')) return '图片消息'
  if (text === '[语音]' || text.startsWith('data:audio') || text.includes('data:audio/')) return '语音消息'
  if (text.startsWith('data:')) return '媒体消息'
  if (text.length > 72) return `${text.slice(0, 72)}…`
  return text
}

function lastMessageKind(msg) {
  if (!msg) return 'empty'
  const text = String(msg).trim()
  if (text === '[图片]' || text.startsWith('data:image')) return 'image'
  if (text === '[语音]' || text.startsWith('data:audio') || text.includes('data:audio/')) return 'audio'
  if (text.startsWith('data:')) return 'media'
  return 'text'
}

async function fetchConversations() {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: page.value, pageSize })
    if (searchKey.value.trim()) q.set('keyword', searchKey.value.trim())
    if (filterStatus.value) q.set('status', filterStatus.value)
    const res = await fetch(`/api/chat/history?${q}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      conversations.value = data.data.rows || []
      total.value = data.data.total || 0
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function doSearch() { page.value = 1; fetchConversations() }
function resetSearch() { searchKey.value = ''; filterStatus.value = ''; page.value = 1; fetchConversations() }

async function openDrawer(conv) {
  drawerConv.value = conv
  showDrawer.value = true
  drawerLoading.value = true
  drawerMessages.value = []
  try {
    const res = await fetch(`/api/chat/conversations/${conv.id}/messages`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      drawerMessages.value = data.data || []
    }
  } catch { /* ignore */ }
  finally { drawerLoading.value = false; nextTick(() => scrollToBottom()) }
}

function closeDrawer() { showDrawer.value = false; previewImg.value = '' }

const chatBodyRef = ref(null)
function scrollToBottom() {
  if (chatBodyRef.value) chatBodyRef.value.scrollTop = chatBodyRef.value.scrollHeight
}

function msgRoleLabel(role) {
  if (role === 'user') return '用户'
  if (role === 'admin') return '管理员'
  if (role === 'agent') return '代理'
  if (role === 'support') return '客服'
  return role
}

function shouldShowTime(messages, idx) {
  if (idx === 0) return true
  const prev = new Date(messages[idx - 1].created_at).getTime()
  const curr = new Date(messages[idx].created_at).getTime()
  return curr - prev > 5 * 60 * 1000
}

onMounted(() => { fetchConversations() })
</script>

<template>
  <div class="chat-history-page">
    <header class="page-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-content hero-row">
        <div class="hero-main">
          <span class="hero-badge">客服中心</span>
          <h1 class="hero-title">聊天记录</h1>
          <p class="hero-desc">查看用户与客服的会话记录，支持按状态筛选与消息检索</p>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <strong class="hero-stat-val">{{ total }}</strong>
            <span class="hero-stat-label">会话总数</span>
          </div>
          <div class="hero-stat-split" aria-hidden="true"></div>
          <div class="hero-stat">
            <strong class="hero-stat-val hero-stat-val--open">{{ totalOpen }}</strong>
            <span class="hero-stat-label">进行中</span>
          </div>
        </div>
      </div>
    </header>

    <section class="chat-panel">
      <div class="chat-filter">
        <div class="chat-filter-head">
          <span class="chat-filter-title">会话列表</span>
          <span class="chat-filter-count">共 <strong>{{ total }}</strong> 条</span>
        </div>
        <form class="chat-filter-bar" @submit.prevent="doSearch">
          <label class="chat-search-field">
            <svg class="chat-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              v-model="searchKey"
              class="chat-search-input"
              type="search"
              placeholder="搜索用户名 / 消息内容"
              @keyup.enter="doSearch"
            />
          </label>
          <el-select v-model="filterStatus" placeholder="全部状态" clearable class="chat-filter-select" @change="doSearch">
            <el-option label="全部状态" value="" />
            <el-option label="进行中" value="open" />
            <el-option label="已结束" value="closed" />
          </el-select>
          <button type="submit" class="cf-btn cf-btn--primary">搜索</button>
          <button type="button" class="cf-btn cf-btn--ghost" @click="resetSearch">重置</button>
        </form>
      </div>

      <div class="conv-list">
        <template v-if="!loading && conversations.length">
          <article
            v-for="conv in conversations"
            :key="conv.id"
            class="conv-card"
            :class="`is-${conv.status || 'closed'}`"
            @click="openDrawer(conv)"
          >
            <UserAvatar :name="displayName(conv)" :size="42" shape="rounded" />
            <div class="conv-body">
              <div class="conv-title-row">
                <strong class="conv-name">{{ displayName(conv) }}</strong>
                <span
                  class="conv-status-pill"
                  :style="{
                    color: statusInfo(conv.status).color,
                    background: statusInfo(conv.status).bg,
                    borderColor: statusInfo(conv.status).border
                  }"
                >{{ statusInfo(conv.status).label }}</span>
                <time class="conv-time">{{ fmtShortTime(conv.last_message_at) }}</time>
              </div>
              <div class="conv-preview-line" :class="`conv-preview--${lastMessageKind(conv.last_message)}`">
                <span class="conv-last-msg">{{ formatLastMessage(conv.last_message) }}</span>
                <span class="meta-chip">{{ conv.msg_count || 0 }} 条</span>
              </div>
            </div>
            <svg class="conv-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </article>
        </template>
        <EmptyState v-if="loading" loading class="empty-state" />
        <EmptyState
          v-else-if="!conversations.length"
          class="empty-state"
          text="暂无聊天记录"
          description="用户发起客服咨询后，聊天记录将显示在这里"
        />
      </div>

      <div v-if="total > 0" class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          background
          small
          @current-change="fetchConversations"
        />
      </div>
    </section>

    <!-- 聊天详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showDrawer" class="drawer-mask" @click.self="closeDrawer">
        <Transition name="drawer-slide">
          <div v-if="showDrawer" class="chat-drawer">
            <!-- 头部 -->
            <div class="drawer-header">
              <div class="drawer-title-row">
                <div class="drawer-user-info">
                  <UserAvatar
                    v-if="drawerConv"
                    :name="displayName(drawerConv)"
                    :size="44"
                    shape="rounded"
                  />
                  <div>
                    <h3>{{ drawerConv ? displayName(drawerConv) : '' }}</h3>
                    <div class="drawer-sub">
                      <span class="conv-status-pill small" v-if="drawerConv"
                        :style="{ color: statusInfo(drawerConv.status).color, background: statusInfo(drawerConv.status).bg, borderColor: statusInfo(drawerConv.status).border }">{{
                          statusInfo(drawerConv.status).label }}</span>
                      <span class="drawer-meta-text">{{ drawerConv?.msg_count || 0 }} 条消息</span>
                    </div>
                  </div>
                </div>
                <button class="drawer-close" @click="closeDrawer">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div v-if="drawerConv" class="drawer-info-chips">
                <div class="info-chip">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>创建 {{ fmtTime(drawerConv.created_at) }}</span>
                </div>
                <div class="info-chip">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>最后活跃 {{ fmtShortTime(drawerConv.last_message_at) }}</span>
                </div>
              </div>
            </div>

            <div class="drawer-drag-bar"><span></span></div>

            <!-- 消息列表 -->
            <div class="drawer-chat-body" ref="chatBodyRef">
              <div v-if="drawerLoading" class="drawer-loading">
                <div class="spinner"></div>
                <span>加载中...</span>
              </div>
              <template v-else-if="drawerMessages.length">
                <template v-for="(msg, idx) in drawerMessages" :key="msg.id">
                  <div v-if="shouldShowTime(drawerMessages, idx)" class="msg-time-divider">
                    <span>{{ fmtTime(msg.created_at) }}</span>
                  </div>
                  <div class="msg-row" :class="msg.sender_role === 'user' ? 'msg-left' : 'msg-right'">
                    <div class="msg-avatar-mini" :class="'avatar-' + msg.sender_role">{{
                      msgRoleLabel(msg.sender_role)[0] }}</div>
                    <div class="msg-content-wrap">
                      <div class="msg-sender">
                        <span class="msg-role-tag" :class="'role-' + msg.sender_role">{{ msgRoleLabel(msg.sender_role)
                          }}</span>
                      </div>
                      <div v-if="msg.type === 'image'" class="msg-img-wrap">
                        <img :src="msg.content" class="msg-img" @click="previewImg = msg.content" />
                      </div>
                      <div v-else-if="msg.type === 'audio'" class="msg-audio-wrap">
                        <audio :src="msg.content" controls preload="none" class="msg-audio"></audio>
                      </div>
                      <div v-else class="msg-bubble-text">{{ msg.content }}</div>
                    </div>
                  </div>
                </template>
              </template>
              <EmptyState v-else compact text="暂无消息记录" class="drawer-empty" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- 图片预览 -->
    <Transition name="fade">
      <div v-if="previewImg" class="img-preview-mask" @click="previewImg = ''">
        <img :src="previewImg" class="img-preview" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.chat-history-page {
  --ch-primary: #2f6df6;
  --ch-ink: #152033;
  --ch-muted: #8a95a8;
  --ch-border: #e8eef7;
  --ch-radius: 14px;
  --ch-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 20px 60px;
}

/* ========== 页面头部 ========== */
.page-hero {
  position: relative;
  border-radius: var(--ch-radius);
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid rgba(47, 109, 246, 0.12);
  box-shadow: var(--ch-shadow);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 0% 0%, rgba(47, 109, 246, 0.12), transparent 55%),
    radial-gradient(ellipse 50% 40% at 100% 100%, rgba(47, 109, 246, 0.06), transparent 50%),
    linear-gradient(180deg, #fff 0%, #fafbff 100%);
}

.hero-content {
  position: relative;
  z-index: 1;
  padding: 20px 22px;
}

.hero-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.hero-main {
  min-width: 0;
  flex: 1;
}

.hero-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--ch-primary);
  font-size: 11px;
  font-weight: 800;
  margin-bottom: 8px;
}

.hero-title {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--ch-ink);
  line-height: 1.2;
}

.hero-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--ch-muted);
  line-height: 1.5;
  max-width: 480px;
}

.hero-stats {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(47, 109, 246, 0.1);
  box-shadow: 0 4px 14px rgba(47, 109, 246, 0.06);
}

.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 96px;
  padding: 12px 16px;
}

.hero-stat-split {
  width: 1px;
  align-self: stretch;
  margin: 12px 0;
  background: #e8eef6;
}

.hero-stat-val {
  font-size: 20px;
  font-weight: 900;
  color: var(--ch-primary);
  line-height: 1.15;
}

.hero-stat-val--open {
  color: #10b981;
}

.hero-stat-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ch-muted);
}

/* ========== 主面板 ========== */
.chat-panel {
  background: #fff;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius);
  box-shadow: var(--ch-shadow);
  overflow: hidden;
}

.chat-filter {
  padding: 14px 16px 12px;
  border-bottom: 1px solid #f0f2f7;
}

.chat-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.chat-filter-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--ch-ink);
}

.chat-filter-count {
  font-size: 12px;
  color: var(--ch-muted);
}

.chat-filter-count strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--ch-primary);
}

.chat-filter-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px auto auto;
  gap: 8px;
  align-items: center;
}

.chat-search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 36px;
  padding: 0 10px 0 12px;
  border-radius: 10px;
  border: 1.5px solid #e4ebf5;
  background: #f8faff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.chat-search-field:focus-within {
  border-color: var(--ch-primary);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(47, 109, 246, 0.1);
}

.chat-search-icon {
  flex-shrink: 0;
  color: #9aa5b5;
}

.chat-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 13px;
  color: var(--ch-ink);
}

.chat-filter-select {
  width: 100%;
  min-width: 0;
}

.chat-filter-select :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 10px;
  box-shadow: 0 0 0 1px #e4ebf5 inset;
  background: #f8faff;
}

.cf-btn {
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.cf-btn--primary {
  border: none;
  background: var(--ch-primary);
  color: #fff;
}

.cf-btn--primary:hover {
  background: #2558d4;
}

.cf-btn--ghost {
  border: 1px solid #e4ebf5;
  background: #fff;
  color: #425066;
}

.cf-btn--ghost:hover {
  border-color: #c7d7ff;
  background: #f5f8ff;
  color: var(--ch-primary);
}

/* ========== 会话列表 ========== */
.conv-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
  min-height: 200px;
  background: linear-gradient(180deg, #f8faff 0%, #f4f7fb 100%);
}

.conv-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 2px 10px rgba(21, 32, 51, 0.05);
  cursor: pointer;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}

.conv-card:hover {
  border-color: #b8ccfa;
  box-shadow: 0 6px 20px rgba(47, 109, 246, 0.08);
}

.conv-card.is-open {
  border-color: #bbf7d0;
}

.conv-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(47, 109, 246, 0.1);
  color: var(--ch-primary);
  border: 1px solid rgba(47, 109, 246, 0.12);
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 800;
  flex-shrink: 0;
}

.conv-card.is-open .conv-avatar {
  color: #059669;
  background: #ecfdf3;
  border-color: #bbf7d0;
}

.conv-body {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
}

.conv-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.conv-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--ch-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.conv-time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ch-muted);
}

.conv-status-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  border: 1px solid;
  flex-shrink: 0;
}

.conv-status-pill.small {
  font-size: 10px;
  padding: 2px 8px;
}

.conv-preview-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  min-width: 0;
}

.conv-last-msg {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-preview--audio .conv-last-msg,
.conv-preview--image .conv-last-msg,
.conv-preview--media .conv-last-msg {
  color: #475569;
  font-weight: 600;
}

.meta-chip {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ch-muted);
  background: #f1f5f9;
}

.conv-chevron {
  flex-shrink: 0;
  margin-top: 4px;
  color: #c0c9d6;
  transition: color 180ms ease, transform 180ms ease;
}

.conv-card:hover .conv-chevron {
  color: var(--ch-primary);
  transform: translateX(2px);
}

.empty-state {
  background: #fff;
  border: 1px dashed #dce4f0;
  border-radius: 14px;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 2.5px solid #e5e8ed;
  border-top-color: #5b8def;
  border-radius: 50%;
  animation: spin .6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px 14px;
  border-top: 1px solid #f0f2f7;
  background: #fff;
}

.pagination-wrap :deep(.el-pagination.is-background .el-pager li.is-active) {
  background: var(--ch-primary);
}

/* ========== 抽屉 ========== */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.chat-drawer {
  width: 520px;
  max-width: 100vw;
  background: #fff;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 40px rgba(0, 0, 0, .1);
}

.drawer-header {
  padding: 22px 24px 16px;
  border-bottom: 1px solid #f0f2f5;
  background: linear-gradient(180deg, #fafbfe, #fff);
}

.drawer-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.drawer-user-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.drawer-avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #5b8def, #7c5bf5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  box-shadow: 0 3px 10px rgba(91, 141, 239, .25);
}

.drawer-user-info h3 {
  font-size: 16px;
  font-weight: 700;
  color: #1a2332;
  margin: 0 0 3px;
}

.drawer-sub {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-meta-text {
  font-size: 12px;
  color: #b0b8c5;
}

.drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #8a94a6;
  padding: 6px;
  border-radius: 8px;
  transition: all .15s;
}

.drawer-close:hover {
  background: #f0f2f5;
  color: #3a4555;
}

.drawer-info-chips {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.info-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #9aa5b5;
  background: #f5f7fa;
  padding: 5px 12px;
  border-radius: 8px;
}

.drawer-drag-bar {
  display: none;
}

/* ========== 聊天消息 ========== */
.drawer-chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f5f7fa;
}

.drawer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 0;
  color: #9aa5b5;
  font-size: 13px;
}

.drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 0;
  color: #b0b8c5;
  font-size: 14px;
}

.msg-time-divider {
  text-align: center;
  margin: 20px 0 12px;
}

.msg-time-divider span {
  font-size: 11px;
  color: #a0a9b8;
  background: #eaeef3;
  padding: 4px 14px;
  border-radius: 12px;
  font-weight: 500;
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  max-width: 80%;
}

.msg-left {
  align-items: flex-start;
}

.msg-right {
  flex-direction: row-reverse;
  margin-left: auto;
}

.msg-avatar-mini {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  color: #fff;
}

.avatar-user {
  background: linear-gradient(135deg, #5b8def, #6ea2f5);
}

.avatar-admin {
  background: linear-gradient(135deg, #e8375a, #f06292);
}

.avatar-agent {
  background: linear-gradient(135deg, #8b7bf7, #a78bfa);
}

.avatar-support {
  background: linear-gradient(135deg, #18a058, #4ade80);
}

.msg-content-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.msg-sender {
  margin-bottom: 4px;
}

.msg-role-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  display: inline-block;
}

.role-user {
  color: #5b8def;
  background: #eef3ff;
}

.role-admin {
  color: #e8375a;
  background: #fff0f3;
}

.role-agent {
  color: #8b7bf7;
  background: #f4f0ff;
}

.role-support {
  color: #18a058;
  background: #eafaf1;
}

.msg-bubble-text {
  background: #fff;
  padding: 12px 16px;
  border-radius: 4px 16px 16px 16px;
  font-size: 14px;
  color: #2a3444;
  line-height: 1.6;
  word-break: break-word;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .04);
}

.msg-right .msg-bubble-text {
  background: linear-gradient(135deg, #5b8def, #7c5bf5);
  color: #fff;
  border-radius: 16px 4px 16px 16px;
}

.msg-img-wrap {
  max-width: 240px;
}

.msg-img {
  max-width: 100%;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .08);
  transition: transform .15s;
}

.msg-img:hover {
  transform: scale(1.02);
}

.msg-audio-wrap {
  width: 220px;
}

.msg-audio {
  width: 100%;
  height: 36px;
  border-radius: 8px;
}

/* ========== 图片预览 ========== */
.img-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, .75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}

.img-preview {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, .3);
}

/* ========== 动画 ========== */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity .25s;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform .3s cubic-bezier(.4, 0, .2, 1);
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity .2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ========== 移动端 ========== */
@media (max-width: 760px) {
  .chat-history-page {
    padding: 12px 12px 40px;
  }

  .hero-content {
    padding: 14px 14px 12px;
  }

  .hero-row {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }

  .hero-title {
    font-size: 18px;
  }

  .hero-desc {
    font-size: 12px;
  }

  .hero-stats {
    width: 100%;
  }

  .hero-stat {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
  }

  .hero-stat-val {
    font-size: 18px;
  }

  .chat-filter {
    padding: 12px;
  }

  .chat-filter-bar {
    grid-template-columns: 1fr 1fr;
  }

  .chat-search-field {
    grid-column: 1 / -1;
  }

  .chat-filter-select {
    grid-column: 1 / -1;
  }

  .cf-btn {
    flex: 1;
    min-width: 0;
  }

  .conv-list {
    padding: 10px 10px 12px;
    gap: 8px;
  }

  .conv-card {
    padding: 9px 10px;
  }

  .conv-name {
    max-width: 100px;
  }

  .conv-time {
    margin-left: 0;
  }

  .chat-drawer {
    width: 100vw;
  }

  .drawer-drag-bar {
    display: flex;
    justify-content: center;
    padding: 8px 0 4px;
  }

  .drawer-drag-bar span {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: #d0d7e2;
  }

  .msg-row {
    max-width: 88%;
  }
}
</style>
