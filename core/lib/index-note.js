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

function noteLink(row) {
  const title = escapeCell(row.title || '未命名视频')
  const path = String(row.notePath || '').replace(/\.md$/i, '')
  return path ? '[[' + path + '|' + title + ']]' : title
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp))
  if (!Number.isFinite(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function sourceLabel(value) {
  return value === 'douyin' ? '抖音' : 'B站'
}

/** 生成索引 Markdown（不含 AUTO 标记，由调用方包装）。 */
export function buildIndexMarkdown(videos = [], { noteRoot = '课程知识地图' } = {}) {
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
        '| ' + formatDate(row.createdAt) + ' | ' + noteLink(row) + ' | ' +
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
