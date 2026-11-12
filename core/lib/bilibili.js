/**
 * seen-core · B 站内容抓取
 *
 * 纯 ESM、零运行时依赖。只使用 Node 内置的 fetch（Node 18+）。
 *
 * 抓取链路：
 *   ref（BV/URL/短链/标题）→ resolveVideoInput → searchVideo（必要时）
 *   → fetchView（分 P 选择 cid）→ fetchSubtitle / fetchDanmaku / fetchComments
 *
 * 约定：
 *  - 所有请求带 BILI_UA、Referer、buvid3 Cookie；
 *  - 10s 超时、2 次重试；HTML 响应视为风控失败；
 *  - fetchContent 内部捕获所有异常，永不抛出。
 */

export const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const BILI_REFERER = 'https://www.bilibili.com/'

const BILI_API = 'https://api.bilibili.com'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_RETRIES = 2
const DANMAKU_MAX_BYTES = 5 * 1024 * 1024
const DANMAKU_MAX_ITEMS = 150
const SEARCH_MIN_SIMILARITY = 0.5

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ */
/* 文本 / URL 工具                                                      */
/* ------------------------------------------------------------------ */

export function decodeXml(input) {
  return String(input ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '' }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)) } catch { return '' }
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
      return map[String(name).toLowerCase()] ?? ''
    })
}

export function stripHtml(input) {
  return decodeXml(
    String(input ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

function pickUrl(input) {
  const text = String(input ?? '')
  const direct = text.match(/https?:\/\/[^\s<>"'）)】。，；！？]+/i)
  if (direct) return direct[0]
  const bili = text.match(/(?:www\.)?bilibili\.com\/video\/[^\s<>"'）)】。，；！？]+/i)
  if (bili) return 'https://' + bili[0]
  const short = text.match(/(?:www\.)?b23\.tv\/[^\s<>"'）)】。，；！？]+/i)
  if (short) return 'https://' + short[0]
  return ''
}

function isShortUrl(url) {
  return /^(?:https?:\/\/)?(?:www\.)?b23\.tv\//i.test(String(url ?? ''))
}

function canonicalVideoUrl(bvid, p = 1) {
  const page = Number.isInteger(Number(p)) && Number(p) > 1 ? Number(p) : 1
  return 'https://www.bilibili.com/video/' + bvid + (page > 1 ? '?p=' + page : '')
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------------ */
/* URL / BV 解析                                                        */
/* ------------------------------------------------------------------ */

/**
 * 从任意输入中解析 BVID。
 * 支持裸 BV 号、/video/BV...、bvid=BV... 等；短链返回 null（需 resolveVideoInput 跟随重定向）。
 */
export function extractBvid(input) {
  const text = String(input ?? '')
  if (!text) return null
  const match = text.match(/(?:^|[^0-9A-Za-z])(BV[0-9A-Za-z]{10})(?![0-9A-Za-z])/i)
  if (!match) return null
  return 'BV' + match[1].slice(2)
}

/** 解析分 P 参数（?p=2 / &page=2），默认 1。 */
export function extractPage(input) {
  const text = String(input ?? '')
  const query = text.match(/[?&](?:p|page)=(\d{1,4})(?:[&#]|$)/i)
  if (query) {
    const n = Number(query[1])
    if (Number.isInteger(n) && n > 0) return n
    return 1
  }
  const path = text.match(/\/p(\d{1,4})(?:\/|$)/i)
  if (path) {
    const n = Number(path[1])
    if (Number.isInteger(n) && n > 0) return n
  }
  return 1
}

function extractAvId(input) {
  const text = String(input ?? '')
  const match = text.match(/(?:^|\/|video\/|av)(?:av)?(\d{1,12})(?![0-9])/i)
  if (!match) return null
  // 避免把普通标题中的数字误判成 av 号：只在纯 av 输入或 /video/av 链接里接受
  if (/^av\d+$/i.test(text.trim())) return match[1]
  if (/\/video\/av\d+/i.test(text)) return match[1]
  return null
}

async function expandShortUrl(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error('timeout')), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': BILI_UA,
        Referer: BILI_REFERER,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: ac.signal,
    })
    const finalUrl = typeof res?.url === 'string' && res.url ? res.url : url
    // 最终 URL 已含 BV 时无需读取 HTML 正文
    if (extractBvid(finalUrl)) return { url: finalUrl, text: '' }
    let text = ''
    try { text = await readResponseText(res) } catch { text = '' }
    return { url: finalUrl, text }
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

async function avToBvid(aid) {
  try {
    const data = await biliFetch(
      BILI_API + '/x/web-interface/view?aid=' + encodeURIComponent(String(aid))
    )
    if (data?.code === 0 && data?.data?.bvid) return String(data.data.bvid)
  } catch {
    /* 降级 */
  }
  return null
}

/**
 * 解析视频输入：裸 BV / 完整 URL / b23.tv 短链 / 纯标题。
 * 永不抛错；无法识别时返回 { title } 或 {}。
 */
export async function resolveVideoInput(ref) {
  try {
    let raw = ''
    if (typeof ref === 'string') raw = ref.trim()
    else if (ref && typeof ref === 'object') {
      raw = String(ref.url ?? ref.ref ?? ref.title ?? '').trim()
    }
    if (!raw) return {}

    let url = pickUrl(raw)
    if (url && isShortUrl(url)) {
      const expanded = await expandShortUrl(url)
      if (expanded.url && extractBvid(expanded.url)) url = expanded.url
      else if (expanded.text && extractBvid(expanded.text)) url = expanded.text
    }

    const source = url || raw
    let bvid = extractBvid(source) || extractBvid(raw)
    const p = extractPage(url || raw)

    if (!bvid) {
      const avId = extractAvId(source)
      if (avId) {
        const converted = await avToBvid(avId)
        if (converted) bvid = converted
      }
    }

    if (bvid) return { bvid, p, url: canonicalVideoUrl(bvid, p) }
    if (url) return { p, url }
    const title = cleanBiliTitle(raw)
    return title ? { title } : {}
  } catch {
    return {}
  }
}

/** 清洗视频标题：去 HTML、去浏览器/平台后缀、压缩空白。 */
const TITLE_SUFFIXES = [
  ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox', ' - Safari',
  ' - Chromium', ' - Opera', ' - Brave', ' - Internet Explorer', ' - Arc',
  ' - 谷歌浏览器', ' - 微软 Edge', ' - 火狐浏览器', ' - 360极速浏览器',
  '_哔哩哔哩_bilibili', '_哔哩哔哩', ' - 哔哩哔哩', ' - bilibili', '-bilibili',
  ' - Bilibili', '_bilibili', ' - 哔哩哔哩弹幕视频网',
  ' - YouTube', ' - 优酷', ' - 爱奇艺', ' - 腾讯视频', ' - 芒果TV',
  ' - 抖音', ' - 快手', ' - 夸克', ' - Quark',
]

export function cleanBiliTitle(raw) {
  let title = stripHtml(String(raw ?? ''))
  let changed = true
  while (changed) {
    changed = false
    const lower = title.toLowerCase()
    for (const suffix of TITLE_SUFFIXES) {
      if (lower.endsWith(suffix.toLowerCase())) {
        title = title.slice(0, title.length - suffix.length).trim()
        changed = true
        break
      }
    }
  }
  return title.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ */
/* 标题相似度                                                           */
/* ------------------------------------------------------------------ */

function normalizeTitle(text) {
  return stripHtml(String(text ?? ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 标题相似度：包含关系直接 1，否则按字符 bigram 的 Dice 系数。
 * 返回 0 ~ 1。
 */
export function titleSimilarity(a, b) {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigrams = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const A = bigrams(na)
  const B = bigrams(nb)
  if (!A.size || !B.size) return 0
  let intersection = 0
  for (const token of A) if (B.has(token)) intersection++
  return (2 * intersection) / (A.size + B.size)
}

/* ------------------------------------------------------------------ */
/* HTTP 基础                                                            */
/* ------------------------------------------------------------------ */

let cachedBuvid3 = null
let cachedBuvidFetch = null

/** 获取并缓存 buvid3（用于 Cookie 风控）。失败返回空字符串。 */
export async function getBuvid3() {
  // 若外部替换了全局 fetch（测试常见），缓存失效，避免测试间串值
  if (cachedBuvid3 !== null && cachedBuvidFetch === globalThis.fetch) return cachedBuvid3
  cachedBuvidFetch = globalThis.fetch
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error('timeout')), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(BILI_API + '/x/frontend/finger/spi', {
      headers: {
        'User-Agent': BILI_UA,
        Referer: BILI_REFERER,
        Accept: 'application/json, text/plain, */*',
      },
      signal: ac.signal,
    })
    const text = await readResponseText(res)
    if (looksLikeHtml(text)) {
      cachedBuvid3 = ''
    } else {
      const json = JSON.parse(text)
      cachedBuvid3 = typeof json?.data?.b_3 === 'string' ? json.data.b_3 : ''
    }
  } catch {
    cachedBuvid3 = ''
  } finally {
    clearTimeout(timer)
  }
  return cachedBuvid3
}

async function readResponseText(res) {
  if (typeof res?.text === 'function') return String(await res.text())
  if (typeof res?.json === 'function') return JSON.stringify(await res.json())
  if (typeof res?.arrayBuffer === 'function') {
    return new TextDecoder().decode(await res.arrayBuffer())
  }
  return ''
}

function looksLikeHtml(text) {
  const head = String(text ?? '').slice(0, 1024).trim().toLowerCase()
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    /<head[\s>]/.test(head) ||
    (/<body[\s>]/.test(head) && !head.startsWith('<?xml'))
  )
}

/**
 * 带 UA / Referer / buvid3 的 GET 请求。
 * - 默认 JSON；json:false 返回文本
 * - 10s 超时、2 次重试
 * - HTML 响应抛错（视为被风控）
 */
export async function biliFetch(url, options = {}) {
  const {
    json = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    maxBytes = 0,
    headers: extraHeaders = {},
  } = options
  const buvid3 = await getBuvid3()
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': BILI_UA,
          Referer: BILI_REFERER,
          Origin: 'https://www.bilibili.com',
          Accept: json ? 'application/json, text/plain, */*' : 'text/xml,application/xml,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          ...(buvid3 ? { Cookie: 'buvid3=' + buvid3 } : {}),
          ...extraHeaders,
        },
        signal: ac.signal,
      })
      const status = Number(res?.status ?? 0)
      const ok = typeof res?.ok === 'boolean' ? res.ok : status >= 200 && status < 300
      if (status === 412) throw new Error('B站接口 HTTP 412（风控）')
      if (!ok) throw new Error('B站接口 HTTP ' + (status || 'unknown'))

      const contentType = String(res?.headers?.get?.('content-type') ?? '')
      if (/text\/html/i.test(contentType)) throw new Error('B站接口返回 HTML（可能被风控）')

      const text = await readResponseText(res)
      if (maxBytes > 0 && Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new Error('B站响应超过 ' + maxBytes + ' 字节上限')
      }
      if (looksLikeHtml(text)) throw new Error('B站接口返回 HTML（可能被风控）')
      if (!json) return text
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('B站接口返回了无法解析的 JSON')
      }
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(400 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'B站请求失败'))
}

/* ------------------------------------------------------------------ */
/* 搜索 / 视频信息                                                      */
/* ------------------------------------------------------------------ */

function parseTags(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => stripHtml(v)).filter(Boolean))].slice(0, 20)
  }
  return [...new Set(String(value ?? '').split(/[,，、]/).map((v) => stripHtml(v)).filter(Boolean))].slice(0, 20)
}

/**
 * 按标题搜索 B 站视频；相似度 < 0.5 返回 null。
 * 返回 { bvid, aid, title, desc, tags }。
 */
export async function searchVideo(title) {
  const keyword = String(title ?? '').trim()
  if (!keyword) return null
  const url =
    BILI_API +
    '/x/web-interface/search/type?search_type=video&keyword=' +
    encodeURIComponent(keyword)
  const data = await biliFetch(url)
  if (data?.code !== 0) throw new Error('B站搜索接口返回 code ' + data?.code)

  const results = Array.isArray(data?.data?.result)
    ? data.data.result.filter((item) => item && item.bvid)
    : []
  if (!results.length) return null

  let best = null
  let bestScore = -1
  for (const item of results.slice(0, 20)) {
    const cleanTitle = stripHtml(item.title)
    const score = titleSimilarity(keyword, cleanTitle)
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  if (!best || bestScore < SEARCH_MIN_SIMILARITY) return null

  return {
    bvid: String(best.bvid),
    aid: toNumber(best.aid),
    title: stripHtml(best.title),
    desc: stripHtml(best.description ?? best.desc ?? ''),
    tags: parseTags(best.tag ?? best.tags),
  }
}

/**
 * 获取视频信息；p 为 1-based 分 P 序号，cid 按分 P 选择。
 * 返回 { bvid, aid, cid, page, part, title, desc, owner, stat, pages, subtitle }。
 */
export async function fetchView(bvid, p = 1) {
  const id = extractBvid(String(bvid ?? '')) || String(bvid ?? '').trim()
  if (!id) throw new Error('fetchView: 缺少 bvid')
  const data = await biliFetch(
    BILI_API + '/x/web-interface/view?bvid=' + encodeURIComponent(id)
  )
  if (data?.code !== 0) throw new Error('B站视频信息接口返回 code ' + data?.code)

  const d = data?.data ?? {}
  const pages = Array.isArray(d.pages)
    ? d.pages.map((page) => ({
        cid: toNumber(page?.cid),
        page: toNumber(page?.page),
        part: String(page?.part ?? ''),
        duration: toNumber(page?.duration) ?? 0,
      }))
    : []
  const pageNum = Number.isInteger(Number(p)) && Number(p) >= 1 ? Number(p) : 1
  const selected = pages[pageNum - 1] ?? null

  return {
    bvid: String(d.bvid || id),
    aid: toNumber(d.aid),
    cid: toNumber(selected?.cid ?? d.cid ?? pages[0]?.cid),
    page: pageNum,
    part: String(selected?.part ?? ''),
    title: String(d.title ?? ''),
    desc: String(d.desc ?? ''),
    owner: String(d.owner?.name ?? ''),
    stat: d.stat && typeof d.stat === 'object' ? d.stat : {},
    pages,
    subtitle: Array.isArray(d?.subtitle?.list)
      ? d.subtitle.list
      : Array.isArray(d?.subtitle)
        ? d.subtitle
        : [],
  }
}

/**
 * 获取视频标签（搜索接口不可用时的补充）。
 * 失败静默返回空数组。
 */
export async function fetchTags(bvid) {
  const id = extractBvid(String(bvid ?? '')) || String(bvid ?? '').trim()
  if (!id) return []
  try {
    const data = await biliFetch(
      BILI_API + '/x/tag/archive/tags?bvid=' + encodeURIComponent(id)
    )
    if (data?.code !== 0) return []
    const list = Array.isArray(data?.data) ? data.data : []
    return [...new Set(list.map((tag) => stripHtml(tag?.tag_name ?? tag?.name ?? '')).filter(Boolean))].slice(0, 20)
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/* 弹幕 / 评论 / 字幕                                                   */
/* ------------------------------------------------------------------ */

/**
 * 获取播放器信息：字幕列表（需要登录时可能为空）与章节 view_points。
 * 匿名也能拿到 view_points；登录 Cookie 可拿到 AI 字幕列表。
 */
export async function fetchPlayerInfo(bvid, cid, { cookieHeader = '' } = {}) {
  const id = extractBvid(String(bvid ?? '')) || String(bvid ?? '').trim()
  if (!id || !cid) return { needLoginSubtitle: false, subtitles: [], viewPoints: [] }
  try {
    const data = await biliFetch(
      BILI_API + '/x/player/v2?bvid=' + encodeURIComponent(id) + '&cid=' + encodeURIComponent(String(cid)),
      { headers: cookieHeader ? { Cookie: cookieHeader } : {} }
    )
    if (data?.code !== 0) return { needLoginSubtitle: false, subtitles: [], viewPoints: [] }
    const d = data?.data ?? {}
    return {
      needLoginSubtitle: d.need_login_subtitle === true,
      subtitles: Array.isArray(d?.subtitle?.subtitles) ? d.subtitle.subtitles : [],
      viewPoints: Array.isArray(d?.view_points)
        ? d.view_points.map((item) => ({
            from: toNumber(item?.from) ?? 0,
            to: toNumber(item?.to) ?? 0,
            content: String(item?.content ?? ''),
          }))
        : [],
    }
  } catch {
    return { needLoginSubtitle: false, subtitles: [], viewPoints: [] }
  }
}

/** 抓取弹幕 XML：去重、最多 150 条、响应上限 5MB。 */
export async function fetchDanmaku(cid) {
  const id = String(cid ?? '').trim()
  if (!id) return []
  let xml
  try {
    xml = await biliFetch('https://comment.bilibili.com/' + encodeURIComponent(id) + '.xml', {
      json: false,
      maxBytes: DANMAKU_MAX_BYTES,
    })
  } catch (error) {
    // 超大 / 非 XML 的弹幕响应直接降级为空
    if (/超过|上限|too large|5MB/i.test(String(error?.message ?? error))) return []
    throw error
  }

  const items = []
  const seen = new Set()
  const re = /<d(?:\s[^>]*)?>([\s\S]*?)<\/d>/gi
  let match
  while ((match = re.exec(xml)) !== null) {
    let text = decodeXml(match[1]).replace(/<\!\[CDATA\[|\]\]>/g, '')
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (text.startsWith('[') && text.endsWith(']')) continue // 高级弹幕 JSON
    if (seen.has(text)) continue
    seen.add(text)
    items.push(text)
    if (items.length >= DANMAKU_MAX_ITEMS) break
  }
  return items
}

/**
 * 抓取一级评论（按热度）。
 * - 匿名接口每页实际约 3 条；带 Cookie 登录态可每页 20 条。
 * - limit 默认 20，最大 100；带 Cookie 时自动翻页。
 */
export async function fetchComments(aid, { limit = 20, cookieHeader = '' } = {}) {
  const id = String(aid ?? '').trim()
  if (!id) return []
  const max = Math.max(1, Math.min(100, Number(limit) || 20))
  const results = []
  const seen = new Set()
  let page = 1
  while (results.length < max && page <= 6) {
    const data = await biliFetch(
      BILI_API + '/x/v2/reply?type=1&oid=' + encodeURIComponent(id) + '&sort=2&ps=20&pn=' + page,
      { headers: cookieHeader ? { Cookie: cookieHeader } : {} }
    )
    if (data?.code !== 0) break
    const replies = Array.isArray(data?.data?.replies) ? data.data.replies : []
    if (replies.length === 0) break
    for (const reply of replies) {
      const message = stripHtml(reply?.content?.message ?? '')
      if (!message || seen.has(message)) continue
      seen.add(message)
      results.push(message)
      if (results.length >= max) break
    }
    if (!cookieHeader && replies.length <= 3) break
    const total = Number(data?.data?.page?.count ?? data?.data?.page?.acount ?? 0)
    if (total > 0 && page * 20 >= total) break
    page += 1
    await sleep(250)
  }
  return results.slice(0, max)
}

/** 抓取字幕文本；任何失败静默返回空字符串。 */
export async function fetchSubtitle(view) {
  try {
    const list = Array.isArray(view?.subtitle)
      ? view.subtitle
      : Array.isArray(view?.subtitle?.list)
        ? view.subtitle.list
        : []
    const priority = ['ai-zh', 'zh-Hans', 'zh-CN', 'zh', 'ai-en', 'en']
    const item = priority
      .map((lang) => list.find((entry) => entry && entry.subtitle_url && String(entry.lan || '').toLowerCase() === lang.toLowerCase()))
      .find(Boolean) || list.find((entry) => entry && entry.subtitle_url)
    if (!item) return ''

    let url = String(item.subtitle_url).trim()
    if (url.startsWith('//')) url = 'https:' + url
    else if (url.startsWith('http://')) url = 'https://' + url.slice('http://'.length)

    const data = await biliFetch(url)
    const body = Array.isArray(data?.body) ? data.body : []
    return body
      .map((entry) => String(entry?.content ?? '').trim())
      .filter(Boolean)
      .join(' ')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* 综合抓取                                                             */
/* ------------------------------------------------------------------ */

function emptyContent(overrides = {}) {
  return {
    matched: false,
    bvid: null,
    aid: null,
    cid: null,
    url: '',
    title: '',
    desc: '',
    tags: [],
    owner: '',
    stat: {},
    transcript: '',
    transcriptSource: '',
    danmaku: [],
    comments: [],
    chapters: [],
    subtitleEntries: [],
    needLoginSubtitle: false,
    fetchStats: { desc: 0, tags: 0, transcript: 0, danmaku: 0, comments: 0, totalDanmaku: 0, totalComments: 0 },
    ...overrides,
  }
}

/**
 * 综合抓取视频内容。
 * @param {{ ref?: string, title?: string, fetchContent?: boolean, cookieHeader?: string, commentLimit?: number }} input
 * @returns {Promise<object>} ContentResult；永不抛错。
 */
export async function fetchContent(input = {}) {
  const options = input && typeof input === 'object' ? input : { ref: input }
  const { ref, title, fetchContent: withContent = true, cookieHeader = '', commentLimit = 20 } = options
  const refText = typeof ref === 'string' ? ref.trim() : ''
  const titleText = typeof title === 'string' ? title.trim() : ''

  let fallbackTitle = ''
  try {
    fallbackTitle = cleanBiliTitle(titleText || refText)
  } catch {
    fallbackTitle = String(titleText || refText || '')
  }

  try {
    let resolved = {}
    try {
      resolved = await resolveVideoInput(refText || titleText)
    } catch {
      resolved = {}
    }

    let bvid = resolved.bvid || null
    const p = resolved.p || 1
    const searchTitle =
      titleText ||
      (refText && !pickUrl(refText) ? cleanBiliTitle(refText) : '') ||
      resolved.title ||
      ''

    let search = null
    if (!bvid && withContent && searchTitle) {
      try {
        search = await searchVideo(searchTitle)
      } catch {
        search = null
      }
      if (search?.bvid) bvid = search.bvid
    }

    const displayTitle =
      cleanBiliTitle(search?.title || resolved.title || fallbackTitle || searchTitle)

    if (!bvid) {
      return emptyContent({
        url: resolved.url || '',
        title: displayTitle,
        desc: search?.desc || '',
        tags: search?.tags || [],
      })
    }

    if (!withContent) {
      return emptyContent({
        matched: true,
        bvid,
        aid: search?.aid ?? null,
        url: canonicalVideoUrl(bvid, p),
        title: displayTitle,
        desc: search?.desc || '',
        tags: search?.tags || [],
      })
    }

    let view = null
    try {
      view = await fetchView(bvid, p)
    } catch {
      view = null
    }

    const aid = view?.aid ?? search?.aid ?? null
    const cid = view?.cid ?? null
    const desc = String(view?.desc || search?.desc || '').trim()
    const owner = String(view?.owner || '')
    const stat = view?.stat && typeof view.stat === 'object' ? view.stat : {}

    let playerInfo = { needLoginSubtitle: false, subtitles: [], viewPoints: [] }
    try {
      playerInfo = await fetchPlayerInfo(bvid, cid, { cookieHeader })
    } catch { /* 降级 */ }
    const subtitleEntries = playerInfo.subtitles.length
      ? playerInfo.subtitles
      : (Array.isArray(view?.subtitle) ? view.subtitle : [])

    const [fetchedTags, transcript, danmaku, comments] = await Promise.all([
      search?.tags?.length ? Promise.resolve(search.tags) : fetchTags(bvid).catch(() => []),
      // 只使用 view 里 UP 主上传的字幕；AI 字幕统一由 transcript.js 通过 yt-dlp 获取。
      // 原因：B站 player/v2 的 AI 字幕 URL 在部分登录态下会返回与当前视频无关的内容。
      fetchSubtitle(view).catch(() => ''),
      cid ? fetchDanmaku(cid).catch(() => []) : Promise.resolve([]),
      aid ? fetchComments(aid, { limit: commentLimit, cookieHeader }).catch(() => []) : Promise.resolve([]),
    ])
    const tags = fetchedTags.length ? fetchedTags : []
    const officialSubtitles = Array.isArray(view?.subtitle) ? view.subtitle : []
    const transcriptSource = transcript
      ? (officialSubtitles.some((entry) => String(entry?.lan || '').toLowerCase().startsWith('ai-') || /ai|自动/i.test(String(entry?.lan_doc || ''))) ? 'ai-subtitle' : 'up-subtitle')
      : ''

    return emptyContent({
      matched: true,
      bvid,
      aid,
      cid,
      url: canonicalVideoUrl(bvid, p),
      title: cleanBiliTitle(view?.title || displayTitle),
      desc,
      tags,
      owner,
      stat,
      transcript,
      transcriptSource,
      danmaku,
      comments,
      chapters: playerInfo.viewPoints,
      subtitleEntries,
      needLoginSubtitle: playerInfo.needLoginSubtitle,
      fetchStats: {
        desc: desc.length,
        tags: tags.length,
        transcript: transcript.length,
        danmaku: danmaku.length,
        comments: comments.length,
        totalDanmaku: Number(stat?.danmaku) || 0,
        totalComments: Number(stat?.reply) || 0,
      },
    })
  } catch {
    return emptyContent({
      url: '',
      title: fallbackTitle,
    })
  }
}

/* ------------------------------------------------------------------ */
/* 兼容别名（原插件命名）                                                */
/* ------------------------------------------------------------------ */

export const searchBili = searchVideo
export const viewBili = fetchView
export const titleSimilar = titleSimilarity

export default {
  BILI_UA,
  BILI_REFERER,
  extractBvid,
  extractPage,
  resolveVideoInput,
  cleanBiliTitle,
  titleSimilarity,
  searchVideo,
  fetchView,
  fetchPlayerInfo,
  fetchTags,
  fetchDanmaku,
  fetchComments,
  fetchSubtitle,
  fetchContent,
}
