<script setup>
import { computed, inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const { isAdmin, getToken } = inject('workspace')

onMounted(() => {
  if (!isAdmin.value) { router.push('/dashboard'); return }
  fetchCsConfig()
})

const csConfig = ref({ telegram: '', welcomeText: '', quickQuestions: [] })
const originalConfig = ref(null)
const loading = ref(false)
const saving = ref(false)
const msg = ref('')
const newQuestion = ref('')

// 编辑弹窗
const showEdit = ref(false)
const editIdx = ref(-1)
const editForm = ref({ question: '', answer: '' })

const welcomeLines = computed(() => {
  const t = csConfig.value.welcomeText || '您好！欢迎使用在线客服。'
  return t.split('\n').filter(l => l.trim())
})

/* 兼容旧格式：string → {question, answer} */
function normalizeQuestions(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(q => typeof q === 'string' ? { question: q, answer: '' } : q)
}

async function fetchCsConfig() {
  loading.value = true
  try {
    const res = await fetch('/api/cs-config', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      data.data.quickQuestions = normalizeQuestions(data.data.quickQuestions)
      csConfig.value = data.data
      originalConfig.value = JSON.parse(JSON.stringify(data.data))
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

async function save() {
  saving.value = true
  msg.value = ''
  try {
    const res = await fetch('/api/cs-config', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(csConfig.value)
    })
    const data = await res.json()
    if (data.code === 0) {
      data.data.quickQuestions = normalizeQuestions(data.data.quickQuestions)
      csConfig.value = data.data
      originalConfig.value = JSON.parse(JSON.stringify(data.data))
      msg.value = '保存成功'
    } else {
      msg.value = data.message || '保存失败'
    }
  } catch { msg.value = '网络错误' }
  finally { saving.value = false; setTimeout(() => msg.value = '', 2000) }
}

function resetConfig() {
  if (originalConfig.value) {
    csConfig.value = JSON.parse(JSON.stringify(originalConfig.value))
  }
}

function addQuestion() {
  const q = newQuestion.value.trim()
  if (!q) return
  csConfig.value.quickQuestions.push({ question: q, answer: '' })
  newQuestion.value = ''
}

function removeQuestion(idx) {
  csConfig.value.quickQuestions.splice(idx, 1)
}

function openEditQuestion(idx) {
  const item = csConfig.value.quickQuestions[idx]
  editIdx.value = idx
  editForm.value = { question: item.question, answer: item.answer || '' }
  showEdit.value = true
}

async function saveEditQuestion() {
  if (!editForm.value.question.trim()) return
  const idx = editIdx.value
  csConfig.value.quickQuestions[idx] = {
    question: editForm.value.question.trim(),
    answer: editForm.value.answer.trim()
  }
  showEdit.value = false
  await save()
}
</script>

<template>
  <section class="csc-page">
    <!-- 顶部 -->
    <div class="csc-top">
      <div class="csc-top-left">
        <h1>客服配置</h1>
        <div class="csc-breadcrumb">工作桌面 / 客服配置</div>
        <p class="csc-desc">配置在线客服的欢迎语和常见问题列表，修改后实时生效。</p>
      </div>
      <div class="csc-top-right">
        <Transition name="fade">
          <span v-if="msg" class="csc-msg" :class="{ error: msg.includes('失败') || msg.includes('错误') }">{{ msg }}</span>
        </Transition>
        <button type="button" class="csc-btn-reset" @click="resetConfig">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          重置
        </button>
        <button type="button" class="csc-btn-save" :disabled="saving" @click="save">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="csc-loading">加载中...</div>

    <div v-else class="csc-grid">
      <!-- 左列 -->
      <div class="csc-col-left">
        <!-- 基本设置 -->
        <div class="csc-card">
          <div class="csc-card-head">
            <div class="csc-card-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </div>
            <span class="csc-card-label">基本设置</span>
          </div>

          <div class="csc-field">
            <label>欢迎语</label>
            <div class="csc-bubble">
              <textarea v-model="csConfig.welcomeText" rows="3" placeholder="客服欢迎语..."></textarea>
            </div>
          </div>
        </div>

        <!-- 常见问题 -->
        <div class="csc-card">
          <div class="csc-card-head">
            <div class="csc-card-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <span class="csc-card-label">常见问题</span>
            <span class="csc-count">共 {{ csConfig.quickQuestions.length }} 条</span>
          </div>

          <div class="csc-q-list">
            <div v-for="(q, i) in csConfig.quickQuestions" :key="i" class="csc-q-item" @click="openEditQuestion(i)">
              <span class="csc-q-num">{{ i + 1 }}</span>
              <div class="csc-q-body">
                <span class="csc-q-text">{{ q.question }}</span>
                <span v-if="q.answer" class="csc-q-answer-tag">已设回复</span>
                <span v-else class="csc-q-answer-tag empty">未设回复</span>
              </div>
              <button type="button" class="csc-q-del" @click.stop="removeQuestion(i)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div v-if="csConfig.quickQuestions.length === 0" class="csc-q-empty">暂无常见问题，点击下方添加</div>
          </div>

          <div class="csc-q-add">
            <input v-model="newQuestion" placeholder="输入新问题..." @keyup.enter="addQuestion" />
            <button type="button" @click="addQuestion">添加</button>
          </div>
        </div>
      </div>

      <!-- 右列 -->
      <div class="csc-col-right">
        <!-- 客服助手预览 -->
        <div class="csc-card">
          <div class="csc-card-head">
            <div class="csc-card-icon preview-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <span class="csc-card-label">客服助手预览</span>
          </div>

          <div class="preview-box">
            <!-- 预览头部 -->
            <div class="pv-header">
              <div class="pv-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a5 5 0 0 0-5 5v1h18v-1a5 5 0 0 0-5-5z"/></svg>
              </div>
              <div class="pv-info">
                <span class="pv-name">AI 客服助手 <span class="pv-star">✦</span></span>
                <span class="pv-status"><i class="pv-dot"></i> 在线</span>
              </div>
            </div>

            <!-- 预览消息 -->
            <div class="pv-body">
              <div class="pv-msg">
                <div class="pv-msg-avatar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a5 5 0 0 0-5 5v1h18v-1a5 5 0 0 0-5-5z"/></svg>
                </div>
                <div class="pv-msg-bubble">
                  <p v-for="(line, li) in welcomeLines" :key="li">{{ line }}</p>
                </div>
              </div>
              <div class="pv-time">10:30</div>

              <!-- 常见问题预览 -->
              <div class="pv-section-label">常见问题</div>
              <div class="pv-quick-grid">
                <button v-for="(q, i) in csConfig.quickQuestions.slice(0, 6)" :key="i" class="pv-quick-btn">
                  <span class="pv-quick-num">{{ i + 1 }}</span> {{ q.question }}
                </button>
              </div>
              <button class="pv-contact-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                联系人工客服
              </button>
            </div>

            <!-- 预览输入框 -->
            <div class="pv-input">
              <span class="pv-input-text">输入消息...</span>
              <div class="pv-send">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </div>
            </div>
          </div>
        </div>

        <!-- 配置说明 -->
        <div class="csc-card note-card">
          <div class="note-header">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            配置说明
          </div>
          <div class="note-body">
            <div class="note-item">
              <i class="note-dot green"></i>
              <span>保存后配置将实时生效，用户即可通过在线客服看到最新内容。</span>
            </div>
            <div class="note-item">
              <i class="note-dot blue"></i>
              <span>欢迎语将展示在会话开始时，建议简明友好地引导用户。</span>
            </div>
            <div class="note-item">
              <i class="note-dot orange"></i>
              <span>常见问题建议控制在 3-8 条，便于用户快速找到答案。</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑问题弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showEdit" class="eq-mask" @click.self="showEdit = false">
        <div class="eq-dialog">
          <div class="eq-header">
            <div class="eq-header-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <h2>编辑常见问题</h2>
            <button class="eq-close" @click="showEdit = false">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="eq-body">
            <div class="eq-field">
              <label>问题 <em>*</em></label>
              <input v-model="editForm.question" placeholder="用户看到的问题" />
            </div>
            <div class="eq-field">
              <label>回复语</label>
              <textarea v-model="editForm.answer" rows="4" placeholder="点击该问题后自动回复的内容，留空则发送问题到客服"></textarea>
              <span class="eq-hint">设置回复语后，用户点击该问题将自动收到回复，无需人工介入</span>
            </div>
          </div>
          <div class="eq-footer">
            <button class="btn-cancel" @click="showEdit = false">取消</button>
            <button class="btn-submit" @click="saveEditQuestion">保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.csc-page { padding: 24px 28px; }

/* 顶部 */
.csc-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; gap: 16px; }
.csc-top-left { flex: 1; }
.csc-top-left h1 { font-size: 22px; font-weight: 800; color: #1e293b; margin: 0 0 4px; }
.csc-breadcrumb { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
.csc-desc { font-size: 13px; color: #94a3b8; margin: 0; }

.csc-top-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding-top: 4px; }
.csc-btn-reset {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff; color: #475569;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 160ms ease;
}
.csc-btn-reset:hover { border-color: #cbd5e1; background: #f8fafc; }
.csc-btn-save {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 20px; border-radius: 10px;
  border: none; background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all 160ms ease;
  box-shadow: 0 4px 14px rgba(99,102,241,.25);
}
.csc-btn-save:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(99,102,241,.3); }
.csc-btn-save:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.csc-msg { font-size: 13px; color: #22c55e; font-weight: 600; }
.csc-msg.error { color: #ef4444; }

.csc-loading { padding: 48px 0; text-align: center; color: #94a3b8; font-size: 14px; }

/* 两列 */
.csc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.csc-col-left, .csc-col-right { display: flex; flex-direction: column; gap: 20px; }

/* 卡片通用 */
.csc-card {
  background: #fff; border-radius: 16px; padding: 22px 24px;
  border: 1px solid #edf1f6;
  box-shadow: 0 1px 4px rgba(0,0,0,.03);
}
.csc-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.csc-card-icon {
  width: 34px; height: 34px; border-radius: 10px;
  background: #f3f0ff; color: #8b5cf6;
  display: grid; place-items: center; flex-shrink: 0;
}
.csc-card-label { font-size: 15px; font-weight: 800; color: #1e293b; }
.csc-count {
  margin-left: auto; padding: 3px 10px; border-radius: 20px;
  background: #f3f0ff; color: #8b5cf6; font-size: 12px; font-weight: 700;
}

/* 基本设置 */
.csc-field { margin-bottom: 18px; }
.csc-field:last-child { margin-bottom: 0; }
.csc-field label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px; }

.csc-input-wrap { position: relative; display: flex; align-items: center; }
.csc-input-icon { position: absolute; left: 14px; color: #8b5cf6; pointer-events: none; }
.csc-input-wrap input {
  width: 100%; padding: 11px 14px 11px 40px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; font-size: 14px; color: #1e293b;
  background: #f8fafc; outline: none; transition: all 160ms ease;
  box-sizing: border-box;
}
.csc-input-wrap input:focus { border-color: #8b5cf6; background: #fff; box-shadow: 0 0 0 3px rgba(139,92,246,.08); }

.csc-bubble {
  background: #f5f3ff; border-radius: 14px; padding: 4px;
  border: 1.5px solid #ede9fe;
}
.csc-bubble textarea {
  width: 100%; padding: 10px 14px; border-radius: 10px;
  border: none; font-size: 14px; color: #1e293b;
  background: transparent; outline: none; resize: vertical;
  line-height: 1.6; font-family: inherit; box-sizing: border-box;
  min-height: 72px;
}

/* 常见问题 */
.csc-q-list {
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;
  max-height: 380px; overflow-y: auto;
  scrollbar-width: none;
}
.csc-q-list::-webkit-scrollbar { display: none; }

.csc-q-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px; background: #f8fafc;
  border: 1px solid #edf1f6; transition: all 140ms ease;
  cursor: pointer;
}
.csc-q-item:hover { border-color: #ddd6fe; background: #faf8ff; }

.csc-q-num {
  width: 26px; height: 26px; border-radius: 50%;
  background: #8b5cf6; color: #fff; font-size: 12px; font-weight: 800;
  display: grid; place-items: center; flex-shrink: 0;
}
.csc-q-body { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.csc-q-text { font-size: 14px; color: #1e293b; line-height: 1.4; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csc-q-answer-tag {
  padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;
  background: #dcfce7; color: #16a34a; white-space: nowrap; flex-shrink: 0;
}
.csc-q-answer-tag.empty { background: #f4f5f7; color: #94a3b8; }
.csc-q-del {
  width: 28px; height: 28px; border-radius: 8px;
  border: none; background: transparent; color: #94a3b8;
  cursor: pointer; display: grid; place-items: center;
  transition: all 140ms ease; flex-shrink: 0;
}
.csc-q-del:hover { background: #fee2e2; color: #ef4444; }
.csc-q-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }

.csc-q-add { display: flex; gap: 8px; }
.csc-q-add input {
  flex: 1; padding: 11px 14px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; font-size: 14px; color: #1e293b;
  background: #f8fafc; outline: none; transition: all 160ms ease;
  box-sizing: border-box;
}
.csc-q-add input:focus { border-color: #8b5cf6; background: #fff; box-shadow: 0 0 0 3px rgba(139,92,246,.08); }
.csc-q-add button {
  padding: 0 22px; border-radius: 10px;
  border: none; background: #8b5cf6; color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: background 160ms ease; white-space: nowrap;
}
.csc-q-add button:hover { background: #7c3aed; }

/* 预览 */
.preview-box {
  border-radius: 14px; overflow: hidden;
  border: 1px solid #edf1f6; background: #f8fafc;
}
.pv-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; background: #fff;
  border-bottom: 1px solid #edf1f6;
}
.pv-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
  display: grid; place-items: center; flex-shrink: 0;
}
.pv-info { display: flex; flex-direction: column; gap: 2px; }
.pv-name { font-size: 14px; font-weight: 700; color: #1e293b; }
.pv-star { color: #f59e0b; font-size: 12px; }
.pv-status { font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px; }
.pv-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; display: inline-block; }

.pv-body { padding: 16px; }
.pv-msg { display: flex; gap: 8px; }
.pv-msg-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
  display: grid; place-items: center; flex-shrink: 0;
}
.pv-msg-bubble {
  background: #fff; border-radius: 0 12px 12px 12px;
  padding: 10px 14px; font-size: 13px; color: #334155;
  line-height: 1.6; border: 1px solid #edf1f6;
  max-width: 85%;
}
.pv-msg-bubble p { margin: 0; }
.pv-time { text-align: center; font-size: 11px; color: #cbd5e1; margin: 10px 0 14px; }

.pv-section-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 8px; }
.pv-quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.pv-quick-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px; border-radius: 8px;
  border: 1px solid #edf1f6; background: #fff; color: #334155;
  font-size: 11px; cursor: default; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pv-quick-num {
  width: 18px; height: 18px; border-radius: 50%;
  background: #ede9fe; color: #8b5cf6; font-size: 10px; font-weight: 800;
  display: inline-grid; place-items: center; flex-shrink: 0;
}
.pv-contact-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 8px; border-radius: 8px;
  border: 1.5px solid #ddd6fe; background: #faf8ff; color: #7c3aed;
  font-size: 12px; font-weight: 600; cursor: default;
}

.pv-input {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; background: #fff;
  border-top: 1px solid #edf1f6;
}
.pv-input-text { flex: 1; font-size: 12px; color: #cbd5e1; }
.pv-send {
  width: 30px; height: 30px; border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
  display: grid; place-items: center;
}

/* 配置说明 */
.note-card { padding: 0; overflow: hidden; }
.note-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 20px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
  font-size: 14px; font-weight: 700;
}
.note-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
.note-item { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: #475569; line-height: 1.5; }
.note-dot {
  width: 20px; height: 20px; border-radius: 50%;
  display: inline-grid; place-items: center; flex-shrink: 0; margin-top: 1px;
}
.note-dot.green { background: #dcfce7; }
.note-dot.green::after { content: '✓'; font-size: 11px; color: #22c55e; font-weight: 800; }
.note-dot.blue { background: #dbeafe; }
.note-dot.blue::after { content: '✓'; font-size: 11px; color: #3b82f6; font-weight: 800; }
.note-dot.orange { background: #ffedd5; }
.note-dot.orange::after { content: '✓'; font-size: 11px; color: #f97316; font-weight: 800; }

/* 编辑问题弹窗 */
.eq-mask {
  position: fixed; inset: 0; z-index: 30;
  display: flex; align-items: center; justify-content: center;
  background: rgba(21,32,51,.42); backdrop-filter: blur(8px);
}
.eq-dialog {
  width: min(480px, 94vw); border-radius: 20px;
  background: #fff; box-shadow: 0 32px 80px rgba(21,32,51,.28);
  display: flex; flex-direction: column; overflow: hidden;
}
.eq-header {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 24px 16px; border-bottom: 1px solid #edf1f6;
}
.eq-header-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: #fff; display: grid; place-items: center; flex-shrink: 0;
  box-shadow: 0 4px 14px rgba(139,92,246,.25);
}
.eq-header h2 { flex: 1; font-size: 16px; color: #1e293b; margin: 0; font-weight: 800; }
.eq-close {
  width: 34px; height: 34px; border-radius: 10px;
  color: #94a3b8; background: #f4f7fb; display: grid; place-items: center;
  border: none; cursor: pointer; transition: all 160ms ease;
}
.eq-close:hover { color: #ef4444; background: #fef2f2; transform: rotate(90deg); }

.eq-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 18px; }
.eq-field label {
  display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px;
}
.eq-field label em { color: #ef4444; font-style: normal; }
.eq-field input, .eq-field textarea {
  width: 100%; box-sizing: border-box;
  padding: 10px 14px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #f8fafc;
  font-size: 14px; color: #1e293b; outline: none;
  transition: border-color 200ms ease, box-shadow 200ms ease;
  font-family: inherit; line-height: 1.6;
}
.eq-field input:focus, .eq-field textarea:focus {
  border-color: #8b5cf6; background: #fff; box-shadow: 0 0 0 3px rgba(139,92,246,.08);
}
.eq-field textarea { resize: vertical; min-height: 80px; }
.eq-hint { display: block; font-size: 11px; color: #94a3b8; margin-top: 6px; }

.eq-footer {
  display: flex; gap: 10px; padding: 16px 24px 20px;
  border-top: 1px solid #edf1f6;
}
.eq-footer .btn-cancel {
  flex: 1; padding: 11px 0; border-radius: 12px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #475569; font-weight: 700; font-size: 14px;
  cursor: pointer; transition: all 160ms ease; font-family: inherit;
}
.eq-footer .btn-cancel:hover { background: #f8fafc; color: #8b5cf6; border-color: #ddd6fe; }
.eq-footer .btn-submit {
  flex: 1.5; padding: 11px 0; border-radius: 12px;
  background: linear-gradient(135deg, #8b5cf6, #6366f1); border: none;
  color: #fff; font-weight: 700; font-size: 14px;
  cursor: pointer; box-shadow: 0 8px 20px rgba(139,92,246,.22);
  transition: transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 200ms ease; font-family: inherit;
}
.eq-footer .btn-submit:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(139,92,246,.3); }
.eq-footer .btn-submit:active { transform: scale(.98); }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 220ms ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .eq-dialog, .modal-fade-leave-active .eq-dialog {
  transition: transform 280ms cubic-bezier(.22,1,.36,1), opacity 220ms ease;
}
.modal-fade-enter-from .eq-dialog, .modal-fade-leave-to .eq-dialog {
  transform: scale(.92) translateY(18px); opacity: 0;
}

.fade-enter-active, .fade-leave-active { transition: opacity 200ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .csc-page { padding: 16px; }
  .csc-top { flex-direction: column; }
  .csc-top-left h1 { font-size: 18px; }
  .csc-top-right { width: 100%; justify-content: flex-end; }
  .csc-grid { grid-template-columns: 1fr; }
  .csc-card { padding: 18px; }
}
</style>
