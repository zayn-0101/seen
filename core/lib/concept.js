/**
 * 概念归一与跨笔记关联。
 *
 * 目标：同一概念在不同视频里叫法不同（如「责任前置」「责任前置原则」），
 * 用归一键把它们对齐，再据此生成笔记间的双链。
 */

import { extractPage } from './bilibili.js'

const PUNCT = /[\s\u3000·・,，.。;；:：!！?？'"“”‘’()（）\[\]【】《》<>/\\|#^*~`_\-]+/g

/** 概念的归一键：去标点空白、统一小写。 */
export function conceptKey(name) {
  const text = typeof name === 'string' ? name : String(name?.name ?? '')
  return text.replace(PUNCT, '').toLowerCase()
}

/** 概念条目既可能是字符串，也可能是 { name }，统一取名字。 */
export function conceptNameOf(item) {
  if (typeof item === 'string') return item.trim()
  return String(item?.name ?? '').trim()
}

function toNames(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const result = []
  for (const item of list) {
    const name = conceptNameOf(item)
    const key = conceptKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

/** 一个概念的全部称呼（正名 + 别名）的归一键。 */
function conceptKeysOf(item) {
  if (typeof item === 'string') {
    const key = conceptKey(item)
    return key ? [key] : []
  }
  const names = [item?.name, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
  const keys = []
  for (const name of names) {
    const key = conceptKey(name)
    if (key) keys.push(key)
  }
  return keys
}

function sameVideo(a = {}, b = {}) {
  if (a.bvid && b.bvid) {
    return a.bvid === b.bvid && (Number(a.page) || extractPage(a.url)) === (Number(b.page) || extractPage(b.url))
  }
  if (a.videoId && b.videoId) return a.videoId === b.videoId && (!a.source || !b.source || a.source === b.source)
  if (a.url && b.url) return a.url === b.url
  return Boolean(a.title && b.title && a.title === b.title)
}

/**
 * 找出与当前视频相关的历史笔记。
 * 打分：共同概念 ×2 + 共同关键词 ×1，按分数取前 limit 条。
 */
export function findRelatedVideos(current = {}, videos = [], options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 5
  const currentConcepts = toNames(current.concepts)
  const currentKeywords = toNames(current.keywords)
  const conceptKeys = new Set((Array.isArray(current.concepts) ? current.concepts : []).flatMap(conceptKeysOf))
  const keywordKeys = new Set(currentKeywords.map(conceptKey))
  if (conceptKeys.size === 0 && keywordKeys.size === 0) return []

  const scored = []
  for (const video of Array.isArray(videos) ? videos : []) {
    if (!video || sameVideo(current, video)) continue
    const sharedConcepts = toNames(video.concepts).filter((name) => conceptKeys.has(conceptKey(name)))
    const sharedKeywords = toNames(video.keywords).filter((name) => keywordKeys.has(conceptKey(name)))
    const score = sharedConcepts.length * 2 + sharedKeywords.length
    if (score <= 0) continue
    const parts = []
    if (sharedConcepts.length > 0) parts.push('共同概念：' + sharedConcepts.slice(0, 3).join('、'))
    if (sharedKeywords.length > 0) parts.push('共同关键词：' + sharedKeywords.slice(0, 3).join('、'))
    scored.push({
      title: String(video.title ?? ''),
      notePath: String(video.notePath ?? ''),
      subject: String(video.subject ?? ''),
      score,
      reason: parts.join('；'),
    })
  }
  scored.sort((a, b) => b.score - a.score || String(b.title).localeCompare(String(a.title)))
  return scored.slice(0, limit)
}

/** 概念 → 出现过的视频（供概念索引页使用）。 */
export function buildConceptIndex(videos = []) {
  const map = new Map()
  for (const video of Array.isArray(videos) ? videos : []) {
    if (!video) continue
    for (const name of toNames(video.concepts)) {
      const key = conceptKey(name)
      if (!key) continue
      if (!map.has(key)) map.set(key, { name, videos: [] })
      map.get(key).videos.push({
        title: String(video.title ?? ''),
        notePath: String(video.notePath ?? ''),
        subject: String(video.subject ?? ''),
      })
    }
  }
  return [...map.values()].sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name))
}
