/**
 * seen-core · Markdown / Mermaid 渲染
 *
 * 纯 ESM、零运行时依赖。三类 Markdown 模板：
 *  - 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 核心概念 + 讨论焦点 + 来源统计
 *  - 学科手册/总览：AUTO 区里用 Mermaid mindmap 画学科脉络
 *  - 学科学习手册：AUTO 区（学科总览 mindmap + 视频链接列表）+ 用户「我的补充」区
 *  - 总览：AUTO 区（学科 mindmap + 学科列表）+ 用户「我的补充」区
 *
 * frontmatter 的值一律使用 JSON 双引号字符串；Mermaid 节点一律经 mermaidSafe 处理。
 */

import { conceptKey } from './concept.js'
import { normalizePublishedAt } from './dates.js'
import {
  CONTENT_TYPES,
  normalizeContentType,
  normalizeKeyPointPoints,
  normalizeQuality,
  normalizeQuotes,
  normalizeResources,
  normalizeReviewCards,
  normalizeTemplate,
  normalizeTerms,
  scoreNoteQuality,
  templateSections,
} from './note-content.js'
import { NOTE_FORMAT } from './note-check.js'
import { manualNoteLinkTarget, normalizeNoteLayout } from './paths.js'
import { spaceCjkMarkdown } from './text.js'

export const AUTO_START = '<!-- AUTO:START -->'
export const AUTO_END = '<!-- AUTO:END -->'

const DEFAULT_TITLE = '未命名视频'
const DEFAULT_SUBJECT = '未分类'
const DEFAULT_NOTE_ROOT = '视频笔记'

/** Mermaid mindmap 节点安全化：去掉会破坏语法的字符、压缩空白、截断。 */
export function mermaidSafe(text, max = 60) {
  const limit = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : 60
  return String(text ?? '')
    .replace(/[()[\]{}|<>'"`\\/:;#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .trim()
}

/** frontmatter 字符串值：始终输出 JSON 双引号字符串。 */
export function yamlString(value) {
  return JSON.stringify(String(value))
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function yamlValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item)))
  if (isPlainObject(value)) return JSON.stringify(value)
  // 数字保持裸值（format: 2），其余一律按字符串加引号
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return yamlString(value)
}

/** 复习状态：只接受完整的 due/interval/ease/reps，缺失或非法时返回 null。 */
function normalizeReviewState(value) {
  if (!isPlainObject(value)) return null
  const due = String(value.due ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  const interval = Number(value.interval)
  const ease = Number(value.ease)
  const reps = Number(value.reps)
  return {
    due,
    interval: Number.isFinite(interval) && interval >= 0 ? Math.round(interval) : 0,
    ease: Number.isFinite(ease) && ease > 0 ? Math.round(ease * 10) / 10 : 2.5,
    reps: Number.isFinite(reps) && reps >= 0 ? Math.round(reps) : 0,
  }
}

/** 复习卡片：问题::答案，最多 5 条，供 Obsidian Spaced Repetition 插件识别。 */
function buildReviewCards({ question, answer, keyPoints }) {
  const clean = (text) => oneLine(text).replace(/::/g, '：')
  const cards = []
  const q = clean(question)
  const a = clean(answer)
  if (q && a) cards.push(q + '::' + a)
  for (const topic of keyPoints) {
    if (cards.length >= 5) break
    const title = clean(topic.title)
    const first = topic.points.length ? clean(topic.points[0]?.text ?? topic.points[0]) : ''
    if (title && first) cards.push(title + '::' + first)
  }
  const seen = new Set()
  return cards.filter((card) => {
    const key = card.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 5)
}

/** 渲染 YAML frontmatter（含首尾 ---）。 */
export function renderFrontmatter(obj = {}) {
  const lines = ['---']
  if (isPlainObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue
      lines.push(`${key}: ${yamlValue(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n') + '\n'
}

/** 日期格式化为 YYYY-MM-DD（本地时区）。 */
export function formatDate(ts) {
  let date
  if (ts instanceof Date) date = ts
  else if (typeof ts === 'string' && /^\d+$/.test(ts.trim())) date = new Date(Number(ts.trim()))
  else date = new Date(ts === undefined || ts === null || ts === '' ? Date.now() : ts)
  if (Number.isNaN(date.getTime())) return ''
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 秒数格式化为 mm:ss / hh:mm:ss。 */
/** 视频链接追加时间参数：B 站用 t=秒，YouTube 用 t=秒s；其它来源返回空字符串。 */
export function buildTimeLink(url, platform, seconds) {
  const text = String(url ?? '').trim()
  if (!text) return ''
  const kind = String(platform ?? '').toLowerCase()
  const sec = Math.max(0, Math.floor(Number(seconds) || 0))
  if (kind === 'bilibili') {
    if (!/bilibili\.com|b23\.tv/i.test(text)) return ''
    return text + (text.includes('?') ? '&' : '?') + 't=' + sec
  }
  if (kind === 'youtube') {
    if (!/youtube\.com|youtu\.be/i.test(text)) return ''
    return text + (text.includes('?') ? '&' : '?') + 't=' + sec + 's'
  }
  return ''
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function normalizeChapters(chapters) {
  if (!Array.isArray(chapters)) return []
  return chapters
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ from: Number(item.from) || 0, content: cleanInline(item.content) }))
    .filter((item) => item.content && !/^<.*>$/.test(item.content) && !/^untitled\b/i.test(item.content))
}

function cleanInline(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function cleanNoteRoot(noteRoot) {
  const root = String(noteRoot ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  return root || DEFAULT_NOTE_ROOT
}

function toLinkPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\.md$/i, '')
    .trim()
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => oneLine(item)).filter(Boolean)
}

function normalizeKeyPoints(value) {
  if (!Array.isArray(value)) return []
  const result = []
  for (const item of value) {
    if (typeof item === 'string') {
      const title = cleanInline(item)
      if (title) result.push({ title, points: [] })
      continue
    }
    if (!isPlainObject(item)) continue
    const title = cleanInline(item.title ?? item.name)
    const points = normalizeKeyPointPoints(item.points ?? item.items ?? item.details ?? item.bullets)
    const time = Number(item.time ?? item.start)
    const entry = { title: title || '要点', points }
    if (Number.isFinite(time) && time >= 0) entry.time = Math.floor(time)
    if (title || points.length) result.push(entry)
  }
  return result
}

function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 重整理笔记时，用可读名称标注原始字幕来源。 */
function transcriptOriginLabel(value) {
  const source = cleanInline(value)
  if (source === 'up-subtitle') return 'UP 主字幕'
  if (source === 'ai-subtitle') return 'B站 AI 字幕'
  if (source === 'youtube-subtitle') return 'YouTube 字幕'
  if (source === 'auto-subtitle') return 'YouTube 自动字幕'
  if (source === 'whisper') return '本地 Whisper 转写'
  if (source === 'archive') return '更早的字幕存档'
  if (source === 'metadata') return '简介与讨论'
  return ''
}

function normalizeFetchStats(raw) {
  const src = isPlainObject(raw) ? raw : {}
  return {
    desc: toCount(src.desc),
    tags: toCount(src.tags),
    transcript: toCount(src.transcript),
    danmaku: toCount(src.danmaku),
    comments: toCount(src.comments),
    totalDanmaku: toCount(src.totalDanmaku),
    totalComments: toCount(src.totalComments),
  }
}

// 「我的补充」手写保护区：整篇重写时保留用户自己写的内容
const MANUAL_BEGIN = '<!-- MANUAL:START -->'
const MANUAL_END = '<!-- MANUAL:END -->'

// 和 analyze 侧一致：泛化词不进概念区，否则标签体系会被稀释
const GENERIC_CONCEPTS = new Set([
  '视频', '内容', '作者', '观点', '结论', '方法', '问题', '知识', '学习',
  '总结', '介绍', '讲解', '分析', '案例', '故事', '话题', '主题', '讨论', '分享',
])

export function normalizeConcepts(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const raw = typeof item === 'string' ? { name: item } : (isPlainObject(item) ? item : null)
    if (!raw) continue
    const name = cleanInline(raw.name ?? raw.title ?? raw.concept ?? '')
    if (!name) continue
    const plain = name.replace(/[\s\p{P}]+/gu, '')
    if (plain.length < 2 || plain.length > 12) continue
    if (GENERIC_CONCEPTS.has(plain)) continue
    if (seen.has(plain)) continue
    seen.add(plain)
    const brief = cleanInline(raw.brief ?? raw.desc ?? raw.explanation ?? '')
    const aliases = Array.isArray(raw.aliases)
      ? raw.aliases.map((alias) => cleanInline(alias)).filter(Boolean).slice(0, 3)
      : []
    result.push({ name, brief, aliases })
    if (result.length >= 8) break
  }
  return result
}

export function normalizeNumbers(value) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const item of value) {
    const raw = typeof item === 'string' ? { value: item } : (isPlainObject(item) ? item : null)
    if (!raw) continue
    const figure = cleanInline(raw.value ?? raw.number ?? raw.figure ?? '')
    const meaning = cleanInline(raw.meaning ?? raw.desc ?? raw.note ?? '')
    if (!figure || !meaning) continue
    const key = figure + '|' + meaning
    if (seen.has(key)) continue
    seen.add(key)
    const time = Number(raw.time ?? raw.start)
    const entry = { value: figure.slice(0, 30), meaning }
    if (Number.isFinite(time) && time >= 0) entry.time = Math.floor(time)
    result.push(entry)
    if (result.length >= 6) break
  }
  return result
}

/** 提取「我的补充」区块里的手写内容。 */
export function extractManualSection(text) {
  const source = String(text ?? '')
  const start = source.indexOf(MANUAL_BEGIN)
  if (start < 0) return ''
  const end = source.indexOf(MANUAL_END, start + MANUAL_BEGIN.length)
  if (end < 0) return ''
  return source.slice(start + MANUAL_BEGIN.length, end).trim()
}

/** 把旧笔记里的手写内容搬进新生成的笔记，避免整篇覆盖时丢掉。 */
export function mergeManualSection(existingText, nextText) {
  const manual = extractManualSection(existingText)
  const next = String(nextText ?? '')
  if (!manual) return next
  const start = next.indexOf(MANUAL_BEGIN)
  const end = start >= 0 ? next.indexOf(MANUAL_END, start + MANUAL_BEGIN.length) : -1
  if (start < 0 || end < 0) {
    const body = next.trimEnd()
    return body + '\n\n## 我的补充\n\n' + MANUAL_BEGIN + '\n' + manual + '\n' + MANUAL_END + '\n'
  }
  return next.slice(0, start + MANUAL_BEGIN.length) + '\n' + manual + '\n' + next.slice(end)
}

function normalizeVideos(videos) {
  if (!Array.isArray(videos)) return []
  const result = []
  for (const item of videos) {
    if (typeof item === 'string') {
      const title = cleanInline(item)
      if (title) result.push({ title, bvid: '', notePath: '', summary: '', createdAt: undefined })
      continue
    }
    if (!isPlainObject(item)) continue
    const title = cleanInline(item.title ?? item.name)
    if (!title) continue
    result.push({
      title,
      bvid: String(item.bvid ?? '').trim(),
      notePath: String(item.notePath ?? '').trim(),
      summary: oneLine(item.summary),
      concepts: Array.isArray(item.concepts) ? item.concepts.map((c) => String(c ?? '').trim()).filter(Boolean) : [],
      terms: Array.isArray(item.terms) ? item.terms : [],
      template: isPlainObject(item.template) ? item.template : {},
      question: oneLine(item.question),
      answer: oneLine(item.answer),
      quality: Number(item.quality) || 0,
      createdAt: item.createdAt,
    })
  }
  return result
}

function normalizeSubjects(subjects) {
  if (!Array.isArray(subjects)) return []
  const seen = new Set()
  const result = []
  for (const item of subjects) {
    const raw = typeof item === 'string' ? item : (isPlainObject(item) ? (item.subject ?? item.name) : '')
    const name = cleanInline(raw) || DEFAULT_SUBJECT
    if (seen.has(name)) continue
    seen.add(name)
    const count = isPlainObject(item) ? Number(item.videos ?? item.count) : Number.NaN
    result.push({ name, count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : null })
  }
  return result
}

/**
 * 标签由 tags.js 按「学科 → 主题 → 类型 → 概念」组装好后传入，这里只做清洗与去重。
 * 不动形态：把空格换成连字符会毁掉「概念/被动语态」这类嵌套标签。
 */
function normalizeTags(value, subject, concepts = [], { includeConceptTags = true } = {}) {
  const tags = []
  const push = (item) => {
    const tag = cleanInline(item)
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  if (Array.isArray(value)) {
    for (const item of value) push(item)
  } else if (typeof value === 'string') {
    for (const item of value.split(/[,，、]/)) push(item)
  }
  // 调用方已经拼过概念标签就不再重复，否则按核心概念补齐
  if (includeConceptTags && !tags.some((tag) => tag.startsWith('概念/'))) {
    for (const item of Array.isArray(concepts) ? concepts : []) {
      const name = cleanInline(typeof item === 'string' ? item : item?.name).replace(/[/\\#^|\s]+/g, '')
      if (name) push('概念/' + name)
    }
  }
  // 至少要留一个可检索维度：老调用方完全不传标签时退回学科
  if (tags.length === 0) push(subject)
  return tags
}

const TEMPLATE_TABLE_SPECS = {
  arguments: { headers: ['论点', '依据'], fields: ['claim', 'basis'] },
  mechanisms: { headers: ['机制', '证据'], fields: ['point', 'evidence'] },
  comparisons: { headers: ['对象', '结论', '依据'], fields: ['item', 'verdict', 'basis'] },
  people: { headers: ['人物', '观点'], fields: ['name', 'view'] },
  timeline: { headers: ['时间', '事件'], fields: [] },
}

function escapeCell(value) {
  return cleanInline(value).replace(/\|/g, '\\|')
}

function timePrefix(time, url, platform) {
  const seconds = Number(time)
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const label = formatDuration(seconds)
  const link = buildTimeLink(url, platform, seconds)
  return link ? `[${label}](${link}) ` : `${label} `
}

function renderTemplateSection(section, value, { url, platform }) {
  const items = Array.isArray(value) ? value : []
  if (!items.length) return []
  const lines = [`## ${section.title}`, '']
  if (section.kind === 'ordered') {
    for (let index = 0; index < items.length; index += 1) {
      const item = typeof items[index] === 'string' ? { text: items[index] } : items[index]
      lines.push(`${index + 1}. ${timePrefix(item?.time, url, platform)}${cleanInline(item?.text ?? item?.content ?? '')}`)
    }
  } else if (section.kind === 'list') {
    for (const item of items) {
      const text = typeof item === 'string' ? item : item?.text ?? item?.content ?? ''
      if (cleanInline(text)) lines.push(`- ${cleanInline(text)}`)
    }
  } else {
    const spec = TEMPLATE_TABLE_SPECS[section.key]
    if (!spec) return []
    lines.push(`| ${spec.headers.join(' | ')} |`)
    lines.push(`| ${spec.headers.map(() => '---').join(' | ')} |`)
    for (const item of items) {
      if (section.key === 'timeline') {
        const label = cleanInline(item?.label) || (Number.isFinite(Number(item?.time)) ? formatDuration(item.time) : '')
        const event = cleanInline(item?.event ?? item?.text ?? '')
        if (event) lines.push(`| ${escapeCell(label)} | ${escapeCell(event)} |`)
        continue
      }
      const cells = spec.fields.map((field) => escapeCell(item?.[field]))
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  lines.push('')
  return lines
}

/** 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 核心概念 + 讨论焦点 + 来源统计。 */
export function renderVideoNote(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const title = cleanInline(source.title) || DEFAULT_TITLE
  const subject = cleanInline(source.subject) || DEFAULT_SUBJECT
  const bvid = String(source.bvid ?? '').trim()
  const videoId = String(source.videoId ?? '').trim()
  const platform = cleanInline(source.source || source.platform) || 'bilibili'
  const url = String(source.url ?? '').trim()
  const author = String(source.author ?? '').trim()
  const createdAt = formatDate(source.createdAt ?? Date.now())
  const updatedAt = formatDate(source.updatedAt ?? source.createdAt ?? Date.now())
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const summary = oneLine(source.summary)
  const question = oneLine(source.question)
  const answer = oneLine(source.answer)
  const keyPoints = normalizeKeyPoints(source.keyPoints)
  const discussion = normalizeStringList(source.discussion)
  const stats = normalizeFetchStats(source.fetchStats)
  const chapters = normalizeChapters(source.chapters)
  const duration = toCount(source.duration)
  const publishedAt = cleanInline(normalizePublishedAt(source.publishedAt))
  const contentSource = cleanInline(source.contentSource) || 'metadata'
  const transcriptOrigin = cleanInline(source.transcriptOrigin) || contentSource
  const transcriptOriginName = transcriptOriginLabel(transcriptOrigin)
  const contentQuality = cleanInline(source.contentQuality) || 'metadata-only'
  // 元数据版没有字幕支撑，概念和数字容易被模型编出来，整节省略
  const concepts = contentQuality === 'full' ? normalizeConcepts(source.concepts) : []
  const numbers = contentQuality === 'full' ? normalizeNumbers(source.numbers) : []
  const contentType = normalizeContentType(source.contentType)
  const template = contentQuality === 'full' ? normalizeTemplate(source.template, contentType) : {}
  const quotes = contentQuality === 'full' ? normalizeQuotes(source.quotes) : []
  const terms = contentQuality === 'full' ? normalizeTerms(source.terms) : []
  const resources = contentQuality === 'full' ? normalizeResources(source.resources) : []
  const transcriptLength = toCount(source.transcriptLength)
  const quality = normalizeQuality(
    source.quality,
    scoreNoteQuality({
      contentQuality,
      transcriptSource: transcriptOrigin,
      transcriptLength,
      keyPointCount: keyPoints.length,
      conceptCount: concepts.length,
    })
  )
  const relatedNotes = (Array.isArray(source.relatedNotes) ? source.relatedNotes : [])
    .map((item) => ({
      title: cleanInline(item?.title),
      notePath: String(item?.notePath ?? '').trim(),
      reason: cleanInline(item?.reason),
    }))
    .filter((item) => item.title)
    .slice(0, 5)
  const review = normalizeReviewState(source.review)
  const reviewCards = buildReviewCards({ question, answer, keyPoints })

  const frontmatterData = {
    title,
    subject,
    source: platform,
    url,
    author,
    created: createdAt,
    updated: updatedAt,
    tags: normalizeTags(source.tags, subject, concepts, { includeConceptTags: source.includeConceptTags !== false }),
    contentSource,
    contentQuality,
    contentType,
    quality,
    type: 'video-note',
    // 版式版本：自检用它区分当前格式与 0.3 之前的旧笔记
    format: NOTE_FORMAT,
  }
  if (review) frontmatterData.review = review
  if (bvid) frontmatterData.bvid = bvid
  if (videoId) frontmatterData.videoId = videoId
  // 重整理时正文来自本地存档，但评分和来源说明仍以原始字幕来源为准。
  if (contentSource === 'archive' && transcriptOrigin && transcriptOrigin !== 'archive') {
    frontmatterData.transcriptOrigin = transcriptOrigin
  }
  const frontmatter = renderFrontmatter(frontmatterData)

  const lines = []
  lines.push(frontmatter.trimEnd(), '')
  lines.push(`# ${title}`, '')
  if (contentQuality !== 'full') {
    lines.push('> [!warning] 内容依据有限', '> 未获取到视频字幕/转写，本文主要基于简介、标签和观众讨论整理，知识点可能不完整或有偏差。', '')
  } else if (contentSource === 'ai-subtitle') {
    lines.push('> [!info] 内容来源：B站 AI 字幕（自动识别，可能存在少量同音错字）', '')
  } else if (contentSource === 'youtube-subtitle') {
    lines.push('> [!info] 内容来源：YouTube 字幕', '')
  } else if (contentSource === 'auto-subtitle') {
    lines.push('> [!info] 内容来源：YouTube 自动字幕（自动识别，可能存在少量错字）', '')
  } else if (contentSource === 'whisper') {
    lines.push('> [!info] 内容来源：音频，本地 Whisper 转写（自动识别，可能存在同音错字）', '')
  } else if (contentSource === 'archive') {
    lines.push('> [!info] 内容来源：本地字幕存档（重整理' + (transcriptOriginName ? '，原文来自 ' + transcriptOriginName : '') + '）', '')
  }
  lines.push('> [!abstract] 一句话总结', `> ${summary || '（暂无摘要）'}`, '')
  if (question) lines.push('> [!question] 这期想回答', `> ${question}`, '')
  if (answer) lines.push('> [!success] 给出的答案', `> ${answer}`, '')
  if (platform === 'douyin') {
    lines.push('> [!note] 抖音评论/弹幕正文暂未抓取，下方讨论焦点为基于主题的推演。', '')
  } else if (platform === 'youtube') {
    lines.push('> [!note] YouTube 不提供弹幕，评论暂未抓取，下方讨论焦点为基于主题的推演。', '')
  }
  const manualTarget = manualNoteLinkTarget({ noteRoot, subject, layout: normalizeNoteLayout(source.layout) })
  lines.push(`> 所属学科：[[${manualTarget}|${subject} 学习手册]]`, '')

  // 元数据统一收进表格，正文只留结论与知识点
  const platformLabel = platform === 'youtube' ? 'YouTube' : platform === 'douyin' ? '抖音精选' : 'B站'
  const metaRows = [['平台', platformLabel]]
  if (author) {
    const authorLabel = platform === 'youtube' ? '频道' : platform === 'douyin' ? '作者' : 'UP 主'
    metaRows.push([authorLabel, author])
  }
  if (duration > 0) metaRows.push(['时长', formatDuration(duration)])
  if (publishedAt) metaRows.push(['发布', publishedAt])
  if (url) metaRows.push(['链接', url])
  if (bvid) metaRows.push(['BV 号', bvid])
  if (videoId && !bvid) metaRows.push(['视频 ID', videoId])
  lines.push('## 视频信息', '', '| 项目 | 内容 |', '| --- | --- |')
  for (const [metaKey, metaValue] of metaRows) lines.push(`| ${metaKey} | ${metaValue.replace(/\|/g, '\\|')} |`)
  lines.push('')

  if (numbers.length > 0) {
    lines.push('## 关键数字', '', '| 数字 | 含义 |', '| --- | --- |')
    for (const item of numbers) {
      lines.push(`| ${item.value.replace(/\|/g, '\\|')} | ${item.meaning.replace(/\|/g, '\\|')} |`)
    }
    lines.push('')
  }

  if (chapters.length > 0) {
    lines.push('## 章节', '')
    for (const chapter of chapters) {
      const label = formatDuration(chapter.from)
      const link = buildTimeLink(url, platform, chapter.from)
      lines.push(link ? `- [${label}](${link}) ${chapter.content}` : `- ${label} ${chapter.content}`)
    }
    lines.push('')
  }

  for (const section of templateSections(contentType)) {
    lines.push(...renderTemplateSection(section, template[section.key], { url, platform }))
  }

  lines.push('## 核心知识点', '')
  if (keyPoints.length === 0) {
    lines.push('- （暂无知识点）', '')
  } else {
    for (const topic of keyPoints) {
      const topicLink = Number.isFinite(topic.time) ? buildTimeLink(url, platform, topic.time) : ''
      lines.push(topicLink
        ? `### ${topic.title} [${formatDuration(topic.time)}](${topicLink})`
        : `### ${topic.title}`, '')
      if (topic.points.length === 0) lines.push('- （暂无要点）')
      else {
        for (const point of topic.points) {
          const pointText = cleanInline(point?.text ?? point)
          const pointPrefix = timePrefix(point?.time, url, platform)
          lines.push(`- ${pointPrefix}${pointText}`)
        }
      }
      lines.push('')
    }
  }

  if (concepts.length > 0) {
    lines.push('## 核心概念', '')
    for (const concept of concepts) {
      const aliasText = concept.aliases.length ? `（别称：${concept.aliases.join('、')}）` : ''
      const slug = conceptKey(concept.name).slice(0, 40)
      const blockId = slug ? ` ^concept-${slug}` : ''
      const body = concept.brief
        ? `- **${concept.name}** — ${concept.brief}${aliasText}`
        : `- **${concept.name}**${aliasText}`
      lines.push(body + blockId)
    }
    lines.push('')
  }

  if (quotes.length > 0) {
    lines.push('## 原话摘录', '')
    for (const quote of quotes) {
      const prefix = timePrefix(quote.time, url, platform)
      lines.push(`> ${prefix}${quote.text}`, '')
    }
    if (lines[lines.length - 1] === '') lines.pop()
    lines.push('')
  }

  if (terms.length > 0) {
    lines.push('## 术语表', '', '| 术语 | 解释 |', '| --- | --- |')
    for (const term of terms) lines.push(`| ${escapeCell(term.name)} | ${escapeCell(term.definition)} |`)
    lines.push('')
  }

  if (resources.length > 0) {
    lines.push('## 提到的资源', '')
    for (const item of resources) {
      lines.push(item.note ? `- **${item.name}** — ${item.note}` : `- **${item.name}**`)
    }
    lines.push('')
  }

  if (relatedNotes.length > 0) {
    lines.push('## 相关笔记', '')
    for (const item of relatedNotes) {
      const target = item.notePath ? item.notePath.replace(/\.md$/i, '') : ''
      const link = target ? `[[${target}|${item.title}]]` : item.title
      lines.push(item.reason ? `- ${link} — ${item.reason}` : `- ${link}`)
    }
    lines.push('')
  }

  // 复习卡片：Obsidian Spaced Repetition 的 Question::Answer 语法，纯文本也读得懂
  if (reviewCards.length > 0) {
    lines.push('## 复习卡片', '')
    for (const card of reviewCards) lines.push(card)
    lines.push('')
  }

  lines.push(platform === 'youtube' ? '## 讨论焦点' : '## 弹幕与评论讨论焦点', '')
  if (discussion.length === 0) lines.push('- （暂无讨论数据）')
  else for (const item of discussion) lines.push(`- ${item}`)
  lines.push('')

  // 手写保护区：重新生成笔记时由 mergeManualSection 原样搬回
  lines.push('## 我的补充', '', MANUAL_BEGIN, '', MANUAL_END, '')

  lines.push('## 来源统计', '', '<details>', '<summary>展开技术细节</summary>', '')
  const archiveTranscriptSuffix = contentSource === 'archive'
    ? '（本地字幕存档' + (transcriptOriginName ? '，原文来自 ' + transcriptOriginName : '') + '）'
    : ''
  if (platform === 'douyin') {
    lines.push(`- 抖音精选：${url || '（未匹配到抖音视频）'}`)
    lines.push(`- 视频 ID：${videoId || '（无）'}`)
    lines.push(`- 作者：${author || '（未知）'}`)
    lines.push(`- 视频简介：${stats.desc} 字`)
    lines.push(`- 标签：${stats.tags} 个`)
    lines.push(`- 音频转写：${stats.transcript} 字${archiveTranscriptSuffix || '（本地 Whisper）'}`)
    lines.push(`- 弹幕：全站 ${stats.totalDanmaku || '未知'} 条（暂未抓取）`)
    lines.push(`- 评论：全站 ${stats.totalComments || '未知'} 条（暂未抓取）`, '')
  } else if (platform === 'youtube') {
    const ytLabel = contentSource === 'archive'
      ? archiveTranscriptSuffix
      : contentSource === 'youtube-subtitle'
        ? '（YouTube 字幕）'
        : contentSource === 'auto-subtitle'
          ? '（YouTube 自动字幕）'
          : contentSource === 'whisper'
            ? '（本地 Whisper 转写）'
            : ''
    lines.push(`- YouTube 视频：${url || '（未匹配到 YouTube 视频）'}`)
    lines.push(`- 视频 ID：${videoId || '（无）'}`)
    lines.push(`- 频道：${author || '（未知）'}`)
    lines.push(`- 视频简介：${stats.desc} 字`)
    lines.push(`- 标签：${stats.tags} 个`)
    lines.push(`- 章节：${chapters.length} 个`)
    lines.push(`- 字幕：${stats.transcript} 字${ytLabel}`)
    lines.push('- 评论：暂未抓取（YouTube 无弹幕）', '')
  } else {
    lines.push(`- B站视频：${url || '（未匹配到 B 站视频）'}`)
    lines.push(`- BV 号：${bvid || '（无）'}`)
    lines.push(`- UP 主：${author || '（未知）'}`)
    lines.push(`- 视频简介：${stats.desc} 字`)
    lines.push(`- 标签：${stats.tags} 个`)
    const transcriptLabel = contentSource === 'archive'
      ? archiveTranscriptSuffix
      : contentSource === 'ai-subtitle'
        ? '（B站 AI 字幕）'
        : contentSource === 'up-subtitle'
          ? '（UP 主字幕）'
          : contentSource === 'whisper'
            ? '（本地 Whisper 转写）'
            : ''
    lines.push(`- 字幕：${stats.transcript} 字${transcriptLabel}`)
    lines.push(`- 弹幕：抓取 ${stats.danmaku} 条 / 全站 ${stats.totalDanmaku || '未知'} 条`)
    lines.push(`- 评论：抓取 ${stats.comments} 条 / 全站 ${stats.totalComments || '未知'} 条`, '')
  }

  lines.push('</details>', '')

  return lines.join('\n')
}

const CONTENT_TYPE_LABELS = Object.fromEntries(CONTENT_TYPES.map((item) => [item.id, item.label]))

function contentTypeLabel(value) {
  const id = normalizeContentType(value)
  return CONTENT_TYPE_LABELS[id] || '其他'
}

function platformLabel(platform) {
  const id = String(platform || '').toLowerCase()
  if (id === 'youtube') return 'YouTube'
  if (id === 'douyin') return '抖音精选'
  return 'B 站'
}

function subtitleLabel(contentSource, transcriptOriginName) {
  const id = cleanInline(contentSource)
  if (id === 'ai-subtitle') return 'B 站 AI 字幕'
  if (id === 'up-subtitle') return 'UP 主字幕'
  if (id === 'whisper') return '本地 Whisper 转写'
  if (id === 'youtube-subtitle') return 'YouTube 字幕'
  if (id === 'auto-subtitle') return 'YouTube 自动字幕'
  if (id === 'archive') return '本地字幕存档' + (transcriptOriginName ? '（原文：' + transcriptOriginName + '）' : '')
  return '无（仅简介与讨论）'
}

function noteAuthorLabel(platform) {
  const id = String(platform || '').toLowerCase()
  if (id === 'youtube') return '频道'
  if (id === 'douyin') return '作者'
  return 'UP 主'
}

function buildReviewPairs(source, fallbackCards) {
  const explicit = normalizeReviewCards(source.reviewCards)
  const cards = explicit.length > 0 ? explicit : normalizeReviewCards(fallbackCards)
  return cards.slice(0, 5)
}

function renderSeenMeta(meta) {
  return '<!-- seen-meta\n' + JSON.stringify(meta, null, 2) + '\n-->'
}

function renderV5Numbers(numbers, url, platform) {
  const hasTime = numbers.some((item) => Number.isFinite(item.time))
  const lines = ['### 关键数字', '']
  if (hasTime) {
    lines.push('| 时间 | 数字 | 含义 |', '| --- | --- | --- |')
    for (const item of numbers) {
      const label = Number.isFinite(item.time) ? formatDuration(item.time) : ''
      const link = Number.isFinite(item.time) ? buildTimeLink(url, platform, item.time) : ''
      const timeCell = link ? '[' + label + '](' + link + ')' : label
      lines.push('| ' + escapeCell(timeCell) + ' | ' + escapeCell(item.value) + ' | ' + escapeCell(item.meaning) + ' |')
    }
  } else {
    lines.push('| 数字 | 含义 |', '| --- | --- |')
    for (const item of numbers) lines.push('| ' + escapeCell(item.value) + ' | ' + escapeCell(item.meaning) + ' |')
  }
  lines.push('')
  return lines
}

function renderV5TemplateBlock(section, value, { url, platform }) {
  if (!section || !['prerequisites', 'steps', 'exercises', 'comparisons', 'people', 'timeline'].includes(section.key)) return []
  const items = Array.isArray(value) ? value : []
  if (!items.length) return []
  const lines = ['### ' + section.title, '']
  if (section.kind === 'ordered') {
    items.forEach((item, index) => {
      const entry = typeof item === 'string' ? { text: item } : item
      const text = cleanInline(entry?.text ?? entry?.content ?? '')
      if (text) lines.push((index + 1) + '. ' + timePrefix(entry?.time, url, platform) + text)
    })
  } else if (section.kind === 'list') {
    for (const item of items) {
      const text = typeof item === 'string' ? item : item?.text ?? item?.content ?? ''
      if (cleanInline(text)) lines.push('- ' + cleanInline(text))
    }
  } else {
    const spec = TEMPLATE_TABLE_SPECS[section.key]
    if (!spec) return []
    lines.push('| ' + spec.headers.join(' | ') + ' |')
    lines.push('| ' + spec.headers.map(() => '---').join(' | ') + ' |')
    for (const item of items) {
      if (section.key === 'timeline') {
        const label = cleanInline(item?.label) || (Number.isFinite(Number(item?.time)) ? formatDuration(item.time) : '')
        const event = cleanInline(item?.event ?? item?.text ?? '')
        if (event) lines.push('| ' + escapeCell(label) + ' | ' + escapeCell(event) + ' |')
        continue
      }
      const cells = spec.fields.map((field) => escapeCell(item?.[field]))
      lines.push('| ' + cells.join(' | ') + ' |')
    }
  }
  lines.push('')
  return lines
}

function calloutBlock(type, title, bodyLines) {
  const body = Array.isArray(bodyLines) ? bodyLines.filter((line) => String(line ?? '').trim() !== '') : []
  return ['> [!' + type + ']- ' + title, '>', ...body.map((line) => '> ' + line)]
}

/** 视频笔记 v5：中文属性 + 摘要 + 速览 + 核心知识点 + 类型补充 + 概念表 + 折叠附录。 */
export function renderVideoNoteV5(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const originalTitle = cleanInline(source.originalTitle) || cleanInline(source.title) || DEFAULT_TITLE
  const displayTitle = cleanInline(source.displayTitle) || cleanInline(source.title) || originalTitle
  const subject = cleanInline(source.subject) || DEFAULT_SUBJECT
  const bvid = String(source.bvid ?? '').trim()
  const videoId = String(source.videoId ?? '').trim()
  const platform = cleanInline(source.source || source.platform) || 'bilibili'
  const url = String(source.url ?? '').trim()
  const author = String(source.author ?? '').trim()
  const createdAt = formatDate(source.createdAt ?? Date.now())
  const updatedAt = formatDate(source.updatedAt ?? source.createdAt ?? Date.now())
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const summary = oneLine(source.summary)
  const question = oneLine(source.question)
  const answer = oneLine(source.answer)
  // 元数据版没有字幕支撑，知识点和复习卡片容易被模型从简介编出来，整节省略。
  const contentQuality = cleanInline(source.contentQuality) || 'metadata-only'
  const keyPoints = contentQuality === 'full' ? normalizeKeyPoints(source.keyPoints) : []
  const discussion = normalizeStringList(source.discussion)
  const stats = normalizeFetchStats(source.fetchStats)
  const chapters = normalizeChapters(source.chapters)
  const duration = toCount(source.duration)
  const publishedAt = cleanInline(normalizePublishedAt(source.publishedAt))
  const contentSource = cleanInline(source.contentSource) || 'metadata'
  const transcriptOrigin = cleanInline(source.transcriptOrigin) || contentSource
  const transcriptOriginName = transcriptOriginLabel(transcriptOrigin)
  const concepts = contentQuality === 'full' ? normalizeConcepts(source.concepts) : []
  const numbers = contentQuality === 'full' ? normalizeNumbers(source.numbers) : []
  const contentType = normalizeContentType(source.contentType)
  const template = contentQuality === 'full' ? normalizeTemplate(source.template, contentType) : {}
  const quotes = contentQuality === 'full' ? normalizeQuotes(source.quotes) : []
  const terms = contentQuality === 'full' ? normalizeTerms(source.terms) : []
  const resources = contentQuality === 'full' ? normalizeResources(source.resources) : []
  const transcriptLength = toCount(source.transcriptLength)
  const quality = normalizeQuality(
    source.quality,
    scoreNoteQuality({
      contentQuality,
      transcriptSource: transcriptOrigin,
      transcriptLength,
      keyPointCount: keyPoints.length,
      conceptCount: concepts.length,
    })
  )
  const relatedNotes = (Array.isArray(source.relatedNotes) ? source.relatedNotes : [])
    .map((item) => ({
      title: cleanInline(item?.title),
      notePath: String(item?.notePath ?? '').trim(),
      reason: cleanInline(item?.reason),
    }))
    .filter((item) => item.title)
    .slice(0, 5)
  const review = normalizeReviewState(source.review)
  // v5 只接受真正的问答；没有问答就不硬凑「标题::首条要点」的假卡片。
  const legacyCards = buildReviewCards({ question, answer, keyPoints: [] })
  const reviewPairs = contentQuality === 'full' ? buildReviewPairs(source, legacyCards) : []
  const noteTags = normalizeTags(source.tags, subject, [], { includeConceptTags: false })
  if (reviewPairs.length > 0 && !noteTags.includes('flashcards')) noteTags.push('flashcards')

  const manualTarget = manualNoteLinkTarget({ noteRoot, subject, layout: normalizeNoteLayout(source.layout) })
  const platformName = platformLabel(platform)
  const frontmatterData = {
    平台: platformName,
    类型: contentTypeLabel(contentType),
  }
  if (author) frontmatterData[noteAuthorLabel(platform)] = author
  if (duration > 0) frontmatterData['时长'] = formatDuration(duration)
  if (publishedAt) frontmatterData['发布时间'] = publishedAt
  frontmatterData['字幕'] = subtitleLabel(contentSource, transcriptOriginName)
  if (url) frontmatterData['视频链接'] = url
  frontmatterData['学科'] = subject
  frontmatterData['笔记创建'] = createdAt
  frontmatterData['笔记更新'] = updatedAt
  frontmatterData['tags'] = noteTags
  frontmatterData['cssclasses'] = ['seen-note']
  const frontmatter = renderFrontmatter(frontmatterData)

  const lines = [frontmatter.trimEnd(), '']
  if (contentQuality !== 'full') {
    lines.push('> [!warning] 内容依据有限', '> 未获取到视频字幕/转写，本文主要基于简介、标签和观众讨论整理，知识点可能不完整或有偏差。', '')
  }
  const abstract = ['> [!abstract] 摘要', '> **概述**', '> ' + (summary || '（暂无摘要）')]
  if (question) abstract.push('>', '> **核心问题**', '> ' + question)
  if (answer) abstract.push('>', '> **核心结论**', '> ' + answer)
  lines.push(...abstract, '')
  lines.push('学科：[[' + manualTarget + '|' + subject + ' 学习手册]]', '')

  const speed = []
  if (numbers.length > 0) speed.push(...renderV5Numbers(numbers, url, platform))
  if (chapters.length > 0) {
    speed.push('### 章节', '')
    for (const chapter of chapters) {
      const label = formatDuration(chapter.from)
      const link = buildTimeLink(url, platform, chapter.from)
      speed.push(link ? '- [' + label + '](' + link + ') ' + chapter.content : '- ' + label + ' ' + chapter.content)
    }
    speed.push('')
  }
  for (const section of templateSections(contentType)) {
    speed.push(...renderV5TemplateBlock(section, template[section.key], { url, platform }))
  }

  const knowledge = []
  if (keyPoints.length === 0) {
    knowledge.push('- （暂无知识点）', '')
  } else {
    for (const topic of keyPoints) {
      const topicLink = Number.isFinite(topic.time) ? buildTimeLink(url, platform, topic.time) : ''
      knowledge.push(topicLink
        ? '### ' + topic.title + ' [' + formatDuration(topic.time) + '](' + topicLink + ')'
        : '### ' + topic.title, '')
      if (topic.points.length === 0) knowledge.push('- （暂无要点）')
      else {
        for (const point of topic.points) {
          knowledge.push('- ' + timePrefix(point?.time, url, platform) + cleanInline(point?.text ?? point))
        }
      }
      knowledge.push('')
    }
  }

  const extra = []
  const supplementSection = templateSections(contentType).find((item) => item.key === 'doubts' || item.key === 'misconceptions')
  if (supplementSection) {
    const items = Array.isArray(template[supplementSection.key]) ? template[supplementSection.key] : []
    if (items.length > 0) {
      for (const item of items) {
        const text = typeof item === 'string' ? item : item?.text ?? item?.content ?? ''
        if (cleanInline(text)) extra.push('- ' + cleanInline(text))
      }
      extra.push('')
    }
  }

  const conceptRows = []
  const conceptKeys = new Set()
  const conceptNameKeys = []
  for (const concept of concepts) {
    const key = conceptKey(concept.name)
    if (key) {
      conceptKeys.add(key)
      conceptNameKeys.push(key)
    }
    for (const alias of concept.aliases) {
      const aliasKey = conceptKey(alias)
      if (aliasKey) conceptKeys.add(aliasKey)
    }
    const aliasText = concept.aliases.length ? '（' + concept.aliases.join('、') + '）' : ''
    conceptRows.push([concept.name + aliasText, concept.brief || '—'])
  }
  for (const term of terms) {
    const key = conceptKey(term.name)
    if (!key || conceptKeys.has(key)) continue
    // 术语只是概念名的缩短写法（3A / DEI指标）时不再重复一行。
    if (conceptNameKeys.some((nameKey) => nameKey.length >= 2 && (key.includes(nameKey) || nameKey.includes(key)))) continue
    conceptKeys.add(key)
    conceptRows.push([term.name, term.definition || '—'])
  }

  const related = []
  if (relatedNotes.length > 0) {
    for (const item of relatedNotes) {
      const target = item.notePath ? item.notePath.replace(/\.md$/i, '') : ''
      const link = target ? '[[' + target + '|' + item.title + ']]' : item.title
      related.push(item.reason ? '- ' + link + ' — ' + item.reason : '- ' + link)
    }
    related.push('')
  }

  const reviewLines = []
  if (reviewPairs.length > 0) {
    const total = reviewPairs.length
    reviewLines.push('> [!summary]- 展开 ' + total + ' 张卡片', '>')
    reviewPairs.forEach((card, index) => {
      reviewLines.push('> **' + card.question + '**', '>', '> ?', '>', '> **答案：** ' + card.answer)
      if (index < reviewPairs.length - 1) reviewLines.push('>')
    })
    reviewLines.push('')
  }

  const mainSections = []
  if (speed.length > 0) mainSections.push({ title: '速览', body: speed })
  if (keyPoints.length > 0 || contentQuality === 'full') mainSections.push({ title: '核心知识点', body: knowledge })
  if (extra.length > 0) mainSections.push({ title: supplementSection?.title || '补充', body: extra })
  if (conceptRows.length > 0) {
    mainSections.push({
      title: '核心概念与术语',
      body: ['| 概念 / 术语 | 解释 |', '| --- | --- |', ...conceptRows.map((row) => '| ' + escapeCell(row[0]) + ' | ' + escapeCell(row[1]) + ' |'), ''],
    })
  }
  if (related.length > 0) mainSections.push({ title: '相关笔记', body: related })
  if (reviewLines.length > 0) mainSections.push({ title: '复习卡片', body: reviewLines })

  const appendix = []
  if (quotes.length > 0) {
    const quoteLines = quotes.map((quote) => '- ' + timePrefix(quote.time, url, platform) + quote.text)
    appendix.push(...calloutBlock('quote', '原话摘录（' + quotes.length + ' 条）', quoteLines), '')
  }
  if (resources.length > 0) {
    const resourceLines = resources.map((item) => item.note ? '- **' + item.name + '** — ' + item.note : '- **' + item.name + '**')
    appendix.push(...calloutBlock('note', '提到的资源（' + resources.length + ' 个）', resourceLines), '')
  }
  if (discussion.length > 0) {
    const hasRealDiscussion = stats.danmaku > 0 || stats.comments > 0
    const discussionLabel = hasRealDiscussion
      ? (platform === 'youtube' ? '讨论焦点（YouTube 评论）' : '观众讨论（B 站弹幕 / 评论）')
      : '延伸思考'
    appendix.push(...calloutBlock('note', discussionLabel, discussion.map((item) => '- ' + item)), '')
  }
  const statLines = []
  if (stats.transcript > 0) statLines.push('- 字幕：' + stats.transcript.toLocaleString('en-US') + ' 字')
  if (platform === 'bilibili') {
    if (stats.danmaku > 0) statLines.push('- 弹幕：抓取 ' + stats.danmaku + ' 条 / 全站 ' + (stats.totalDanmaku ? stats.totalDanmaku.toLocaleString('en-US') : '未知') + ' 条')
    if (stats.comments > 0) statLines.push('- 评论：抓取 ' + stats.comments + ' 条 / 全站 ' + (stats.totalComments ? stats.totalComments.toLocaleString('en-US') : '未知') + ' 条')
  } else if (platform === 'youtube') {
    if (chapters.length > 0) statLines.push('- 章节：' + chapters.length + ' 个')
    statLines.push('- 评论：暂未抓取（YouTube 无弹幕）')
  } else {
    if (stats.danmaku > 0) statLines.push('- 弹幕：抓取 ' + stats.danmaku + ' 条 / 全站 ' + (stats.totalDanmaku ? stats.totalDanmaku.toLocaleString('en-US') : '未知') + ' 条（正文未抓取）')
    if (stats.comments > 0) statLines.push('- 评论：抓取 ' + stats.comments + ' 条 / 全站 ' + (stats.totalComments ? stats.totalComments.toLocaleString('en-US') : '未知') + ' 条（正文未抓取）')
  }
  if (statLines.length > 0) appendix.push(...calloutBlock('info', '抓取统计', statLines), '')

  let number = 0
  for (const section of mainSections) {
    number += 1
    lines.push('## ' + String(number).padStart(2, '0') + ' ' + section.title, '', ...section.body)
  }
  if (appendix.length > 0) lines.push('## 附录', '', ...appendix)
  number += 1
  lines.push('## ' + String(number).padStart(2, '0') + ' 我的补充', '', '> 记录疑问、联想或待查资料。', '', MANUAL_BEGIN, '', MANUAL_END, '')

  const meta = {
    title: originalTitle,
    displayTitle,
    subject,
    source: platform,
    url,
    author,
    contentSource,
    contentQuality,
    contentType,
    quality,
    type: 'video-note',
    format: 5,
  }
  if (duration > 0) meta.duration = duration
  if (publishedAt) meta.publishedAt = publishedAt
  if (review) meta.review = review
  if (bvid) meta.bvid = bvid
  if (videoId) meta.videoId = videoId
  if (contentSource === 'archive' && transcriptOrigin && transcriptOrigin !== 'archive') meta.transcriptOrigin = transcriptOrigin
  lines.push(renderSeenMeta(meta), '')

  return frontmatter.trimEnd() + '\n' + spaceCjkMarkdown(lines.slice(1).join('\n'))
}

/** 学科学习手册 AUTO 区正文（不含 AUTO 标记）。 */
export function subjectManualAutoBody(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const subject = cleanInline(source.subject) || DEFAULT_SUBJECT
  const videos = normalizeVideos(source.videos)
  const videoLink = (video) => {
    const target = toLinkPath(video.notePath || video.title)
    return `[[${target}|${video.title}]]`
  }
  const lines = ['## 学科总览', '', '```mermaid', 'mindmap', `  root((${mermaidSafe(subject) || DEFAULT_SUBJECT}))`]
  if (videos.length === 0) {
    lines.push('    （暂无视频）')
  } else {
    for (const video of videos) lines.push(`    ${mermaidSafe(video.title) || DEFAULT_TITLE}`)
  }
  lines.push('```', '', '## 学习路径', '')
  if (videos.length === 0) {
    lines.push('- （暂无视频，观看课程后会自动更新）')
  } else {
    const ordered = videos.slice().sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    ordered.forEach((video, index) => {
      const summary = video.summary ? ` — ${video.summary}` : ''
      lines.push(`${index + 1}. ${videoLink(video)}${summary}`)
    })
  }

  lines.push('', '## 视频笔记', '')
  if (videos.length === 0) {
    lines.push('- （暂无视频，观看课程后会自动更新）')
  } else {
    for (const video of videos) {
      const summary = video.summary ? ` — ${video.summary}` : ''
      lines.push(`- ${videoLink(video)}${summary}`)
    }
  }

  const conceptMap = new Map()
  for (const video of videos) {
    for (const name of video.concepts || []) {
      const key = conceptKey(name)
      if (!key) continue
      if (!conceptMap.has(key)) conceptMap.set(key, { name, videos: [] })
      conceptMap.get(key).videos.push(video)
    }
  }
  // 只保留出现在两篇以上笔记里的概念才算「核心」；单篇出现的进不了学科列表
  const concepts = [...conceptMap.values()]
    .filter((item) => item.videos.length >= 2)
    .sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name))
    .slice(0, 20)
  if (concepts.length > 0) {
    lines.push('', '## 本学科核心概念', '')
    for (const item of concepts) {
      const links = item.videos
        .slice(0, 3)
        .map((video) => `[[${toLinkPath(video.notePath || video.title)}|${video.title}]]`)
        .join('、')
      lines.push(`- **${item.name}**（${item.videos.length}） — ${links}`)
    }
  }

  // 术语表：跨本学科视频汇总，同一个词只留第一次的释义
  const termMap = new Map()
  for (const video of videos) {
    const terms = Array.isArray(video.terms) ? video.terms : []
    for (const item of terms) {
      const name = cleanInline(typeof item === 'string' ? item : item?.name)
      const brief = cleanInline(typeof item === 'string' ? '' : item?.brief)
      const key = conceptKey(name)
      if (!key) continue
      if (!termMap.has(key)) termMap.set(key, { name, brief, videos: [] })
      termMap.get(key).videos.push(video.title)
      if (!termMap.get(key).brief && brief) termMap.get(key).brief = brief
    }
  }
  const terms = [...termMap.values()].sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name)).slice(0, 30)
  if (terms.length > 0) {
    lines.push('', '## 术语表', '')
    for (const item of terms) {
      lines.push('- **' + item.name + '**' + (item.brief ? ' — ' + item.brief : ''))
    }
  }

  // 常见对比：把各篇「对比」表里同一个对象合并，保留一句结论
  const comparisonMap = new Map()
  for (const video of videos) {
    const rows = Array.isArray(video.template?.comparisons) ? video.template.comparisons : []
    for (const row of rows) {
      const item = cleanInline(row?.item)
      const key = conceptKey(item)
      if (!key) continue
      if (!comparisonMap.has(key)) comparisonMap.set(key, { item, verdict: cleanInline(row?.verdict), basis: cleanInline(row?.basis), videos: [] })
      const entry = comparisonMap.get(key)
      entry.videos.push(video.title)
      if (!entry.verdict && row?.verdict) entry.verdict = cleanInline(row.verdict)
      if (!entry.basis && row?.basis) entry.basis = cleanInline(row.basis)
    }
  }
  const comparisons = [...comparisonMap.values()].sort((a, b) => b.videos.length - a.videos.length || a.item.localeCompare(b.item)).slice(0, 12)
  if (comparisons.length > 0) {
    lines.push('', '## 常见对比', '')
    for (const item of comparisons) {
      const verdict = item.verdict ? '：' + item.verdict : ''
      const basis = item.basis ? '（依据：' + item.basis + '）' : ''
      lines.push('- **' + item.item + '**' + verdict + basis)
    }
  }

  // 待解问题：各篇「可质疑之处」汇总
  const doubts = []
  const seenDoubts = new Set()
  for (const video of videos) {
    const rows = Array.isArray(video.template?.doubts) ? video.template.doubts : []
    for (const row of rows) {
      const text = cleanInline(row)
      const key = conceptKey(text)
      if (!key || seenDoubts.has(key)) continue
      seenDoubts.add(key)
      doubts.push({ text, video: video.title })
    }
  }
  if (doubts.length > 0) {
    lines.push('', '## 待解问题', '')
    for (const item of doubts.slice(0, 12)) lines.push('- ' + item.text + '（来自《' + item.video + '》）')
  }
  return lines.join('\n')
}

/** 总览 AUTO 区正文（不含 AUTO 标记）。 */
export function overviewAutoBody(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const layout = normalizeNoteLayout(source.layout)
  const subjects = normalizeSubjects(source.subjects)
  const videos = normalizeVideos(source.videos)
  const lines = ['## 学科总览', '', '```mermaid', 'mindmap', `  root((${noteRoot}))`]
  if (subjects.length === 0) {
    lines.push('    （暂无学科）')
  } else {
    for (const subject of subjects) lines.push(`    ${mermaidSafe(subject.name) || DEFAULT_SUBJECT}`)
  }
  lines.push('```', '', '## 学科列表', '')
  if (subjects.length === 0) {
    lines.push('- （暂无，开始观看视频后会自动生成）')
  } else {
    for (const subject of subjects) {
      const target = manualNoteLinkTarget({ noteRoot, subject: subject.name, layout })
      const count = subject.count === null ? '' : ` — ${subject.count} 个视频`
      lines.push(`- [[${target}|${subject.name}]]${count}`)
    }
  }

  if (videos.length > 0) {
    const ordered = videos.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    lines.push('', '## 最近更新', '')
    for (const video of ordered.slice(0, 5)) {
      const target = toLinkPath(video.notePath || video.title)
      const day = formatDate(video.createdAt)
      const subject = video.subject ? ' · ' + video.subject : ''
      lines.push('- ' + (day ? day + ' ' : '') + `[[${target}|${video.title}]]` + subject)
    }
    const now = Number(source.now ?? Date.now())
    const weekCount = videos.filter((video) => Number(video.createdAt || 0) >= now - 7 * 86400000).length
    const conceptNames = new Set()
    for (const video of videos) {
      for (const name of video.concepts || []) {
        const key = conceptKey(name)
        if (key) conceptNames.add(key)
      }
    }
    lines.push('', '## 知识库概况', '')
    lines.push('- 视频笔记：' + videos.length + ' 篇')
    lines.push('- 学科：' + subjects.length + ' 个')
    lines.push('- 概念：' + conceptNames.size + ' 个')
    lines.push('- 本周新增：' + weekCount + ' 篇')
  }
  return lines.join('\n')
}

/** 学科学习手册完整文档（frontmatter + H1 + AUTO 区 + 用户补充区）。 */
export function renderSubjectManual(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const subject = cleanInline(source.subject) || DEFAULT_SUBJECT
  const updatedAt = formatDate(source.updatedAt ?? Date.now())
  const frontmatter = renderFrontmatter({ title: `${subject} 学习手册`, subject, created: updatedAt, updated: updatedAt, type: 'subject-manual' })
  const body = subjectManualAutoBody({ subject, videos: source.videos })
  return [
    frontmatter.trimEnd(),
    '',
    `# ${subject} 学习手册`,
    '',
    autoBlock(body),
    '',
    '## 我的补充',
    '',
    '（在这里记录你的笔记、疑问和扩展阅读；本区域不会被自动更新覆盖。）',
    '',
  ].join('\n')
}

/** 总览完整文档（frontmatter + H1 + AUTO 区 + 用户补充区）。 */
export function renderOverview(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const updatedAt = formatDate(source.updatedAt ?? Date.now())
  const frontmatter = renderFrontmatter({ title: noteRoot, created: updatedAt, updated: updatedAt, type: 'course-overview' })
  const body = overviewAutoBody({ subjects: source.subjects, videos: source.videos, noteRoot, layout: source.layout, now: source.now })
  return [
    frontmatter.trimEnd(),
    '',
    `# ${noteRoot}`,
    '',
    autoBlock(body),
    '',
    '## 我的补充',
    '',
    '（在这里记录你的笔记、疑问和扩展阅读；本区域不会被自动更新覆盖。）',
    '',
  ].join('\n')
}

/** 生成带 AUTO 标记的区块。 */
export function autoBlock(body) {
  return `${AUTO_START}\n${String(body ?? '').trim()}\n${AUTO_END}`
}

function stripAutoMarkers(block) {
  let text = String(block ?? '').trim()
  const start = text.indexOf(AUTO_START)
  const end = text.lastIndexOf(AUTO_END)
  if (start !== -1 && end > start) {
    text = text.slice(start + AUTO_START.length, end).trim()
  }
  return text
}

/** 只替换 AUTO 区内部内容，保留标记之外的用户内容；没有标记时追加。 */
export function upsertAutoBlock(text, block) {
  const source = String(text ?? '')
  const body = stripAutoMarkers(block)
  const replacement = `${AUTO_START}\n${body}\n${AUTO_END}`
  const start = source.indexOf(AUTO_START)
  const end = start === -1 ? -1 : source.indexOf(AUTO_END, start + AUTO_START.length)
  if (start !== -1 && end !== -1) {
    return source.slice(0, start) + replacement + source.slice(end + AUTO_END.length)
  }
  const prefix = source.trim() ? source.replace(/\s+$/, '') + '\n\n' : ''
  return prefix + replacement + '\n'
}
