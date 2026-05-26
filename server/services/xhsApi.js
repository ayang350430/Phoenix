import config from '../config/index.js'

/**
 * XHS 上游任务 API 客户端
 * 用于创建任务、查询任务状态、停止任务
 */

const ENDPOINTS = {
  impression: '/api/v2/impression',
  like:       '/api/v2/note_likes',
  view:       '/api/v2/note_views',
  read:       '/api/v2/note_views'   // read 映射到 view
}

function getEndpoint(targetType) {
  const ep = ENDPOINTS[targetType]
  if (!ep) throw new Error(`未知类型: ${targetType}`)
  return ep
}

async function request(method, url, body, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.xhsApi.token}`
        },
        signal: AbortSignal.timeout(config.xhsApi.timeout),
        keepalive: false
      }
      if (body) opts.body = JSON.stringify(body)

      console.log(`[xhsApi] ${method} ${url}`, body ? JSON.stringify(body) : '')
      const res = await fetch(url, opts)
      const json = await res.json()
      console.log(`[xhsApi] 响应 ${res.status}:`, JSON.stringify(json))

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`)
      }
      return json
    } catch (err) {
      const isNetErr = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'fetch failed']
        .some(k => (err.message || '').includes(k) || (err.cause?.code || '').includes(k))
      if (isNetErr && i < retries) {
        console.warn(`[xhsApi] 网络错误, 第${i + 1}次重试: ${err.message}`)
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
        continue
      }
      throw err
    }
  }
}

// ========== 创建任务 ==========

/**
 * 向上游创建一个任务
 * @param {string} targetType — 'read'|'like'|'impression'
 * @param {object} payload — 任务参数
 * @returns {Promise<string>} external_task_id
 */
export async function createTask(targetType, payload, apiEndpoint) {
  const url = `${config.xhsApi.baseUrl}${apiEndpoint || getEndpoint(targetType)}`
  const body = await request('POST', url, payload)

  if (body.success === false || body.code !== 0) {
    throw new Error(`上游创建任务失败: ${JSON.stringify(body)}`)
  }

  const taskId = body.data?.id
  if (!taskId) throw new Error('上游返回无效 task id')
  return String(taskId)
}

// ========== 查询任务状态 ==========

/**
 * 查询上游任务进度
 * @param {string} targetType
 * @param {string} externalTaskId
 * @returns {Promise<{status:number, totalCount:number, currentCount:number}>}
 *   status: 1=运行中  2=已完成
 */
export async function getTaskStatus(targetType, externalTaskId, apiEndpoint) {
  const url = `${config.xhsApi.baseUrl}${apiEndpoint || getEndpoint(targetType)}?id=${externalTaskId}`
  const body = await request('GET', url, null)

  if (body.success === false || body.code === -1) {
    return { status: -1, totalCount: 0, currentCount: 0, failed: true }
  }

  const data = body.data || body
  return {
    status: data.status,                   // 1=running  2=completed
    totalCount: data.total_count || 0,
    currentCount: data.current_count || 0,
    failed: false
  }
}

// ========== 取消任务 ==========

export async function cancelTask(targetType, externalTaskId, apiEndpoint) {
  const url = `${config.xhsApi.baseUrl}${apiEndpoint || getEndpoint(targetType)}?id=${externalTaskId}`
  try {
    const body = await request('DELETE', url, null)
    console.log(`[xhsApi] 取消任务 ${externalTaskId}:`, JSON.stringify(body))
    return { success: true }
  } catch (err) {
    console.warn(`[xhsApi] 取消任务失败 ${externalTaskId}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ========== 构建派单载荷 ==========

/**
 * 根据订单信息构建上游 API 需要的载荷
 */
export function buildTaskPayload(order, noteId, authorId) {
  const base = {
    author_id: authorId,
    note_id: noteId,
    priority: 0,
    reason: `gw:order=${order.order_no}`,
    source: `gw:${order.user_id}`,
    status: 1
  }

  const type = order.target_type

  if (type === 'like') {
    // 点赞：total_count = 目标数 = 下单量 + 当前已有点赞
    base.total_count = order.ordered_quantity + (order.like_count || 0)
    base.need_sync = false
  } else if (type === 'read' || type === 'view') {
    // 阅读/浏览：total_count = 增量
    base.total_count = order.ordered_quantity
    base.app_count = 0
    base.channel = 1
    base.mp_count = 0
    base.web_count = 0
  } else {
    // 曝光
    base.total_count = order.ordered_quantity
  }

  return base
}
