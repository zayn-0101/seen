/**
 * seen-core · 每周回顾（写入 noteRoot/资料/回顾/）
 *
 * 按自然周（周一 ~ 周日）汇总本周处理过的视频，生成一篇 Markdown 回顾。
 * 只读取传入的 history 数据，不访问文件系统。
 */

import { collectReviews } from './review-schedule.js'

export const WEEK_FOLDER = '回顾'

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
  const start = new Date(year, 0, 4 - day + 1 + (week - 1) * 7)
  const nextMonday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  const end = new Date(nextMonday.getTime() - 1)
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

  const allRows = Array.isArray(videos) ? videos : []
  const rows = allRows
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

    const { stats } = collectReviews(allRows, { now, limit: 0 })
    const { due: dueThisWeek } = collectReviews(rows, { now, limit: 5 })
    lines.push('## 复习情况', '', '- 已复习 ' + stats.reviewed + ' 篇 · 待复习 ' + stats.due + ' 篇')
    if (dueThisWeek.length > 0) {
      lines.push('- 本周优先：' + dueThisWeek.map((row) => noteLink(row)).join('、'))
    } else {
      lines.push('- 本周新增的笔记都还没到复习时间')
    }
    lines.push('')

    const typeCounts = new Map()
    for (const row of allRows) {
      const type = String(row.contentType || '').trim()
      if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1)
    }
    lines.push('## 学习统计', '')
    lines.push('- 平均质量分：' + (stats.averageQuality ? stats.averageQuality + ' / 5' : '暂无'))
    if (typeCounts.size > 0) {
      const typeText = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => name + ' ' + count).join(' · ')
      lines.push('- 内容类型：' + typeText)
    }
    lines.push('')

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
