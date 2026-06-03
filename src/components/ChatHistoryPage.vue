<script setup>
import { ref, computed, onMounted, inject, nextTick } from 'vue'
import { ElPagination, ElSelect, ElOption } from 'element-plus'
import 'element-plus/es/components/pagination/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/option/style/css'

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
    <!-- 顶部统计卡片 -->
    <div class="stats-row">
      <div class="stat-card stat-card--total">
        <div class="stat-icon icon-total">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">会话总数</span>
          <strong class="stat-value">{{ total }}</strong>
        </div>
      </div>
      <div class="stat-card stat-card--open">
        <div class="stat-icon icon-open">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <div class="stat-body">
          <span class="stat-label">进行中</span>
          <strong class="stat-value green">{{ totalOpen }}</strong>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <div class="search-wrap">
          <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input v-model="searchKey" placeholder="搜索用户名 / 消息内容" class="filter-input" @keyup.enter="doSearch" />
        </div>
        <el-select v-model="filterStatus" placeholder="全部状态" clearable class="filter-select" @change="doSearch">
          <el-option label="全部状态" value="" />
          <el-option label="进行中" value="open" />
          <el-option label="已结束" value="closed" />
        </el-select>
        <div class="filter-actions">
          <button type="button" class="btn-search" @click="doSearch">搜索</button>
          <button type="button" class="btn-reset" @click="resetSearch">重置</button>
        </div>
      </div>
      <span class="filter-total">共 <strong>{{ total }}</strong> 条会话</span>
    </div>

    <!-- 会话列表 -->
    <div class="conv-list">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>
      <template v-else-if="conversations.length">
        <div v-for="conv in conversations" :key="conv.id" class="conv-card" @click="openDrawer(conv)">
          <div class="conv-avatar">
            <span>{{ (displayName(conv) || '用')[0] }}</span>
          </div>
          <div class="conv-body">
            <div class="conv-top">
              <div class="conv-head">
                <span class="conv-name">{{ displayName(conv) }}</span>
                <span
                  class="conv-status-pill"
                  :style="{
                    color: statusInfo(conv.status).color,
                    background: statusInfo(conv.status).bg,
                    borderColor: statusInfo(conv.status).border
                  }"
                >{{ statusInfo(conv.status).label }}</span>
              </div>
              <time class="conv-time">{{ fmtShortTime(conv.last_message_at) }}</time>
            </div>
            <div class="conv-preview" :class="`conv-preview--${lastMessageKind(conv.last_message)}`">
              <span class="conv-preview-icon" aria-hidden="true">
                <svg v-if="lastMessageKind(conv.last_message) === 'image'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <svg v-else-if="lastMessageKind(conv.last_message) === 'audio'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <span class="conv-last-msg">{{ formatLastMessage(conv.last_message) }}</span>
            </div>
            <div class="conv-meta">
              <span class="meta-chip">{{ conv.msg_count || 0 }} 条消息</span>
            </div>
          </div>
          <div class="conv-action" aria-hidden="true">
            <svg class="conv-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </template>
      <div v-else class="empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <p>暂无聊天记录</p>
        <span>用户发起客服咨询后，聊天记录将显示在这里</span>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > 0" class="pagination-wrap">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="total, prev, pager, next"
        background small @current-change="fetchConversations" />
    </div>

    <!-- 聊天详情抽屉 -->
    <Transition name="drawer-fade">
      <div v-if="showDrawer" class="drawer-mask" @click.self="closeDrawer">
        <Transition name="drawer-slide">
          <div v-if="showDrawer" class="chat-drawer">
            <!-- 头部 -->
            <div class="drawer-header">
              <div class="drawer-title-row">
                <div class="drawer-user-info">
                  <div class="drawer-avatar">
                    <span>{{ drawerConv ? (displayName(drawerConv) || '用')[0] : '' }}</span>
                  </div>
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
              <div v-else class="drawer-empty">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d0d7e2" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>暂无消息记录</span>
              </div>
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
  --ch-muted: #64748b;
  --ch-line: rgba(21, 32, 51, 0.08);
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 20px 60px;
}

/* ========== 统计卡片 ========== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
  margin-bottom: 20px;
}

.stat-card {
  position: relative;
  overflow: hidden;
  background: #fff;
  border-radius: 18px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 10px 32px rgba(21, 32, 51, 0.05);
  border: 1px solid var(--ch-line);
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 3px;
  border-radius: 999px;
  opacity: 0.9;
}

.stat-card--total::before {
  background: linear-gradient(90deg, var(--ch-primary), #8b7bf7);
}

.stat-card--open::before {
  background: linear-gradient(90deg, #34d399, #10b981);
}

.stat-icon {
  width: 50px;
  height: 50px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-total {
  background: linear-gradient(145deg, rgba(47, 109, 246, 0.14), rgba(47, 109, 246, 0.05));
  color: var(--ch-primary);
  border: 1px solid rgba(47, 109, 246, 0.1);
}

.icon-open {
  background: linear-gradient(145deg, rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.05));
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.12);
}

.stat-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ch-muted);
}

.stat-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--ch-ink);
  letter-spacing: -0.03em;
  line-height: 1;
}

.stat-value.green {
  color: #10b981;
}

/* ========== 筛选栏 ========== */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: #fff;
  border-radius: 18px;
  padding: 16px 20px;
  margin-bottom: 18px;
  box-shadow: 0 10px 32px rgba(21, 32, 51, 0.05);
  border: 1px solid var(--ch-line);
}

.filter-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 220px;
  max-width: 360px;
}

.search-icon {
  position: absolute;
  left: 14px;
  color: #94a3b8;
  pointer-events: none;
}

.filter-input {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 11px 14px 11px 40px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  background: #f8fafc;
  color: var(--ch-ink);
}

.filter-input:focus {
  border-color: rgba(47, 109, 246, 0.45);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(47, 109, 246, 0.1);
}

.filter-select {
  width: 132px;
  flex-shrink: 0;
}

.filter-select :deep(.el-select__wrapper) {
  min-height: 42px;
  border-radius: 12px;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
  background: #f8fafc;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-search,
.btn-reset {
  min-height: 42px;
  padding: 0 20px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}

.btn-search {
  background: var(--goosd-primary);
  color: #fff;
  border: none;
}

.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: var(--goosd-btn-shadow-hover);
  background: var(--goosd-primary-dark);
}

.btn-reset {
  background: #fff;
  color: #475569;
  border: 1px solid #e2e8f0;
}

.btn-reset:hover {
  background: #f8fafc;
}

.filter-total {
  font-size: 13px;
  color: var(--ch-muted);
  white-space: nowrap;
  padding: 8px 14px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid var(--ch-line);
}

.filter-total strong {
  color: var(--ch-primary);
  font-weight: 800;
}

/* ========== 会话列表 ========== */
.conv-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conv-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px;
  cursor: pointer;
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
  box-shadow: 0 8px 28px rgba(21, 32, 51, 0.04);
  border: 1px solid var(--ch-line);
}

.conv-card:hover {
  border-color: rgba(47, 109, 246, 0.16);
  box-shadow: 0 16px 40px rgba(47, 109, 246, 0.1);
  transform: translateY(-2px);
}

.conv-avatar {
  width: 48px;
  height: 48px;
  border-radius: 15px;
  background: linear-gradient(135deg, var(--ch-primary), #8b7bf7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  flex-shrink: 0;
  box-shadow: 0 8px 18px rgba(47, 109, 246, 0.22);
}

.conv-body {
  min-width: 0;
}

.conv-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.conv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.conv-name {
  font-weight: 800;
  font-size: 15px;
  color: var(--ch-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
}

.conv-status-pill {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 700;
  border: 1px solid;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.conv-status-pill.small {
  font-size: 10px;
  padding: 2px 8px;
}

.conv-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 8px;
}

.conv-preview-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  flex-shrink: 0;
  color: var(--ch-primary);
  background: rgba(47, 109, 246, 0.08);
}

.conv-preview--audio .conv-preview-icon {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.1);
}

.conv-preview--image .conv-preview-icon {
  color: #0ea5e9;
  background: rgba(14, 165, 233, 0.1);
}

.conv-preview--empty .conv-preview-icon {
  color: #94a3b8;
  background: #f1f5f9;
}

.conv-last-msg {
  font-size: 13px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.45;
}

.conv-preview--audio .conv-last-msg,
.conv-preview--image .conv-last-msg,
.conv-preview--media .conv-last-msg {
  color: #475569;
  font-weight: 600;
}

.conv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid var(--ch-line);
}

.conv-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #f8fafc;
  flex-shrink: 0;
  transition: background 0.2s, transform 0.2s;
}

.conv-arrow {
  color: #94a3b8;
  transition: color 0.2s, transform 0.2s;
}

.conv-card:hover .conv-action {
  background: rgba(47, 109, 246, 0.08);
}

.conv-card:hover .conv-arrow {
  color: var(--ch-primary);
  transform: translateX(2px);
}

/* ========== 空状态 & 加载 ========== */
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: #9aa5b5;
}

.empty-icon {
  margin-bottom: 16px;
  color: #d0d7e2;
}

.empty-state p {
  font-size: 16px;
  font-weight: 600;
  color: #7a8599;
  margin: 0 0 6px;
}

.empty-state span {
  font-size: 13px;
  color: #b0b8c5;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 80px 0;
  color: #9aa5b5;
  font-size: 14px;
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
  to {
    transform: rotate(360deg);
  }
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
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
    padding: 0 12px 40px;
  }

  .stats-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .stat-card {
    padding: 18px;
  }

  .filter-bar {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
    padding: 14px;
  }

  .filter-left {
    flex-wrap: wrap;
    gap: 8px;
  }

  .search-wrap {
    width: 100%;
    max-width: none;
  }

  .filter-input {
    font-size: 12px !important;
    padding: 10px 12px 10px 36px;
  }

  .filter-select {
    width: 100%;
  }

  .filter-actions {
    width: 100%;
  }

  .btn-search,
  .btn-reset {
    flex: 1;
  }

  .filter-total {
    text-align: center;
    font-size: 12px;
  }

  .conv-card {
    padding: 14px 16px;
    gap: 12px;
  }

  .conv-avatar {
    width: 42px;
    height: 42px;
    font-size: 16px;
    border-radius: 13px;
  }

  .conv-top {
    flex-direction: column;
    gap: 4px;
  }

  .conv-time {
    align-self: flex-start;
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
