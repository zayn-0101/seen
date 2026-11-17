/**
 * seen-core · 概念页与主题综述
 *
 * 只做纯函数：从 history 归纳概念/主题，并渲染成 AUTO 区块正文。
 * 文件读写由 obsidian.js 的 writeConceptPage / writeTopicPage 完成。
 */

import { conceptKey, conceptNameOf } from './concept.js'
import { sanitizeFilename } from './config.js'
import { conceptPageRelPath } from './paths.js'

function escapeInline(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '｜').replace(/\]\]/g, '] ]').trim()
}

function noteLink(video) {
  const title = escapeInline(video.title || '未命名视频')
  const path = String(video.notePath || '').replace(/\.md$/i, '')
  return path ? '[[' + path + '|' + title + ']]' : title
}

function conceptLink(noteRoot, name) {
  const root = String(noteRoot || '视频笔记').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '').trim() || '视频笔记'
  const path = conceptPageRelPath({ noteRoot: root, name: sanitizeFilename(name || '未命名概念', 80) }).replace(/\.md$/i, '')
  return '[[' + path + '|' + escapeInline(name) + ']]'
}

/** 从一篇视频里取概念条目（支持字符串或 { name, brief }）。 */
function conceptEntries(video) {
  const list = Array.isArray(video?.concepts) ? video.concepts : []
  const details = Array.isArray(video?.conceptDetails) ? video.conceptDetails : []
  const briefByKey = new Map()
  for (const item of details) {
    const name = conceptNameOf(item)
    const key = conceptKey(name)
    if (key && item?.brief) briefByKey.set(key, String(item.brief))
  }
  const seen = new Set()
  const result = []
  for (const item of list) {
    const name = conceptNameOf(item)
    const key = conceptKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    result.push({ name, key, brief: briefByKey.get(key) || (typeof item === 'object' ? String(item.brief || '') : '') })
  }
  return result
}

/**
 * 汇总概念页：出现于 >= minVideos 篇笔记的概念。
 * 返回 [{ name, key, definition, videos: [{title,notePath,subject}], related: [{name,count}] }]
 */
export function collectConceptPages(history, { minVideos = 2, max = 300 } = {}) {
  const map = new Map()
  const videos = Array.isArray(history) ? history : []
  for (const video of videos) {
    const entries = conceptEntries(video)
    for (const entry of entries) {
      if (!map.has(entry.key)) map.set(entry.key, { name: entry.name, definition: entry.brief || '', videos: [], keys: new Map() })
      const page = map.get(entry.key)
      if (!page.definition && entry.brief) page.definition = entry.brief
      page.videos.push({ title: String(video.title || ''), notePath: String(video.notePath || ''), subject: String(video.subject || '') })
      for (const other of entries) {
        if (other.key !== entry.key) page.keys.set(other.key, (page.keys.get(other.key) || 0) + 1)
      }
    }
  }
  const pages = []
  for (const [key, page] of map) {
    if (page.videos.length < minVideos) continue
    pages.push({ key, name: page.name, definition: page.definition, videos: page.videos, keys: page.keys })
  }
  pages.sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name))
  const top = pages.slice(0, max)
  const nameByKey = new Map(top.map((page) => [page.key, page.name]))
  return top.map((page) => {
    const related = [...page.keys.entries()]
      .filter(([key]) => nameByKey.has(key))
      .map(([key, count]) => ({ name: nameByKey.get(key), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8)
    return { name: page.name, definition: page.definition, videos: page.videos, related }
  })
}

/**
 * 汇总主题页：主题标签出现在 >= minVideos 篇笔记时建页。
 * 返回 [{ name, videos: [{title,notePath,subject}], concepts: [{name,count}] }]
 */
export function collectTopicPages(history, { minVideos = 3, max = 200 } = {}) {
  const videos = Array.isArray(history) ? history : []
  const themes = new Map()
  for (const video of videos) {
    if (!video || typeof video !== 'object') continue
    const subject = String(video.subject || '').trim()
    const tags = Array.isArray(video.tags) ? video.tags : []
    const themeTags = tags
      .map((tag) => String(tag || '').trim())
      .filter((tag) => tag && !tag.includes('/') && tag !== subject && tag.length >= 2 && tag.length <= 12)
    const seen = new Set()
    for (const tag of themeTags) {
      const key = conceptKey(tag)
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (!themes.has(key)) themes.set(key, { name: tag, videos: [] })
      themes.get(key).videos.push({ title: String(video.title || ''), notePath: String(video.notePath || ''), subject })
    }
  }
  const pages = []
  for (const page of themes.values()) {
    if (page.videos.length < minVideos) continue
    const counts = new Map()
    const keyOf = (video) => JSON.stringify([String(video.notePath || ''), String(video.title || '')])
    const members = new Set(page.videos.map(keyOf))
    for (const video of videos) {
      if (!video || !members.has(keyOf(video))) continue
      for (const entry of conceptEntries(video)) {
        counts.set(entry.name, (counts.get(entry.name) || 0) + 1)
      }
    }
    const concepts = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 10)
    pages.push({ name: page.name, videos: page.videos, concepts })
  }
  pages.sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name))
  return pages.slice(0, max)
}

/** 概念页 AUTO 区正文。 */
export function buildConceptPageMarkdown({ name, definition = '', videos = [], related = [], noteRoot = '视频笔记' } = {}) {
  const lines = ['## 概念释义', '']
  lines.push(definition ? escapeInline(definition) : '「' + escapeInline(name) + '」在多篇视频笔记里出现，还没有统一释义。', '')
  lines.push('## 出现笔记', '')
  if (!videos.length) lines.push('（暂无）')
  else {
    for (const video of videos) {
      const subject = video.subject ? ' · ' + escapeInline(video.subject) : ''
      lines.push('- ' + noteLink(video) + subject)
    }
  }
  lines.push('', '## 相关概念', '')
  if (!related.length) lines.push('（暂无）')
  else {
    for (const item of related) {
      lines.push('- ' + conceptLink(noteRoot, item.name) + ' · 共同出现 ' + item.count + ' 次')
    }
  }
  return lines.join('\n')
}

/** 主题综述 AUTO 区正文。 */
export function buildTopicPageMarkdown({ name, videos = [], concepts = [], noteRoot = '视频笔记' } = {}) {
  const subjects = [...new Set(videos.map((video) => video.subject).filter(Boolean))]
  const lines = ['## 主题概览', '']
  lines.push('共 ' + videos.length + ' 篇视频笔记' + (subjects.length ? '，涉及 ' + subjects.map((item) => '「' + escapeInline(item) + '」').join('、') : '') + '。', '')
  lines.push('## 视频笔记', '')
  if (!videos.length) lines.push('（暂无）')
  else {
    for (const video of videos) {
      const subject = video.subject ? ' · ' + escapeInline(video.subject) : ''
      lines.push('- ' + noteLink(video) + subject)
    }
  }
  lines.push('', '## 相关概念', '')
  if (!concepts.length) lines.push('（暂无）')
  else {
    for (const item of concepts) {
      lines.push('- ' + conceptLink(noteRoot, item.name) + ' · 出现 ' + item.count + ' 次')
    }
  }
  return lines.join('\n')
}
