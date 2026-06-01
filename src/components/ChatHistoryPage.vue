<script setup>
import { ref, computed, onMounted, inject, nextTick } from 'vue'
import { ElPagination, ElSelect, ElOption } from 'element-plus'

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
  if (s === 'open') return { label: '进行中', color: '#42c978', bg: '#edfbf3', border: '#b7ebc9' }
  if (s === 'closed') return { label: '已结束', color: '#9aa5b5', bg: '#f6f8fc', border: '#e0e4ea' }
  return { label: s || '未知', color: '#9aa5b5', bg: '#f6f8fc', border: '#e0e4ea' }
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
      <div class="stat-card">
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
      <div class="stat-card">
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
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 130px" @change="doSearch">
          <el-option label="全部状态" value="" />
          <el-option label="进行中" value="open" />
          <el-option label="已结束" value="closed" />
        </el-select>
        <button type="button" class="btn-search" @click="doSearch">搜索</button>
        <button type="button" class="btn-reset" @click="resetSearch">重置</button>
      </div>
      <span class="filter-total">共 {{ total }} 条会话</span>
    </div>

    <!-- 会话列表 -->
    <div class="conv-list">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>
      <template v-else-if="conversations.length">
        <div v-for="conv in conversations" :key="conv.id" class="conv-card" @click="openDrawer(conv)">
          <div class="conv-left">
            <div class="conv-avatar">
              <span>{{ (displayName(conv) || '用')[0] }}</span>
            </div>
          </div>
          <div class="conv-center">
            <div class="conv-head">
              <span class="conv-name">{{ displayName(conv) }}</span>
              <span class="conv-status-pill"
                :style="{ color: statusInfo(conv.status).color, background: statusInfo(conv.status).bg, borderColor: statusInfo(conv.status).border }">{{
                  statusInfo(conv.status).label }}</span>
            </div>
            <div class="conv-last-msg">{{ conv.last_message || '暂无消息' }}</div>
            <div class="conv-meta">
              <span class="meta-item">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {{ fmtShortTime(conv.last_message_at) }}
              </span>
              <span class="meta-dot"></span>
              <span class="meta-item">{{ conv.msg_count || 0 }} 条消息</span>
            </div>
          </div>
          <div class="conv-right">
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
  max-width: 960px;
  margin: 0 auto;
  padding: 0 16px 60px;
}

/* ========== 统计卡片 ========== */
.stats-row {
  display: flex;
  gap: 16px;
  margin-top: 20px;
  margin-bottom: 20px;
}

.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 16px;
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .04);
  border: 1px solid rgba(0, 0, 0, .03);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-total {
  background: linear-gradient(135deg, #eef3ff, #e0e8ff);
  color: #5b8def;
}

.icon-open {
  background: linear-gradient(135deg, #edfbf3, #d4f5e2);
  color: #42c978;
}

.stat-body {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 12px;
  color: #9aa5b5;
  margin-bottom: 2px;
}

.stat-value {
  font-size: 26px;
  font-weight: 800;
  color: #1a2332;
  letter-spacing: -.5px;
}

.stat-value.green {
  color: #42c978;
}

/* ========== 筛选栏 ========== */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: 14px;
  padding: 14px 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .04);
  border: 1px solid rgba(0, 0, 0, .03);
}

.filter-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: #b0b8c5;
  pointer-events: none;
}

.filter-input {
  border: 1.5px solid #e8ecf1;
  border-radius: 10px;
  padding: 9px 14px 9px 36px;
  font-size: 13px;
  outline: none;
  width: 240px;
  transition: all .2s;
  background: #fafbfc;
}

.filter-input:focus {
  border-color: #5b8def;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(91, 141, 239, .1);
}

.btn-search {
  background: linear-gradient(135deg, #5b8def, #7c5bf5);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 9px 22px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 600;
  transition: transform .15s, box-shadow .15s;
}

.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(91, 141, 239, .3);
}

.btn-reset {
  background: #f5f6f8;
  color: #5a6a7e;
  border: 1.5px solid #e8ecf1;
  border-radius: 10px;
  padding: 9px 18px;
  font-size: 13px;
  cursor: pointer;
  transition: background .15s;
}

.btn-reset:hover {
  background: #eef0f3;
}

.filter-total {
  font-size: 13px;
  color: #9aa5b5;
  white-space: nowrap;
}

/* ========== 会话列表 ========== */
.conv-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.conv-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  border-radius: 16px;
  padding: 18px 22px;
  cursor: pointer;
  transition: all .2s;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .04);
  border: 1.5px solid transparent;
}

.conv-card:hover {
  border-color: rgba(91, 141, 239, .2);
  box-shadow: 0 6px 24px rgba(91, 141, 239, .1);
  transform: translateY(-2px);
}

.conv-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #5b8def, #7c5bf5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(91, 141, 239, .25);
}

.conv-center {
  flex: 1;
  min-width: 0;
}

.conv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.conv-name {
  font-weight: 700;
  font-size: 15px;
  color: #1a2332;
}

.conv-status-pill {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 20px;
  font-weight: 600;
  border: 1px solid;
  letter-spacing: .3px;
}

.conv-status-pill.small {
  font-size: 10px;
  padding: 1px 8px;
}

.conv-last-msg {
  font-size: 13px;
  color: #7a8599;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
  line-height: 1.4;
}

.conv-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #b0b8c5;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #d0d7e2;
}

.conv-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.conv-arrow {
  color: #d0d7e2;
  transition: color .2s, transform .2s;
}

.conv-card:hover .conv-arrow {
  color: #5b8def;
  transform: translateX(3px);
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
    padding: 0 10px 40px;
  }

  .stats-row {
    flex-direction: column;
    gap: 10px;
  }

  .stat-card {
    padding: 16px 18px;
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
  }

  .filter-input {
    width: 100%;
    font-size: 12px !important;
    padding: 8px 12px 8px 32px;
  }

  .btn-search {
    flex: 1;
    padding: 9px 0;
    text-align: center;
  }

  .btn-reset {
    flex: 1;
    padding: 9px 0;
    text-align: center;
  }

  .filter-total {
    text-align: center;
    font-size: 12px;
    color: #9aa5b5;
  }

  .conv-card {
    padding: 14px 16px;
    gap: 12px;
  }

  .conv-avatar {
    width: 40px;
    height: 40px;
    font-size: 15px;
    border-radius: 12px;
  }

  .conv-meta {
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
  }

  .meta-dot {
    display: none;
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
