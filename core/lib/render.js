/**
 * seen-core · Markdown / Mermaid 渲染
 *
 * 纯 ESM、零运行时依赖。三类 Markdown 模板：
 *  - 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 弹幕评论焦点 + Mermaid mindmap + 来源统计
 *  - 学科学习手册：AUTO 区（学科总览 mindmap + 视频链接列表）+ 用户「我的补充」区
 *  - 课程总览：AUTO 区（学科 mindmap + 学科列表）+ 用户「我的补充」区
 *
 * frontmatter 的值一律使用 JSON 双引号字符串；Mermaid 节点一律经 mermaidSafe 处理。
 */

export const AUTO_START = '<!-- AUTO:START -->'
export const AUTO_END = '<!-- AUTO:END -->'

const DEFAULT_TITLE = '未命名视频'
const DEFAULT_SUBJECT = '未分类'
const DEFAULT_NOTE_ROOT = '课程知识地图'

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
  return yamlString(value)
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
    .filter((item) => item.content)
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
    const points = Array.isArray(item.points)
      ? item.points.map((point) => oneLine(point)).filter(Boolean)
      : []
    if (title || points.length) result.push({ title: title || '要点', points })
  }
  return result
}

function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
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

function normalizeTags(value, subject) {
  let tags = []
  if (Array.isArray(value)) tags = value.map((item) => cleanInline(item).replace(/\s+/g, '-')).filter(Boolean)
  else if (typeof value === 'string') tags = value.split(/[,，、]/).map((item) => cleanInline(item).replace(/\s+/g, '-')).filter(Boolean)
  if (tags.length === 0) tags = ['视频课程', subject]
  return [...new Set(tags)]
}

/** 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 弹幕评论焦点 + Mermaid mindmap + 来源统计。 */
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
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const summary = oneLine(source.summary)
  const keyPoints = normalizeKeyPoints(source.keyPoints)
  const discussion = normalizeStringList(source.discussion)
  const stats = normalizeFetchStats(source.fetchStats)
  const chapters = normalizeChapters(source.chapters)
  const contentSource = cleanInline(source.contentSource) || 'metadata'
  const contentQuality = cleanInline(source.contentQuality) || 'metadata-only'

  const frontmatterData = {
    title,
    subject,
    source: platform,
    url,
    author,
    created: createdAt,
    updated: createdAt,
    tags: normalizeTags(source.tags, subject),
    contentSource,
    contentQuality,
    type: 'video-note',
  }
  if (bvid) frontmatterData.bvid = bvid
  if (videoId) frontmatterData.videoId = videoId
  const frontmatter = renderFrontmatter(frontmatterData)

  const lines = []
  lines.push(frontmatter.trimEnd(), '')
  lines.push(`# ${title}`, '')
  if (contentQuality !== 'full') {
    lines.push('> [!warning] 内容依据有限', '> 未获取到视频字幕/转写，本文主要基于简介、标签和观众讨论整理，知识点可能不完整或有偏差。', '')
  } else if (contentSource === 'ai-subtitle') {
    lines.push('> [!info] 内容来源：B站 AI 字幕（自动识别，可能存在少量同音错字）', '')
  } else if (contentSource === 'whisper') {
    lines.push('> [!info] 内容来源：抖音音频，本地 Whisper 转写（自动识别，可能存在同音错字）', '')
  }
  lines.push(`> ${summary || '（暂无摘要）'}`, '')
  if (platform === 'douyin') {
    lines.push('> [!note] 抖音评论/弹幕正文暂未抓取，下方讨论焦点为基于主题的推演。', '')
  }
  const manualTarget = `${noteRoot}/${subject}/${subject} 学习手册`
  lines.push(`> 所属学科：[[${manualTarget}|${subject} 学习手册]]`, '')

  if (chapters.length > 0) {
    lines.push('## 章节', '')
    for (const chapter of chapters) lines.push(`- ${formatDuration(chapter.from)} ${chapter.content}`)
    lines.push('')
  }

  lines.push('## 核心知识点', '')
  if (keyPoints.length === 0) {
    lines.push('- （暂无知识点）', '')
  } else {
    for (const topic of keyPoints) {
      lines.push(`### ${topic.title}`, '')
      if (topic.points.length === 0) lines.push('- （暂无要点）')
      else for (const point of topic.points) lines.push(`- ${point}`)
      lines.push('')
    }
  }

  lines.push('## 弹幕与评论讨论焦点', '')
  if (discussion.length === 0) lines.push('- （暂无讨论数据）')
  else for (const item of discussion) lines.push(`- ${item}`)
  lines.push('')

  lines.push('## 思维导图', '', '```mermaid', 'mindmap')
  const rootText = mermaidSafe(title) || DEFAULT_TITLE
  lines.push(`  root((${rootText}))`)
  for (const topic of keyPoints) {
    const topicText = mermaidSafe(topic.title)
    if (!topicText) continue
    lines.push(`    ${topicText}`)
    for (const point of topic.points) {
      const pointText = mermaidSafe(point, 60)
      if (pointText) lines.push(`      ${pointText}`)
    }
  }
  lines.push('```', '')

  lines.push('## 来源统计', '')
  if (platform === 'douyin') {
    lines.push(`- 抖音精选：${url || '（未匹配到抖音视频）'}`)
    lines.push(`- 视频 ID：${videoId || '（无）'}`)
    lines.push(`- 作者：${author || '（未知）'}`)
    lines.push(`- 视频简介：${stats.desc} 字`)
    lines.push(`- 标签：${stats.tags} 个`)
    lines.push(`- 音频转写：${stats.transcript} 字（本地 Whisper）`)
    lines.push(`- 弹幕：全站 ${stats.totalDanmaku || '未知'} 条（暂未抓取）`)
    lines.push(`- 评论：全站 ${stats.totalComments || '未知'} 条（暂未抓取）`, '')
  } else {
    lines.push(`- B站视频：${url || '（未匹配到 B 站视频）'}`)
    lines.push(`- BV 号：${bvid || '（无）'}`)
    lines.push(`- UP 主：${author || '（未知）'}`)
    lines.push(`- 视频简介：${stats.desc} 字`)
    lines.push(`- 标签：${stats.tags} 个`)
    const transcriptLabel = contentSource === 'ai-subtitle'
      ? '（B站 AI 字幕）'
      : contentSource === 'up-subtitle'
        ? '（UP 主字幕）'
        : ''
    lines.push(`- 字幕：${stats.transcript} 字${transcriptLabel}`)
    lines.push(`- 弹幕：抓取 ${stats.danmaku} 条 / 全站 ${stats.totalDanmaku || '未知'} 条`)
    lines.push(`- 评论：抓取 ${stats.comments} 条 / 全站 ${stats.totalComments || '未知'} 条`, '')
  }

  return lines.join('\n')
}

/** 学科学习手册 AUTO 区正文（不含 AUTO 标记）。 */
export function subjectManualAutoBody(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const subject = cleanInline(source.subject) || DEFAULT_SUBJECT
  const videos = normalizeVideos(source.videos)
  const lines = ['## 学科总览', '', '```mermaid', 'mindmap', `  root((${mermaidSafe(subject) || DEFAULT_SUBJECT}))`]
  if (videos.length === 0) {
    lines.push('    （暂无视频）')
  } else {
    for (const video of videos) lines.push(`    ${mermaidSafe(video.title) || DEFAULT_TITLE}`)
  }
  lines.push('```', '', '## 视频笔记', '')
  if (videos.length === 0) {
    lines.push('- （暂无视频，观看课程后会自动更新）')
  } else {
    for (const video of videos) {
      const target = toLinkPath(video.notePath || video.title)
      const summary = video.summary ? ` — ${video.summary}` : ''
      lines.push(`- [[${target}|${video.title}]]${summary}`)
    }
  }
  return lines.join('\n')
}

/** 课程总览 AUTO 区正文（不含 AUTO 标记）。 */
export function overviewAutoBody(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const subjects = normalizeSubjects(source.subjects)
  const lines = ['## 学科总览', '', '```mermaid', 'mindmap', '  root((课程知识地图))']
  if (subjects.length === 0) {
    lines.push('    （暂无学科）')
  } else {
    for (const subject of subjects) lines.push(`    ${mermaidSafe(subject.name) || DEFAULT_SUBJECT}`)
  }
  lines.push('```', '', '## 学科列表', '')
  if (subjects.length === 0) {
    lines.push('- （暂无，开始观看视频课程后会自动生成）')
  } else {
    for (const subject of subjects) {
      const target = `${noteRoot}/${subject.name}/${subject.name} 学习手册`
      const count = subject.count === null ? '' : ` — ${subject.count} 个视频`
      lines.push(`- [[${target}|${subject.name}]]${count}`)
    }
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

/** 课程总览完整文档（frontmatter + H1 + AUTO 区 + 用户补充区）。 */
export function renderOverview(input = {}) {
  const source = isPlainObject(input) ? input : {}
  const noteRoot = cleanNoteRoot(source.noteRoot)
  const updatedAt = formatDate(source.updatedAt ?? Date.now())
  const frontmatter = renderFrontmatter({ title: '课程知识地图', created: updatedAt, updated: updatedAt, type: 'course-overview' })
  const body = overviewAutoBody({ subjects: source.subjects, noteRoot })
  return [
    frontmatter.trimEnd(),
    '',
    '# 课程知识地图',
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
