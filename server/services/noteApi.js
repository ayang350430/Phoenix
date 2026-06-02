import config from '../config/index.js'

const { baseUrl, timeout, concurrency } = config.noteApi
const PROXY_LINES = ['line_1070', 'line_1086', 'hailiang_14223']
const RETRIES_PER_LINE = 2

async function get(url) {
  for (let i = 0; i <= RETRIES_PER_LINE; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        keepalive: false
      })
      if (res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
      return await res.json()
    } catch (err) {
      const isRetryable = err.status >= 500 ||
        ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'fetch failed']
          .some(k => (err.message || '').includes(k) || (err.cause?.code || '').includes(k))
      if (isRetryable && i < RETRIES_PER_LINE) {
        await new Promise(r => setTimeout(r, 800 * (i + 1)))
        continue
      }
      throw err
    }
  }
}

async function getWithLineFailover(path) {
  for (let li = 0; li < PROXY_LINES.length; li++) {
    const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}proxy_line=${PROXY_LINES[li]}`
    try {
      return await get(url)
    } catch (err) {
      if (li < PROXY_LINES.length - 1) {
        console.warn(`[noteApi] ${PROXY_LINES[li]} 失败，切换 ${PROXY_LINES[li + 1]}`)
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
    const body = await getWithLineFailover(`/basic?note_id=${noteId}`)
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
 * 获取笔记实时全量数据（阅读、点赞、收藏、评论、分享）
 * 统一使用 /realtime 接口
 * @param {string} noteId
 */
export async function fetchNoteRealtimeCounts(noteId) {
  try {
    const body = await getWithLineFailover(`/realtime?note_id=${noteId}`)
    if (body.code === 0 && body.data?.realTime) {
      const rt = pickRealtimeCounts(body.data.realTime)
      if (rt) return { ...rt, payload: body.data }
    }
    return EMPTY_COUNTS()
  } catch {
    return EMPTY_COUNTS()
  }
}

const EMPTY_COUNTS = () => ({ view_count: null, like_count: null, collect_count: null, comment_count: null, share_count: null, payload: null })

/**
 * 解析 /realtime 的 data.realTime 对象
 * 真实字段：viewNum / likeNum / favNum / cmtNum / shareNum（保留旧字段名作兜底）
 */
function pickRealtimeCounts(rt) {
  if (!rt || typeof rt !== 'object') return null
  return {
    view_count: rt.viewNum ?? rt.view_count ?? null,
    like_count: rt.likeNum ?? rt.likedCount ?? rt.like_count ?? null,
    collect_count: rt.favNum ?? rt.collectCount ?? rt.collect_count ?? null,
    comment_count: rt.cmtNum ?? rt.commentCount ?? rt.comment_count ?? null,
    share_count: rt.shareNum ?? rt.shareCount ?? rt.share_count ?? null
  }
}

/**
 * 解析 /pgy 的 data.sync_data.data 对象
 * 真实字段：read_num（阅读）/ like_num（点赞）/ fav_num（收藏）/ cmt_num（评论）/ share_num（分享）/ imp_num（曝光）
 */
function pickPgyCounts(d) {
  if (!d || typeof d !== 'object') return null
  return {
    view_count: d.read_num ?? d.view_num ?? null,
    like_count: d.like_num ?? null,
    collect_count: d.fav_num ?? null,
    comment_count: d.cmt_num ?? null,
    share_count: d.share_num ?? null,
    impression_count: d.imp_num ?? null
  }
}

/**
 * 获取笔记「蒲公英」平台快照
 * 调用 ${baseUrl}/pgy?note_id=xxx&proxy_line=xxx（3 线路自动故障转移）
 * 响应结构：{ code, data: { note_id, sync_data: { data: {...各项指标} } } }
 * @param {string} noteId
 */
export async function fetchNotePgyCounts(noteId) {
  try {
    const body = await getWithLineFailover(`/pgy?note_id=${noteId}`)
    if (body && body.code === 0 && body.data) {
      const d = body.data.sync_data?.data || body.data.data || body.data.sync_data || null
      const counts = pickPgyCounts(d)
      if (counts && Object.values(counts).some(v => v != null)) {
        return { ...counts, payload: body.data }
      }
    }
    console.warn('[noteApi] pgy 响应结构未识别:', JSON.stringify(body).slice(0, 400))
    return EMPTY_COUNTS()
  } catch {
    return EMPTY_COUNTS()
  }
}

/**
 * 按数据源获取笔记全量计数
 * @param {string} noteId
 * @param {'realtime'|'pgy'} dataSource
 */
export async function fetchNoteCounts(noteId, dataSource = 'realtime') {
  return dataSource === 'pgy'
    ? fetchNotePgyCounts(noteId)
    : fetchNoteRealtimeCounts(noteId)
}

/**
 * 获取笔记阅读数（兼容旧调用）
 * @param {string} noteId
 * @param {'realtime'|'pgy'} dataSource
 * @returns {Promise<{view_count:number|null, payload:object|null}>}
 */
export async function fetchNoteViewCount(noteId, dataSource = 'realtime') {
  const counts = await fetchNoteCounts(noteId, dataSource)
  return { view_count: counts.view_count, payload: counts.payload }
}

/**
 * 获取笔记点赞数（兼容旧调用）
 * @param {string} noteId
 * @param {'realtime'|'pgy'} dataSource
 * @returns {Promise<{like_count:number|null, payload:object|null}>}
 */
export async function fetchNoteLikeCount(noteId, dataSource = 'realtime') {
  const counts = await fetchNoteCounts(noteId, dataSource)
  return { like_count: counts.like_count, payload: counts.payload }
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
export async function fetchSnapshot(noteUrl, targetType = 'read', dataSource = 'realtime') {
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

  // 3. 计数快照（根据类型 + 数据源：realtime=/realtime，pgy=/pgy）
  if (targetType === 'read' || targetType === 'view') {
    const { view_count, payload } = await fetchNoteViewCount(noteId, dataSource)
    result.view_count = view_count
    if (payload) result.count_payload = truncJson(payload)
  } else if (targetType === 'like') {
    const { like_count, payload } = await fetchNoteLikeCount(noteId, dataSource)
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
export async function collectSnapshots(lines, targetType = 'read', dataSource = 'realtime') {
  const results = new Map()
  const batch = concurrency
  for (let i = 0; i < lines.length; i += batch) {
    const chunk = lines.slice(i, i + batch)
    const tasks = chunk.map((line, j) =>
      fetchSnapshot(line.url, targetType, dataSource).then(snap => {
        results.set(i + j, snap)
      }).catch(() => {})
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
