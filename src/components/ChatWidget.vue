<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'

const { getToken } = inject('workspace')

const open = ref(false)
const input = ref('')
const sending = ref(false)
const chatBody = ref(null)
const fileInput = ref(null)
const showEmoji = ref(false)
const previewImg = ref('')
const hasUnread = ref(false)
const messages = ref([])
const lastMsgId = ref(0)
const liveMode = ref(false)
let pollTimer = null
let localId = -1
function nextId() { return localId-- }

const quickQuestions = ref([
  '订单怎么申请退款？',
  '我的订单什么时间能到？',
  '余额怎么充值？',
  '如何批量下单？',
  '怎么查看订单状态？',
  '添加飞机号',
  '联系人工客服'
])
const welcomeText = ref('您好！我是AI客服助手，可以为您解答常见问题。\n如需人工服务，请点击「联系人工客服」。')
const telegramId = ref('')

const emojiGroups = [
  { label: '常用', items: ['😀','😁','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','😏','😢','😭','😤','😡','🥺','😱','🤗','🤔','👍','👎','👏','🙏','💪','❤️','🔥','⭐','🎉','✅'] },
  { label: '手势', items: ['👍','👎','👏','🤝','✌️','🤞','👌','🤙','👋','✋','🖐️','👊','✊','🤛','🤜','🫶'] },
  { label: '物品', items: ['💰','💸','💳','📱','💻','📦','📋','📊','🔗','🔔','⏰','🎯','🏷️','📌','💡','🔧'] }
]

const faqMap = [
  { keywords: ['退款','退钱','退费'], answer: '关于退款：\n1. 进入「记录中心」查看订单\n2. 如果订单未完成且需要退款，请联系管理员处理\n3. 退款将在 1-3 个工作日内到账\n\n如需人工处理，请点击「转人工」。' },
  { keywords: ['时间','多久','到账','完成'], answer: '订单处理时间说明：\n• 阅读订单：一般 1-6 小时内完成\n• 点赞订单：一般 2-8 小时内完成\n• 曝光订单：一般 1-4 小时内完成\n\n您可以在「记录中心」实时查看进度。' },
  { keywords: ['充值','余额','付款','支付'], answer: '充值方式：\n1. 点击顶部导航栏的「充值」按钮\n2. 输入充值金额（最低 1 元）\n3. 选择支付方式完成支付\n4. 支付成功后余额自动到账' },
  { keywords: ['批量','下单','提交'], answer: '批量下单步骤：\n1. 进入「批量下单」页面\n2. 选择任务类型\n3. 每行输入：链接 + 空格 + 数量\n4. 点击「手动预校验」检查链接\n5. 确认后点击提交' },
  { keywords: ['查看','订单','记录','状态','进度'], answer: '查看订单状态：\n1. 点击导航栏「记录中心」\n2. 可以查看所有批次和订单详情\n3. 订单状态包括：待处理、进行中、已完成、失败' },
  { keywords: ['代理','推荐','邀请','下级'], answer: '代理推荐功能：\n1. 在个人中心查看您的推荐链接\n2. 将链接分享给好友\n3. 好友通过链接注册后自动成为您的下级\n\n如需升级为代理，请联系管理员。' },
  { keywords: ['价格','单价','费用','多少钱'], answer: '关于价格：\n• 价格在「批量下单」页面会显示当前单价\n• 不同类型的任务价格不同\n• 代理用户可能享有不同的价格\n\n如有价格疑问，请咨询您的上级或管理员。' },
  { keywords: ['飞机','telegram','tg','电报'], answer: null, dynamic: 'telegram' }
]

function findConfigAnswer(text) {
  for (const q of quickQuestions.value) {
    if (typeof q === 'object' && q.answer && q.question === text) return q.answer
  }
  return null
}

function matchFaq(text) {
  for (const faq of faqMap) {
    if (faq.keywords.some(k => text.includes(k))) {
      if (faq.dynamic === 'telegram') {
        return telegramId.value
          ? `飞机号(Telegram)：${telegramId.value}\n\n您可以通过 Telegram 联系我们获取更多帮助。`
          : '暂未配置飞机号，请联系人工客服获取。'
      }
      return faq.answer
    }
  }
  return null
}

function scrollBottom() {
  nextTick(() => { if (chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight })
}

function toggleChat() {
  open.value = !open.value
  if (open.value) {
    hasUnread.value = false
    showEmoji.value = false
    scrollBottom()
  }
}

// ========== 人工客服模式 ==========
function connectLiveChat() {
  if (liveMode.value) return
  liveMode.value = true
  messages.value.push({ id: nextId(), role: 'system', type: 'text', text: '已转接人工客服，请描述您的问题' })
  scrollBottom()
  startPolling()
}

// ========== 后端消息拉取 ==========
async function fetchMessages() {
  try {
    const url = lastMsgId.value
      ? `/api/chat/messages?since=${lastMsgId.value}`
      : '/api/chat/messages'
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data.messages.length > 0) {
      for (const msg of data.data.messages) {
        if (messages.value.some(m => m.id === msg.id)) continue
        messages.value.push({
          id: msg.id,
          role: msg.sender_role === 'user' ? 'user' : 'bot',
          type: msg.type,
          text: msg.type === 'text' ? msg.content : undefined,
          src: (msg.type === 'image' || msg.type === 'audio') ? msg.content : undefined,
          _playing: false, _dur: 0
        })
      }
      const maxId = Math.max(...data.data.messages.map(m => m.id))
      lastMsgId.value = Math.max(lastMsgId.value, maxId)
      if (!open.value && data.data.messages.some(m => m.sender_role !== 'user')) {
        hasUnread.value = true
      }
      scrollBottom()
    }
  } catch { /* ignore */ }
}

function startPolling() { stopPolling(); pollTimer = setInterval(fetchMessages, 3000) }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

// ========== 发送消息 ==========
function qText(q) { return typeof q === 'object' ? q.question : q }

function sendQuick(q) {
  const text = qText(q)
  const configAnswer = typeof q === 'object' && q.answer ? q.answer : ''
  if (text === '联系人工客服') { connectLiveChat(); return }
  input.value = text
  sendMessage(configAnswer)
}

async function sendMessage(directAnswer) {
  const text = input.value.trim()
  if (!text || sending.value) return

  input.value = ''
  showEmoji.value = false

  if (liveMode.value) {
    // 发送到后端
    sending.value = true
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ type: 'text', content: text })
      })
      const data = await res.json()
      if (data.code === 0) {
        if (!messages.value.some(m => m.id === data.data.id)) {
          messages.value.push({ id: data.data.id, role: 'user', type: 'text', text })
        }
        lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
        scrollBottom()
      }
    } catch { /* ignore */ }
    sending.value = false
    // 人工模式下，自动匹配配置的回复语
    const autoReply = directAnswer || findConfigAnswer(text) || matchFaq(text)
    if (autoReply) {
      setTimeout(() => {
        messages.value.push({ id: nextId(), role: 'bot', type: 'text', text: autoReply })
        scrollBottom()
      }, 600)
    }
  } else {
    // 本地 FAQ 自动回复
    messages.value.push({ id: nextId(), role: 'user', type: 'text', text })
    sending.value = true
    scrollBottom()
    setTimeout(() => {
      const answer = directAnswer || findConfigAnswer(text) || matchFaq(text)
      messages.value.push({
        id: nextId(), role: 'bot', type: 'text',
        text: answer || '抱歉，我暂时无法回答这个问题。\n\n您可以点击下方「转人工」联系人工客服获取帮助。'
      })
      sending.value = false
      scrollBottom()
    }, 600 + Math.random() * 400)
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
}

// ========== 表情 ==========
function insertEmoji(emoji) { input.value += emoji }

// ========== 图片 ==========
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
    if (liveMode.value) {
      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ type: 'image', content: src })
        })
        const data = await res.json()
        if (data.code === 0) {
          if (!messages.value.some(m => m.id === data.data.id)) {
            messages.value.push({ id: data.data.id, role: 'user', type: 'image', src })
          }
          lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
          scrollBottom()
        }
      } catch { /* ignore */ }
    } else {
      messages.value.push({ id: nextId(), role: 'user', type: 'image', src })
      scrollBottom()
      sending.value = true
      setTimeout(() => {
        messages.value.push({
          id: nextId(), role: 'bot', type: 'text',
          text: '收到您的图片，如需人工处理请点击「转人工」。'
        })
        sending.value = false
        scrollBottom()
      }, 800)
    }
  }
  reader.readAsDataURL(file)
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (blob) readAndSendImage(blob)
      return
    }
  }
}

function closeEmojiOnOutside(e) {
  if (showEmoji.value && !e.target.closest('.emoji-area')) showEmoji.value = false
}

// ========== 语音功能 ==========
const voiceMode = ref('off')   // 'off' | 'stt' | 'recording'
const recording = ref(false)
const recordSec = ref(0)
const sttText = ref('')
const sttListening = ref(false)
let mediaRecorder = null
let audioChunks = []
let recordTimer = null
let sttRecognition = null

// 语音转文字
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
  sttRecognition.onend = () => {
    sttListening.value = false
    sttRecognition = null
  }
  sttRecognition.start()
}
function stopSTT() {
  if (sttRecognition) { sttRecognition.stop(); sttRecognition = null }
  sttListening.value = false
}

// 录音发送语音消息
async function startRecording() {
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
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  recording.value = false
}

function cancelRecording() {
  audioChunks = []
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = () => {
      mediaRecorder.stream?.getTracks().forEach(t => t.stop())
    }
    mediaRecorder.stop()
  }
  clearInterval(recordTimer)
  recording.value = false
  recordSec.value = 0
}

function getAudioMime() {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

async function sendAudioBlob(blob) {
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = reader.result
    if (liveMode.value) {
      try {
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ type: 'audio', content: base64 })
        })
        const data = await res.json()
        if (data.code === 0) {
          if (!messages.value.some(m => m.id === data.data.id)) {
            messages.value.push({ id: data.data.id, role: 'user', type: 'audio', src: base64, _playing: false, _dur: 0 })
          }
          lastMsgId.value = Math.max(lastMsgId.value, data.data.id)
          scrollBottom()
        }
      } catch { /* ignore */ }
    } else {
      messages.value.push({ id: nextId(), role: 'user', type: 'audio', src: base64, _playing: false, _dur: 0 })
      scrollBottom()
    }
  }
  reader.readAsDataURL(blob)
}

// ========== 微信语音播放 ==========
let currentAudio = null
let currentMsg = null

function playVoice(msg) {
  // 如果正在播放同一条，停止
  if (currentMsg === msg && currentAudio) {
    currentAudio.pause()
    currentAudio = null
    msg._playing = false
    currentMsg = null
    return
  }
  // 停止之前的
  if (currentAudio) {
    currentAudio.pause()
    if (currentMsg) currentMsg._playing = false
  }
  const audio = new Audio(msg.src)
  currentAudio = audio
  currentMsg = msg
  msg._playing = true
  audio.onloadedmetadata = () => {
    if (isFinite(audio.duration)) {
      msg._dur = Math.ceil(audio.duration)
    }
  }
  audio.onended = () => {
    msg._playing = false
    currentAudio = null
    currentMsg = null
  }
  audio.onerror = () => {
    msg._playing = false
    currentAudio = null
    currentMsg = null
  }
  audio.play().catch(() => {
    msg._playing = false
    currentAudio = null
    currentMsg = null
  })
}

function fmtDuration(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

onMounted(async () => {
  // 加载客服配置
  try {
    const cfgRes = await fetch('/api/cs-config/public')
    const cfgData = await cfgRes.json()
    if (cfgData.code === 0 && cfgData.data) {
      if (cfgData.data.quickQuestions?.length) quickQuestions.value = cfgData.data.quickQuestions
      if (cfgData.data.welcomeText) welcomeText.value = cfgData.data.welcomeText
      if (cfgData.data.telegram) telegramId.value = cfgData.data.telegram
    }
  } catch { /* ignore */ }

  // 检查是否有已存在的后端会话，自动进入人工模式
  try {
    const res = await fetch('/api/chat/messages', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0 && data.data.messages.length > 0) {
      liveMode.value = true
      for (const msg of data.data.messages) {
        messages.value.push({
          id: msg.id,
          role: msg.sender_role === 'user' ? 'user' : 'bot',
          type: msg.type,
          text: msg.type === 'text' ? msg.content : undefined,
          src: (msg.type === 'image' || msg.type === 'audio') ? msg.content : undefined,
          _playing: false, _dur: 0
        })
      }
      lastMsgId.value = Math.max(...data.data.messages.map(m => m.id))
      scrollBottom()
      startPolling()
    }
  } catch { /* ignore */ }

  document.addEventListener('click', closeEmojiOnOutside)
})

onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('click', closeEmojiOnOutside)
})
</script>

<template>
  <Teleport to="body">
    <!-- 浮动按钮 -->
    <button v-if="!open" type="button" class="chat-fab" @click="toggleChat">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span v-if="hasUnread" class="fab-dot"></span>
    </button>

    <!-- 聊天窗口 -->
    <Transition name="chat-slide">
      <div v-if="open" class="chat-container">
        <!-- 顶栏 -->
        <header class="chat-header">
          <button type="button" class="chat-back" @click="open = false">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="chat-header-info">
            <div class="chat-avatar-wrap">
              <div class="chat-avatar">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span class="online-dot"></span>
            </div>
            <div>
              <strong>{{ liveMode ? '人工客服' : '在线客服' }}</strong>
              <span class="chat-status">{{ liveMode ? '已连接' : '在线' }}</span>
            </div>
          </div>
          <button type="button" class="chat-close-pc" @click="open = false">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <!-- 消息区 -->
        <div class="chat-body" ref="chatBody">
          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0 && !liveMode" class="welcome-section">
            <div class="welcome-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5b8def" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h3 class="welcome-title">欢迎咨询</h3>
            <p class="welcome-text"><template v-for="(line, li) in welcomeText.split('\n')" :key="li">{{ line }}<br v-if="li < welcomeText.split('\n').length - 1" /></template></p>
          </div>

          <div v-for="(msg, i) in messages" :key="msg.id || i" :class="['chat-row', msg.role === 'system' ? 'system' : msg.role]">
            <!-- 系统消息 -->
            <div v-if="msg.role === 'system'" class="system-msg">{{ msg.text }}</div>
            <template v-else>
              <div v-if="msg.role === 'bot'" class="bot-avatar-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <!-- 文本 -->
              <div v-if="msg.type === 'text'" class="chat-bubble">
                <span v-for="(line, li) in msg.text.split('\n')" :key="li">
                  {{ line }}<br v-if="li < msg.text.split('\n').length - 1" />
                </span>
              </div>
              <!-- 图片 -->
              <div v-else-if="msg.type === 'image'" class="chat-bubble img-bubble">
                <img :src="msg.src" alt="图片" @click="previewImg = msg.src" />
              </div>
              <!-- 语音（微信样式） -->
              <div v-else-if="msg.type === 'audio'"
                class="chat-bubble voice-bubble"
                :class="{ playing: msg._playing }"
                @click="playVoice(msg)"
              >
                <div class="voice-wave" :class="{ active: msg._playing }">
                  <span></span><span></span><span></span>
                </div>
                <span class="voice-dur">{{ msg._dur ? msg._dur + "''" : '' }}</span>
              </div>
            </template>
          </div>

          <!-- 打字指示（仅 FAQ 模式） -->
          <div v-if="sending && !liveMode" class="chat-row bot">
            <div class="bot-avatar-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="chat-bubble typing">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
          </div>

          <!-- 快捷问题（无消息且非人工模式时显示） -->
          <div v-if="messages.length === 0 && !liveMode" class="quick-section">
            <p class="quick-title">常见问题</p>
            <div class="quick-list">
              <button v-for="(q, qi) in quickQuestions" :key="qi" type="button"
                :class="['quick-btn', { 'quick-live': qText(q) === '联系人工客服' }]"
                @click="sendQuick(q)">
                {{ qText(q) }}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="chat-footer">
          <div class="chat-toolbar">
            <div class="emoji-area">
              <button type="button" class="tool-btn" :class="{ active: showEmoji }" @click.stop="showEmoji = !showEmoji" title="表情">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              <Transition name="emoji-pop">
                <div v-if="showEmoji" class="emoji-panel" @click.stop>
                  <div v-for="g in emojiGroups" :key="g.label" class="emoji-group">
                    <p class="emoji-group-label">{{ g.label }}</p>
                    <div class="emoji-grid">
                      <button v-for="e in g.items" :key="e" type="button" class="emoji-item" @click="insertEmoji(e)">{{ e }}</button>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
            <button type="button" class="tool-btn" @click="triggerImagePick" title="发送图片">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <input ref="fileInput" type="file" accept="image/*" multiple class="hidden-file" @change="onFileChange" />
            <!-- 语音转文字 -->
            <button type="button" class="tool-btn" :class="{ active: sttListening }" @click="toggleSTT" title="语音转文字">
              <svg v-if="!sttListening" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2.5" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            </button>
            <!-- 录音发送语音 -->
            <button type="button" class="tool-btn voice-rec-btn" :class="{ active: recording }" @click="recording ? stopRecording() : startRecording()" title="发送语音消息">
              <svg v-if="!recording" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1" fill="#ff4d4f" stroke="none"/></svg>
            </button>
            <!-- 转人工按钮（FAQ 模式下且已有消息时显示） -->
            <button v-if="!liveMode && messages.length > 0" type="button" class="live-connect-btn" @click="connectLiveChat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              转人工
            </button>
          </div>
          <!-- 录音状态条 -->
          <div v-if="recording" class="recording-bar">
            <span class="rec-dot"></span>
            <span class="rec-timer">{{ fmtDuration(recordSec) }}</span>
            <span class="rec-hint">录音中，点击停止按钮发送</span>
            <button type="button" class="rec-cancel" @click="cancelRecording">取消</button>
          </div>
          <!-- 语音识别状态 -->
          <div v-if="sttListening" class="stt-bar">
            <span class="stt-dot"></span>
            <span>正在听...</span>
            <button type="button" class="stt-stop" @click="stopSTT">停止</button>
          </div>
          <div class="chat-input-wrap">
            <input
              v-model="input"
              type="text"
              :placeholder="liveMode ? '输入消息...' : '请输入您的问题...'"
              @keydown="handleKeydown"
              @paste="onPaste"
              :disabled="sending"
            />
            <button type="button" class="chat-send" :disabled="!input.trim() || sending" @click="sendMessage">
              发送
            </button>
          </div>
        </footer>
      </div>
    </Transition>

    <!-- 图片预览 -->
    <Transition name="preview-fade">
      <div v-if="previewImg" class="img-preview-mask" @click="previewImg = ''">
        <img :src="previewImg" alt="预览" class="img-preview" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ========== 浮动按钮 ========== */
.chat-fab {
  position: fixed;
  bottom: 28px; right: 28px;
  z-index: 9998;
  width: 56px; height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  border: none; cursor: pointer;
  display: grid; place-items: center;
  box-shadow: 0 8px 28px rgba(91,141,239,.35);
  transition: transform 240ms cubic-bezier(.22,1,.36,1), box-shadow 240ms ease;
}
.chat-fab:hover {
  transform: scale(1.1) translateY(-2px);
  box-shadow: 0 14px 36px rgba(91,141,239,.45);
}
.chat-fab:active { transform: scale(.95); }

.fab-dot {
  position: absolute; top: 6px; right: 6px;
  width: 12px; height: 12px; border-radius: 50%;
  background: #ff4d6a; border: 2px solid #fff;
  animation: fab-pulse 1.8s infinite;
}
@keyframes fab-pulse {
  0%,100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}

/* ========== 聊天窗口 ========== */
.chat-container {
  position: fixed; z-index: 9999;
  display: flex; flex-direction: column;
  background: #f4f7fb; overflow: hidden;
  bottom: 28px; right: 28px;
  width: 400px; height: 620px;
  max-height: calc(100vh - 56px);
  border-radius: 20px;
  box-shadow: 0 24px 64px rgba(21,32,51,.22), 0 0 0 1px rgba(21,32,51,.06);
}

/* ========== 顶栏 ========== */
.chat-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  color: #fff; flex-shrink: 0;
}
.chat-back {
  display: none;
  width: 34px; height: 34px; border-radius: 10px;
  background: rgba(255,255,255,.15); border: none;
  color: #fff; cursor: pointer; place-items: center;
  transition: background 160ms ease;
}
.chat-back:hover { background: rgba(255,255,255,.25); }

.chat-header-info { flex: 1; display: flex; align-items: center; gap: 10px; }
.chat-avatar-wrap { position: relative; flex-shrink: 0; }
.chat-avatar {
  width: 38px; height: 38px; border-radius: 12px;
  background: rgba(255,255,255,.2);
  display: grid; place-items: center;
}
.online-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #42e695; border: 2px solid rgba(91,141,239,.9);
}
.chat-header-info strong { font-size: 15px; display: block; }
.chat-status { font-size: 11px; opacity: .8; }

.chat-close-pc {
  width: 32px; height: 32px; border-radius: 10px;
  background: rgba(255,255,255,.15); border: none;
  color: #fff; cursor: pointer; display: grid; place-items: center;
  transition: background 160ms ease;
}
.chat-close-pc:hover { background: rgba(255,255,255,.3); }

/* ========== 欢迎区 ========== */
.welcome-section {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px 20px 16px; text-align: center;
}
.welcome-icon {
  width: 64px; height: 64px; border-radius: 18px;
  background: linear-gradient(135deg, rgba(91,141,239,.12), rgba(139,123,247,.12));
  display: grid; place-items: center; margin-bottom: 14px;
}
.welcome-title { font-size: 16px; font-weight: 800; color: #152033; margin: 0 0 6px; }
.welcome-text { font-size: 13px; color: #647184; line-height: 1.6; margin: 0; }

/* ========== 消息区 ========== */
.chat-body {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.chat-row { display: flex; gap: 8px; max-width: 88%; }
.chat-row.user { align-self: flex-end; flex-direction: row-reverse; }
.chat-row.system { align-self: center; max-width: 100%; }

.system-msg {
  padding: 6px 18px; border-radius: 12px;
  background: rgba(91,141,239,.08);
  color: #5b8def; font-size: 12px; font-weight: 600;
  text-align: center;
}

.bot-avatar-sm {
  width: 30px; height: 30px; border-radius: 10px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  display: grid; place-items: center; flex-shrink: 0; margin-top: 2px;
}
.chat-bubble {
  padding: 12px 16px; border-radius: 16px;
  font-size: 14px; line-height: 1.6; word-break: break-word;
}
.chat-row.bot .chat-bubble {
  background: #fff; color: #2c3e50;
  border-top-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.chat-row.user .chat-bubble {
  background: linear-gradient(135deg, #5b8def, #7c6df7);
  color: #fff; border-top-right-radius: 4px;
}

.img-bubble {
  padding: 4px !important;
  background: transparent !important;
  box-shadow: none !important;
  max-width: 220px;
}
.img-bubble img {
  display: block;
  max-width: 100%; max-height: 200px;
  border-radius: 14px;
  cursor: pointer;
  object-fit: cover;
  box-shadow: 0 4px 16px rgba(0,0,0,.1);
  transition: transform 160ms ease;
}
.img-bubble img:hover { transform: scale(1.03); }

/* 打字动画 */
.chat-bubble.typing {
  display: flex; gap: 5px; align-items: center; padding: 14px 20px;
}
.chat-bubble.typing .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #b0bec5; animation: typing-bounce .6s ease-in-out infinite;
}
.chat-bubble.typing .dot:nth-child(2) { animation-delay: .15s; }
.chat-bubble.typing .dot:nth-child(3) { animation-delay: .3s; }
@keyframes typing-bounce {
  0%,100% { transform: translateY(0); opacity: .4; }
  50% { transform: translateY(-5px); opacity: 1; }
}

/* ========== 快捷问题 ========== */
.quick-section {
  margin-top: 8px; padding: 14px; border-radius: 14px;
  background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.quick-title { font-size: 13px; font-weight: 700; color: #5b8def; margin: 0 0 10px; }
.quick-list { display: flex; flex-direction: column; gap: 6px; }
.quick-btn {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; padding: 10px 14px;
  border-radius: 10px; border: 1px solid #edf1f6;
  background: #f8faff; color: #425066;
  font-size: 13px; font-weight: 600; text-align: left;
  cursor: pointer; transition: all 160ms ease;
}
.quick-btn:hover { background: #eef3ff; border-color: #c4d4f7; color: #5b8def; }
.quick-btn.quick-live {
  background: linear-gradient(135deg, rgba(91,141,239,.08), rgba(139,123,247,.08));
  border-color: #c4d4f7; color: #5b8def; font-weight: 700;
}
.quick-btn.quick-live:hover { background: linear-gradient(135deg, rgba(91,141,239,.15), rgba(139,123,247,.15)); }

/* ========== 输入区 ========== */
.chat-footer {
  padding: 8px 12px 12px;
  background: #fff; border-top: 1px solid #edf1f6; flex-shrink: 0;
}
.chat-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 0 4px 8px;
}
.tool-btn {
  width: 36px; height: 36px; border-radius: 10px;
  border: none; background: transparent; cursor: pointer;
  color: #9aa5b5; display: grid; place-items: center;
  transition: all 160ms ease;
}
.tool-btn:hover { background: #f0f4ff; color: #5b8def; }
.tool-btn.active { background: #eef3ff; color: #5b8def; }

.hidden-file { display: none; }

.live-connect-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 12px; border-radius: 8px;
  background: linear-gradient(135deg, rgba(91,141,239,.1), rgba(139,123,247,.1));
  color: #5b8def; font-size: 12px; font-weight: 700;
  border: none; cursor: pointer;
  transition: all 160ms ease;
}
.live-connect-btn:hover {
  background: linear-gradient(135deg, rgba(91,141,239,.18), rgba(139,123,247,.18));
  transform: translateY(-1px);
}

/* 表情面板 */
.emoji-area { position: relative; }
.emoji-panel {
  position: absolute; bottom: 44px; left: 0;
  width: 320px; max-height: 260px;
  background: #fff; border-radius: 16px;
  box-shadow: 0 16px 48px rgba(21,32,51,.18), 0 0 0 1px rgba(21,32,51,.06);
  overflow-y: auto; padding: 12px;
  z-index: 10;
}
.emoji-group-label {
  font-size: 11px; font-weight: 700; color: #9aa5b5;
  margin: 0 0 6px; padding: 4px 0;
}
.emoji-group + .emoji-group { border-top: 1px solid #f0f2f5; padding-top: 8px; margin-top: 4px; }
.emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.emoji-item {
  width: 36px; height: 36px; border-radius: 8px;
  border: none; background: transparent; cursor: pointer;
  font-size: 20px; display: grid; place-items: center;
  transition: background 120ms ease, transform 120ms ease;
}
.emoji-item:hover { background: #f0f4ff; transform: scale(1.2); }
.emoji-item:active { transform: scale(.9); }

.emoji-pop-enter-active { transition: all 180ms cubic-bezier(.22,1,.36,1); }
.emoji-pop-leave-active { transition: all 120ms ease-in; }
.emoji-pop-enter-from { opacity: 0; transform: translateY(8px) scale(.95); }
.emoji-pop-leave-to { opacity: 0; transform: translateY(4px) scale(.98); }

/* 输入框 */
.chat-input-wrap {
  display: flex; gap: 8px; align-items: center;
  background: #f4f7fb; border-radius: 12px;
  padding: 4px 4px 4px 16px;
  border: 1.5px solid #e3e8f0;
  transition: border-color 200ms ease;
}
.chat-input-wrap:focus-within {
  border-color: #5b8def; box-shadow: 0 0 0 3px rgba(91,141,239,.1);
}
.chat-input-wrap input {
  flex: 1; border: none; background: transparent;
  font-size: 14px; color: #152033; outline: none; padding: 8px 0;
}
.chat-input-wrap input::placeholder { color: #b0bec5; }

.chat-send {
  padding: 8px 18px; border-radius: 10px;
  background: linear-gradient(135deg, #5b8def, #8b7bf7);
  color: #fff; font-weight: 700; font-size: 13px;
  border: none; cursor: pointer; white-space: nowrap;
  transition: opacity 160ms ease, transform 160ms ease;
}
.chat-send:hover { transform: translateY(-1px); }
.chat-send:disabled { opacity: .45; pointer-events: none; }

/* 语音按钮 */
.voice-rec-btn.active { color: #ff4d4f !important; background: #fff1f0 !important; }

/* 录音状态条 */
.recording-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; margin-bottom: 8px;
  background: #fff1f0; border-radius: 10px; font-size: 12px; color: #d4380d;
}
.rec-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #ff4d4f;
  animation: rec-blink 1s ease-in-out infinite;
}
@keyframes rec-blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.rec-timer { font-weight: 700; font-family: 'SF Mono', Consolas, monospace; }
.rec-hint { flex: 1; color: #9aa5b5; }
.rec-cancel {
  padding: 3px 10px; border-radius: 6px; border: none;
  background: #ffd8d2; color: #d4380d; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: background 150ms ease;
}
.rec-cancel:hover { background: #ffc0b5; }

/* 语音识别状态条 */
.stt-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; margin-bottom: 8px;
  background: #eef3ff; border-radius: 10px; font-size: 12px; color: #5b8def; font-weight: 600;
}
.stt-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #5b8def;
  animation: rec-blink 1s ease-in-out infinite;
}
.stt-stop {
  margin-left: auto; padding: 3px 10px; border-radius: 6px; border: none;
  background: #d6e4ff; color: #2f54eb; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: background 150ms ease;
}
.stt-stop:hover { background: #bdd1ff; }

/* 微信风格语音气泡 */
.voice-bubble {
  display: flex !important; align-items: center; gap: 8px;
  padding: 12px 16px !important; min-width: 80px; max-width: 180px;
  cursor: pointer; user-select: none;
  transition: opacity 150ms ease;
}
.voice-bubble:active { opacity: .7; }

.voice-wave {
  display: flex; align-items: flex-end; gap: 2px; height: 18px;
}
.chat-row.user .voice-wave { flex-direction: row-reverse; }

.voice-wave span {
  display: block; width: 3px; border-radius: 2px;
  background: currentColor; opacity: .4;
  transition: opacity 200ms ease;
}
.voice-wave span:nth-child(1) { height: 6px; }
.voice-wave span:nth-child(2) { height: 12px; }
.voice-wave span:nth-child(3) { height: 18px; }

.voice-wave.active span {
  animation: voice-ani 1s ease-in-out infinite;
  opacity: 1;
}
.voice-wave.active span:nth-child(1) { animation-delay: 0s; }
.voice-wave.active span:nth-child(2) { animation-delay: .15s; }
.voice-wave.active span:nth-child(3) { animation-delay: .3s; }

@keyframes voice-ani {
  0%,100% { opacity: .3; }
  50% { opacity: 1; }
}

.voice-dur {
  font-size: 12px; font-weight: 600; opacity: .8; white-space: nowrap;
}

/* ========== 图片预览 ========== */
.img-preview-mask {
  position: fixed; inset: 0; z-index: 10001;
  background: rgba(0,0,0,.75); backdrop-filter: blur(8px);
  display: grid; place-items: center; cursor: pointer;
}
.img-preview {
  max-width: 90vw; max-height: 90vh;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0,0,0,.4);
  object-fit: contain;
}
.preview-fade-enter-active, .preview-fade-leave-active { transition: opacity 200ms ease; }
.preview-fade-enter-from, .preview-fade-leave-to { opacity: 0; }

/* ========== 动画 ========== */
.chat-slide-enter-active { transition: all 320ms cubic-bezier(.22,1,.36,1); }
.chat-slide-leave-active { transition: all 200ms ease-in; }
.chat-slide-enter-from { opacity: 0; transform: translateY(20px) scale(.95); }
.chat-slide-leave-to { opacity: 0; transform: translateY(10px) scale(.97); }

/* ========== 移动端 ========== */
@media (max-width: 760px) {
  .chat-fab { bottom: 20px; right: 16px; width: 50px; height: 50px; }
  .chat-container {
    inset: 0; width: 100%; height: 100%;
    max-height: 100vh; border-radius: 0; box-shadow: none;
  }
  .chat-back { display: grid; }
  .chat-close-pc { display: none; }
  .chat-footer {
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .emoji-panel { width: 280px; left: -4px; }
  .emoji-grid { grid-template-columns: repeat(7, 1fr); }
  .chat-slide-enter-from { opacity: 0; transform: translateX(100%); }
  .chat-slide-leave-to { opacity: 0; transform: translateX(100%); }
}
</style>
