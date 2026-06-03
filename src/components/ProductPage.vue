<script setup>
import { inject, onMounted, ref, computed } from 'vue'

const ws = inject('workspace')
const { getToken, isAdmin, isAgent, balance, fetchBalance } = ws

// ============================== 共用 ==============================
const builtinTypes = [
  { key: 'read', label: '阅读' },
  { key: 'like', label: '点赞' },
  { key: 'impression', label: '曝光' },
  { key: 'collect', label: '收藏' },
  { key: 'follow', label: '关注' },
  { key: 'comment', label: '评论' },
  { key: 'share', label: '分享' }
]
// 合并内置 + 已有商品中出现的类型（去重）
const allTypeOptions = computed(() => {
  const map = new Map(builtinTypes.map(t => [t.key, t.label]))
  for (const p of products.value) {
    if (!map.has(p.target_type)) map.set(p.target_type, p.target_type)
  }
  return [...map.entries()].map(([key, label]) => ({ key, label }))
})
const typeLabel = t => {
  const found = builtinTypes.find(o => o.key === t)
  return found ? found.label : t
}
const groupedProducts = computed(() => {
  const groups = new Map()
  for (const p of products.value) {
    if (!groups.has(p.target_type)) groups.set(p.target_type, [])
    groups.get(p.target_type).push(p)
  }
  return [...groups.entries()].sort((a, b) => {
    const aMin = Math.min(...a[1].map(x => x.sort_order || 0))
    const bMin = Math.min(...b[1].map(x => x.sort_order || 0))
    return aMin - bMin
  })
})

// ============================== 管理端 ==============================
const products = ref([])
const loading = ref(false)
const showForm = ref(false)
const editingId = ref(null)

const colorOptions = [
  '#ee4d7a', '#5b8def', '#8b7bf7', '#22c2d6',
  '#42c978', '#ff9f43', '#ff6b6b', '#6b73ff'
]

const defaultForm = {
  name: '', target_type: '', unit_price: 0.01,
  min_quantity: 100, max_quantity: 100000, step_quantity: 100,
  status: 'on', description: '', icon: '', color: '#5b8def', sort_order: 0,
  api_endpoint: ''
}
const form = ref({ ...defaultForm })
const formError = ref('')
const saving = ref(false)
const formTitle = computed(() => editingId.value ? '编辑商品' : '新增商品')

async function fetchProducts() {
  loading.value = true
  try {
    const res = await fetch('/api/products/all', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) products.value = data.data
  } catch { /* ignore */ }
  finally { loading.value = false }
}

function openAdd() {
  editingId.value = null
  form.value = { ...defaultForm }
  formError.value = ''
  showForm.value = true
}

function openEdit(p) {
  editingId.value = p.id
  form.value = {
    name: p.name, target_type: p.target_type,
    unit_price: Number(p.unit_price), min_quantity: p.min_quantity,
    max_quantity: p.max_quantity, step_quantity: p.step_quantity,
    status: p.status, description: p.description || '',
    icon: p.icon || '', color: p.color || '#5b8def', sort_order: p.sort_order || 0,
    api_endpoint: p.api_endpoint || ''
  }
  formError.value = ''
  showForm.value = true
}

async function submitForm() {
  formError.value = ''
  if (!form.value.name.trim()) { formError.value = '请输入商品名称'; return }
  if (!form.value.target_type.trim()) { formError.value = '请输入任务类型'; return }
  if (form.value.unit_price <= 0) { formError.value = '单价必须大于0'; return }
  saving.value = true
  try {
    const url = editingId.value ? `/api/products/${editingId.value}` : '/api/products'
    const method = editingId.value ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(form.value)
    })
    const data = await res.json()
    if (data.code !== 0) { formError.value = data.message || '操作失败'; return }
    showForm.value = false
    await fetchProducts()
  } catch { formError.value = '网络错误' }
  finally { saving.value = false }
}

async function toggleStatus(p) {
  try {
    const res = await fetch(`/api/products/${p.id}/toggle`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) p.status = data.data.status
  } catch { /* ignore */ }
}

async function removeProduct(p) {
  if (!confirm(`确定删除「${p.name}」？`)) return
  try {
    await fetch(`/api/products/${p.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` }
    })
    await fetchProducts()
  } catch { /* ignore */ }
}

// ============================== 代理端 ==============================
const agentProducts = ref([])
const agentLoading = ref(false)
const editPrices = ref({})            // { [productId]: input value }
const savingPrice = ref({})           // { [productId]: boolean }

// 下级用户
const agentUsers = ref([])
const selectedUserId = ref(null)
const userPrices = ref([])            // 选中用户的各商品定制价
const editUserPrices = ref({})        // { [productId]: input value }
const savingUserPrice = ref({})
const userSearchQuery = ref('')

const selectedUser = computed(() => agentUsers.value.find(u => u.id === selectedUserId.value))

const filteredAgentUsers = computed(() => {
  const q = userSearchQuery.value.trim().toLowerCase()
  if (!q) return agentUsers.value
  return agentUsers.value.filter(u =>
    (u.username || '').toLowerCase().includes(q) ||
    (u.nickname || '').toLowerCase().includes(q) ||
    (u.real_name || '').toLowerCase().includes(q) ||
    String(u.id).includes(q)
  )
})

async function fetchAgentPrices() {
  agentLoading.value = true
  try {
    const res = await fetch('/api/agent/prices', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      agentProducts.value = data.data
      // 初始化编辑值
      const ep = {}
      for (const p of data.data) {
        ep[p.id] = p.sell_price !== null ? p.sell_price : ''
      }
      editPrices.value = ep
    }
  } catch { /* ignore */ }
  finally { agentLoading.value = false }
}

async function fetchAgentUsers() {
  try {
    const res = await fetch('/api/agent/users', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) agentUsers.value = data.data
  } catch { /* ignore */ }
}

const priceError = ref({})

async function saveAgentPrice(productId) {
  priceError.value = { ...priceError.value, [productId]: '' }
  const val = editPrices.value[productId]
  const price = parseFloat(val)
  if (isNaN(price) || price <= 0) {
    priceError.value = { ...priceError.value, [productId]: '请输入有效价格' }
    return
  }
  const product = agentProducts.value.find(p => p.id === productId)
  if (product && price < product.base_price) {
    priceError.value = { ...priceError.value, [productId]: `不能低于底价 ¥${product.base_price.toFixed(4)}` }
    return
  }

  savingPrice.value = { ...savingPrice.value, [productId]: true }
  try {
    const res = await fetch(`/api/agent/prices/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ sell_price: price })
    })
    const data = await res.json()
    if (data.code === 0) {
      await fetchAgentPrices()
    } else {
      priceError.value = { ...priceError.value, [productId]: data.message || '设置失败' }
    }
  } catch { priceError.value = { ...priceError.value, [productId]: '网络错误' } }
  finally { savingPrice.value = { ...savingPrice.value, [productId]: false } }
}

async function resetAgentPrice(productId) {
  savingPrice.value = { ...savingPrice.value, [productId]: true }
  try {
    await fetch(`/api/agent/prices/${productId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` }
    })
    await fetchAgentPrices()
  } catch { /* ignore */ }
  finally { savingPrice.value = { ...savingPrice.value, [productId]: false } }
}

// 加载用户定制价
async function loadUserPrices() {
  if (!selectedUserId.value) { userPrices.value = []; return }
  try {
    const res = await fetch('/api/agent/user-prices', {
      headers: { Authorization: `Bearer ${getToken()}` }
    })
    const data = await res.json()
    if (data.code === 0) {
      // 只取选中用户的
      userPrices.value = data.data.filter(r => r.user_id === selectedUserId.value)
      // 初始化编辑值
      const ep = {}
      for (const p of agentProducts.value) {
        const up = userPrices.value.find(r => r.product_id === p.id)
        ep[p.id] = up ? parseFloat(up.sell_price) : ''
      }
      editUserPrices.value = ep
    }
  } catch { /* ignore */ }
}

function selectUser(uid) {
  selectedUserId.value = uid
  transferAmount.value = ''
  transferError.value = ''
  transferMsg.value = ''
  loadUserPrices()
}

const userPriceError = ref({})

async function saveUserPrice(productId) {
  userPriceError.value = { ...userPriceError.value, [productId]: '' }
  const val = editUserPrices.value[productId]
  const price = parseFloat(val)
  if (isNaN(price) || price <= 0) {
    userPriceError.value = { ...userPriceError.value, [productId]: '请输入有效价格' }
    return
  }
  const product = agentProducts.value.find(p => p.id === productId)
  if (product && price < product.base_price) {
    userPriceError.value = { ...userPriceError.value, [productId]: `不能低于底价 ¥${product.base_price.toFixed(4)}` }
    return
  }

  savingUserPrice.value = { ...savingUserPrice.value, [productId]: true }
  try {
    const res = await fetch(`/api/agent/user-prices/${selectedUserId.value}/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ sell_price: price })
    })
    const data = await res.json()
    if (data.code === 0) {
      await loadUserPrices()
    } else {
      userPriceError.value = { ...userPriceError.value, [productId]: data.message || '设置失败' }
    }
  } catch { userPriceError.value = { ...userPriceError.value, [productId]: '网络错误' } }
  finally { savingUserPrice.value = { ...savingUserPrice.value, [productId]: false } }
}

async function resetUserPrice(productId) {
  savingUserPrice.value = { ...savingUserPrice.value, [productId]: true }
  try {
    await fetch(`/api/agent/user-prices/${selectedUserId.value}/${productId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` }
    })
    await loadUserPrices()
  } catch { /* ignore */ }
  finally { savingUserPrice.value = { ...savingUserPrice.value, [productId]: false } }
}

function userPriceOf(productId) {
  const up = userPrices.value.find(r => r.product_id === productId)
  return up ? parseFloat(up.sell_price) : null
}

// ============================== 余额划款 ==============================
const transferAmount = ref('')
const transferring = ref(false)
const transferError = ref('')
const transferMsg = ref('')

async function doTransfer() {
  transferError.value = ''
  transferMsg.value = ''
  const amount = Math.round((parseFloat(transferAmount.value) || 0) * 100) / 100
  if (!selectedUserId.value) { transferError.value = '请先选择下级用户'; return }
  if ((balance.value || 0) <= 0) { transferError.value = '余额为 0，无法划款'; return }
  if (!amount || amount <= 0) { transferError.value = '请输入有效的划款金额'; return }
  if (amount > balance.value) { transferError.value = `划款金额不能超过可用余额 ¥${balance.value.toFixed(2)}`; return }

  transferring.value = true
  try {
    const res = await fetch('/api/agent/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ user_id: selectedUserId.value, amount })
    })
    const data = await res.json()
    if (data.code === 0) {
      transferMsg.value = data.message || '划款成功'
      transferAmount.value = ''
      if (fetchBalance) await fetchBalance()
    } else {
      transferError.value = data.message || '划款失败'
    }
  } catch { transferError.value = '网络错误' }
  finally { transferring.value = false }
}

// ============================== 生命周期 ==============================
onMounted(() => {
  if (isAdmin.value) {
    fetchProducts()
  }
  if (isAgent.value || isAdmin.value) {
    fetchAgentPrices()
    fetchAgentUsers()
  }
})
</script>

<template>
  <section class="product-page">

    <!-- ============ 管理端：商品 CRUD（已迁移到独立项目） ============ -->
    <template v-if="false">
      <div class="page-header">
        <div>
          <h1>商品管理</h1>
          <p>管理上架商品与底价</p>
        </div>
        <button class="btn-add" @click="openAdd">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新增商品
        </button>
      </div>

      <div v-if="loading" class="page-loading"><div class="spin"></div>加载中...</div>
      <div v-else-if="products.length === 0" class="page-empty">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#d0d7e2" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        <p>暂无商品</p>
        <button class="btn-add small" @click="openAdd">创建第一个商品</button>
      </div>

      <template v-else>
        <div v-for="[type, items] in groupedProducts" :key="type" class="cat-section">
          <div class="cat-head">
            <span class="cat-icon" :style="{ background: items[0]?.color || '#8b7bf7' }">
              {{ items[0]?.icon || typeLabel(type)[0] }}
            </span>
            <h2>{{ typeLabel(type) }}</h2>
            <span class="cat-count">{{ items.length }} 个商品</span>
          </div>
          <div v-for="p in items" :key="p.id" class="cat-row" :class="{ off: p.status === 'off' }">
            <div class="cat-row-info">
              <span class="cat-row-name">{{ p.name }}</span>
              <span class="cat-badge" :class="p.status">{{ p.status === 'on' ? '上架中' : '已下架' }}</span>
            </div>
            <div class="cat-row-meta">
              <div class="cat-meta-item"><label>底价</label><strong class="price">¥{{ Number(p.unit_price).toFixed(4) }}</strong></div>
              <div class="cat-meta-item"><label>范围</label><span>{{ p.min_quantity }} ~ {{ p.max_quantity }}</span></div>
              <div class="cat-meta-item"><label>步进</label><span>{{ p.step_quantity }}</span></div>
              <div class="cat-meta-item"><label>排序</label><span>{{ p.sort_order }}</span></div>
              <div class="cat-meta-item">
                <label>上游接口</label>
                <span v-if="p.api_endpoint" class="api-on">{{ p.api_endpoint }}</span>
                <span v-else class="api-off">未配置</span>
              </div>
            </div>
            <div class="cat-row-actions">
              <button class="act-btn toggle" :class="p.status" @click="toggleStatus(p)">
                <svg v-if="p.status==='on'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18.36 6.64A9 9 0 0 1 12 21a9 9 0 0 1-6.36-2.64"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                {{ p.status === 'on' ? '下架' : '上架' }}
              </button>
              <button class="act-btn edit" @click="openEdit(p)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                编辑
              </button>
              <button class="act-btn delete" @click="removeProduct(p)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                删除
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 新增/编辑弹窗 -->
      <Transition name="modal-fade">
        <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
          <div class="modal-dialog">
            <div class="modal-header">
              <div class="modal-header-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
              </div>
              <h2>{{ formTitle }}</h2>
              <button class="modal-close" @click="showForm = false">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="form-row">
                <label>商品名称 <em>*</em></label>
                <input v-model="form.name" placeholder="如：小红书阅读" />
              </div>
              <div class="form-row-2col">
                <div class="form-row">
                  <label>任务类型 <em>*</em></label>
                  <select v-model="form.target_type">
                    <option value="" disabled>请选择类型</option>
                    <option v-for="t in allTypeOptions" :key="t.key" :value="t.key">{{ t.label }}</option>
                  </select>
                </div>
                <div class="form-row">
                  <label>底价 (元) <em>*</em></label>
                  <input v-model.number="form.unit_price" type="number" min="0" step="0.001" />
                </div>
              </div>
              <div class="form-row-3col">
                <div class="form-row"><label>最小下单量</label><input v-model.number="form.min_quantity" type="number" min="1" /></div>
                <div class="form-row"><label>最大下单量</label><input v-model.number="form.max_quantity" type="number" min="1" /></div>
                <div class="form-row"><label>步进量</label><input v-model.number="form.step_quantity" type="number" min="1" /></div>
              </div>
              <div class="form-row">
                <label>上游接口</label>
                <input v-model="form.api_endpoint" placeholder="如 /api/v2/note_views（留空则不参与批量下单）" />
                <span class="form-hint">配置后该商品可在批量下单中使用</span>
              </div>
              <div class="form-row"><label>商品描述</label><textarea v-model="form.description" rows="2" placeholder="可选"></textarea></div>
              <div class="form-row-2col">
                <div class="form-row"><label>图标文字</label><input v-model="form.icon" maxlength="2" placeholder="1~2个字" /></div>
                <div class="form-row"><label>排序</label><input v-model.number="form.sort_order" type="number" /></div>
              </div>
              <div class="form-row">
                <label>图标颜色</label>
                <div class="color-pick">
                  <button v-for="c in colorOptions" :key="c" type="button" class="color-dot" :class="{ active: form.color === c }" :style="{ background: c }" @click="form.color = c"></button>
                  <input v-model="form.color" class="color-input" placeholder="#HEX" />
                </div>
              </div>
              <div class="form-row">
                <label>状态</label>
                <div class="status-switch">
                  <button type="button" :class="{ active: form.status === 'on' }" @click="form.status = 'on'">上架</button>
                  <button type="button" :class="{ active: form.status === 'off' }" @click="form.status = 'off'">下架</button>
                </div>
              </div>
              <p v-if="formError" class="form-error">{{ formError }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-cancel" @click="showForm = false">取消</button>
              <button class="btn-submit" :disabled="saving" @click="submitForm">{{ saving ? '保存中...' : '保存' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </template>

    <!-- ============ 代理端：定价管理 ============ -->
    <template v-if="isAgent || isAdmin">
      <div class="page-header">
        <div>
          <h1>{{ isAdmin ? '代理定价预览' : '我的定价' }}</h1>
          <p>设置下级用户看到的售价，售价不能低于底价</p>
        </div>
      </div>

      <div v-if="agentLoading" class="page-loading"><div class="spin"></div>加载中...</div>

      <div v-else class="price-table-wrap">
        <table class="price-table">
          <thead>
            <tr>
              <th>商品</th>
              <th>底价（成本）</th>
              <th>我的售价</th>
              <th>利润/单位</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in agentProducts" :key="p.id" :class="{ off: p.status === 'off' }">
              <td>
                <div class="table-product">
                  <span class="product-icon-sm" :style="{ background: p.color || '#8b7bf7' }">{{ p.icon || p.name[0] }}</span>
                  <span>{{ p.name }}</span>
                </div>
              </td>
              <td class="td-price base">¥{{ p.base_price.toFixed(4) }}</td>
              <td>
                <div class="price-input-group" :class="{ 'has-error': priceError[p.id] }">
                  <span class="price-prefix">¥</span>
                  <input
                    v-model="editPrices[p.id]"
                    type="number"
                    :min="p.base_price"
                    step="0.001"
                    :placeholder="p.base_price.toFixed(4)"
                    class="price-input"
                    @input="priceError[p.id] = ''"
                  />
                </div>
                <div v-if="priceError[p.id]" class="price-error">{{ priceError[p.id] }}</div>
              </td>
              <td class="td-price profit">
                <template v-if="p.sell_price !== null && p.sell_price >= p.base_price">
                  +¥{{ (p.sell_price - p.base_price).toFixed(4) }}
                </template>
                <span v-else-if="p.sell_price !== null && p.sell_price < p.base_price" class="price-warn">低于底价!</span>
                <span v-else class="muted">未设置</span>
              </td>
              <td>
                <div class="table-actions">
                  <button
                    class="btn-sm save"
                    :disabled="savingPrice[p.id]"
                    @click="saveAgentPrice(p.id)"
                  >保存</button>
                  <button
                    v-if="p.sell_price !== null"
                    class="btn-sm reset"
                    :disabled="savingPrice[p.id]"
                    @click="resetAgentPrice(p.id)"
                  >恢复底价</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 单用户定价 -->
      <div class="page-header" style="margin-top: 32px;">
        <div>
          <h1>用户专属价格</h1>
          <p>为特定下级用户设置专属价格，优先于默认售价</p>
        </div>
      </div>

      <div v-if="agentUsers.length === 0" class="page-empty small">
        <p>暂无下级用户</p>
      </div>

      <template v-else>
        <div class="user-picker-card">
          <div class="user-picker-header">
            <div class="user-picker-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                v-model="userSearchQuery"
                type="text"
                class="user-search-input"
                placeholder="搜索用户名 / 昵称 / ID..."
              />
            </div>
            <span class="user-search-count">{{ filteredAgentUsers.length }} / {{ agentUsers.length }} 人</span>
          </div>
          <div class="user-chips-area">
            <button
              v-for="u in filteredAgentUsers" :key="u.id"
              type="button"
              :class="['user-chip', { active: selectedUserId === u.id }]"
              @click="selectUser(u.id)"
            >
              <span class="chip-avatar">{{ (u.nickname || u.username || '?')[0] }}</span>
              {{ u.nickname || u.username }}
            </button>
            <div v-if="filteredAgentUsers.length === 0 && userSearchQuery" class="user-search-empty">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#c8cfd8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <span>未找到匹配的用户</span>
            </div>
          </div>
        </div>

        <!-- 余额划款 -->
        <div v-if="selectedUserId" class="transfer-card">
          <div class="transfer-head">
            <div class="transfer-title">
              <h3>余额划款给 {{ selectedUser?.nickname || selectedUser?.username }}</h3>
              <p>从你的余额划入该下级，金额不能超过可用余额；余额为 0 时不可划款</p>
            </div>
            <div class="transfer-balance">
              <span>我的可用余额</span>
              <strong>¥{{ (balance || 0).toFixed(2) }}</strong>
            </div>
          </div>
          <div class="transfer-form">
            <div class="price-input-group" :class="{ 'has-error': transferError }">
              <span class="price-prefix">¥</span>
              <input
                v-model="transferAmount"
                type="number"
                min="0"
                step="0.01"
                :max="balance"
                placeholder="划款金额"
                class="price-input"
                :disabled="(balance || 0) <= 0"
                @input="transferError = ''"
              />
            </div>
            <button
              class="btn-transfer"
              :disabled="transferring || (balance || 0) <= 0"
              @click="doTransfer"
            >{{ transferring ? '划款中...' : '确认划款' }}</button>
          </div>
          <div v-if="transferError" class="price-error">{{ transferError }}</div>
          <div v-else-if="transferMsg" class="transfer-success">{{ transferMsg }}</div>
          <div v-else-if="(balance || 0) <= 0" class="transfer-hint">当前余额为 0，无法划款。可通过下级下单分润或充值获得余额。</div>
        </div>

        <div v-if="selectedUserId" class="price-table-wrap">
          <table class="price-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>底价</th>
                <th>默认售价</th>
                <th>用户专属价</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in agentProducts" :key="p.id">
                <td>
                  <div class="table-product">
                    <span class="product-icon-sm" :style="{ background: p.color || '#8b7bf7' }">{{ p.icon || p.name[0] }}</span>
                    <span>{{ p.name }}</span>
                  </div>
                </td>
                <td class="td-price base">¥{{ p.base_price.toFixed(4) }}</td>
                <td class="td-price">¥{{ p.effective_price.toFixed(4) }}</td>
                <td>
                  <div class="price-input-group" :class="{ 'has-error': userPriceError[p.id] }">
                    <span class="price-prefix">¥</span>
                    <input
                      v-model="editUserPrices[p.id]"
                      type="number"
                      :min="p.base_price"
                      step="0.001"
                      :placeholder="p.effective_price.toFixed(4)"
                      class="price-input"
                      @input="userPriceError[p.id] = ''"
                    />
                  </div>
                  <div v-if="userPriceError[p.id]" class="price-error">{{ userPriceError[p.id] }}</div>
                </td>
                <td>
                  <div class="table-actions">
                    <button
                      class="btn-sm save"
                      :disabled="savingUserPrice[p.id]"
                      @click="saveUserPrice(p.id)"
                    >保存</button>
                    <button
                      v-if="userPriceOf(p.id) !== null"
                      class="btn-sm reset"
                      :disabled="savingUserPrice[p.id]"
                      @click="resetUserPrice(p.id)"
                    >恢复默认</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.product-page {
  padding: 18px 28px 28px;
  max-width: 100%;
  overflow-x: clip;
}

/* ========== 头部 ========== */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-header h1 { font-size: 22px; color: #152033; }
.page-header p { color: #9aa5b5; font-size: 14px; margin-top: 4px; }

.section-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, #e3e8f0 20%, #e3e8f0 80%, transparent);
  margin: 36px 0 28px;
}

.btn-add {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px; border-radius: 12px;
  background: #2f6df6;
  color: #fff; font-weight: 700; font-size: 14px; border: none; cursor: pointer;
  box-shadow: 0 8px 20px rgba(139,123,247,.22);
  transition: transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 200ms ease;
}
.btn-add:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(139,123,247,.3); }
.btn-add:active { transform: scale(.97); }
.btn-add.small { padding: 8px 18px; font-size: 13px; margin-top: 12px; }

/* ========== 加载 & 空 ========== */
.page-loading {
  display: flex; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 0; color: #9aa5b5;
}
.spin {
  width: 24px; height: 24px; border: 3px solid #edf1f6;
  border-top-color: #8b7bf7; border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.page-empty {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 60px 0; color: #9aa5b5;
}
.page-empty.small { padding: 30px 0; }
.page-empty p { font-size: 15px; color: #647184; }

/* ========== 分类商品列表 ========== */
.cat-section {
  background: #fff; border-radius: 16px; border: 1px solid #edf1f6;
  box-shadow: 0 4px 18px rgba(21,32,51,.05); margin-bottom: 18px; overflow: hidden;
}
.cat-head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 22px;
  background: linear-gradient(135deg, rgba(139,123,247,.06), rgba(91,141,239,.06));
  border-bottom: 1px solid #edf1f6;
}
.cat-head h2 { font-size: 16px; color: #152033; margin: 0; font-weight: 800; }
.cat-count {
  font-size: 12px; color: #9aa5b5; background: #f4f7fb;
  padding: 3px 10px; border-radius: 20px; font-weight: 500; margin-left: auto;
}
.cat-icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: grid; place-items: center;
  color: #fff; font-size: 15px; font-weight: 900; flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
}
.cat-row {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 22px; border-bottom: 1px solid #f4f7fb;
  transition: background .15s;
}
.cat-row:last-child { border-bottom: none; }
.cat-row:hover { background: #fbfcff; }
.cat-row.off { opacity: .55; }
.cat-row.off:hover { opacity: .75; }
.cat-row-info { display: flex; align-items: center; gap: 10px; min-width: 150px; }
.cat-row-name { font-size: 14px; font-weight: 700; color: #152033; white-space: nowrap; }
.cat-badge {
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap;
}
.cat-badge.on { background: #e8faf0; color: #2fb86e; }
.cat-badge.off { background: #f4f5f7; color: #9aa5b5; }
.cat-row-meta { flex: 1; display: flex; gap: 24px; flex-wrap: wrap; }
.cat-meta-item label { display: block; font-size: 11px; color: #9aa5b5; margin-bottom: 1px; }
.cat-meta-item span, .cat-meta-item strong { font-size: 13px; color: #425066; font-weight: 700; }
.cat-meta-item .price { color: #ee4d7a; font-size: 14px; }
.cat-row-actions { display: flex; gap: 8px; flex-shrink: 0; }
.act-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 7px 14px; border-radius: 8px; font-size: 12px; font-weight: 600;
  border: none; cursor: pointer; transition: all 180ms cubic-bezier(.22,1,.36,1);
  white-space: nowrap; line-height: 1;
}
.act-btn svg { flex-shrink: 0; }
.act-btn.toggle.on { background: #fff7e6; color: #d48806; }
.act-btn.toggle.on:hover { background: #fff0d4; box-shadow: 0 2px 8px rgba(245,166,35,.18); }
.act-btn.toggle.off { background: #e8faf0; color: #1a9d4f; }
.act-btn.toggle.off:hover { background: #d4f5e4; box-shadow: 0 2px 8px rgba(42,201,110,.18); }
.act-btn.edit { background: #f3f0ff; color: #7c6ad6; }
.act-btn.edit:hover { background: #ece8ff; box-shadow: 0 2px 8px rgba(139,123,247,.18); }
.act-btn.delete { background: #fef2f2; color: #dc4446; }
.act-btn.delete:hover { background: #fee2e2; box-shadow: 0 2px 8px rgba(255,107,107,.18); }
.act-btn:active { transform: scale(.95); }

.api-on {
  color: #2fb86e !important; font-size: 12px !important; font-weight: 600 !important;
  background: #e8faf0; padding: 2px 8px; border-radius: 6px;
  font-family: 'SF Mono', 'Consolas', monospace;
}
.api-off { color: #c8cfd8 !important; font-weight: 400 !important; }
.form-hint {
  display: block; font-size: 11px; color: #9aa5b5; margin-top: 4px;
}

/* ========== 代理定价表格 ========== */
.price-table-wrap {
  border-radius: 16px; background: #fff; border: 1px solid #edf1f6;
  box-shadow: 0 4px 18px rgba(21,32,51,.05);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.price-table {
  width: 100%; border-collapse: collapse; font-size: 14px;
}
.price-table th {
  text-align: left; padding: 14px 18px; font-size: 12px; font-weight: 700;
  color: #9aa5b5; background: #f8faff; border-bottom: 1px solid #edf1f6;
  white-space: nowrap;
}
.price-table td {
  padding: 14px 18px; border-bottom: 1px solid #f4f7fb;
  vertical-align: middle;
}
.price-table tr:last-child td { border-bottom: none; }
.price-table tr.off { opacity: .5; }
.price-table tr:hover { background: #fbfcff; }

.table-product {
  display: flex; align-items: center; gap: 10px; font-weight: 700; color: #152033;
  white-space: nowrap;
}
.product-icon-sm {
  width: 32px; height: 32px; border-radius: 9px;
  display: grid; place-items: center;
  color: #fff; font-size: 13px; font-weight: 900; flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0,0,0,.1);
}

.td-price { font-weight: 700; white-space: nowrap; }
.td-price.base { color: #9aa5b5; }
.td-price.profit { color: #42c978; }
.muted { color: #c8cfd8; font-weight: 400; }

.price-input-group {
  display: flex; align-items: center; gap: 4px;
  border: 1.5px solid #e3e8f0; border-radius: 8px;
  background: #fbfcff; padding: 0 10px;
  transition: border-color 200ms ease;
  max-width: 160px;
}
.price-input-group:focus-within { border-color: #8b7bf7; box-shadow: 0 0 0 3px rgba(139,123,247,.1); }
.price-prefix { color: #9aa5b5; font-size: 13px; font-weight: 700; }
.price-input {
  border: none; background: transparent; outline: none;
  padding: 8px 4px; font-size: 14px; color: #152033;
  width: 100px; font-weight: 700;
}
.price-input::-webkit-inner-spin-button { opacity: 0.3; }

.price-input-group.has-error { border-color: #ff6b6b; box-shadow: 0 0 0 3px rgba(255,107,107,.1); }
.price-error { font-size: 11px; color: #ee4d7a; margin-top: 4px; font-weight: 600; }
.price-warn { color: #ee4d7a !important; font-weight: 700 !important; font-size: 12px; }

.table-actions { display: flex; gap: 6px; white-space: nowrap; }
.btn-sm {
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700;
  border: none; cursor: pointer; transition: all 160ms ease;
}
.btn-sm.save {
  background: #2f6df6; color: #fff;
  box-shadow: 0 4px 12px rgba(139,123,247,.18);
}
.btn-sm.save:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(139,123,247,.28); }
.btn-sm.save:disabled { opacity: .5; pointer-events: none; }
.btn-sm.reset {
  background: #f4f7fb; color: #647184; border: 1px solid #e3e8f0;
}
.btn-sm.reset:hover { background: #edf1f6; color: #425066; }
.btn-sm.reset:disabled { opacity: .5; pointer-events: none; }

/* ========== 余额划款 ========== */
.transfer-card {
  margin-bottom: 18px;
  padding: 18px 20px;
  border: 1px solid #e6ecf5;
  border-radius: 12px;
  background: linear-gradient(135deg, #fbfcff, #f7faff);
}
.transfer-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  margin-bottom: 14px;
}
.transfer-title h3 { font-size: 16px; font-weight: 800; color: #152033; margin: 0 0 4px; }
.transfer-title p { font-size: 12px; color: #8a95a8; margin: 0; line-height: 1.6; }
.transfer-balance { flex-shrink: 0; text-align: right; }
.transfer-balance span { display: block; font-size: 12px; color: #8a95a8; }
.transfer-balance strong { display: block; margin-top: 3px; font-size: 22px; color: #ee4d7a; font-variant-numeric: tabular-nums; }
.transfer-form { display: flex; gap: 10px; align-items: stretch; }
.transfer-form .price-input-group { flex: 1; }
.btn-transfer {
  flex-shrink: 0; min-width: 110px; padding: 0 22px;
  border-radius: 8px; border: none; cursor: pointer;
  color: #fff; font-size: 14px; font-weight: 800;
  background: #2f6df6;
  box-shadow: 0 8px 18px rgba(47, 109, 246, 0.24);
  transition: transform 200ms ease, box-shadow 200ms ease, background 200ms ease;
}
.btn-transfer:hover:not(:disabled) { transform: translateY(-1px); filter: saturate(1.08); }
.btn-transfer:active:not(:disabled) { transform: scale(.97); }
.btn-transfer:disabled { opacity: .5; cursor: not-allowed; }
.transfer-success { margin-top: 8px; font-size: 13px; font-weight: 700; color: #18b66e; }
.transfer-hint { margin-top: 8px; font-size: 12px; color: #b96b00; }

/* ========== 用户选择卡片 ========== */
.user-picker-card {
  background: #fff; border-radius: 16px; border: 1px solid #edf1f6;
  box-shadow: 0 4px 18px rgba(21,32,51,.05); margin-bottom: 20px;
  overflow: hidden;
}
.user-picker-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 20px;
  background: linear-gradient(135deg, rgba(139,123,247,.06), rgba(91,141,239,.06));
  border-bottom: 1px solid #edf1f6;
}
.user-picker-title {
  flex: 1; display: flex; align-items: center; gap: 8px;
  color: #9aa5b5;
}
.user-search-input {
  flex: 1; border: none; background: transparent; outline: none;
  font-size: 14px; color: #152033; font-weight: 500;
}
.user-search-input::placeholder { color: #c0c8d4; font-weight: 400; }
.user-search-count {
  font-size: 12px; color: #9aa5b5; font-weight: 600;
  background: #f4f7fb; padding: 4px 12px; border-radius: 20px;
  white-space: nowrap; flex-shrink: 0;
}
.user-chips-area {
  display: flex; gap: 10px; flex-wrap: wrap;
  padding: 16px 20px;
  max-height: 220px; overflow-y: auto;
}
.user-chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px 8px 8px; border-radius: 12px;
  border: 1.5px solid #edf1f6; background: #f8faff;
  font-size: 13px; font-weight: 600; color: #647184;
  cursor: pointer; transition: all 200ms cubic-bezier(.22,1,.36,1);
}
.user-chip:hover {
  border-color: #c4bbf7; background: #f3f0ff; color: #7c6ad6;
  transform: translateY(-1px); box-shadow: 0 4px 12px rgba(139,123,247,.1);
}
.user-chip.active {
  border-color: #8b7bf7; background: linear-gradient(135deg, #f3f0ff, #eef0ff); color: #7c6ad6;
  box-shadow: 0 4px 14px rgba(139,123,247,.15);
}
.chip-avatar {
  width: 26px; height: 26px; border-radius: 8px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff; display: grid; place-items: center;
  font-size: 11px; font-weight: 900;
}
.user-chip.active .chip-avatar {
  box-shadow: 0 2px 8px rgba(139,123,247,.3);
}
.user-search-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  width: 100%; padding: 24px 0;
  color: #c0c8d4; font-size: 13px;
}

/* ========== 弹窗 ========== */
.modal-mask {
  position: fixed; inset: 0; z-index: 30;
  display: flex; align-items: center; justify-content: center;
  background: rgba(21,32,51,.42); backdrop-filter: blur(8px);
}
.modal-dialog {
  width: min(540px, 94vw); max-height: 88vh; border-radius: 20px;
  background: #fff; box-shadow: 0 32px 80px rgba(21,32,51,.28);
  display: flex; flex-direction: column; overflow: hidden;
}
.modal-header {
  display: flex; align-items: center; gap: 12px;
  padding: 22px 24px 16px; border-bottom: 1px solid #edf1f6;
}
.modal-header-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #8b7bf7, #5b8def);
  color: #fff; display: grid; place-items: center; flex-shrink: 0;
  box-shadow: 0 6px 16px rgba(139,123,247,.25);
}
.modal-header h2 { flex: 1; font-size: 17px; color: #152033; margin: 0; }
.modal-close {
  width: 34px; height: 34px; border-radius: 10px;
  color: #9aa5b5; background: #f4f7fb; display: grid; place-items: center;
  border: none; cursor: pointer; transition: all 160ms ease;
}
.modal-close:hover { color: #ee4d7a; background: #fff1f5; transform: rotate(90deg); }

.modal-body {
  flex: 1; overflow-y: auto; padding: 20px 24px;
  display: flex; flex-direction: column; gap: 16px;
}
.form-row label {
  display: block; font-size: 13px; font-weight: 700;
  color: #425066; margin-bottom: 6px;
}
.form-row label em { color: #ee4d7a; font-style: normal; }
.form-row input, .form-row select, .form-row textarea {
  width: 100%; box-sizing: border-box;
  padding: 10px 14px; border-radius: 10px;
  border: 1.5px solid #e3e8f0; background: #fbfcff;
  font-size: 14px; color: #152033; outline: none;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}
.form-row input:focus, .form-row select:focus, .form-row textarea:focus {
  border-color: #8b7bf7; box-shadow: 0 0 0 3px rgba(139,123,247,.1);
}
.form-row textarea { resize: vertical; }
.form-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-row-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }

.color-pick { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.color-dot {
  width: 28px; height: 28px; border-radius: 8px; border: 2px solid transparent;
  cursor: pointer; transition: transform 160ms ease, border-color 160ms ease;
}
.color-dot:hover { transform: scale(1.1); }
.color-dot.active { border-color: #152033; transform: scale(1.15); }
.color-input { width: 80px !important; padding: 6px 10px !important; font-size: 12px !important; }

.status-switch { display: flex; gap: 8px; }
.status-switch button {
  flex: 1; padding: 8px 0; border-radius: 8px;
  border: 1.5px solid #e3e8f0; background: #fbfcff;
  font-size: 13px; font-weight: 700; color: #647184;
  cursor: pointer; transition: all 160ms ease;
}
.status-switch button.active { border-color: #8b7bf7; background: #f3f0ff; color: #8b7bf7; }

.form-error {
  color: #ee4d7a; font-size: 13px; margin: 0;
  padding: 8px 12px; border-radius: 8px; background: #fff1f5;
}

.modal-footer {
  display: flex; gap: 10px; padding: 16px 24px 20px;
  border-top: 1px solid #edf1f6;
}
.btn-cancel {
  flex: 1; padding: 11px 0; border-radius: 12px;
  border: 1.5px solid #e3e8f0; background: #fff;
  color: #647184; font-weight: 700; font-size: 14px;
  cursor: pointer; transition: all 160ms ease;
}
.btn-cancel:hover { background: #f8faff; color: #8b7bf7; border-color: #d8d0fd; }
.btn-submit {
  flex: 1.5; padding: 11px 0; border-radius: 12px;
  background: #2f6df6; border: none;
  color: #fff; font-weight: 700; font-size: 14px;
  cursor: pointer; box-shadow: 0 8px 20px rgba(47, 109, 246, 0.22);
  transition: transform 200ms cubic-bezier(.22,1,.36,1), box-shadow 200ms ease, background 200ms ease;
}
.btn-submit:hover { transform: translateY(-1px); background: #2558d4; box-shadow: 0 12px 28px rgba(47, 109, 246, 0.28); }
.btn-submit:active { transform: scale(.98); }
.btn-submit:disabled { opacity: .6; pointer-events: none; }

/* ========== 动画 ========== */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 220ms ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-dialog, .modal-fade-leave-active .modal-dialog {
  transition: transform 280ms cubic-bezier(.22,1,.36,1), opacity 220ms ease;
}
.modal-fade-enter-from .modal-dialog, .modal-fade-leave-to .modal-dialog {
  transform: scale(.92) translateY(18px); opacity: 0;
}

/* ========== 响应式 ========== */
@media (max-width: 760px) {
  .product-page { padding: 12px; }
  .page-header { flex-direction: column; align-items: flex-start; gap: 12px; }
  .cat-row { flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px 16px; }
  .cat-row-info { min-width: 0; }
  .cat-row-meta { gap: 12px; }
  .cat-row-actions { width: 100%; }
  .cat-row-actions .act-btn { flex: 1; justify-content: center; }
  .cat-head { padding: 14px 16px; }
  .form-row-2col, .form-row-3col { grid-template-columns: 1fr; }
  .modal-dialog { max-height: calc(100vh - 24px); border-radius: 20px 20px 0 0; align-self: flex-end; }
  .price-table-wrap {
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  .price-table { min-width: 620px; }
  .price-table th, .price-table td { padding: 10px 12px; font-size: 13px; }
  .price-input { width: 80px; }
  .user-picker-header { flex-wrap: wrap; padding: 12px 14px; }
  .user-chips-area { padding: 12px 14px; gap: 8px; max-height: 180px; }
  .user-chip { padding: 6px 12px 6px 6px; font-size: 12px; }
}
</style>
