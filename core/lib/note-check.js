/**
 * seen-core · 笔记结构自检
 *
 * 只做「读文本、断结构」：不访问文件系统、不调模型。
 * 文件系统由调用方（scripts/self-check.mjs 或测试）注入 exists 谓词。
 *
 * 两套断言：
 * 1. checkNoteShape / checkNoteLinks / checkIndexLinks —— 检查已写出的 markdown；
 * 2. checkSummaryShape / checkSegments —— 检查模型返回的数据结构（回放回归用）。
 */

import { conceptKey } from './concept.js'
import { TAG_TYPES } from './tags.js'

/** 当前笔记版式版本；缺失视为 0.3 之前的旧格式，结构缺失只算警告。 */
export const NOTE_FORMAT = 3

export const MANUAL_START = '<!-- MANUAL:START -->'
export const MANUAL_END = '<!-- MANUAL:END -->'

const SECTION_ORDER = [
  '视频信息',
  '关键数字',
  '章节',
  '核心知识点',
  '核心概念',
  '相关笔记',
  '讨论焦点',
  '弹幕与评论讨论焦点',
  '我的补充',
  '来源统计',
]

const REQUIRED_ALWAYS = ['视频信息', '核心知识点', '来源统计']

// 0.2 时代没有的区块，只在当前格式里强制要求
const REQUIRED_CURRENT = ['我的补充']

const DIRTY_TAGS = new Set(['视频课程', 'B站', 'bilibili', 'YouTube', 'youtube', '抖音精选', '全网最全', '保姆级'])

function cleanInline(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** 解析 YAML 里的一行值：'""' 包裹的走 JSON，其余原样。 */
function parseValue(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.replace(/^"|"$/g, '')
    }
  }
  return text
}

/** 拆 frontmatter 与正文。 */
export function splitFrontmatter(markdown) {
  const text = String(markdown ?? '').replace(/^\uFEFF/, '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: '', body: text }
  return { frontmatter: match[1], body: text.slice(match[0].length) }
}

/** mm:ss / hh:mm:ss → 秒。 */
export function clockSeconds(value) {
  const parts = String(value ?? '').trim().split(':').map((item) => Number(item))
  if (parts.some((item) => !Number.isFinite(item))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

/** 解析一篇笔记：frontmatter 关键字段 + 各区块正文。 */
export function parseNoteMarkdown(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown)
  const meta = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!match) continue
    meta[match[1]] = parseValue(match[2])
  }
  let tags = []
  if (Array.isArray(meta.tags)) tags = meta.tags.map((item) => String(item))
  else if (typeof meta.tags === 'string' && meta.tags) {
    try {
      const parsed = JSON.parse(meta.tags)
      if (Array.isArray(parsed)) tags = parsed.map(String)
    } catch {
      tags = meta.tags.split(/[,，、]/).map((item) => cleanInline(item)).filter(Boolean)
    }
  }

  const lines = body.split(/\r?\n/)
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      current = { title: cleanInline(heading[1]), body: '', index: sections.length }
      sections.push(current)
      continue
    }
    if (current) current.body += line + '\n'
  }

  const sectionMap = new Map(sections.map((item) => [item.title, item]))
  const infoSection = sectionMap.get('视频信息')
  let duration = 0
  if (infoSection) {
    const row = infoSection.body.match(/^\|\s*时长\s*\|\s*([0-9:]+)\s*\|/m)
    if (row) duration = clockSeconds(row[1])
  }

  const conceptSection = sectionMap.get('核心概念')
  const conceptEntries = []
  if (conceptSection) {
    for (const line of conceptSection.body.split(/\r?\n/)) {
      const match = line.match(/^-\s+\*\*(.+?)\*\*(.*)$/)
      if (!match) continue
      const name = cleanInline(match[1])
      const rest = match[2] || ''
      conceptEntries.push({
        name,
        hasAlias: /（别称[:：]/.test(rest),
        hasBlockId: /\^concept-\S+/.test(rest),
      })
    }
  }
  const conceptBlockCount = (body.match(/\^concept-\S+/g) || []).length

  const relatedSection = sectionMap.get('相关笔记')
  const relatedLinks = []
  if (relatedSection) {
    for (const match of relatedSection.body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      relatedLinks.push(cleanInline(match[1]))
    }
  }

  const manualLink = body.match(/\[\[([^\]|#]+)\|[^\]]*学习手册\]\]/)

  const statsSection = sectionMap.get('来源统计')
  const statsUrl = statsSection ? (statsSection.body.match(/https?:\/\/[^\s|)]+/) || [])[0] || '' : ''

  return {
    frontmatter,
    body,
    meta,
    format: Number(meta.format) || 0,
    tags,
    title: cleanInline(meta.title),
    subject: cleanInline(meta.subject),
    source: cleanInline(meta.source),
    url: cleanInline(meta.url),
    type: cleanInline(meta.type),
    contentQuality: cleanInline(meta.contentQuality),
    duration,
    sections,
    sectionTitles: sections.map((item) => item.title),
    sectionMap,
    conceptEntries,
    conceptBlockCount,
    relatedLinks,
    manualLinkTarget: manualLink ? cleanInline(manualLink[1]) : '',
    manualMarkersOk: body.includes(MANUAL_START) && body.includes(MANUAL_END) && body.indexOf(MANUAL_START) < body.indexOf(MANUAL_END),
    detailsOk: Boolean(statsSection) && /<details>/.test(statsSection.body) && /<\/details>/.test(statsSection.body),
    statsUrl,
  }
}

function finding(code, level, message) {
  return { code, level, message }
}

function discussionTitleOf(note) {
  return note.source === 'youtube' ? '讨论焦点' : '弹幕与评论讨论焦点'
}

/** 长度（按字符，不是字节）。 */
function charLength(text) {
  return [...String(text ?? '')].length
}

/** 检查一篇笔记的版式、标签与时间轴。 */
export function checkNoteShape(note) {
  const findings = []
  const isCurrent = note.format >= NOTE_FORMAT
  const soft = isCurrent ? 'error' : 'warn'
  const legacyHint = isCurrent ? '' : '（旧格式，仅供参考）'
  const titles = note.sectionTitles

  for (const title of REQUIRED_ALWAYS) {
    if (!titles.includes(title)) findings.push(finding('missing-section', soft, '缺少「## ' + title + '」' + legacyHint))
  }
  for (const title of REQUIRED_CURRENT) {
    if (!titles.includes(title)) findings.push(finding('missing-section', soft, '缺少「## ' + title + '」' + legacyHint))
  }
  const discussion = discussionTitleOf(note)
  if (!titles.includes(discussion)) {
    findings.push(finding('missing-section', soft, '缺少「## ' + discussion + '」' + legacyHint))
  }

  const present = titles.filter((title) => SECTION_ORDER.includes(title))
  const expected = SECTION_ORDER.filter((title) => present.includes(title))
  if (present.join('|') !== expected.join('|')) {
    findings.push(finding('section-order', soft, '区块顺序不对：实际 ' + present.join(' → ')))
  }

  if (isCurrent) {
    if (!note.manualMarkersOk) {
      findings.push(finding('manual-markers', 'error', '「我的补充」里缺 ' + MANUAL_START + ' / ' + MANUAL_END + ' 成对标记'))
    }
    if (!note.detailsOk) findings.push(finding('stats-details', 'error', '「来源统计」缺 <details> 折叠块'))
    // format 3 去掉了封面、思维导图与「所属章节」标注，重新出现说明版式回退
    if (/^cover:/m.test(note.frontmatter) || /!\[封面/.test(note.body)) {
      findings.push(finding('legacy-cover', 'error', 'format 3 不再抓封面，笔记里不该有 cover 字段或封面图'))
    }
    if (note.sectionTitles.includes('思维导图')) {
      findings.push(finding('legacy-mindmap', 'error', 'format 3 的视频笔记不再有「思维导图」，内容与知识点重复'))
    }
    if (note.body.includes('所属章节：')) {
      findings.push(finding('legacy-chapter-tag', 'error', 'format 3 不再标注「所属章节」，章节与知识点标题已能对照'))
    }
  }

  // 标签
  const tags = note.tags
  if (tags.length === 0) {
    findings.push(finding('tags-empty', 'error', 'frontmatter 没有 tags'))
  } else {
    if (note.subject && tags[0] !== note.subject) {
      findings.push(finding('tag-subject-first', 'error', '第一个标签应是学科「' + note.subject + '」，实际是「' + tags[0] + '」'))
    }
    const themes = []
    const types = []
    const concepts = []
    for (const tag of tags) {
      const name = String(tag)
      if (DIRTY_TAGS.has(name)) findings.push(finding('tag-dirty', 'error', '标签含无信息量的值「' + name + '」'))
      if (TAG_TYPES.includes(name)) findings.push(finding('tag-bare-type', 'error', '类型词「' + name + '」应写成「类型/' + name + '」'))
      if (name.startsWith('概念/')) concepts.push(name.slice(3))
      else if (name.startsWith('类型/')) types.push(name.slice(3))
      else if (name !== note.subject) themes.push(name)
    }
    if (themes.length > 4) findings.push(finding('theme-count', 'error', '主题标签超过 4 个：' + themes.join('、')))
    if (isCurrent && themes.length === 0) findings.push(finding('theme-empty', soft, '没有主题标签，只剩学科与类型'))
    for (const theme of themes) {
      const max = /[A-Za-z]/.test(theme) ? 12 : 6
      if (charLength(theme) < 2 || charLength(theme) > max) {
        findings.push(finding('theme-length', 'error', '主题「' + theme + '」长度不合规（2–' + max + ' 字）'))
      }
    }
    if (types.length > 2) findings.push(finding('type-count', 'error', '类型标签超过 2 个：' + types.join('、')))
    for (const type of types) {
      if (!TAG_TYPES.includes(type)) findings.push(finding('type-unknown', 'error', '类型「' + type + '」不在固定枚举里'))
    }
    // 旧笔记的概念是历史数据，数量超限只提示，不判错
    if (concepts.length > 6) findings.push(finding('concept-count', isCurrent ? 'error' : 'warn', '概念标签超过 6 个：' + concepts.join('、')))
    for (const concept of concepts) {
      if (charLength(concept) < 2 || charLength(concept) > 8) {
        findings.push(finding('concept-length', 'error', '概念「' + concept + '」长度不合规（2–8 字）'))
      }
      if (/[（(]/.test(concept)) findings.push(finding('concept-bracket', 'error', '概念「' + concept + '」不该带括号'))
    }
    if (note.conceptEntries.length > 0) {
      // 用 conceptKey 比对：容忍空格、标点与大小写差异
      const names = note.conceptEntries.map((item) => conceptKey(item.name))
      for (const concept of concepts) {
        if (!names.includes(conceptKey(concept))) {
          // 旧笔记的概念区块可能与重打后的标签不同步，只提示
          findings.push(finding('concept-tag-mismatch', isCurrent ? 'error' : 'warn', '标签「概念/' + concept + '」在「核心概念」里找不到同名条目'))
        }
      }
      for (const entry of note.conceptEntries) {
        if (!entry.hasBlockId) findings.push(finding('concept-block-id', 'error', '核心概念「' + entry.name + '」缺 ^concept- 块引用'))
      }
    }
    if (concepts.length > 0 && note.conceptEntries.length === 0 && isCurrent) {
      findings.push(finding('concept-section-missing', soft, '有概念标签但没有「核心概念」区块'))
    }
  }

  // 章节时间轴
  const chapterSection = note.sectionMap.get('章节')
  if (!chapterSection) {
    if (note.duration >= 240 && (note.source === 'bilibili' || note.source === 'youtube')) {
      findings.push(finding('chapters-missing', 'warn', '时长 ' + Math.round(note.duration / 60) + ' 分钟却没有「章节」（可能分段失败，也可能本来没有章节）'))
    }
  } else {
    const rows = [...chapterSection.body.matchAll(/^-\s+(?:\[([0-9:]+)\]\(([^)]*)\)\s*|([0-9:]+)\s+)(.*)$/gm)]
    let last = -1
    for (const row of rows) {
      const clock = row[1] || row[3]
      const link = row[2] || ''
      const seconds = clockSeconds(clock)
      if (seconds <= last) findings.push(finding('chapter-order', 'error', '章节时间没有递增：' + clock))
      last = seconds
      if (note.duration > 0 && seconds > note.duration + 5) {
        findings.push(finding('chapter-overflow', 'error', '章节时间 ' + clock + ' 超出视频时长'))
      }
      if (note.source === 'bilibili' && link && !/[?&]t=\d+/.test(link)) {
        findings.push(finding('chapter-link', 'error', 'B 站章节链接缺 t= 参数'))
      }
      if (note.source === 'youtube' && link && !/[?&]t=\d+/.test(link)) {
        findings.push(finding('chapter-link', 'error', 'YouTube 章节链接缺 t= 参数'))
      }
      if (note.source === 'douyin' && /[?&]t=\d+/.test(link)) {
        findings.push(finding('chapter-link', 'error', '抖音分享链接不支持 t=，不该带时间参数'))
      }
    }
  }

  if (note.statsUrl && note.url && note.statsUrl !== note.url) {
    findings.push(finding('stats-url-mismatch', 'warn', '来源统计里的链接与 frontmatter 不一致'))
  }
  if (note.type && note.type !== 'video-note') {
    findings.push(finding('note-type', 'error', 'frontmatter type 应为 video-note，实际是「' + note.type + '」'))
  }

  return findings
}

/** 检查笔记内部的链接（相关笔记、学科手册）目标是否存在。 */
export function checkNoteLinks(note, { exists = () => true, selfPath = '' } = {}) {
  const findings = []
  const normalized = (target) => String(target || '').trim().replace(/\\/g, '/')
  for (const target of note.relatedLinks) {
    const path = normalized(target)
    const rel = path.endsWith('.md') ? path : path + '.md'
    if (selfPath && normalized(selfPath) === rel) {
      findings.push(finding('related-self', 'error', '「相关笔记」链到了自己：' + path))
      continue
    }
    if (!exists(rel)) findings.push(finding('related-broken', 'error', '「相关笔记」指向的文件不存在：' + path))
  }
  if (note.manualLinkTarget) {
    const path = normalized(note.manualLinkTarget)
    const rel = path.endsWith('.md') ? path : path + '.md'
    if (!exists(rel)) findings.push(finding('manual-broken', 'error', '学科手册链接指向的文件不存在：' + path))
  }
  return findings
}

/** 检查索引页里所有 [[双链]] 目标是否存在。 */
export function checkIndexLinks(markdown, { exists = () => true } = {}) {
  const findings = []
  for (const match of String(markdown ?? '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const path = cleanInline(match[1]).replace(/\\/g, '/')
    if (!path) continue
    const rel = path.endsWith('.md') ? path : path + '.md'
    if (!exists(rel)) findings.push(finding('index-broken', 'error', '索引里的双链指向不存在的文件：' + path))
  }
  return findings
}

/** 检查模型返回的总结结构（回放回归用）。 */
export function checkSummaryShape(summary) {
  const findings = []
  const data = summary && typeof summary === 'object' ? summary : {}
  const text = cleanInline(data.summary)
  if (charLength(text) < 10) findings.push(finding('summary-empty', 'error', '一句话总结为空或过短'))
  // 提示词允许「只是知识罗列」的视频两栏都留空，所以只查成对性
  const question = cleanInline(data.question)
  const answer = cleanInline(data.answer)
  if (Boolean(question) !== Boolean(answer)) {
    findings.push(finding('summary-qa', 'warn', '「这期想回答」与「给出的答案」只填了一边'))
  }
  const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints : []
  if (keyPoints.length === 0) findings.push(finding('summary-keypoints', 'error', '没有核心知识点'))
  if (keyPoints.length > 20) findings.push(finding('summary-keypoints', 'error', '核心知识点超过 20 个'))
  for (const topic of keyPoints) {
    if (!cleanInline(topic?.title)) findings.push(finding('summary-keypoints', 'error', '有知识点缺标题'))
    if (!Array.isArray(topic?.points) || topic.points.length === 0) {
      findings.push(finding('summary-keypoints', 'error', '知识点「' + cleanInline(topic?.title) + '」没有要点'))
    }
  }
  const concepts = Array.isArray(data.concepts) ? data.concepts : []
  if (concepts.length > 8) findings.push(finding('summary-concepts', 'error', '概念超过 8 个'))
  for (const item of concepts) {
    const name = cleanInline(typeof item === 'string' ? item : item?.name)
    if (!name) findings.push(finding('summary-concepts', 'error', '有概念缺名字'))
    else if (charLength(name) < 2 || charLength(name) > 8) {
      findings.push(finding('summary-concepts', 'error', '概念「' + name + '」长度不合规（2–8 字）'))
    }
  }
  const themes = Array.isArray(data.tags?.themes) ? data.tags.themes : []
  if (themes.length > 4) findings.push(finding('summary-themes', 'error', '主题超过 4 个'))
  const types = Array.isArray(data.tags?.types) ? data.tags.types : []
  for (const type of types) {
    if (!TAG_TYPES.includes(cleanInline(type))) findings.push(finding('summary-types', 'error', '类型「' + type + '」不在固定枚举里'))
  }
  const numbers = Array.isArray(data.numbers) ? data.numbers : []
  if (numbers.length > 6) findings.push(finding('summary-numbers', 'error', '关键数字超过 6 条'))
  return findings
}

/** 检查切段结果（回放回归用）。 */
export function checkSegments(segments, { duration = 0 } = {}) {
  const findings = []
  const list = Array.isArray(segments) ? segments : []
  if (list.length === 0) return [finding('segment-empty', 'error', '没有切出任何段落')]
  if (list.length < 3) findings.push(finding('segment-count', 'error', '只切出 ' + list.length + ' 段（应 3–5 段）'))
  if (list.length > 5) findings.push(finding('segment-count', 'error', '切出 ' + list.length + ' 段（应 3–5 段）'))
  let last = -1
  const seen = new Set()
  for (const segment of list) {
    const from = Number(segment?.from)
    const content = cleanInline(segment?.content)
    if (!Number.isFinite(from)) {
      findings.push(finding('segment-from', 'error', '有段落缺起始时间'))
      continue
    }
    if (from <= last) findings.push(finding('segment-order', 'error', '段落时间没有递增：' + from + 's'))
    last = from
    if (duration > 0 && from > duration + 5) findings.push(finding('segment-overflow', 'error', '段落起点 ' + from + 's 超出视频时长'))
    if (!content) findings.push(finding('segment-title', 'error', '有段落缺标题'))
    else if (charLength(content) > 30) findings.push(finding('segment-title', 'error', '段落标题过长：' + content))
    else if (seen.has(content)) findings.push(finding('segment-title', 'error', '段落标题重复：' + content))
    if (content) seen.add(content)
  }
  return findings
}

/** 汇总 findings：按级别计数 + 按 code 归并。 */
export function summarizeFindings(findings = []) {
  const list = Array.isArray(findings) ? findings.filter(Boolean) : []
  const errors = list.filter((item) => item.level === 'error')
  const warnings = list.filter((item) => item.level !== 'error')
  const group = (items) => {
    const map = new Map()
    for (const item of items) {
      const entry = map.get(item.code) || { code: item.code, count: 0, messages: [] }
      entry.count += 1
      if (entry.messages.length < 3 && !entry.messages.includes(item.message)) entry.messages.push(item.message)
      map.set(item.code, entry)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }
  return { total: list.length, errors, warnings, errorGroups: group(errors), warningGroups: group(warnings) }
}

export default {
  NOTE_FORMAT,
  splitFrontmatter,
  parseNoteMarkdown,
  checkNoteShape,
  checkNoteLinks,
  checkIndexLinks,
  checkSummaryShape,
  checkSegments,
  summarizeFindings,
  clockSeconds,
}
