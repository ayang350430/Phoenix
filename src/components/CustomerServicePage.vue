<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import iconPin from '../assets/screenpin.png'
import iconYuedu from '../assets/screenyuedu.png'
import iconDianzan from '../assets/screendianzan.png'
import iconBao from '../assets/screenbao.png'
import iconYan from '../assets/screenyan.png'
import iconXiadan from '../assets/screenxiadan.png'

const { getToken, isAdmin, isAgent, isSupport, logout } = inject('workspace')
const router = useRouter()

if (!isAdmin.value && !isAgent.value && !isSupport.value) router.push('/dashboard')

const conversations = ref([])
const activeConvId = ref(null)
const messages = ref([])
const input = ref('')
const sending = ref(false)
const chatBody = ref(null)
const fileInput = ref(null)
const showEmoji = ref(false)
const previewImg = ref('')
const lastMsgId = ref(0)
const mobileShowChat = ref(false)
const convLoading = ref(false)
const searchKey = ref('')
const activeNavItem = ref('messages')

// ========== 语音功能 ==========
const recording = ref(false)
const recordSec = ref(0)
const sttListening = ref(false)
let mediaRecorder = null
let audioChunks = []
let recordTimer = null
let sttRecognition = null

let convTimer = null
let msgTimer = null
let prevUnreadTotal = 0

let audioCtx = null
function playNotifySound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, audioCtx.currentTime)
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.1)
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3)
    osc.start(audioCtx.currentTime)
    osc.stop(audioCtx.currentTime + 0.3)
  } catch { /* audio not supported */ }
}

// ========== 右键菜单 ==========
const ctxMenu = ref({ show: false, x: 0, y: 0, conv: null })
const agentInfo = ref({ show: false, loading: false, data: null })

function onConvContextMenu(e, c) {
  if (!isAdmin.value) return
  e.preventDefault()
  ctxMenu.value = { show: true, x: e.clientX, y: e.clientY, conv: c }
  document.addEventListener('click', closeCtxMenu, { once: true })
}
function closeCtxMenu() { ctxMenu.value.show = false }

async function viewSuperior() {
  const c = ctxMenu.value.conv
  closeCtxMenu()
  if (!c) return
  agentInfo.value = { show: true, loading: true, data: null }
  try {
    const res = await fetch(`/api/chat/user-agent/${c.user_id}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const json = await res.json()
    if (json.code === 0) agentInfo.value.data = json.data
  } catch { /* ignore */ }
  finally { agentInfo.value.loading = false }
}
function closeAgentInfo() { agentInfo.value.show = false }

const emojiGroups = [
  { label: '常用', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😋', '😎', '🤩', '😏', '😢', '😭', '😤', '😡', '🥺', '😱', '🤗', '🤔', '👍', '👎', '👏', '🙏', '💪', '❤️', '🔥', '⭐', '🎉', '✅'] },
  { label: '手势', items: ['👍', '👎', '👏', '🤝', '✌️', '🤞', '👌', '🤙', '👋', '✋', '🖐️', '👊', '✊', '🤛', '🤜', '🫶'] },
  { label: '物品', items: ['💰', '💸', '💳', '📱', '💻', '📦', '📋', '📊', '🔗', '🔔', '⏰', '🎯', '🏷️', '📌', '💡', '🔧'] }
]

const quickActions = [
  { name: '订单', img: iconXiadan },
  { name: '校证', img: iconYan },
  { name: '模助', img: iconDianzan },
  { name: '记录', img: iconBao },
  { name: '投诉', img: iconPin },
  { name: '参考', img: iconYuedu }
]

const activeConv = computed(() => conversations.value.find(c => c.id === activeConvId.value))
const totalUnread = computed(() => conversations.value.reduce((s, c) => s + (c.unread_count || 0), 0))

const filteredConversations = computed(() => {
  if (!searchKey.value.trim()) return conversations.value
  const k = searchKey.value.trim().toLowerCase()
  return conversations.value.filter(c =>
    displayName(c).toLowerCase().includes(k) ||
    (c.last_message || '').toLowerCase().includes(k)
  )
})

function displayName(c) {
  if (c.user_id === 0 || c.visitor_id) return c.visitor_name || `访客${(c.visitor_id || '').slice(-6)}`
  return c.real_name || c.nickname || c.username || `用户${c.user_id}`
}

function userRoleLabel(c) {
  const roles = c.user_roles || []
  if (roles.includes('admin') || roles.includes('super')) return '管理员'
  if (roles.includes('agent')) return '代理'
  if (roles.includes('support')) return '客服'
  return '用户'
}

function userRoleClass(c) {
  const roles = c.user_roles || []
  if (roles.includes('admin') || roles.includes('super')) return 'ur-admin'
  if (roles.includes('agent')) return 'ur-agent'
  if (roles.includes('support')) return 'ur-support'
  return 'ur-user'
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 172800) return '昨天'
  return new Date(dateStr).toLocaleDateString()
}

function msgTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function scrollBottom() {
  nextTick(() => { if (chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight })
}

async function fetchConversations() {
  try {
    const res = await fetch('/api/chat/conversations', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      conversations.value = data.data
      const newTotal = data.data.reduce((s, c) => s + (c.unread_count || 0), 0)
      if (newTotal > prevUnreadTotal) playNotifySound()
      prevUnreadTotal = newTotal
    }
  } catch { /* ignore */ }
}

function startConvPolling() { stopConvPolling(); convTimer = setInterval(fetchConversations, 5000) }
function stopConvPolling() { if (convTimer) { clearInterval(convTimer); convTimer = null } }

async function fetchMessages(initial = false) {
  if (!activeConvId.value) return
  try {
    const since = initial ? '' : `?since=${lastMsgId.value}`
    const res = await fetch(`/api/chat/conversations/${activeConvId.value}/messages${since}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      const msgs = data.data
      if (initial) {
        messages.value = msgs.map(m => ({
          id: m.id, role: m.sender_role, type: m.type,
          content: m.content, time: m.created_at,
          _playing: false, _dur: 0
        }))
        if (msgs.length) lastMsgId.value = msgs[msgs.length - 1].id
        scrollBottom()
      } else if (msgs.length) {
        let hasNewUserMsg = false
        for (const m of msgs) {
          if (messages.value.some(x => x.id === m.id)) continue
          if (m.sender_role === 'user') hasNewUserMsg = true
          messages.value.push({
            id: m.id, role: m.sender_role, type: m.type,
            content: m.content, time: m.created_at,
            _playing: false, _dur: 0
          })
        }
        if (msgs.length > 0) lastMsgId.value = Math.max(lastMsgId.value, ...msgs.map(m => m.id))
        if (hasNewUserMsg) playNotifySound()
        scrollBottom()
      }
      const conv = conversations.value.find(c => c.id === activeConvId.value)
      if (conv) conv.unread_count = 0
    }
  } catch { /* ignore */ }
}

function startMsgPolling() { stopMsgPolling(); msgTimer = setInterval(() => fetchMessages(false), 3000) }
function stopMsgPolling() { if (msgTimer) { clearInterval(msgTimer); msgTimer = null } }

async function selectConversation(c) {
  activeConvId.value = c.id
  lastMsgId.value = 0
  messages.value = []
  mobileShowChat.value = true
  await fetchMessages(true)
  startMsgPolling()
}

function closeChat() { mobileShowChat.value = false; stopMsgPolling() }

async function sendReply() {
  const text = input.value.trim()
  if (!text || sending.value || !activeConvId.value) return
  input.value = ''
  sending.value = true
  showEmoji.value = false
  try {
    const res = await fetch(`/api/chat/conversations/${activeConvId.value}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ type: 'text', content: text })
    })
    const data = await res.json()
    if (data.code === 0) {
      if (!messages.value.some(m => m.id === data.data.id)) {
        messages.value.push({ id: data.data.id, role: 'admin', type: 'text', content: text, time: new Date().toISOString() })
      }
      lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
      scrollBottom()
      fetchConversations()
    }
  } catch { /* ignore */ }
  sending.value = false
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() }
}

function insertEmoji(emoji) { input.value += emoji }
function triggerImagePick() { fileInput.value?.click() }

function onFileChange(e) {
  const files = e.target.files
  if (!files) return
  for (const file of files) { if (file.type.startsWith('image/')) readAndSendImage(file) }
  e.target.value = ''
}

function readAndSendImage(file) {
  const reader = new FileReader()
  reader.onload = async () => {
    const src = reader.result
    if (!activeConvId.value) return
    try {
      const res = await fetch(`/api/chat/conversations/${activeConvId.value}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ type: 'image', content: src })
      })
      const data = await res.json()
      if (data.code === 0) {
        if (!messages.value.some(m => m.id === data.data.id)) {
          messages.value.push({ id: data.data.id, role: 'admin', type: 'image', content: src, time: new Date().toISOString() })
        }
        lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
        scrollBottom()
      }
    } catch { /* ignore */ }
  }
  reader.readAsDataURL(file)
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) { e.preventDefault(); readAndSendImage(item.getAsFile()); return }
  }
}

function closeEmojiOnOutside(e) {
  if (showEmoji.value && !e.target.closest('.emoji-area')) showEmoji.value = false
}

// ========== 语音转文字 ==========
function toggleSTT() {
  if (sttListening.value) { stopSTT(); return }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { alert('当前浏览器不支持语音识别，请使用 Chrome'); return }
  sttRecognition = new SR()
  sttRecognition.lang = 'zh-CN'
  sttRecognition.continuous = true
  sttRecognition.interimResults = true
  sttListening.value = true
  sttRecognition.onresult = (e) => {
    let final = '', interim = ''
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript
      else interim += e.results[i][0].transcript
    }
    input.value = final + interim
  }
  sttRecognition.onerror = () => { sttListening.value = false }
  sttRecognition.onend = () => { sttListening.value = false; sttRecognition = null }
  sttRecognition.start()
}
function stopSTT() {
  if (sttRecognition) { sttRecognition.stop(); sttRecognition = null }
  sttListening.value = false
}

// ========== 录音发送语音消息 ==========
function getAudioMime() {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

async function startRecording() {
  if (!activeConvId.value) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: getAudioMime() })
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data) }
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      if (audioChunks.length > 0 && recordSec.value >= 1) {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType })
        sendAudioBlob(blob)
      }
      clearInterval(recordTimer)
      recordSec.value = 0
    }
    mediaRecorder.start()
    recording.value = true
    recordSec.value = 0
    recordTimer = setInterval(() => {
      recordSec.value++
      if (recordSec.value >= 60) stopRecording()
    }, 1000)
  } catch {
    alert('无法访问麦克风，请检查权限设置')
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  recording.value = false
}

function cancelRecording() {
  audioChunks = []
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = () => { mediaRecorder.stream?.getTracks().forEach(t => t.stop()) }
    mediaRecorder.stop()
  }
  clearInterval(recordTimer)
  recording.value = false
  recordSec.value = 0
}

async function sendAudioBlob(blob) {
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result
    if (!activeConvId.value) return
    try {
      const res = await fetch(`/api/chat/conversations/${activeConvId.value}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ type: 'audio', content: base64 })
      })
      const data = await res.json()
      if (data.code === 0) {
        if (!messages.value.some(m => m.id === data.data.id)) {
          messages.value.push({ id: data.data.id, role: 'admin', type: 'audio', content: base64, time: new Date().toISOString(), _playing: false, _dur: 0 })
        }
        lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
        scrollBottom()
        fetchConversations()
      }
    } catch { /* ignore */ }
  }
  reader.readAsDataURL(blob)
}

// ========== 微信语音播放 ==========
let currentAudio = null
let currentVoiceMsg = null

function playVoice(msg) {
  if (currentVoiceMsg === msg && currentAudio) {
    currentAudio.pause()
    currentAudio = null
    msg._playing = false
    currentVoiceMsg = null
    return
  }
  if (currentAudio) {
    currentAudio.pause()
    if (currentVoiceMsg) currentVoiceMsg._playing = false
  }
  const audio = new Audio(msg.content)
  currentAudio = audio
  currentVoiceMsg = msg
  msg._playing = true
  audio.onloadedmetadata = () => {
    if (isFinite(audio.duration)) msg._dur = Math.ceil(audio.duration)
  }
  audio.onended = () => { msg._playing = false; currentAudio = null; currentVoiceMsg = null }
  audio.onerror = () => { msg._playing = false; currentAudio = null; currentVoiceMsg = null }
  audio.play().catch(() => { msg._playing = false; currentAudio = null; currentVoiceMsg = null })
}

function fmtDuration(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function handleNavClick(item) {
  if (item === 'dashboard') router.push('/dashboard')
  else activeNavItem.value = item
}

onMounted(async () => {
  convLoading.value = true
  await fetchConversations()
  convLoading.value = false
  startConvPolling()
  document.addEventListener('click', closeEmojiOnOutside)
})

onBeforeUnmount(() => {
  stopConvPolling(); stopMsgPolling()
  document.removeEventListener('click', closeEmojiOnOutside)
})
</script>

<template>
  <div class="cs-page" :class="{ 'mobile-chat-active': mobileShowChat }">
    <!-- ====== 左导航 ====== -->
    <nav class="cs-nav">
      <div class="nav-brand">
        <h3>ServiceDesk</h3>
        <small>CS Workbench</small>
      </div>
      <div class="nav-links">
        <button type="button" :class="['nav-item', { active: activeNavItem === 'dashboard' }]"
          @click="handleNavClick('dashboard')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Dashboard
        </button>
        <button type="button" :class="['nav-item', { active: activeNavItem === 'messages' }]"
          @click="activeNavItem = 'messages'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Messages
        </button>
        <button type="button" :class="['nav-item', { active: activeNavItem === 'customers' }]"
          @click="activeNavItem = 'customers'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Customers
        </button>
        <button type="button" :class="['nav-item', { active: activeNavItem === 'analytics' }]"
          @click="activeNavItem = 'analytics'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Analytics
        </button>
        <button type="button" :class="['nav-item', { active: activeNavItem === 'settings' }]"
          @click="activeNavItem = 'settings'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </div>
      <div class="nav-bottom">
        <button type="button" class="create-ticket-btn" @click="activeNavItem = 'messages'">Create Ticket</button>
        <button type="button" class="nav-footer-item" @click="handleNavClick('dashboard')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Support
        </button>
        <button type="button" class="nav-footer-item" @click="logout()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>
      </div>
    </nav>

    <!-- ====== 会话列表 ====== -->
    <aside class="cs-sidebar">
      <div class="sidebar-head">
        <div class="sidebar-title-row">
          <h2>客服工作台专业版</h2>
          <span class="conv-count-badge">{{ conversations.length }}会话</span>
        </div>
        <div class="sidebar-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input v-model="searchKey" placeholder="搜索用户..." />
        </div>
      </div>

      <div class="conv-list">
        <div v-if="convLoading" class="conv-empty">
          <div class="conv-spinner"></div><span>加载中</span>
        </div>
        <div v-else-if="filteredConversations.length === 0" class="conv-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cdd5e0" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p>{{ searchKey ? '无搜索结果' : '暂无会话' }}</p>
          <small v-if="!searchKey">用户发起咨询后将显示在此</small>
        </div>
        <template v-else>
          <div v-for="c in filteredConversations" :key="c.id" :class="['conv-card', { active: activeConvId === c.id }]"
            @click="selectConversation(c)" @contextmenu="onConvContextMenu($event, c)">
            <div class="conv-ava" :class="{ 'visitor-ava': c.visitor_id }">
              <span>{{ displayName(c)[0] }}</span>
              <i class="conv-online"></i>
            </div>
            <div class="conv-body">
              <div class="conv-top">
                <div class="conv-top_box">
                  <strong class="conv-name">{{ displayName(c) }}</strong>
                  <span v-if="c.user_roles" :class="['conv-role-tag', userRoleClass(c)]">{{ userRoleLabel(c) }}</span>
                </div>
                <span class="conv-time">{{ timeAgo(c.last_message_at) }}</span>
              </div>
              <div class="conv-bottom">
                <span class="conv-preview">{{ c.last_message || '暂无消息' }}</span>
                <span v-if="c.unread_count > 0" class="conv-badge">{{ c.unread_count > 99 ? '99+' : c.unread_count
                  }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <!-- ====== 聊天区 ====== -->
    <main class="cs-main">
      <template v-if="activeConvId && activeConv">
        <header class="chat-head">
          <button type="button" class="back-btn" @click="closeChat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
              stroke-linecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div class="chat-head-ava">
            <span>{{ displayName(activeConv)[0] }}</span>
            <i class="head-online"></i>
          </div>
          <div class="chat-head-info">
            <strong>{{ displayName(activeConv) }}</strong>
            <span v-if="activeConv.user_roles" :class="['conv-role-tag', userRoleClass(activeConv)]">{{
              userRoleLabel(activeConv) }}</span>
            <span class="head-sub">
              <template v-if="activeConv.visitor_id">
                <span class="visitor-tag">网页访客</span> · {{ timeAgo(activeConv.created_at) }}发起
              </template>
              <template v-else>
                ID: {{ activeConv.user_id }} · {{ timeAgo(activeConv.created_at) }}发起
              </template>
            </span>
          </div>
        </header>

        <div class="chat-body" ref="chatBody">
          <div v-if="messages.length === 0" class="chat-empty-hint">暂无消息</div>

          <template v-for="(msg, idx) in messages" :key="msg.id">
            <div v-if="idx === 0 || (new Date(msg.time) - new Date(messages[idx - 1].time)) > 300000"
              class="time-divider">
              <span>{{ msgTime(msg.time) }}</span>
            </div>

            <div :class="['msg-row', msg.role === 'user' ? 'incoming' : 'outgoing']">
              <div v-if="msg.role === 'user'" class="msg-ava incoming-ava">{{ displayName(activeConv)[0] }}</div>
              <div class="msg-content">
                <div v-if="msg.type === 'text'" class="msg-bubble">
                  <span v-for="(line, li) in String(msg.content ?? '').split('\n')" :key="li">
                    {{ line }}<br v-if="li < String(msg.content ?? '').split('\n').length - 1" />
                  </span>
                </div>
                <div v-else-if="msg.type === 'image'" class="msg-bubble img-bub">
                  <img :src="msg.content" alt="图片" @click="previewImg = msg.content" />
                </div>
                <div v-else-if="msg.type === 'audio'" class="msg-bubble voice-bub" :class="{ playing: msg._playing }"
                  @click="playVoice(msg)">
                  <div class="voice-wave" :class="{ active: msg._playing }">
                    <span></span><span></span><span></span>
                  </div>
                  <span class="voice-dur">{{ msg._dur ? msg._dur + "''" : '' }}</span>
                </div>
                <span class="msg-ts">{{ msgTime(msg.time) }}</span>
              </div>
              <div v-if="msg.role !== 'user'" class="msg-ava outgoing-ava">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"
                  stroke-linecap="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
            </div>
          </template>
        </div>

        <footer class="chat-foot">
          <div class="quick-actions">
            <button v-for="qa in quickActions" :key="qa.name" type="button" class="qa-item">
              <img :src="qa.img" :alt="qa.name" class="qa-icon" />
              <span>{{ qa.name }}</span>
            </button>
          </div>
          <div class="foot-toolbar">
            <div class="emoji-area">
              <button type="button" class="tb-btn" :class="{ active: showEmoji }" @click.stop="showEmoji = !showEmoji">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
              <Transition name="ep">
                <div v-if="showEmoji" class="emoji-panel" @click.stop>
                  <div v-for="g in emojiGroups" :key="g.label" class="eg">
                    <p class="eg-label">{{ g.label }}</p>
                    <div class="eg-grid">
                      <button v-for="e in g.items" :key="e" type="button" class="ei" @click="insertEmoji(e)">{{ e
                        }}</button>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
            <button type="button" class="tb-btn" @click="triggerImagePick">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <!-- 语音转文字 -->
            <button type="button" class="tb-btn" :class="{ active: sttListening }" @click="toggleSTT" title="语音转文字">
              <svg v-if="!sttListening" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2.5"
                stroke-linecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
            </button>
            <!-- 录音发送语音 -->
            <button type="button" class="tb-btn voice-rec-btn" :class="{ active: recording }"
              @click="recording ? stopRecording() : startRecording()" title="发送语音消息">
              <svg v-if="!recording" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2.5"
                stroke-linecap="round">
                <circle cx="12" cy="12" r="10" />
                <rect x="9" y="9" width="6" height="6" rx="1" fill="#ff4d4f" stroke="none" />
              </svg>
            </button>
            <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onFileChange" />
          </div>
          <!-- 录音状态条 -->
          <div v-if="recording" class="cs-recording-bar">
            <span class="cs-rec-dot"></span>
            <span class="cs-rec-timer">{{ fmtDuration(recordSec) }}</span>
            <span class="cs-rec-hint">录音中，点击停止按钮发送</span>
            <button type="button" class="cs-rec-cancel" @click="cancelRecording">取消</button>
          </div>
          <!-- 语音识别状态 -->
          <div v-if="sttListening" class="cs-stt-bar">
            <span class="cs-stt-dot"></span>
            <span>正在听...</span>
            <button type="button" class="cs-stt-stop" @click="stopSTT">停止</button>
          </div>
          <div class="foot-input">
            <input v-model="input" type="text" placeholder="输入回复内容..." @keydown="handleKeydown" @paste="onPaste"
              :disabled="sending" />
            <button type="button" class="send-btn" :disabled="!input.trim() || sending" @click="sendReply">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </footer>
      </template>

      <template v-else>
        <div class="no-selection">
          <div class="no-sel-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c4cdd8" stroke-width="1.2"
              stroke-linecap="round" stroke-linejoin="round">
              <path
                d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <h3>选择一个会话</h3>
          <p>从左侧列表中选择用户会话开始回复</p>
        </div>
      </template>
    </main>

    <Transition name="pf">
      <div v-if="previewImg" class="preview-mask" @click="previewImg = ''">
        <img :src="previewImg" alt="预览" />
      </div>
    </Transition>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <button type="button" @click="viewSuperior">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          查看上级代理
        </button>
      </div>
    </Teleport>

    <!-- 上级代理信息弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="agentInfo.show" class="agent-modal-mask" @click.self="closeAgentInfo">
          <div class="agent-modal">
            <div class="agent-modal-head">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>上级代理信息</span>
              <button type="button" class="agent-modal-close" @click="closeAgentInfo">&times;</button>
            </div>
            <div v-if="agentInfo.loading" class="agent-modal-loading">
              <div class="spinner"></div> 加载中...
            </div>
            <div v-else-if="agentInfo.data" class="agent-modal-body">
              <template v-if="agentInfo.data.agent">
                <div class="agent-info-row">
                  <div class="agent-info-avatar">{{ (agentInfo.data.agent.nickname || agentInfo.data.agent.username ||
                    '代')[0] }}</div>
                  <div class="agent-info-detail">
                    <strong>{{ agentInfo.data.agent.nickname || agentInfo.data.agent.username }}</strong>
                    <span class="agent-info-username">@{{ agentInfo.data.agent.username }}</span>
                  </div>
                </div>
                <div class="agent-info-roles">
                  <span v-for="r in agentInfo.data.agent.roles" :key="r"
                    :class="['role-chip', r === 'support' ? 'role-support' : r === 'agent' ? 'role-agent' : 'role-default']">{{
                      r === 'agent' ? '代理' : r === 'support' ? '客服' : r === 'admin' ? '管理员' : r === 'super' ? '超管' : r
                    }}</span>
                </div>
                <div class="agent-info-support" :class="agentInfo.data.agent.hasSupport ? 'yes' : 'no'">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {{ agentInfo.data.agent.hasSupport ? '具有客服身份 — 消息路由到该代理' : '无客服身份 — 消息路由到管理员' }}
                </div>
              </template>
              <div v-else class="agent-info-none">该用户没有上级代理，消息直接路由到管理员</div>
            </div>
            <div v-else class="agent-modal-loading">加载失败</div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.cs-page {
  display: flex;
  min-height: 0;
  overflow: hidden;
  gap: 16px;
  padding: 16px;
  background: #f1f5f9;
  height: calc(100vh - 72px - 12px);
}

/* ============================== 左导航栏 ============================== */
.cs-nav {
  display: none;
}

.nav-brand {
  padding: 0 20px 24px;
  border-bottom: 1px solid #f1f5f9;
  margin-bottom: 8px;
}

.nav-brand h3 {
  font-size: 16px;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
}

.nav-brand small {
  font-size: 11px;
  color: #94a3b8;
}

.nav-links {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  border: none;
  background: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: all 160ms ease;
}

.nav-item:hover {
  background: #f8fafc;
  color: #1e293b;
}

.nav-item.active {
  background: #2563eb;
  color: #fff;
  box-shadow: 0 4px 12px rgba(37, 99, 235, .25);
}

.nav-item.active svg {
  stroke: #fff;
}

.nav-bottom {
  padding: 12px 10px 0;
  border-top: 1px solid #f1f5f9;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.create-ticket-btn {
  margin: 0 4px 12px;
  padding: 10px;
  border-radius: 10px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(37, 99, 235, .2);
  transition: all 160ms ease;
}

.create-ticket-btn:hover {
  background: #1d4ed8;
  transform: translateY(-1px);
}

.nav-footer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  color: #64748b;
  border: none;
  background: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: all 140ms ease;
}

.nav-footer-item:hover {
  background: #f8fafc;
  color: #1e293b;
}

/* ============================== 会话列表 ============================== */
.cs-sidebar {
  width: 300px;
  flex-shrink: 0;
  background: #fff;
  border-right: none;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .06), 0 0 0 1px rgba(0, 0, 0, .04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-head {
  padding: 18px 16px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid #f1f5f9;
}

.sidebar-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.sidebar-title-row h2 {
  font-size: 15px;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
}

.conv-count-badge {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: #dcfce7;
  color: #16a34a;
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 38px;
  border-radius: 10px;
  background: #f8fafc;
  color: #94a3b8;
  border: 1px solid #e2e8f0;
  transition: all 200ms ease;
}

.sidebar-search:focus-within {
  border-color: #2563eb;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .08);
}

.sidebar-search input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 13px;
  color: #1e293b;
}

.sidebar-search input::placeholder {
  color: #94a3b8;
}

.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: none;
}

.conv-list::-webkit-scrollbar {
  display: none;
}

.conv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 16px;
  text-align: center;
}

.conv-empty p {
  font-size: 14px;
  color: #647184;
  font-weight: 600;
  margin: 4px 0 0;
}

.conv-empty small {
  font-size: 12px;
  color: #b0b8c6;
}

.conv-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #edf1f6;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.conv-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 180ms ease;
  margin-bottom: 2px;
}

.conv-card:hover {
  background: #f8fafc;
}

.conv-card.active {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, .1);
}

.conv-ava {
  position: relative;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
  font-weight: 800;
  font-size: 15px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.conv-ava.visitor-ava {
  background: linear-gradient(135deg, #10b981, #34d399);
}

.conv-online {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
}

.conv-body {
  flex: 1;
  min-width: 0;
}

.conv-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.conv-top_box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conv-name {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-time {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  flex-shrink: 0;
}

.conv-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
}

.conv-preview {
  font-size: 12px;
  color: #94a3b8;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-badge {
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  display: grid;
  place-items: center;
  padding: 0 5px;
  flex-shrink: 0;
}

/* ============================== 聊天区 ============================== */
.cs-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .06), 0 0 0 1px rgba(0, 0, 0, .04);
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  background: #fff;
  border-bottom: 1px solid #edf1f6;
  flex-shrink: 0;
}

.back-btn {
  display: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #f1f5f9;
  border: none;
  color: #64748b;
  cursor: pointer;
  place-items: center;
  transition: all 160ms ease;
}

.back-btn:hover {
  background: #e2e8f0;
  color: #2563eb;
}

.chat-head-ava {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.head-online {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
}

.chat-head-info strong {
  display: block;
  font-size: 15px;
  color: #1e293b;
}

.head-sub {
  font-size: 12px;
  color: #94a3b8;
}

.visitor-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: #dcfce7;
  color: #16a34a;
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
}

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: none;
  background: #f8fafc;
}

.chat-body::-webkit-scrollbar {
  display: none;
}

.chat-empty-hint {
  flex: 1;
  display: grid;
  place-items: center;
  color: #94a3b8;
  font-size: 14px;
}

.time-divider {
  align-self: center;
  padding: 8px 0;
}

.time-divider span {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 10px;
  background: rgba(148, 163, 184, .1);
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
}

.msg-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 72%;
}

.msg-row.outgoing {
  align-self: flex-end;
}

.msg-ava {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 800;
}

.incoming-ava {
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
}

.outgoing-ava {
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
  color: #fff;
}

.msg-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.msg-row.outgoing .msg-content {
  align-items: flex-end;
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.msg-row.incoming .msg-bubble {
  background: #fff;
  color: #1e293b;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .04);
}

.msg-row.outgoing .msg-bubble {
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
  border-bottom-right-radius: 4px;
  box-shadow: 0 2px 8px rgba(37, 99, 235, .2);
}

.msg-ts {
  font-size: 10px;
  color: #b0b8c6;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 160ms ease;
}

.msg-row:hover .msg-ts {
  opacity: 1;
}

.img-bub {
  padding: 4px !important;
  background: transparent !important;
  box-shadow: none !important;
  max-width: 220px;
}

.img-bub img {
  display: block;
  max-width: 100%;
  max-height: 200px;
  border-radius: 12px;
  cursor: pointer;
  object-fit: cover;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .08);
  transition: transform 160ms ease;
}

.img-bub img:hover {
  transform: scale(1.02);
}

/* 微信风格语音气泡 */
.voice-bub {
  display: flex !important;
  align-items: center;
  gap: 8px;
  padding: 12px 16px !important;
  min-width: 80px;
  max-width: 180px;
  cursor: pointer;
  user-select: none;
  transition: opacity 150ms ease;
}

.voice-bub:active {
  opacity: .7;
}

.voice-wave {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 18px;
}

.msg-row.incoming .voice-wave {
  flex-direction: row-reverse;
}

.voice-wave span {
  display: block;
  width: 3px;
  border-radius: 2px;
  background: currentColor;
  opacity: .4;
  transition: opacity 200ms ease;
}

.voice-wave span:nth-child(1) {
  height: 6px;
}

.voice-wave span:nth-child(2) {
  height: 12px;
}

.voice-wave span:nth-child(3) {
  height: 18px;
}

.voice-wave.active span {
  animation: voice-ani 1s ease-in-out infinite;
  opacity: 1;
}

.voice-wave.active span:nth-child(1) {
  animation-delay: 0s;
}

.voice-wave.active span:nth-child(2) {
  animation-delay: .15s;
}

.voice-wave.active span:nth-child(3) {
  animation-delay: .3s;
}

@keyframes voice-ani {

  0%,
  100% {
    opacity: .3;
  }

  50% {
    opacity: 1;
  }
}

.voice-dur {
  font-size: 12px;
  font-weight: 600;
  opacity: .8;
  white-space: nowrap;
}

.no-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.no-sel-icon {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: #f1f5f9;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
}

.no-selection h3 {
  font-size: 17px;
  color: #475569;
  font-weight: 700;
  margin: 0;
}

.no-selection p {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}

/* ============================== 快捷操作 ============================== */
.quick-actions {
  display: none;
}

.qa-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 4px;
  min-width: 48px;
  transition: transform 160ms ease;
}

.qa-item:hover {
  transform: translateY(-2px);
}

.qa-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  object-fit: contain;
}

.qa-item span {
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
  white-space: nowrap;
}

/* ============================== 输入区 ============================== */
.chat-foot {
  background: #fff;
  flex-shrink: 0;
}

.foot-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 24px;
}

.tb-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #94a3b8;
  display: grid;
  place-items: center;
  transition: all 140ms ease;
}

.tb-btn:hover {
  background: #f1f5f9;
  color: #2563eb;
}

.tb-btn.active {
  background: #eff6ff;
  color: #2563eb;
}

.emoji-area {
  position: relative;
}

.emoji-panel {
  position: absolute;
  bottom: 42px;
  left: 0;
  width: 340px;
  max-height: 280px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .14), 0 0 0 1px rgba(0, 0, 0, .04);
  overflow-y: auto;
  padding: 12px;
  z-index: 10;
}

.eg+.eg {
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
  margin-top: 4px;
}

.eg-label {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  margin: 0 0 6px;
}

.eg-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.ei {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
  display: grid;
  place-items: center;
  transition: background 100ms ease, transform 100ms ease;
}

.ei:hover {
  background: #f1f5f9;
  transform: scale(1.2);
}

.ei:active {
  transform: scale(.9);
}

.ep-enter-active {
  transition: all 160ms cubic-bezier(.22, 1, .36, 1);
}

.ep-leave-active {
  transition: all 100ms ease-in;
}

.ep-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(.96);
}

.ep-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.foot-input {
  display: flex;
  gap: 8px;
  align-items: center;
  background: #f8fafc;
  border-radius: 24px;
  padding: 4px 4px 4px 18px;
  margin: 0 24px 16px;
  border: 1.5px solid #e2e8f0;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.foot-input:focus-within {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .08);
}

.foot-input input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  color: #1e293b;
  outline: none;
  padding: 10px 0;
}

.foot-input input::placeholder {
  color: #94a3b8;
}

.send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  transition: all 160ms ease;
  box-shadow: 0 2px 8px rgba(37, 99, 235, .25);
}

.send-btn:hover {
  background: #1d4ed8;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(37, 99, 235, .35);
}

.send-btn:active {
  transform: scale(.95);
}

.send-btn:disabled {
  opacity: .35;
  pointer-events: none;
  box-shadow: none;
}

/* ============================== 图片预览 ============================== */
.preview-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, .78);
  backdrop-filter: blur(8px);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.preview-mask img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, .4);
  object-fit: contain;
}

.pf-enter-active,
.pf-leave-active {
  transition: opacity 200ms ease;
}

.pf-enter-from,
.pf-leave-to {
  opacity: 0;
}

/* ============================== 语音功能 ============================== */
.voice-rec-btn.active {
  color: #ff4d4f !important;
  background: #fff1f0 !important;
}

.cs-recording-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  font-size: 12px;
  color: #d4380d;
  background: #fff1f0;
  margin: 0;
}

.cs-rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff4d4f;
  animation: cs-blink 1s ease-in-out infinite;
}

@keyframes cs-blink {

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: .3;
  }
}

.cs-rec-timer {
  font-weight: 700;
  font-family: 'SF Mono', Consolas, monospace;
}

.cs-rec-hint {
  flex: 1;
  color: #94a3b8;
}

.cs-rec-cancel {
  padding: 3px 10px;
  border-radius: 6px;
  border: none;
  background: #ffd8d2;
  color: #d4380d;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 150ms ease;
}

.cs-rec-cancel:hover {
  background: #ffc0b5;
}

.cs-stt-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  font-size: 12px;
  color: #2563eb;
  font-weight: 600;
  background: #eff6ff;
  margin: 0;
}

.cs-stt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
  animation: cs-blink 1s ease-in-out infinite;
}

.cs-stt-stop {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: 6px;
  border: none;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 150ms ease;
}

.cs-stt-stop:hover {
  background: #bfdbfe;
}

/* ============================== 响应式 ============================== */
@media (max-width: 760px) {
  .cs-page {
    padding: 0;
    gap: 0;
    background: #fff;
    height: calc(100vh - 84px);
  }

  .cs-sidebar {
    width: 100%;
    border-radius: 0;
    box-shadow: none;
  }

  .cs-main {
    display: none;
    border-radius: 0;
    box-shadow: none;
  }

  .cs-page.mobile-chat-active .cs-sidebar {
    display: none;
  }

  .cs-page.mobile-chat-active .cs-main {
    display: flex;
  }

  .back-btn {
    display: grid;
  }

  .chat-head {
    padding: 12px 14px;
  }

  .chat-body {
    padding: 14px;
    scrollbar-width: none;
  }

  .chat-body::-webkit-scrollbar {
    display: none;
  }

  .msg-row {
    max-width: 85%;
  }

  .foot-toolbar {
    padding: 4px 14px;
  }

  .foot-input {
    margin: 0 14px 12px;
    padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
  }

  .emoji-panel {
    width: 280px;
  }

  .eg-grid {
    grid-template-columns: repeat(7, 1fr);
  }
}

/* ========== 用户身份标签 ========== */
.conv-role-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ur-user {
  background: #eef3ff;
  color: #5b8def;
}

.ur-agent {
  background: #f4f0ff;
  color: #8b7bf7;
}

.ur-support {
  background: #eafaf1;
  color: #18a058;
}

.ur-admin {
  background: #fff0f3;
  color: #e8375a;
}

/* ========== 右键菜单 & 代理弹窗 ========== */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .15);
  padding: 4px;
  min-width: 160px;
}

.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  font-size: 13px;
  color: #1a2332;
  cursor: pointer;
  border-radius: 8px;
  transition: background .15s;
}

.ctx-menu button:hover {
  background: #f0f4ff;
  color: #2563eb;
}

.agent-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(15, 23, 42, .4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-modal {
  background: #fff;
  border-radius: 16px;
  width: 380px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .15);
  overflow: hidden;
}

.agent-modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 20px;
  border-bottom: 1px solid #f0f2f5;
  font-weight: 700;
  font-size: 15px;
  color: #1a2332;
}

.agent-modal-close {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 22px;
  cursor: pointer;
  color: #8a94a6;
  padding: 0 4px;
  line-height: 1;
}

.agent-modal-close:hover {
  color: #1a2332;
}

.agent-modal-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: #9aa5b5;
  font-size: 14px;
}

.agent-modal-body {
  padding: 20px;
}

.agent-info-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.agent-info-avatar {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #8b7bf7, #a78bfa);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  box-shadow: 0 3px 10px rgba(139, 123, 247, .25);
}

.agent-info-detail strong {
  display: block;
  font-size: 16px;
  color: #1a2332;
}

.agent-info-username {
  font-size: 13px;
  color: #9aa5b5;
}

.agent-info-roles {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.role-chip {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 20px;
}

.role-agent {
  background: #f4f0ff;
  color: #8b7bf7;
}

.role-support {
  background: #eafaf1;
  color: #18a058;
}

.role-default {
  background: #f5f7fa;
  color: #5a6a7e;
}

.agent-info-support {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
}

.agent-info-support.yes {
  background: #eafaf1;
  color: #18a058;
}

.agent-info-support.no {
  background: #fff8f0;
  color: #e8913a;
}

.agent-info-none {
  text-align: center;
  padding: 20px 0;
  color: #9aa5b5;
  font-size: 14px;
}
</style>
