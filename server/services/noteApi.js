import config from '../config/index.js'

const { baseUrl, timeout, concurrency, proxyLine } = config.noteApi

// ========== 基础请求 ==========

/**
 * 带超时 + 自动重试的 GET 请求
 * ECONNRESET / ECONNREFUSED / ETIMEDOUT 等网络错误自动重试
 */
async function get(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        keepalive: false
      })
      return await res.json()
    } catch (err) {
      const isNetErr = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'fetch failed']
        .some(k => (err.message || '').includes(k) || (err.cause?.code || '').includes(k))
      if (isNetErr && i < retries) {
        await new Promise(r => setTimeout(r, 800 * (i + 1)))
        continue
      }
      throw err
    }
  }
}

// ========== 单条查询 ==========

/**
 * 解析小红书链接 → note_id
 * @param {string} noteUrl — 笔记链接 (支持短链)
 * @returns {Promise<string>} note_id，失败返回 ''
 */
export async function fetchNoteId(noteUrl) {
  try {
    const body = await get(`${baseUrl}/id?url=${encodeURIComponent(noteUrl)}`)
    if (body.code === 0 && body.data?.note_id) {
      return body.data.note_id
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * 获取笔记基础信息（标题、作者）
 * @param {string} noteId
 * @returns {Promise<{title:string, author_id:string, author_name:string, avatar_url:string}|null>}
 */
export async function fetchNoteBasic(noteId) {
  try {
    const body = await get(`${baseUrl}/basic?note_id=${noteId}&proxy_line=${proxyLine}`)
    if (body.code === 0 && body.data?.base_info) {
      const info = body.data.base_info
      return {
        title: info.title || '',
        author_id: info.user?.id || '',
        author_name: info.user?.name || '',
        avatar_url: info.user?.image || ''
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 获取笔记实时阅读数
 * @param {string} noteId
 * @returns {Promise<{view_count:number|null, payload:object|null}>}
 */
export async function fetchNoteViewCount(noteId) {
  try {
    const body = await get(`${baseUrl}/realtime?note_id=${noteId}&proxy_line=${proxyLine}`)
    if (body.code === 0 && body.data?.realTime) {
      return {
        view_count: body.data.realTime.viewNum ?? null,
        payload: body.data
      }
    }
    return { view_count: null, payload: null }
  } catch {
    return { view_count: null, payload: null }
  }
}

/**
 * 获取笔记点赞数
 * @param {string} noteId
 * @returns {Promise<{like_count:number|null, payload:object|null}>}
 */
export async function fetchNoteLikeCount(noteId) {
  try {
    const body = await get(`${baseUrl}/likes?note_id=${noteId}&proxy_line=${proxyLine}`)
    if (body.code === 0 && body.data) {
      return {
        like_count: body.data.likes_num ?? null,
        payload: body.data
      }
    }
    return { like_count: null, payload: null }
  } catch {
    return { like_count: null, payload: null }
  }
}

// ========== 完整快照（单条） ==========

/**
 * 获取单条笔记的完整快照信息
 * 会依次调用：解析 note_id → 基础信息 → 计数（根据 targetType）
 *
 * @param {string} noteUrl — 笔记链接
 * @param {string} targetType — 'read'|'like'|'impression'
 * @returns {Promise<NoteSnapshot>}
 *
 * @typedef {object} NoteSnapshot
 * @property {string}      note_id
 * @property {string}      title
 * @property {string}      author_id
 * @property {string}      author_name
 * @property {string}      avatar_url
 * @property {number|null} like_count
 * @property {number|null} view_count
 * @property {string|null} count_payload — JSON 字符串，截断到 8000 字符
 */
export async function fetchSnapshot(noteUrl, targetType = 'read') {
  const result = {
    note_id: '',
    title: '',
    author_id: '',
    author_name: '',
    avatar_url: '',
    like_count: null,
    view_count: null,
    count_payload: null
  }

  // 1. 解析 note_id
  const noteId = await fetchNoteId(noteUrl)
  if (!noteId) return result
  result.note_id = noteId

  // 2. 基础信息
  const basic = await fetchNoteBasic(noteId)
  if (basic) {
    result.title = basic.title
    result.author_id = basic.author_id
    result.author_name = basic.author_name
    result.avatar_url = basic.avatar_url
  }

  // 3. 计数快照（根据类型）
  if (targetType === 'read' || targetType === 'view') {
    const { view_count, payload } = await fetchNoteViewCount(noteId)
    result.view_count = view_count
    if (payload) result.count_payload = truncJson(payload)
  } else if (targetType === 'like') {
    const { like_count, payload } = await fetchNoteLikeCount(noteId)
    result.like_count = like_count
    if (payload) result.count_payload = truncJson(payload)
  }
  // impression 类型不采集计数

  return result
}

// ========== 批量快照 ==========

/**
 * 批量采集快照，支持并发控制
 *
 * @param {{url:string, [key:string]:any}[]} lines — 每项至少包含 url 字段
 * @param {string} targetType — 'read'|'like'|'impression'
 * @returns {Promise<Map<number, NoteSnapshot>>} — key 为 lines 数组下标
 */
export async function collectSnapshots(lines, targetType = 'read') {
  const results = new Map()
  const batch = concurrency

  for (let i = 0; i < lines.length; i += batch) {
    const chunk = lines.slice(i, i + batch)
    const tasks = chunk.map((line, j) =>
      fetchSnapshot(line.url, targetType).then(snap => {
        results.set(i + j, snap)
      })
    )
    await Promise.all(tasks)
  }

  return results
}

// ========== 工具 ==========

function truncJson(obj, maxLen = 8000) {
  const str = JSON.stringify(obj)
  return str.length > maxLen ? str.slice(0, maxLen) : str
}
