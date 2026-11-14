/**
 * seen-core · 每周回顾
 *
 * 按自然周（周一 ~ 周日）汇总本周处理过的视频，生成一篇 Markdown 回顾。
 * 只读取传入的 history 数据，不访问文件系统。
 */

export const WEEK_FOLDER = '每周回顾'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value) {
  return String(value).padStart(2, '0')
}

/** ISO 周：返回 { year, week }，跨年按 ISO 规则归属。 */
export function isoWeek(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/** ISO 周的起止时间（本地时区，周一 00:00 ~ 周日 23:59:59.999）。 */
export function weekRange(year, week) {
  const jan4 = new Date(year, 0, 4)
  const day = jan4.getDay() || 7
  const week1Monday = new Date(year, 0, 4 - day + 1)
  const start = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 7 * 86400000 - 1)
  return { start, end }
}

/** 周标签：2026-W46 */
export function weekLabel(year, week) {
  return String(year) + '-W' + pad(week)
}

function formatDay(timestamp) {
  const date = new Date(timestamp)
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + WEEKDAYS[date.getDay()]
}

function noteLink(row) {
  const rawTitle = String(row.title || '未命名视频')
  const safeTitle = rawTitle.replace(/\|/g, '｜').replace(/\]\]/g, '] ]')
  const path = String(row.notePath || '').replace(/\.md$/i, '')
  if (!path) return safeTitle
  return '[[' + path + '|' + safeTitle + ']]'
}

/**
 * 生成一周回顾。
 * @returns {{ year, week, label, count, subjects, markdown }}
 */
export function buildWeeklyReview({ videos = [], now = new Date() } = {}) {
  const { year, week } = isoWeek(now)
  const { start, end } = weekRange(year, week)
  const label = weekLabel(year, week)

  const rows = (Array.isArray(videos) ? videos : [])
    .filter((row) => {
      const at = Number(row && row.createdAt)
      return Number.isFinite(at) && at >= start.getTime() && at <= end.getTime()
    })
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))

  const subjectCounts = new Map()
  const sourceCounts = new Map()
  const keywordSet = new Set()
  for (const row of rows) {
    const subject = String(row.subject || '未分类')
    subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1)
    const source = row.source === 'douyin' ? '抖音' : row.source === 'youtube' ? 'YouTube' : 'B站'
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1)
    for (const keyword of Array.isArray(row.keywords) ? row.keywords : []) {
      const text = String(keyword || '').trim()
      if (text && keywordSet.size < 12) keywordSet.add(text)
    }
  }

  const created = new Date()
  const lines = [
    '---',
    'title: "' + (year + ' 年第 ' + week + ' 周回顾') + '"',
    'type: weekly-review',
    'week: "' + label + '"',
    'created: "' + created.toISOString() + '"',
    '---',
    '',
    '# ' + year + ' 年第 ' + week + ' 周回顾',
    '',
    '## 本周概览',
    '',
  ]

  if (rows.length === 0) {
    lines.push('- 本周没有新增视频笔记。', '')
  } else {
    const sourceText = [...sourceCounts.entries()].map(([name, count]) => name + ' ' + count).join(' · ')
    lines.push(
      '- 新增 ' + rows.length + ' 个视频，覆盖 ' + subjectCounts.size + ' 个学科',
      '- 来源：' + sourceText,
      '',
      '## 学科分布',
      '',
    )
    for (const [subject, count] of [...subjectCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push('- ' + subject + '：' + count + ' 个')
    }
    lines.push('', '## 按天记录', '')

    let currentDay = ''
    for (const row of rows) {
      const day = formatDay(Number(row.createdAt))
      if (day !== currentDay) {
        currentDay = day
        lines.push('### ' + day, '')
      }
      lines.push('- ' + noteLink(row) + ' · ' + String(row.subject || '未分类'))
    }
    lines.push('')

    if (keywordSet.size > 0) {
      lines.push('## 关键词', '', '- ' + [...keywordSet].join('、'), '')
    }

    lines.push('## 值得重看', '')
    for (const row of rows.slice(-3).reverse()) {
      lines.push('- ' + noteLink(row) + ' · ' + String(row.subject || '未分类'))
    }
    lines.push('')
  }

  return {
    year,
    week,
    label,
    count: rows.length,
    subjects: [...subjectCounts.keys()],
    markdown: lines.join('\n'),
  }
}
