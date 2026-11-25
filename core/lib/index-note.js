/**
 * seen-core · 知识索引
 *
 * 把 history 渲染成一篇索引笔记（表格 + 学科分布），由服务在保存笔记后重建。
 * 纯函数，不访问文件系统。
 */

function escapeCell(text) {
  return String(text ?? '')
    .replace(/\|/g, '｜')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function noteLink(row, inTable = false) {
  const title = escapeCell(row.title || '未命名视频')
  const path = String(row.notePath || '').replace(/\.md$/i, '')
  return path ? '[[' + path + (inTable ? '\\|' : '|') + title + ']]' : title
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp))
  if (!Number.isFinite(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function sourceLabel(value) {
  if (value === 'douyin') return '抖音'
  if (value === 'youtube') return 'YouTube'
  return 'B站'
}

/** 生成索引 Markdown（不含 AUTO 标记，由调用方包装）。 */
export function buildIndexMarkdown(videos = [], { noteRoot = '视频笔记' } = {}) {
  const rows = (Array.isArray(videos) ? videos : [])
    .filter((row) => row && typeof row === 'object' && (row.title || row.notePath))
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))

  const subjectCounts = new Map()
  for (const row of rows) {
    const subject = String(row.subject || '未分类')
    subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1)
  }

  const lines = []
  lines.push('## 全部视频', '')
  if (rows.length === 0) {
    lines.push('（还没有视频笔记）', '')
  } else {
    lines.push('| 日期 | 标题 | 学科 | 来源 |')
    lines.push('|---|---|---|---|')
    for (const row of rows) {
      lines.push(
        '| ' + formatDate(row.createdAt) + ' | ' + noteLink(row, true) + ' | ' +
        escapeCell(row.subject || '未分类') + ' | ' + sourceLabel(row.source) + ' |'
      )
    }
    lines.push('')
  }

  lines.push('## 学科分布', '')
  if (subjectCounts.size === 0) {
    lines.push('（暂无）')
  } else {
    for (const [subject, count] of [...subjectCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push('- ' + subject + '：' + count + ' 个')
    }
  }
  lines.push('', '笔记根目录：' + noteRoot)
  return lines.join('\n')
}

/** 生成概念索引 Markdown：每个概念下列出出现过它的视频笔记。 */
export function buildConceptIndexMarkdown(concepts = [], { noteRoot = '视频笔记' } = {}) {
  const items = (Array.isArray(concepts) ? concepts : [])
    .filter((item) => item && item.name && Array.isArray(item.videos) && item.videos.length > 0)
  const lines = ['## 全部概念', '']
  if (items.length === 0) {
    lines.push('（还没有概念，生成笔记后会自动出现）', '', '笔记根目录：' + noteRoot)
    return lines.join('\n')
  }
  lines.push('共 ' + items.length + ' 个概念，按出现次数排序。', '')
  for (const item of items) {
    lines.push('### ' + escapeCell(item.name), '')
    lines.push('出现 ' + item.videos.length + ' 次：')
    for (const video of item.videos) {
      lines.push('- ' + noteLink({ title: video.title, notePath: video.notePath }))
    }
    lines.push('')
  }
  lines.push('笔记根目录：' + noteRoot)
  return lines.join('\n')
}

const TAG_SECTIONS = [
  { type: 'subject', title: '## 学科' },
  { type: 'theme', title: '## 主题' },
  { type: 'type', title: '## 类型' },
  { type: 'concept', title: '## 概念' },
]

/** 生成标签索引 Markdown：主题/类型/概念分区，每个标签下列出用到它的笔记。 */
export function buildTagIndexMarkdown(tags = [], { noteRoot = '视频笔记' } = {}) {
  const items = (Array.isArray(tags) ? tags : []).filter(
    (item) => item && item.name && Array.isArray(item.videos) && item.videos.length > 0
  )
  const lines = ['## 全部标签', '']
  if (items.length === 0) {
    lines.push('（还没有标签，生成笔记后会自动出现）', '', '笔记根目录：' + noteRoot)
    return lines.join('\n')
  }
  lines.push('共 ' + items.length + ' 个标签，按出现次数排序。', '')
  for (const section of TAG_SECTIONS) {
    const group = items.filter((item) => item.type === section.type)
    if (group.length === 0) continue
    lines.push(section.title, '')
    for (const item of group) {
      lines.push('### ' + escapeCell(item.name), '')
      lines.push('出现 ' + item.videos.length + ' 次：')
      for (const video of item.videos) {
        lines.push('- ' + noteLink({ title: video.title, notePath: video.notePath }))
      }
      lines.push('')
    }
  }
  lines.push('笔记根目录：' + noteRoot)
  return lines.join('\n')
}
