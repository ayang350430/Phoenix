/**
 * 小红书数据爬虫 — 自主爬取，不依赖外部 API
 *
 * 用法:
 *   node tests/crawler.js <笔记链接或用户主页链接>
 *   node tests/crawler.js --file urls.txt
 *   node tests/crawler.js --mode browser <链接>     # 强制浏览器模式
 *   node tests/crawler.js --mode fetch <链接>       # 强制直接请求模式
 *
 * 示例:
 *   node tests/crawler.js https://www.xiaohongshu.com/explore/xxxx
 *   node tests/crawler.js https://www.xiaohongshu.com/user/profile/xxxx
 *   node tests/crawler.js https://xhslink.com/xxxxx
 *
 * 输出: tests/output/ 目录下 JSON 文件
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, 'output')

// ========== 配置 ==========

const CONFIG = {
  timeout: 20000,
  delay: 800,
  retries: 2,
  chromePaths: [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ],
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none'
  }
}

// ========== 工具函数 ==========

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function findChrome() {
  for (const p of CONFIG.chromePaths) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function log(msg) { console.log(`  ${msg}`) }
function warn(msg) { console.warn(`  [WARN] ${msg}`) }
function fail(msg) { console.error(`  [FAIL] ${msg}`) }

// ========== URL 检测与解析 ==========

const XHS_USER_PATTERN = /xiaohongshu\.com\/user\/profile\/([a-f0-9]+)/
const XHS_NOTE_PATTERNS = [
  /xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]+)/,
  /xiaohongshu\.com\/search_result\/([a-f0-9]+)/
]

function detectUrlType(url) {
  const userMatch = url.match(XHS_USER_PATTERN)
  if (userMatch) return { type: 'user', id: userMatch[1], url }

  for (const p of XHS_NOTE_PATTERNS) {
    const m = url.match(p)
    if (m) return { type: 'note', id: m[1], url }
  }

  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) {
    return { type: 'note', id: null, url }
  }

  return { type: 'unknown', url }
}

async function resolveShortLink(url) {
  if (!url.includes('xhslink.com')) return url
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: CONFIG.headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(CONFIG.timeout)
    })
    return res.url || url
  } catch {
    return url
  }
}

// ========== HTML 解析：提取 __INITIAL_STATE__ ==========

function extractInitialState(html) {
  // 方式1: window.__INITIAL_STATE__={...}</script>
  const m1 = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*<\/script>/s)
  if (m1) {
    try {
      const cleaned = m1[1]
        .replace(/\bundefined\b/g, 'null')
        .replace(/\bNaN\b/g, 'null')
      return JSON.parse(cleaned)
    } catch {}
  }

  // 方式2: 更宽松的匹配
  const m2 = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/s)
  if (m2) {
    try {
      const cleaned = m2[1]
        .replace(/\bundefined\b/g, 'null')
        .replace(/\bNaN\b/g, 'null')
      return JSON.parse(cleaned)
    } catch {}
  }

  return null
}

// ========== 数据提取 ==========

function extractNoteFromState(state) {
  // 在 noteDetailMap 里找笔记
  const noteMap = state?.note?.noteDetailMap
  if (!noteMap) return null

  const noteId = state?.note?.firstNoteId || Object.keys(noteMap)[0]
  if (!noteId) return null

  const wrapper = noteMap[noteId]
  const note = wrapper?.note || wrapper
  if (!note) return null

  const interact = note.interactInfo || {}
  const user = note.user || {}

  return {
    note_id: note.noteId || noteId,
    title: note.title || note.displayTitle || null,
    desc: note.desc || null,
    type: note.type || null,
    created_at: note.time ? new Date(note.time).toISOString() : null,
    author: {
      id: user.userId || user.id || null,
      name: user.nickname || user.name || null,
      avatar: user.avatar || user.image || null
    },
    stats: {
      likes: toNum(interact.likedCount),
      comments: toNum(interact.commentCount),
      collects: toNum(interact.collectedCount),
      shares: toNum(interact.shareCount)
    },
    tags: (note.tagList || []).map(t => t.name).filter(Boolean),
    images: (note.imageList || []).map(i =>
      i.urlDefault || i.infoList?.[0]?.url || i.url || null
    ).filter(Boolean),
    video: note.video?.consumer?.originVideoKey || null
  }
}

function extractUserFromState(state) {
  const userPage = state?.user?.userPageData
  if (!userPage) return null

  const basic = userPage.basicInfo || {}
  const interactions = userPage.interactions || []

  const findCount = (type) => {
    const item = interactions.find(i => i.type === type)
    return item ? toNum(item.count) : null
  }

  const noteList = userPage.notes || []

  return {
    user_id: basic.userId || basic.id || null,
    nickname: basic.nickname || null,
    avatar: basic.images || basic.avatar || basic.imageb || null,
    desc: basic.desc || null,
    gender: basic.gender != null ? (['男', '女'][basic.gender] || '未知') : null,
    ip_location: basic.ipLocation || null,
    red_id: basic.redId || null,
    stats: {
      followers: findCount('fans'),
      following: findCount('follows'),
      likes_and_collects: findCount('interaction'),
      notes_count: noteList.length || null
    },
    notes: noteList.map(n => ({
      note_id: n.noteId || n.id || null,
      title: n.displayTitle || n.title || null,
      type: n.type || null,
      likes: toNum(n.interactInfo?.likedCount),
      cover: n.cover?.urlDefault || n.cover?.infoList?.[0]?.url || null
    }))
  }
}

function toNum(val) {
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

// ========== 方式1: 直接 fetch 网页 ==========

async function fetchPage(url, retries = CONFIG.retries) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: CONFIG.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(CONFIG.timeout)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (i < retries) {
        await sleep(1500 * (i + 1))
        continue
      }
      throw err
    }
  }
}

async function crawlViaFetch(url, type) {
  log('[fetch] 直接请求网页...')
  const html = await fetchPage(url)

  const state = extractInitialState(html)
  if (!state) {
    throw new Error('无法从 HTML 中提取 __INITIAL_STATE__')
  }

  if (type === 'note') {
    const data = extractNoteFromState(state)
    if (!data) throw new Error('页面中未找到笔记数据')
    return data
  } else {
    const data = extractUserFromState(state)
    if (!data) throw new Error('页面中未找到用户数据')
    return data
  }
}

// ========== 方式2: Puppeteer 浏览器 ==========

async function crawlViaBrowser(url, type) {
  log('[browser] 启动浏览器...')

  const chromePath = findChrome()
  if (!chromePath) {
    throw new Error('未找到 Chrome 浏览器，请设置 CHROME_PATH 环境变量')
  }

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars'
    ]
  })

  try {
    const page = await browser.newPage()

    await page.setUserAgent(CONFIG.headers['User-Agent'])
    await page.setViewport({ width: 1440, height: 900 })

    // 绕过 webdriver 检测
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    log('[browser] 正在加载页面...')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(2000)

    // 尝试从页面上下文提取 __INITIAL_STATE__
    let state = await page.evaluate(() => {
      try { return window.__INITIAL_STATE__ } catch { return null }
    })

    // 如果内存里没有，尝试从 HTML 提取
    if (!state) {
      const html = await page.content()
      state = extractInitialState(html)
    }

    // 如果还是没有，从 DOM 直接抓取
    if (!state && type === 'note') {
      log('[browser] __INITIAL_STATE__ 不可用，从 DOM 提取...')
      const domData = await page.evaluate(() => {
        const getNum = (sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const text = el.textContent.trim()
          const n = parseInt(text.replace(/[^\d]/g, ''))
          return isNaN(n) ? null : n
        }

        const title = document.querySelector('#detail-title')?.textContent?.trim()
          || document.querySelector('.title')?.textContent?.trim()
          || document.querySelector('[class*="title"]')?.textContent?.trim()

        const author = document.querySelector('.username')?.textContent?.trim()
          || document.querySelector('[class*="author"] [class*="name"]')?.textContent?.trim()

        const avatar = document.querySelector('.avatar img')?.src
          || document.querySelector('[class*="author"] img')?.src

        // 互动数据 — 小红书页面底部有点赞/收藏/评论按钮
        const interactEls = document.querySelectorAll('[class*="interact"] [class*="count"], [class*="engage"] span')
        const counts = Array.from(interactEls).map(el => {
          const text = el.textContent.trim()
          if (!text || text === '赞' || text === '收藏' || text === '评论' || text === '分享') return null
          const n = parseInt(text.replace(/[^\d]/g, ''))
          return isNaN(n) ? null : n
        }).filter(v => v !== null)

        return {
          title, author, avatar,
          likes: counts[0] ?? null,
          collects: counts[1] ?? null,
          comments: counts[2] ?? null
        }
      })

      if (domData.title) {
        return {
          note_id: null,
          title: domData.title,
          desc: null,
          type: null,
          created_at: null,
          author: {
            id: null,
            name: domData.author,
            avatar: domData.avatar
          },
          stats: {
            likes: domData.likes,
            comments: domData.comments,
            collects: domData.collects,
            shares: null
          },
          tags: [],
          images: [],
          video: null,
          _source: 'dom'
        }
      }
    }

    if (!state) throw new Error('浏览器模式也无法提取数据')

    if (type === 'note') {
      const data = extractNoteFromState(state)
      if (!data) throw new Error('未能解析笔记数据')
      return data
    } else {
      const data = extractUserFromState(state)
      if (!data) throw new Error('未能解析用户数据')
      return data
    }
  } finally {
    await browser.close()
  }
}

// ========== 组合爬取 ==========

async function crawl(rawUrl, forceMode = null) {
  // 解析短链
  const url = await resolveShortLink(rawUrl)
  const detected = detectUrlType(url)
  const type = detected.type === 'user' ? 'user' : 'note'

  const fullUrl = type === 'user'
    ? `https://www.xiaohongshu.com/user/profile/${detected.id}`
    : detected.id
      ? `https://www.xiaohongshu.com/explore/${detected.id}`
      : url

  console.log(`  类型: ${type === 'note' ? '笔记' : '用户主页'}`)
  console.log(`  地址: ${fullUrl}`)

  const result = {
    url: rawUrl,
    resolved_url: fullUrl,
    type,
    crawled_at: new Date().toISOString(),
    method: null,
    data: null,
    error: null
  }

  // 模式1: 直接请求
  if (forceMode !== 'browser') {
    try {
      result.data = await crawlViaFetch(fullUrl, type)
      result.method = 'fetch'
      log('[OK] 直接请求成功')
      return result
    } catch (err) {
      warn(`直接请求失败: ${err.message}`)
      if (forceMode === 'fetch') {
        result.error = err.message
        return result
      }
    }
    await sleep(CONFIG.delay)
  }

  // 模式2: 浏览器
  try {
    result.data = await crawlViaBrowser(fullUrl, type)
    result.method = 'browser'
    log('[OK] 浏览器模式成功')
  } catch (err) {
    fail(`浏览器模式也失败: ${err.message}`)
    result.error = err.message
  }

  return result
}

// ========== 批量处理 ==========

async function crawlBatch(urls, forceMode) {
  const results = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim()
    if (!url || url.startsWith('#')) continue

    console.log(`\n[${ i + 1}/${urls.length}] ${url}`)
    results.push(await crawl(url, forceMode))

    if (i < urls.length - 1) await sleep(CONFIG.delay)
  }

  return results
}

// ========== 输出 ==========

function saveResults(results) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filepath = path.join(OUTPUT_DIR, `crawl-${ts}.json`)
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf-8')

  return filepath
}

function printSummary(results) {
  console.log('\n' + '='.repeat(60))
  console.log('  爬取结果')
  console.log('='.repeat(60))

  for (const r of results) {
    if (r.error) {
      console.log(`\n  [FAIL] ${r.url}`)
      console.log(`         ${r.error}`)
      continue
    }

    const d = r.data
    if (r.type === 'note') {
      console.log(`\n  [笔记] ${d.title || '(无标题)'}`)
      console.log(`         ID:     ${d.note_id || '-'}`)
      console.log(`         作者:   ${d.author?.name || '-'}`)
      console.log(`         点赞:   ${d.stats?.likes ?? '-'}`)
      console.log(`         评论:   ${d.stats?.comments ?? '-'}`)
      console.log(`         收藏:   ${d.stats?.collects ?? '-'}`)
      console.log(`         分享:   ${d.stats?.shares ?? '-'}`)
      if (d.tags?.length) console.log(`         标签:   ${d.tags.join(', ')}`)
      console.log(`         方式:   ${r.method}`)
    } else {
      console.log(`\n  [用户] ${d.nickname || '(未知)'}`)
      console.log(`         ID:     ${d.user_id || '-'}`)
      console.log(`         粉丝:   ${d.stats?.followers ?? '-'}`)
      console.log(`         关注:   ${d.stats?.following ?? '-'}`)
      console.log(`         获赞:   ${d.stats?.likes_and_collects ?? '-'}`)
      console.log(`         笔记:   ${d.stats?.notes_count ?? '-'}`)
      if (d.notes?.length > 0) {
        console.log(`         最近笔记:`)
        for (const n of d.notes.slice(0, 5)) {
          console.log(`           · ${n.title || '(无标题)'}  赞:${n.likes ?? '-'}`)
        }
      }
      console.log(`         方式:   ${r.method}`)
    }
  }

  console.log('\n' + '='.repeat(60))
}

// ========== 入口 ==========

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log(`
小红书数据爬虫（自主爬取，不依赖外部API）

用法:
  node tests/crawler.js <链接1> [链接2] ...
  node tests/crawler.js --file urls.txt
  node tests/crawler.js --mode browser <链接>    强制浏览器模式
  node tests/crawler.js --mode fetch <链接>      强制直接请求模式

支持:
  笔记: https://www.xiaohongshu.com/explore/xxxxx
  短链: https://xhslink.com/xxxxx
  用户: https://www.xiaohongshu.com/user/profile/xxxxx

Chrome: ${findChrome() || '未找到 (设置 CHROME_PATH 环境变量)'}
`)
    process.exit(0)
  }

  let urls = []
  let forceMode = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') {
      const fp = args[++i]
      if (!fp || !fs.existsSync(fp)) { console.error('文件不存在:', fp); process.exit(1) }
      urls.push(...fs.readFileSync(fp, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))
    } else if (args[i] === '--mode') {
      forceMode = args[++i]
    } else if (args[i].startsWith('http')) {
      urls.push(args[i])
    }
  }

  if (urls.length === 0) { console.error('没有有效的链接'); process.exit(1) }

  console.log(`准备爬取 ${urls.length} 个链接...`)
  if (forceMode) console.log(`强制模式: ${forceMode}`)

  const results = await crawlBatch(urls, forceMode)
  const filepath = saveResults(results)

  printSummary(results)

  const ok = results.filter(r => !r.error).length
  console.log(`\n完成: ${ok}/${results.length} 成功`)
  console.log(`输出: ${filepath}`)
}

main().catch(err => {
  console.error('异常退出:', err)
  process.exit(1)
})
