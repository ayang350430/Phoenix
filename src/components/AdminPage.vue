<script setup>
import { inject, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// ========== 从布局注入共享状态 ==========
const ws = inject('workspace')
const { isAdmin, getToken } = ws

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
  <!-- 批量下单总开关 -->
  <section class="batch-config-panel">
    <h2>批量下单控制</h2>
    <p class="batch-config-desc">全局控制批量下单功能的开关，关闭后所有用户均无法提交对应类型的订单。</p>
    <div class="batch-toggle-list">
      <div v-for="t in batchTypes" :key="t.key" class="batch-toggle-item">
        <div class="toggle-info">
          <span class="toggle-label">{{ t.label }}下单</span>
          <span :class="['toggle-status', t.enabled ? 'on' : 'off']">{{ t.enabled ? '已开启' : '已关闭' }}</span>
        </div>
        <button type="button" :class="['toggle-switch', { active: t.enabled }]" @click="toggleBatchType(t.key)">
          <span class="toggle-knob"></span>
        </button>
      </div>
    </div>
  </section>

  <!-- 管理面板 -->
  <section class="admin-panel">
    <div class="admin-toolbar">
      <h2>用户管理</h2>
      <div class="admin-search">
        <input v-model="keyword" placeholder="搜索用户名 / 昵称 / 推荐码" @keyup.enter="doSearch" />
        <button type="button" @click="doSearch">搜索</button>
      </div>
      <span class="admin-total">共 {{ total }} 个用户</span>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
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
            <th>操作</th>
          </tr>
        </thead>
        <tbody v-if="!loading">
          <tr v-for="u in users" :key="u.id" :class="{ disabled: u.status !== 'active' }">
            <td>{{ u.id }}</td>
            <td><strong>{{ u.username }}</strong></td>
            <td>{{ u.nickname || u.real_name || '-' }}</td>
            <td>
              <span v-for="r in u.roles" :key="r" class="role-tag" :class="r">{{ roleName(r) }}</span>
            </td>
            <td class="mono">¥{{ (u.balance || 0).toFixed(2) }}</td>
            <td class="mono">{{ u.referral_code }}</td>
            <td>
              <span class="status-dot" :class="u.status === 'active' ? 'on' : 'off'"></span>
              {{ u.status === 'active' ? '正常' : '禁用' }}
            </td>
            <td>{{ new Date(u.created_at).toLocaleDateString() }}</td>
            <td class="action-cell">
              <button type="button" class="act-btn" @click="openEdit(u, 'role')">角色</button>
              <button type="button" class="act-btn" @click="openEdit(u, 'balance')">余额</button>
              <button type="button" class="act-btn" @click="openEdit(u, 'password')">密码</button>
              <button type="button" class="act-btn" :class="u.status === 'active' ? 'danger' : 'success'" @click="toggleUserStatus(u)">
                {{ u.status === 'active' ? '禁用' : '启用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-if="!loading && users.length === 0" class="empty-state">暂无数据</div>
    </div>

    <div v-if="total > 20" class="pager">
      <button type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
      <span>{{ page }} / {{ Math.ceil(total / 20) }}</span>
      <button type="button" :disabled="page * 20 >= total" @click="nextPage">下一页</button>
    </div>
  </section>

  <!-- 编辑弹窗 -->
  <Transition name="fade">
    <div v-if="editUser" class="mask" @click.self="closeEdit">
      <div class="dialog">
        <button type="button" class="close-btn" @click="closeEdit">×</button>

        <template v-if="editMode === 'role'">
          <h2>修改角色 — {{ editUser.username }}</h2>
          <div class="role-pick">
            <label v-for="opt in roleOptions" :key="opt.code" class="role-checkbox" :class="{ checked: editRoles.includes(opt.code) }" @click="toggleRole(opt.code)">
              <span class="check-box">{{ editRoles.includes(opt.code) ? '✓' : '' }}</span>
              {{ opt.label }}
            </label>
          </div>
          <p v-if="editMsg" class="msg">{{ editMsg }}</p>
          <button type="button" class="primary-btn" :disabled="editLoading" @click="saveRoles">{{ editLoading ? '保存中...' : '保存' }}</button>
        </template>

        <template v-if="editMode === 'balance'">
          <h2>调整余额 — {{ editUser.username }}</h2>
          <p class="hint">当前余额：<strong>¥{{ (editUser.balance || 0).toFixed(2) }}</strong></p>
          <div class="field">
            <label>调整金额（正数充值，负数扣款）</label>
            <input v-model="editBalanceAmount" type="number" step="0.01" placeholder="如 100 或 -50" />
          </div>
          <div class="field">
            <label>备注</label>
            <input v-model="editBalanceRemark" placeholder="可选" />
          </div>
          <p v-if="editMsg" class="msg">{{ editMsg }}</p>
          <button type="button" class="primary-btn" :disabled="editLoading" @click="saveBalance">{{ editLoading ? '保存中...' : '确认调整' }}</button>
        </template>

        <template v-if="editMode === 'password'">
          <h2>重置密码 — {{ editUser.username }}</h2>
          <div class="field">
            <label>新密码（至少 6 位）</label>
            <input v-model="editPassword" type="text" placeholder="输入新密码" />
          </div>
          <p v-if="editMsg" class="msg">{{ editMsg }}</p>
          <button type="button" class="primary-btn" :disabled="editLoading" @click="savePassword">{{ editLoading ? '保存中...' : '确认重置' }}</button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ---- 批量下单控制 ---- */
.batch-config-panel {
  padding: 24px 28px 22px;
  margin: 0 0 0;
}
.batch-config-panel h2 { font-size: 22px; margin-bottom: 6px; }
.batch-config-desc { font-size: 13px; color: #9aa5b5; margin-bottom: 18px; }

.batch-toggle-list {
  display: flex; gap: 14px; flex-wrap: wrap;
}

.batch-toggle-item {
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; padding: 16px 22px;
  background: #fff; border-radius: 12px;
  box-shadow: 0 8px 26px rgba(21,32,51,.06);
  min-width: 220px; flex: 1; max-width: 320px;
  transition: box-shadow 240ms ease;
}
.batch-toggle-item:hover { box-shadow: 0 12px 30px rgba(21,32,51,.09); }

.toggle-info { display: flex; flex-direction: column; gap: 4px; }
.toggle-label { font-size: 15px; font-weight: 800; color: #152033; }
.toggle-status { font-size: 12px; font-weight: 700; }
.toggle-status.on { color: #42c978; }
.toggle-status.off { color: #ff4d4f; }

.toggle-switch {
  position: relative;
  width: 50px; height: 28px;
  border-radius: 999px;
  background: #dfe5ec;
  cursor: pointer;
  border: none;
  padding: 0;
  transition: background 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-switch.active {
  background: linear-gradient(135deg, #42c978, #38b26a);
}
.toggle-knob {
  position: absolute;
  top: 3px; left: 3px;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-switch.active .toggle-knob {
  transform: translateX(22px);
}

/* ---- 管理面板 ---- */
.admin-panel { padding: 24px 28px 28px; }

.admin-toolbar {
  display: flex; align-items: center; gap: 18px;
  margin-bottom: 18px; flex-wrap: wrap;
}
.admin-toolbar h2 { font-size: 22px; }

.admin-search { display: flex; gap: 8px; flex: 1; max-width: 420px; }
.admin-search input {
  flex: 1; height: 40px; padding: 0 14px;
  border: 2px solid #e8edf4; border-radius: 8px;
  font-size: 14px; outline: none;
  transition: border-color 240ms ease;
}
.admin-search input:focus { border-color: #8b7bf7; }
.admin-search button {
  height: 40px; padding: 0 22px; border-radius: 8px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff; font-weight: 700; font-size: 14px; cursor: pointer;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}
.admin-search button:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(139,123,247,.24); }

.admin-total { color: #9aa5b5; font-size: 14px; }

.admin-table-wrap {
  background: #fff; border-radius: 12px;
  box-shadow: 0 8px 26px rgba(21,32,51,.06); overflow-x: auto;
}

.admin-table { width: 100%; border-collapse: collapse; font-size: 14px; white-space: nowrap; }
.admin-table th {
  padding: 14px 14px; text-align: left;
  background: #f6f8fc; color: #647184; font-weight: 700;
  border-bottom: 2px solid #e8edf4;
}
.admin-table td { padding: 13px 14px; border-bottom: 1px solid #f0f2f5; color: #425066; }
.admin-table tbody tr { transition: background 160ms ease; }
.admin-table tbody tr:hover { background: #f9fafc; }
.admin-table tbody tr.disabled { opacity: .5; }
.admin-table .mono { font-family: 'Cascadia Code','Menlo',monospace; font-size: 13px; }

.role-tag {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700; margin-right: 4px;
}
.role-tag.super, .role-tag.admin { background: linear-gradient(135deg, #ee4d7a, #ff7eb3); color: #fff; }
.role-tag.agent { background: linear-gradient(135deg, #8b7bf7, #a78bfa); color: #fff; }
.role-tag.support { background: linear-gradient(135deg, #2563eb, #60a5fa); color: #fff; }
.role-tag.user { background: #f0f2f5; color: #647184; }

.status-dot {
  display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; margin-right: 6px; vertical-align: middle;
}
.status-dot.on { background: #42c978; box-shadow: 0 0 6px rgba(66,201,120,.4); }
.status-dot.off { background: #ff6b6b; }

.action-cell { display: flex; gap: 6px; }
.act-btn {
  padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700;
  background: #eef3ff; color: #5b8def; cursor: pointer;
  transition: background 160ms ease, color 160ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.act-btn:hover { background: #dce6ff; transform: translateY(-1px); }
.act-btn.danger { background: #fff1f0; color: #ff4d4f; }
.act-btn.danger:hover { background: #ffe4e3; }
.act-btn.success { background: #f0fff4; color: #42c978; }
.act-btn.success:hover { background: #dcfce7; }

.empty-state { text-align: center; padding: 48px; color: #9aa5b5; font-size: 15px; }

.pager {
  display: flex; align-items: center; justify-content: center;
  gap: 16px; margin-top: 16px;
}
.pager button {
  padding: 7px 18px; border-radius: 6px; background: #fff;
  border: 1px solid #e8edf4; color: #425066; font-weight: 700;
  font-size: 13px; cursor: pointer;
  transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
}
.pager button:hover:not(:disabled) { background: #eef3ff; color: #8b7bf7; border-color: #c4b8fd; }
.pager button:disabled { opacity: .4; cursor: not-allowed; }
.pager span { color: #647184; font-size: 13px; }

/* ---- 弹窗 ---- */
.mask {
  position: fixed; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(21,32,51,.32);
}

.dialog {
  width: min(440px, 92vw); padding: 32px;
  border-radius: 16px; background: #fff;
  box-shadow: 0 32px 64px rgba(21,32,51,.24); position: relative;
}

.close-btn {
  position: absolute; top: 16px; right: 16px;
  width: 32px; height: 32px; border-radius: 50%;
  color: #647184; background: #f4f7fb; font-size: 22px; cursor: pointer;
  display: grid; place-items: center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), background 240ms ease, color 240ms ease;
}
.close-btn:hover { color: #ee4d7a; background: #fff1f5; transform: rotate(90deg); }

.dialog h2 { font-size: 20px; color: #152033; margin-bottom: 18px; }

.hint { color: #647184; margin-bottom: 18px; }
.hint strong { color: #152033; font-size: 18px; }

.field { margin-bottom: 16px; }
.field label {
  display: block; margin-bottom: 6px;
  font-size: 13px; font-weight: 700; color: #425066;
}
.field input {
  width: 100%; height: 44px; padding: 0 14px;
  border: 2px solid #dfe5ec; border-radius: 8px;
  font-size: 15px; outline: none; box-sizing: border-box;
  transition: border-color 240ms ease;
}
.field input:focus { border-color: #8b7bf7; }
.field input::-webkit-outer-spin-button,
.field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.msg { color: #8b7bf7; font-size: 13px; margin: 8px 0 12px; font-weight: 700; }

.primary-btn {
  width: 100%; height: 44px; border-radius: 8px;
  color: #fff; font-weight: 800; cursor: pointer;
  background: linear-gradient(135deg, #ee4d7a, #8b7bf7 54%, #5b8def);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 240ms ease;
}
.primary-btn:hover { transform: translateY(-2px); box-shadow: 0 14px 28px rgba(139,123,247,.24); }
.primary-btn:active { transform: scale(.98); }
.primary-btn:disabled { opacity: .7; pointer-events: none; }

.role-pick { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
.role-checkbox {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-radius: 8px; background: #f6f8fc;
  cursor: pointer; font-weight: 700; color: #425066;
  transition: background 160ms ease, box-shadow 160ms ease;
}
.role-checkbox:hover { background: #eef3ff; }
.role-checkbox.checked {
  background: linear-gradient(135deg, #f3f0ff, #ece8ff);
  box-shadow: 0 0 0 2px #8b7bf7; color: #8b7bf7;
}
.check-box {
  width: 22px; height: 22px; display: grid; place-items: center;
  border-radius: 6px; border: 2px solid #d0d5dd;
  font-size: 14px; font-weight: 900; color: #fff; background: #fff;
  transition: background 160ms ease, border-color 160ms ease;
}
.role-checkbox.checked .check-box { background: #8b7bf7; border-color: #8b7bf7; }

/* 动画 */
.fade-enter-active, .fade-leave-active { transition: opacity 240ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 1000px) {
  .batch-config-panel { padding: 16px; }
  .batch-toggle-item { min-width: 180px; }
  .admin-panel { padding: 16px; }
  .admin-toolbar { flex-direction: column; align-items: flex-start; }
  .admin-search { max-width: 100%; width: 100%; }
}

@media (max-width: 760px) {
  .batch-config-panel { padding: 12px; }
  .batch-config-panel h2 { font-size: 18px; }
  .batch-toggle-list { flex-direction: column; }
  .batch-toggle-item { max-width: 100%; }
  .admin-panel { padding: 12px; }
  .admin-toolbar { gap: 10px; }
  .admin-toolbar h2 { font-size: 18px; }
  .admin-table-wrap { font-size: 13px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .admin-table { min-width: 700px; }
  .admin-table th, .admin-table td { padding: 8px 6px; white-space: nowrap; }
}
</style>
