/**
 * seen-core · 标签体系
 *
 * 四层标签：学科（裸标签）/ 主题（裸标签）/ 类型（类型/xxx）/ 概念（概念/xxx）。
 * 主题与类型由 LLM 在总结阶段产出，这里只做形态归一、包含合并与词表约束。
 * 纯函数，不访问文件系统。
 */

import { conceptKey } from './concept.js'

/** 可选的视频形态，固定枚举，避免模型自造「干货」「合集」这类词。 */
export const TAG_TYPES = ['教程', '科普', '访谈', '评测', '观点', '纪录', '播客', '课程']

export const MAX_THEMES = 4
export const MAX_TYPES = 2
export const MAX_CONCEPTS = 6
export const THEME_MIN_CHARS = 2
export const THEME_MAX_CHARS = 6
export const THEME_MAX_CHARS_LATIN = 12
export const VOCAB_LIMIT = 40
export const VOCAB_MAX_TERMS = 500

// 没有区分度的词：既不能当主题，也不该出现在主题里
const GENERIC_THEMES = new Set([
  '视频', '内容', '作者', '观点', '结论', '方法', '问题', '知识', '学习',
  '总结', '介绍', '讲解', '分析', '案例', '故事', '话题', '主题', '讨论', '分享',
  '教程', '科普', '干货', '合集', '系列', '全网最全', '保姆级',
])

/**
 * 归一单个标签名：去括号及其中内容、去书名号引号、去井号、去空白与标点，全角转半角。
 * 只负责形态，长度与语义由调用方判断。
 */
export function normalizeTagName(value) {
  let text = String(value ?? '').trim()
  if (!text) return ''
  // 全角 ASCII 转半角（，！：等），汉字不受影响
  text = text.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  // 括号及其中内容整段丢弃：概念/仓库（Vault）→ 概念/仓库
  text = text.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
  text = text.replace(/[《》「」『』“”‘’"']/g, '')
  text = text.replace(/^#+/, '')
  text = text.replace(/[\s\u3000]+/g, '')
  text = text.replace(/[\p{P}\p{S}]/gu, '')
  return text
}

function charLength(text) {
  return [...text].length
}

/** 规范化主题词：限长、去泛化词、去重、同篇包含合并，最多 4 个。 */
export function normalizeThemes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[、,，;；\n]+/)
  const names = []
  for (const item of list) {
    const name = normalizeTagName(item)
    if (!name) continue
    const max = /[A-Za-z]/.test(name) ? THEME_MAX_CHARS_LATIN : THEME_MAX_CHARS
    const length = charLength(name)
    if (length < THEME_MIN_CHARS || length > max) continue
    if (GENERIC_THEMES.has(name)) continue
    const key = conceptKey(name)
    if (names.some((existing) => conceptKey(existing) === key)) continue
    names.push(name)
  }
  // 包含关系只留更具体的那个（教程 ⊂ 入门教程），长度差超过 2 视为不同主题
  const kept = names.filter(
    (name) =>
      !names.some(
        (other) =>
          other !== name && other.includes(name) && charLength(other) - charLength(name) <= 2
      )
  )
  return kept.slice(0, MAX_THEMES)
}

/** 规范化形态标签：只保留固定枚举里的值，最多 2 个。 */
export function normalizeTagTypes(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[、,，;；\n]+/)
  const result = []
  for (const item of list) {
    const name = normalizeTagName(item)
    if (!name) continue
    const key = conceptKey(name)
    const matched = TAG_TYPES.find((type) => conceptKey(type) === key)
    if (!matched || result.includes(matched)) continue
    result.push(matched)
    if (result.length >= MAX_TYPES) break
  }
  return result
}

/** 组装最终标签：学科 → 主题 → 类型 → 概念；与学科同 key 的主题让位。 */
export function mergeTags({ subject = '', themes = [], types = [], concepts = [] } = {}) {
  const result = []
  const seen = new Set()
  const push = (name) => {
    const key = conceptKey(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(name)
  }

  const subjectName = normalizeTagName(subject)
  if (subjectName) push(subjectName)
  for (const theme of normalizeThemes(themes)) push(theme)
  for (const type of normalizeTagTypes(types)) push('类型/' + type)
  for (const concept of Array.isArray(concepts) ? concepts : []) {
    const name = typeof concept === 'string' ? concept : concept?.name
    const clean = normalizeTagName(name)
    if (clean) push('概念/' + clean)
  }
  return result
}

/** 取历史词表里最常用的若干主题词，供提示词复用。 */
export function buildTagVocabulary(state, limit = VOCAB_LIMIT) {
  const source = state && typeof state === 'object' ? state.tagVocabulary : null
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  return Object.entries(source)
    .map(([name, count]) => [String(name), Number(count)])
    .filter(([name, count]) => name && Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(([name]) => name)
}

function pruneTagVocabulary(state) {
  const entries = Object.entries(state.tagVocabulary || {})
  if (entries.length <= VOCAB_MAX_TERMS) return
  const kept = entries
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, VOCAB_MAX_TERMS)
  state.tagVocabulary = Object.fromEntries(kept)
}

/** 把一篇笔记用到的主题词累加进词表；类型/概念带前缀，不进词表。 */
export function rememberTags(state, tags = []) {
  if (!state || typeof state !== 'object') return 0
  if (!state.tagVocabulary || typeof state.tagVocabulary !== 'object' || Array.isArray(state.tagVocabulary)) {
    state.tagVocabulary = {}
  }
  let changed = 0
  for (const tag of Array.isArray(tags) ? tags : []) {
    const raw = String(tag ?? '').trim()
    if (!raw || raw.includes('/')) continue
    const name = normalizeTagName(raw)
    if (!name) continue
    state.tagVocabulary[name] = (Number(state.tagVocabulary[name]) || 0) + 1
    changed += 1
  }
  pruneTagVocabulary(state)
  return changed
}

function tagKind(name) {
  if (name.startsWith('概念/')) return 'concept'
  if (name.startsWith('类型/')) return 'type'
  return 'theme'
}

/** 汇总全库标签：按出现次数降序，供标签索引页与面板使用。 */
export function buildTagIndex(videos = []) {
  const map = new Map()
  for (const video of Array.isArray(videos) ? videos : []) {
    const tags = Array.isArray(video?.tags) ? video.tags : []
    // mergeTags 保证学科永远是第一个标签且与 subject 同名，据此把它单列成「学科」分区
    const subjectName = String(video?.subject ?? '').trim()
    for (const tag of tags) {
      const name = String(tag ?? '').trim()
      const key = conceptKey(name)
      if (!name || !key) continue
      let bucket = map.get(key)
      if (!bucket) {
        bucket = { name, type: subjectName && name === subjectName ? 'subject' : tagKind(name), videos: [] }
        map.set(key, bucket)
      }
      bucket.videos.push({
        title: String(video?.title ?? ''),
        notePath: String(video?.notePath ?? ''),
        subject: String(video?.subject ?? ''),
      })
    }
  }
  return [...map.values()].sort((a, b) => b.videos.length - a.videos.length)
}

export default {
  TAG_TYPES,
  normalizeTagName,
  normalizeThemes,
  normalizeTagTypes,
  mergeTags,
  buildTagVocabulary,
  rememberTags,
  buildTagIndex,
}
