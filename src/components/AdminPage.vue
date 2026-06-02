<script setup>
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { isAdmin, getToken } = ws

// ========== 注册奖励 ==========
const bonusAgents = ref([])
const bonusAllAgents = ref([])
const bonusLoading = ref(false)
const bonusEditAgent = ref(null)
const bonusEditAmount = ref('')
const bonusEditLoading = ref(false)
const bonusEditMsg = ref('')

async function fetchBonusConfig() {
  bonusLoading.value = true
  try {
    const [bonusRes, agentRes] = await Promise.all([
      fetch('/api/users/register-bonus', { headers: { Authorization: `Bearer ${getToken()}` } }),
      fetch('/api/users/agents', { headers: { Authorization: `Bearer ${getToken()}` } })
    ])
    const bonusData = await bonusRes.json()
    const agentData = await agentRes.json()
    if (bonusData.code === 0) bonusAgents.value = bonusData.data || []
    if (agentData.code === 0) bonusAllAgents.value = agentData.data || []
  } catch { /* ignore */ }
  finally { bonusLoading.value = false }
}

function getBonusForAgent(agentId) {
  const cfg = bonusAgents.value.find(b => b.agent_id === agentId)
  return cfg ? parseFloat(cfg.bonus_amount) : 0
}

function openBonusEdit(agent) {
  bonusEditAgent.value = agent
  bonusEditAmount.value = String(getBonusForAgent(agent.id))
  bonusEditMsg.value = ''
  bonusEditLoading.value = false
}

function closeBonusEdit() { bonusEditAgent.value = null }

async function saveBonusAmount() {
  bonusEditLoading.value = true
  bonusEditMsg.value = ''
  const amount = parseFloat(bonusEditAmount.value)
  if (isNaN(amount) || amount < 0) { bonusEditMsg.value = '请输入有效金额'; bonusEditLoading.value = false; return }
  try {
    const res = await fetch(`/api/users/register-bonus/${bonusEditAgent.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ bonus_amount: amount })
    })
    const data = await res.json()
    bonusEditMsg.value = data.code === 0 ? '已保存' : (data.message || '操作失败')
    if (data.code === 0) { fetchBonusConfig(); setTimeout(closeBonusEdit, 600) }
  } catch { bonusEditMsg.value = '网络错误' }
  finally { bonusEditLoading.value = false }
}

// ========== 批量下单配置（读商品表） ==========
const batchTypes = ref([])
const batchConfigLoading = ref(false)

async function fetchBatchConfig() {
  batchConfigLoading.value = true
  try {
    const res = await fetch('/api/products/all', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      batchTypes.value = data.data.map(p => ({
        id: p.id,
        key: p.target_type,
        label: p.name.replace(/^小红书/, ''),
        enabled: p.status === 'on'
      }))
    }
  } catch { /* ignore */ }
  finally { batchConfigLoading.value = false }
}

async function toggleBatchType(key) {
  const t = batchTypes.value.find(t => t.key === key)
  if (!t) return
  const newEnabled = !t.enabled
  // 乐观更新
  t.enabled = newEnabled
  try {
    const res = await fetch(`/api/products/${t.id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code !== 0) {
      t.enabled = !newEnabled
    }
  } catch {
    t.enabled = !newEnabled
  }
}

// ========== 管理员权限检查 ==========
onMounted(() => {
  if (!isAdmin.value) {
    router.push('/dashboard')
    return
  }
  fetchUsers()
  fetchBatchConfig()
  fetchBonusConfig()
})

// ========== 用户管理 ==========
const users = ref([])
const total = ref(0)
const page = ref(1)
const keyword = ref('')
const loading = ref(false)

const roleOptions = [
  { code: 'user', label: '普通用户' },
  { code: 'support', label: '客服' },
  { code: 'agent', label: '代理' },
  { code: 'admin', label: '管理员' }
]

// 编辑状态
const editUser = ref(null)
const editMode = ref('')
const editRoles = ref([])
const editBalanceAmount = ref('')
const editBalanceRemark = ref('')
const editPassword = ref('')
const editLoading = ref(false)
const editMsg = ref('')

async function fetchUsers() {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: page.value, pageSize: 20 })
    if (keyword.value) q.set('keyword', keyword.value)
    const res = await fetch(`/api/users?${q}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      users.value = data.data.rows
      total.value = data.data.total
    }
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function doSearch() { page.value = 1; fetchUsers() }
function prevPage() { if (page.value > 1) { page.value--; fetchUsers() } }
function nextPage() { if (page.value * 20 < total.value) { page.value++; fetchUsers() } }

function roleName(code) {
  const map = { super: '超级管理员', admin: '管理员', agent: '代理', support: '客服', user: '普通用户' }
  return map[code] || code
}

function openEdit(user, mode) {
  editUser.value = user
  editMode.value = mode
  editMsg.value = ''
  editLoading.value = false
  if (mode === 'role') editRoles.value = [...(user.roles || [])]
  else if (mode === 'balance') { editBalanceAmount.value = ''; editBalanceRemark.value = '' }
  else if (mode === 'password') editPassword.value = ''
}

function closeEdit() { editUser.value = null; editMode.value = '' }

function toggleRole(code) {
  const idx = editRoles.value.indexOf(code)
  if (idx >= 0) {
    if (editRoles.value.length > 1) editRoles.value.splice(idx, 1)
  } else {
    editRoles.value.push(code)
  }
}

async function saveRoles() {
  editLoading.value = true; editMsg.value = ''
  try {
    const res = await fetch(`/api/users/${editUser.value.id}/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ roles: editRoles.value })
    })
    const data = await res.json()
    editMsg.value = data.code === 0 ? '角色已更新' : (data.message || '操作失败')
    if (data.code === 0) { fetchUsers(); setTimeout(closeEdit, 800) }
  } catch { editMsg.value = '网络错误' }
  finally { editLoading.value = false }
}

async function saveBalance() {
  editLoading.value = true; editMsg.value = ''
  const num = parseFloat(editBalanceAmount.value)
  if (isNaN(num) || num === 0) { editMsg.value = '请输入有效金额'; editLoading.value = false; return }
  try {
    const res = await fetch(`/api/users/${editUser.value.id}/balance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ amount: num, remark: editBalanceRemark.value || (num > 0 ? '管理员充值' : '管理员扣款') })
    })
    const data = await res.json()
    editMsg.value = data.code === 0 ? data.message : (data.message || '操作失败')
    if (data.code === 0) { fetchUsers(); setTimeout(closeEdit, 800) }
  } catch { editMsg.value = '网络错误' }
  finally { editLoading.value = false }
}

async function savePassword() {
  editLoading.value = true; editMsg.value = ''
  if (!editPassword.value || editPassword.value.length < 6) { editMsg.value = '密码至少 6 位'; editLoading.value = false; return }
  try {
    const res = await fetch(`/api/users/${editUser.value.id}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ password: editPassword.value })
    })
    const data = await res.json()
    editMsg.value = data.code === 0 ? '密码已重置' : (data.message || '操作失败')
    if (data.code === 0) setTimeout(closeEdit, 800)
  } catch { editMsg.value = '网络错误' }
  finally { editLoading.value = false }
}

async function toggleUserStatus(user) {
  const newStatus = user.status === 'active' ? 'disabled' : 'active'
  try {
    const res = await fetch(`/api/users/${user.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ status: newStatus })
    })
    const data = await res.json()
    if (data.code === 0) fetchUsers()
    else alert(data.message)
  } catch { alert('网络错误') }
}
</script>

<template>
  <div class="admin-page">
    <header class="page-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-content">
        <div class="hero-text">
          <span class="hero-badge">系统管理</span>
          <h1 class="hero-title">权限管理</h1>
          <p class="hero-desc">配置批量下单开关、代理注册奖励，并管理用户角色、余额与账号状态。</p>
        </div>
      </div>
    </header>

    <!-- 批量下单总开关 -->
    <section class="section-card">
      <header class="section-head">
        <div>
          <h2 class="section-title">批量下单控制</h2>
          <p class="section-desc">全局控制各类型批量下单，关闭后所有用户无法提交对应订单。</p>
        </div>
        <span v-if="!batchConfigLoading" class="section-meta">{{ batchTypes.filter(t => t.enabled).length }}/{{ batchTypes.length }} 已开启</span>
      </header>
      <div v-if="batchConfigLoading" class="empty-state"><div class="empty-spinner"></div><span>加载中...</span></div>
      <div v-else class="batch-toggle-grid">
        <div v-for="t in batchTypes" :key="t.key" class="batch-toggle-item" :class="{ off: !t.enabled }">
          <div class="toggle-info">
            <span class="toggle-icon" :class="{ on: t.enabled }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </span>
            <div>
              <span class="toggle-label">{{ t.label }}下单</span>
              <span :class="['toggle-status', t.enabled ? 'on' : 'off']">{{ t.enabled ? '已开启' : '已关闭' }}</span>
            </div>
          </div>
          <button type="button" :class="['toggle-switch', { active: t.enabled }]" :aria-pressed="t.enabled" @click="toggleBatchType(t.key)">
            <span class="toggle-knob"></span>
          </button>
        </div>
      </div>
    </section>

    <!-- 注册奖励配置 -->
    <section class="section-card">
      <header class="section-head">
        <div>
          <h2 class="section-title">新用户注册奖励</h2>
          <p class="section-desc">为代理配置下级新用户注册奖励，到账后自动计入余额。</p>
        </div>
        <span v-if="!bonusLoading" class="section-meta">{{ bonusAllAgents.length }} 个代理</span>
      </header>
      <div v-if="bonusLoading" class="empty-state"><div class="empty-spinner"></div><span>加载中...</span></div>
      <div v-else-if="bonusAllAgents.length === 0" class="empty-state">暂无代理账号</div>
      <div v-else class="bonus-grid">
        <button v-for="agent in bonusAllAgents" :key="agent.id" type="button" class="bonus-card" @click="openBonusEdit(agent)">
          <div class="bonus-card-top">
            <span class="bonus-avatar">{{ (agent.nickname || agent.username || '?')[0] }}</span>
            <div class="bonus-card-meta">
              <strong class="bonus-agent-name">{{ agent.nickname || agent.username }}</strong>
              <span class="bonus-sub-count">{{ agent.sub_count }} 个下级</span>
            </div>
          </div>
          <div class="bonus-amount-block">
            <span class="bonus-label">注册奖励</span>
            <strong class="bonus-val" :class="{ zero: getBonusForAgent(agent.id) === 0 }">¥{{ getBonusForAgent(agent.id).toFixed(2) }}</strong>
          </div>
          <span class="bonus-edit-hint">点击设置金额 →</span>
        </button>
      </div>
    </section>

    <!-- 用户管理 -->
    <section class="section-card users-panel">
      <header class="section-head section-head--toolbar">
        <div>
          <h2 class="section-title">用户管理</h2>
          <p class="section-desc">搜索并管理用户角色、余额、密码与启用状态。</p>
        </div>
        <div class="toolbar-right">
          <div class="admin-search">
            <input v-model="keyword" class="search-input" placeholder="用户名 / 昵称 / 推荐码" @keyup.enter="doSearch" />
            <button type="button" class="btn-search" @click="doSearch">搜索</button>
          </div>
          <span class="admin-total">共 <strong>{{ total }}</strong> 人</span>
        </div>
      </header>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <colgroup>
            <col class="col-id" />
            <col class="col-user" />
            <col class="col-nick" />
            <col class="col-role" />
            <col class="col-money" />
            <col class="col-code" />
            <col class="col-status" />
            <col class="col-time" />
            <col class="col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>昵称</th>
              <th>角色</th>
              <th>余额</th>
              <th>推荐码</th>
              <th>状态</th>
              <th>注册时间</th>
              <th class="th-action">操作</th>
            </tr>
          </thead>
          <tbody v-if="!loading">
            <tr v-for="u in users" :key="u.id" :class="{ disabled: u.status !== 'active' }">
              <td class="mono muted">{{ u.id }}</td>
              <td><strong class="user-name">{{ u.username }}</strong></td>
              <td>{{ u.nickname || u.real_name || '—' }}</td>
              <td>
                <div class="role-tags">
                  <span v-for="r in u.roles" :key="r" class="role-tag" :data-role="r">{{ roleName(r) }}</span>
                </div>
              </td>
              <td class="mono money">¥{{ (u.balance || 0).toFixed(2) }}</td>
              <td class="mono code">{{ u.referral_code || '—' }}</td>
              <td>
                <span class="status-pill" :class="u.status === 'active' ? 'on' : 'off'">
                  <span class="status-dot"></span>
                  {{ u.status === 'active' ? '正常' : '禁用' }}
                </span>
              </td>
              <td class="time-cell">{{ new Date(u.created_at).toLocaleDateString() }}</td>
              <td class="action-cell">
                <div class="action-btns">
                  <button type="button" class="act-btn" @click="openEdit(u, 'role')">角色</button>
                  <button type="button" class="act-btn" @click="openEdit(u, 'balance')">余额</button>
                  <button type="button" class="act-btn" @click="openEdit(u, 'password')">密码</button>
                  <button type="button" class="act-btn" :class="u.status === 'active' ? 'danger' : 'success'" @click="toggleUserStatus(u)">
                    {{ u.status === 'active' ? '禁用' : '启用' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loading" class="empty-state table-empty"><div class="empty-spinner"></div><span>加载中...</span></div>
        <div v-if="!loading && users.length === 0" class="empty-state table-empty">暂无用户数据</div>
      </div>

      <div v-if="total > 20" class="pager-wrap">
        <div class="pager">
          <button type="button" class="page-btn" :disabled="page <= 1" @click="prevPage">上一页</button>
          <span class="page-info">{{ page }} / {{ Math.ceil(total / 20) }}</span>
          <button type="button" class="page-btn" :disabled="page * 20 >= total" @click="nextPage">下一页</button>
        </div>
      </div>
    </section>

  <!-- 注册奖励编辑弹窗 -->
  <Transition name="modal">
    <div v-if="bonusEditAgent" class="mask" @click.self="closeBonusEdit">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bonus-dialog-title">
        <div class="dialog-accent" aria-hidden="true"></div>
        <button type="button" class="close-btn" aria-label="关闭" @click="closeBonusEdit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <header class="dialog-header">
          <span class="dialog-avatar">{{ (bonusEditAgent.nickname || bonusEditAgent.username || '?')[0] }}</span>
          <div class="dialog-header-text">
            <h2 id="bonus-dialog-title">注册奖励</h2>
            <p class="dialog-subtitle">{{ bonusEditAgent.nickname || bonusEditAgent.username }}</p>
          </div>
        </header>
        <div class="dialog-stat-row">
          <span class="dialog-stat-label">下级用户</span>
          <strong class="dialog-stat-val">{{ bonusEditAgent.sub_count }} 人</strong>
        </div>
        <div class="dialog-body">
          <div class="field">
            <label for="bonus-amount-input">奖励金额</label>
            <p class="field-desc">新用户注册后自动到账</p>
            <div class="amount-input-wrap">
              <span class="amount-prefix">¥</span>
              <input id="bonus-amount-input" v-model="bonusEditAmount" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
            <p class="field-hint">设为 0 表示不发放奖励</p>
          </div>
          <p v-if="bonusEditMsg" class="form-msg" :class="{ ok: bonusEditMsg === '已保存' }">{{ bonusEditMsg }}</p>
        </div>
        <footer class="dialog-footer">
          <button type="button" class="btn-secondary" @click="closeBonusEdit">取消</button>
          <button type="button" class="primary-btn" :disabled="bonusEditLoading" @click="saveBonusAmount">
            {{ bonusEditLoading ? '保存中...' : '保存' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>

  <!-- 编辑弹窗 -->
  <Transition name="modal">
    <div v-if="editUser" class="mask" @click.self="closeEdit">
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="dialog-accent" aria-hidden="true"></div>
        <button type="button" class="close-btn" aria-label="关闭" @click="closeEdit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <template v-if="editMode === 'role'">
          <header class="dialog-header">
            <span class="dialog-avatar dialog-avatar--role">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            <div class="dialog-header-text">
              <h2>修改角色</h2>
              <p class="dialog-subtitle">{{ editUser.username }}</p>
            </div>
          </header>
          <div class="dialog-body">
            <div class="role-pick">
              <label v-for="opt in roleOptions" :key="opt.code" class="role-checkbox" :class="{ checked: editRoles.includes(opt.code) }" @click="toggleRole(opt.code)">
                <span class="check-box">{{ editRoles.includes(opt.code) ? '✓' : '' }}</span>
                {{ opt.label }}
              </label>
            </div>
            <p v-if="editMsg" class="form-msg" :class="{ ok: editMsg.includes('已') }">{{ editMsg }}</p>
          </div>
          <footer class="dialog-footer">
            <button type="button" class="btn-secondary" @click="closeEdit">取消</button>
            <button type="button" class="primary-btn" :disabled="editLoading" @click="saveRoles">{{ editLoading ? '保存中...' : '保存' }}</button>
          </footer>
        </template>

        <template v-if="editMode === 'balance'">
          <header class="dialog-header">
            <span class="dialog-avatar dialog-avatar--balance">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <div class="dialog-header-text">
              <h2>调整余额</h2>
              <p class="dialog-subtitle">{{ editUser.username }}</p>
            </div>
          </header>
          <div class="dialog-stat-row dialog-stat-row--accent">
            <span class="dialog-stat-label">当前余额</span>
            <strong class="dialog-stat-val dialog-stat-amount">¥{{ (editUser.balance || 0).toFixed(2) }}</strong>
          </div>
          <div class="dialog-body">
            <div class="field">
              <label for="balance-amount-input">调整金额</label>
              <p class="field-desc">正数充值，负数扣款</p>
              <div class="amount-input-wrap">
                <span class="amount-prefix">¥</span>
                <input id="balance-amount-input" v-model="editBalanceAmount" type="number" step="0.01" placeholder="100 或 -50" />
              </div>
            </div>
            <div class="field">
              <label for="balance-remark-input">备注</label>
              <input id="balance-remark-input" v-model="editBalanceRemark" class="text-input" placeholder="可选，如：活动补偿" />
            </div>
            <p v-if="editMsg" class="form-msg" :class="{ ok: editMsg.includes('成功') || editMsg.includes('已') }">{{ editMsg }}</p>
          </div>
          <footer class="dialog-footer">
            <button type="button" class="btn-secondary" @click="closeEdit">取消</button>
            <button type="button" class="primary-btn" :disabled="editLoading" @click="saveBalance">{{ editLoading ? '保存中...' : '确认调整' }}</button>
          </footer>
        </template>

        <template v-if="editMode === 'password'">
          <header class="dialog-header">
            <span class="dialog-avatar dialog-avatar--pwd">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
            <div class="dialog-header-text">
              <h2>重置密码</h2>
              <p class="dialog-subtitle">{{ editUser.username }}</p>
            </div>
          </header>
          <div class="dialog-body">
            <div class="field">
              <label for="password-input">新密码</label>
              <p class="field-desc">至少 6 位字符</p>
              <input id="password-input" v-model="editPassword" type="text" class="text-input" placeholder="输入新密码" />
            </div>
            <p v-if="editMsg" class="form-msg" :class="{ ok: editMsg.includes('已') }">{{ editMsg }}</p>
          </div>
          <footer class="dialog-footer">
            <button type="button" class="btn-secondary" @click="closeEdit">取消</button>
            <button type="button" class="primary-btn" :disabled="editLoading" @click="savePassword">{{ editLoading ? '保存中...' : '确认重置' }}</button>
          </footer>
        </template>
      </div>
    </div>
  </Transition>
  </div>
</template>

<style scoped>
.admin-page {
  --rp-primary: #2f6df6;
  --rp-accent: #ee4d7a;
  --rp-purple: #8b7bf7;
  --rp-text: #152033;
  --rp-text-2: #425066;
  --rp-text-3: #8a95a8;
  --rp-border: #e8eef7;
  --rp-radius: 14px;
  --rp-shadow: 0 4px 24px rgba(21, 32, 51, 0.06), 0 1px 3px rgba(21, 32, 51, 0.04);
  --rp-shadow-lg: 0 12px 40px rgba(47, 109, 246, 0.08), 0 4px 12px rgba(21, 32, 51, 0.04);
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px 20px 40px;
}

/* ========== 页面头部 ========== */
.page-hero {
  position: relative;
  border-radius: var(--rp-radius);
  overflow: hidden;
  margin-bottom: 18px;
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: var(--rp-shadow-lg);
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 75% 55% at 8% 0%, rgba(139, 123, 247, 0.12), transparent 52%),
    radial-gradient(ellipse 65% 50% at 92% 100%, rgba(47, 109, 246, 0.12), transparent 48%),
    linear-gradient(135deg, #f8faff 0%, #fff6f9 42%, #f3f7ff 100%);
}

.hero-content {
  position: relative;
  padding: 22px 26px;
}

.hero-badge {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(139, 123, 247, 0.12);
  color: var(--rp-purple);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.hero-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--rp-text);
  letter-spacing: -0.3px;
  line-height: 1.2;
}

.hero-desc {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--rp-text-3);
  line-height: 1.55;
  max-width: 560px;
}

/* ========== 区块卡片 ========== */
.section-card {
  background: #fff;
  border-radius: var(--rp-radius);
  border: 1px solid var(--rp-border);
  box-shadow: var(--rp-shadow);
  padding: 20px 22px 22px;
  margin-bottom: 18px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.section-head--toolbar {
  align-items: center;
}

.section-title {
  font-size: 17px;
  font-weight: 900;
  color: var(--rp-text);
  letter-spacing: -0.2px;
}

.section-desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--rp-text-3);
  line-height: 1.5;
}

.section-meta {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: #f5f8ff;
  border: 1px solid #e4ecff;
  font-size: 12px;
  font-weight: 700;
  color: var(--rp-text-3);
  white-space: nowrap;
}

/* ========== 批量下单开关 ========== */
.batch-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.batch-toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #e8eef7;
  background: linear-gradient(180deg, #fcfdff, #fff);
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.batch-toggle-item:hover {
  border-color: #d4e4ff;
  box-shadow: 0 4px 16px rgba(47, 109, 246, 0.06);
}

.batch-toggle-item.off {
  background: #fafbfc;
  border-color: #eef0f4;
}

.toggle-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.toggle-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: #f0f2f5;
  color: #b0b8c4;
}

.toggle-icon svg {
  width: 18px;
  height: 18px;
}

.toggle-icon.on {
  background: rgba(66, 201, 120, 0.12);
  color: #42c978;
}

.toggle-label {
  display: block;
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text);
}

.toggle-status {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 700;
}

.toggle-status.on { color: #42c978; }
.toggle-status.off { color: #ef4444; }

.toggle-switch {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 26px;
  border-radius: 999px;
  background: #dfe5ec;
  cursor: pointer;
  border: none;
  padding: 0;
  transition: background 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.toggle-switch.active {
  background: linear-gradient(135deg, #42c978, #38b2ac);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(22px);
}

/* ========== 注册奖励 ========== */
.bonus-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.bonus-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid #e8eef7;
  background: linear-gradient(180deg, #fcfdff, #fff);
  cursor: pointer;
  transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
}

.bonus-card:hover {
  border-color: #d4e4ff;
  box-shadow: 0 8px 24px rgba(47, 109, 246, 0.08);
  transform: translateY(-2px);
}

.bonus-card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bonus-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 900;
  color: #fff;
  background: linear-gradient(135deg, var(--rp-purple), var(--rp-primary));
}

.bonus-card-meta {
  min-width: 0;
}

.bonus-agent-name {
  display: block;
  font-size: 14px;
  font-weight: 800;
  color: var(--rp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bonus-sub-count {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--rp-text-3);
  font-weight: 600;
}

.bonus-amount-block {
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.bonus-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--rp-text-3);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.bonus-val {
  display: block;
  margin-top: 4px;
  font-size: 22px;
  font-weight: 900;
  color: var(--rp-accent);
  font-variant-numeric: tabular-nums;
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
}

.bonus-val.zero {
  color: var(--rp-text-3);
}

.bonus-edit-hint {
  font-size: 11px;
  font-weight: 700;
  color: var(--rp-primary);
  opacity: 0.85;
}

/* ========== 用户管理 ========== */
.users-panel {
  padding-bottom: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.admin-search {
  display: flex;
  gap: 8px;
}

.search-input {
  width: min(280px, 52vw);
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--rp-border);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  background: #f8faff;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.search-input:focus {
  border-color: var(--rp-purple);
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.12);
  background: #fff;
}

.btn-search {
  min-width: 76px;
  height: 38px;
  padding: 0 18px;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  background: linear-gradient(135deg, var(--rp-purple), var(--rp-primary));
  box-shadow: 0 4px 14px rgba(47, 109, 246, 0.22);
  transition: transform 200ms ease, box-shadow 200ms ease;
}

.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(47, 109, 246, 0.28);
}

.admin-total {
  font-size: 13px;
  color: var(--rp-text-3);
  font-weight: 600;
  white-space: nowrap;
}

.admin-total strong {
  color: var(--rp-primary);
  font-weight: 900;
}

.admin-table-wrap {
  margin: 0 -22px;
  overflow-x: auto;
  background: #f8faff;
  border-top: 1px solid #f0f2f7;
}

.admin-table {
  width: 100%;
  min-width: 960px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  table-layout: fixed;
}

.col-id { width: 52px; }
.col-user { width: 100px; }
.col-nick { width: 88px; }
.col-role { width: 120px; }
.col-money { width: 96px; }
.col-code { width: 100px; }
.col-status { width: 88px; }
.col-time { width: 100px; }
.col-action { width: 240px; }

.admin-table th {
  text-align: left;
  padding: 14px 16px;
  font-weight: 800;
  color: var(--rp-text-3);
  font-size: 11px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  background: #fff;
  border-bottom: 1px solid #eef2f7;
  white-space: nowrap;
}

.th-action,
.action-cell {
  text-align: right;
}

.admin-table td {
  padding: 14px 16px;
  color: var(--rp-text-2);
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
  background: #fff;
}

.admin-table tbody tr {
  transition: background 160ms ease;
}

.admin-table tbody tr:hover td {
  background: #fafbff;
}

.admin-table tbody tr.disabled td {
  opacity: 0.55;
}

.mono {
  font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.muted { color: var(--rp-text-3); }
.user-name { color: var(--rp-text); font-weight: 800; }
.money { font-weight: 900; color: var(--rp-accent); }
.code { color: var(--rp-text-3); }
.time-cell { color: var(--rp-text-3); font-size: 12px; white-space: nowrap; }

.role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.role-tag {
  display: inline-flex;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  border: 1px solid transparent;
}

.role-tag[data-role="super"],
.role-tag[data-role="admin"] {
  background: linear-gradient(135deg, #ee4d7a, #ff7eb3);
  color: #fff;
}

.role-tag[data-role="agent"] {
  background: linear-gradient(135deg, var(--rp-purple), #a78bfa);
  color: #fff;
}

.role-tag[data-role="support"] {
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
}

.role-tag[data-role="user"] {
  background: #f0f2f5;
  color: var(--rp-text-3);
  border-color: #e8edf4;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill.on {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}

.status-pill.off {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-pill.on .status-dot {
  background: #42c978;
  box-shadow: 0 0 6px rgba(66, 201, 120, 0.5);
}

.status-pill.off .status-dot {
  background: #ef4444;
}

.action-cell {
  padding-right: 18px !important;
}

.action-btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.act-btn {
  min-width: 52px;
  padding: 5px 11px;
  border: 1px solid #e4ecff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
  background: #f5f8ff;
  color: var(--rp-primary);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}

.act-btn:hover {
  background: #eef3ff;
  border-color: #c4d4ff;
  transform: translateY(-1px);
}

.act-btn.danger {
  background: #fff5f5;
  border-color: #fecaca;
  color: #dc2626;
}

.act-btn.danger:hover {
  background: #fee2e2;
}

.act-btn.success {
  background: #ecfdf5;
  border-color: #a7f3d0;
  color: #059669;
}

.act-btn.success:hover {
  background: #d1fae5;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--rp-text-3);
  font-size: 14px;
  font-weight: 600;
}

.table-empty {
  background: #fff;
}

.empty-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #eef2f7;
  border-top-color: var(--rp-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.pager-wrap {
  padding: 14px 22px 18px;
  border-top: 1px solid #f0f2f7;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.page-btn {
  min-width: 76px;
  padding: 7px 16px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid var(--rp-border);
  color: var(--rp-text-2);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.page-btn:hover:not(:disabled) {
  background: #f5f8ff;
  border-color: #c4d4ff;
  color: var(--rp-primary);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  color: var(--rp-text-3);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ========== 弹窗 ========== */
.mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 16px;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(8px);
}

.dialog {
  width: min(420px, 100%);
  max-height: min(90vh, 90dvh);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: #fff;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.18),
    0 8px 24px rgba(47, 109, 246, 0.08);
  position: relative;
}

.dialog-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--rp-accent), var(--rp-purple), var(--rp-primary));
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  color: var(--rp-text-3);
  background: #f4f7fb;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 200ms ease, background 200ms ease, color 200ms ease;
}

.close-btn:hover {
  color: var(--rp-accent);
  background: #fff1f5;
  transform: rotate(90deg);
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 24px 0;
  padding-right: 52px;
}

.dialog-avatar {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 900;
  color: #fff;
  background: linear-gradient(135deg, var(--rp-purple), var(--rp-primary));
  box-shadow: 0 6px 16px rgba(139, 123, 247, 0.28);
}

.dialog-avatar--role {
  color: var(--rp-purple);
  background: linear-gradient(135deg, #f3f0ff, #eef3ff);
  box-shadow: none;
  border: 1px solid #e4ecff;
}

.dialog-avatar--balance {
  color: var(--rp-accent);
  background: linear-gradient(135deg, #fff6f9, #fff0f5);
  box-shadow: none;
  border: 1px solid #ffe4ec;
}

.dialog-avatar--pwd {
  color: var(--rp-primary);
  background: linear-gradient(135deg, #f0f4ff, #eef3ff);
  box-shadow: none;
  border: 1px solid #e4ecff;
}

.dialog-header-text {
  min-width: 0;
}

.dialog-header h2 {
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-text);
  letter-spacing: -0.2px;
  line-height: 1.25;
}

.dialog-subtitle {
  margin-top: 3px;
  font-size: 13px;
  font-weight: 600;
  color: var(--rp-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 24px 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #eef2f7;
}

.dialog-stat-row--accent {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border-color: #ffe4ec;
}

.dialog-stat-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--rp-text-3);
}

.dialog-stat-val {
  font-size: 16px;
  font-weight: 900;
  color: var(--rp-text);
  font-variant-numeric: tabular-nums;
}

.dialog-stat-amount {
  font-size: 20px;
  color: var(--rp-accent);
}

.dialog-body {
  padding: 18px 24px 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.dialog-footer {
  display: flex;
  gap: 10px;
  padding: 16px 24px 24px;
  border-top: 1px solid #f0f2f7;
  background: linear-gradient(180deg, #fff, #fafbff);
}

.field {
  margin-bottom: 4px;
}

.field label {
  display: block;
  font-size: 13px;
  font-weight: 800;
  color: var(--rp-text);
}

.field-desc {
  margin-top: 2px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--rp-text-3);
}

.field-hint {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--rp-text-3);
  font-weight: 600;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--rp-border);
  background: #f8faff;
  transition: border-color 200ms ease, box-shadow 200ms ease, background 200ms ease;
}

.amount-input-wrap:focus-within {
  border-color: var(--rp-purple);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.12);
}

.amount-prefix {
  flex-shrink: 0;
  margin-right: 6px;
  font-size: 18px;
  font-weight: 900;
  color: var(--rp-accent);
}

.amount-input-wrap input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  font-size: 20px;
  font-weight: 900;
  color: var(--rp-text);
  outline: none;
  font-variant-numeric: tabular-nums;
}

.text-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--rp-border);
  border-radius: 12px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  background: #f8faff;
  transition: border-color 200ms ease, box-shadow 200ms ease, background 200ms ease;
}

.text-input:focus {
  border-color: var(--rp-purple);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.12);
}

.amount-input-wrap input::-webkit-outer-spin-button,
.amount-input-wrap input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.form-msg {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--rp-purple);
  background: #f3f0ff;
  border: 1px solid #e8e0ff;
}

.form-msg.ok {
  color: #059669;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.btn-secondary {
  flex: 1;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1px solid var(--rp-border);
  background: #fff;
  color: var(--rp-text-2);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.btn-secondary:hover {
  background: #f5f8ff;
  border-color: #d4e4ff;
  color: var(--rp-primary);
}

.primary-btn {
  flex: 1.2;
  min-height: 44px;
  padding: 0 20px;
  border: none;
  border-radius: 12px;
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  cursor: pointer;
  background: #2f6df6;
  box-shadow: 0 8px 22px rgba(47, 109, 246, 0.28);
  transition: transform 200ms ease, box-shadow 200ms ease, background 200ms ease, opacity 200ms ease;
}

.primary-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #2563eb;
  box-shadow: 0 12px 28px rgba(47, 109, 246, 0.35);
}

.primary-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.role-pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #eef2f7;
  background: #f8faff;
  cursor: pointer;
  font-weight: 700;
  color: var(--rp-text-2);
  transition: background 160ms ease, border-color 160ms ease;
}

.role-checkbox:hover {
  background: #f0f4ff;
  border-color: #d4e4ff;
}

.role-checkbox.checked {
  background: linear-gradient(135deg, #f3f0ff, #ece8ff);
  border-color: var(--rp-purple);
  color: var(--rp-purple);
}

.check-box {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border: 2px solid #d0d5dd;
  font-size: 12px;
  font-weight: 900;
  color: #fff;
  background: #fff;
  transition: background 160ms ease, border-color 160ms ease;
}

.role-checkbox.checked .check-box {
  background: var(--rp-purple);
  border-color: var(--rp-purple);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 260ms ease;
}

.modal-enter-active .dialog,
.modal-leave-active .dialog {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .dialog,
.modal-leave-to .dialog {
  transform: scale(0.94) translateY(12px);
  opacity: 0;
}

@media (max-width: 900px) {
  .admin-page {
    padding: 12px 12px 32px;
  }

  .section-head--toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-right {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .admin-search {
    width: 100%;
  }

  .search-input {
    flex: 1;
    width: auto;
  }
}

@media (max-width: 640px) {
  .batch-toggle-grid {
    grid-template-columns: 1fr;
  }

  .bonus-grid {
    grid-template-columns: 1fr;
  }

  .hero-title {
    font-size: 19px;
  }

  .mask {
    align-items: flex-end;
    padding: 0;
  }

  .dialog {
    width: 100%;
    max-height: 88dvh;
    border-radius: 20px 20px 0 0;
    border-bottom: none;
  }

  .dialog-header {
    padding-top: 20px;
  }

  .dialog-footer {
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0));
    flex-direction: column-reverse;
  }

  .dialog-footer .btn-secondary,
  .dialog-footer .primary-btn {
    flex: none;
    width: 100%;
  }
}
</style>
