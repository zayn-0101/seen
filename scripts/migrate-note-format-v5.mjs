#!/usr/bin/env node
/**
 * 把 format 4 的视频笔记迁移到 format 5。
 *
 * 默认只打印计划（dry-run）；加 --apply 才写文件，写前自动备份：
 *   <stateDir>/../backups/v5-<时间戳>/
 *     ├── 视频笔记/          整个笔记根目录
 *     └── state.json
 *
 * 用法：
 *   node scripts/migrate-note-format-v5.mjs
 *   node scripts/migrate-note-format-v5.mjs --apply
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveConfig } from '../core/lib/config.js'
import { loadState, saveState } from '../core/lib/state.js'
import { resolveVaultPath, safeFilename, toPosix } from '../core/lib/obsidian.js'
import { withInstanceLock } from '../core/lib/instance-lock.js'
import { checkNoteShape, parseNoteMarkdown } from '../core/lib/note-check.js'
import { cleanDisplayTitle, spaceCjkMarkdown } from '../core/lib/text.js'
import { conceptKey } from '../core/lib/concept.js'

const apply = process.argv.includes('--apply')
let vaultOverride = ''
let stateOverride = ''
for (const arg of process.argv.slice(2)) {
  if (arg === '--apply') continue
  if (arg.startsWith('--vault=')) { vaultOverride = arg.slice('--vault='.length); continue }
  if (arg.startsWith('--state-dir=')) { stateOverride = arg.slice('--state-dir='.length); continue }
  console.error('用法：node scripts/migrate-note-format-v5.mjs [--apply] [--vault=路径] [--state-dir=路径]')
  process.exit(2)
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const config = resolveConfig({
  ...(vaultOverride ? { vaultPath: vaultOverride } : {}),
  ...(stateOverride ? { stateDir: stateOverride } : {}),
})
const vaultPath = resolveVaultPath(config)
const noteRoot = String(config.noteRoot || '视频笔记').replace(/^\/+|\/+$/g, '')
const stateDir = config.stateDir || join(process.env.HOME || '.', '.seen', 'state')
const statePath = join(stateDir, 'state.json')
const rootAbs = join(vaultPath, noteRoot)
const MANUAL_START = '<!-- MANUAL:START -->'
const MANUAL_END = '<!-- MANUAL:END -->'

const PLATFORM_LABEL = { bilibili: 'B 站', youtube: 'YouTube', douyin: '抖音' }
const TYPE_LABEL = {
  tutorial: '教程', opinion: '观点', science: '科普', review: '评测',
  interview: '访谈', documentary: '纪录', course: '课程', other: '其他',
}
const OVERVIEW_TITLES = new Set([
  '关键数字', '章节', '前置条件', '操作步骤', '事件时间线',
  '对比表', '人物观点', '课程脉络', '练习',
])

function clean(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

function dateOnly(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function clockSeconds(value) {
  const parts = String(value ?? '').trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function durationText(seconds, fallback = '') {
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  const pad = (n) => String(n).padStart(2, '0')
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''))
}

function callout(type, title, lines) {
  const body = (Array.isArray(lines) ? lines : []).filter((line) => String(line ?? '').trim() !== '')
  return ['> [!' + type + ']- ' + title, '>', ...body.map((line) => '> ' + line)]
}

function calloutText(type, title, lines) {
  return callout(type, title, lines).join('\n')
}

function extractCallout(body, kind) {
  const lines = String(body ?? '').split('\n')
  const start = lines.findIndex((line) => new RegExp('^>\\s*\\[!' + kind + '\\]', 'i').test(line))
  if (start < 0) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.startsWith('>')) break
    out.push(line.replace(/^>\s?/, ''))
  }
  return out.join('\n').trim()
}

function parseInfoTable(body) {
  const rows = new Map()
  for (const line of String(body ?? '').split('\n')) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/)
    if (!match) continue
    const key = clean(match[1])
    const value = clean(match[2])
    if (!key || /^-+$/.test(key) || key === '项目') continue
    rows.set(key, value)
  }
  return rows
}

function parseStats(body) {
  const lines = []
  for (const line of String(body ?? '').split('\n')) {
    const match = line.match(/^-\s*([^：:]+?)[：:]\s*(.+)$/)
    if (!match) continue
    const label = clean(match[1])
    const value = clean(match[2])
    if (!/^(字幕|弹幕|评论|章节)$/.test(label)) continue
    lines.push('- ' + label + '：' + value)
  }
  return lines
}

function hasRealDiscussion(statsLines) {
  return statsLines.some((line) => /^-\s*(弹幕|评论)：/.test(line) && /\d/.test(line.replace(/^[^：]+：/, '')))
}

function subtitleLabel(source, contentSource) {
  const value = clean(contentSource)
  if (value === 'ai-subtitle') return source === 'bilibili' ? 'B 站 AI 字幕' : '自动字幕'
  if (value === 'up-subtitle') return 'UP 主字幕'
  if (value === 'auto-subtitle') return '自动字幕'
  if (value === 'whisper') return '本地 Whisper 转写'
  if (value === 'archive') return '存档字幕'
  if (value === 'metadata' || !value) return '无字幕（仅元数据）'
  return value
}

function authorKey(source) {
  if (source === 'youtube') return '频道'
  if (source === 'douyin') return '作者'
  return 'UP 主'
}

function parseConceptBullets(body) {
  const concepts = []
  for (const line of String(body ?? '').split('\n')) {
    const match = line.match(/^-\s+\*\*(.+?)\*\*\s*[—–-]\s*(.*?)\s*$/)
    if (!match) continue
    const name = clean(match[1])
    let definition = clean(match[2]).replace(/\s+\^concept-\S+\s*$/, '').trim()
    let aliases = []
    const aliasMatch = definition.match(/（别称[:：]\s*([^）]+)）/u)
    if (aliasMatch) {
      aliases = aliasMatch[1].split(/[、,，]/).map(clean).filter(Boolean)
      definition = definition.replace(aliasMatch[0], '').trim()
    }
    if (!name) continue
    concepts.push({ name, definition, aliases })
  }
  return concepts
}

function parseTermTable(body) {
  const terms = []
  for (const line of String(body ?? '').split('\n')) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/)
    if (!match) continue
    const name = clean(match[1])
    const definition = clean(match[2])
    if (!name || name === '术语' || /^-+$/.test(name)) continue
    terms.push({ name, definition })
  }
  return terms
}

function escapeCell(value) {
  return clean(value).replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

function buildConceptRows(note) {
  const concepts = parseConceptBullets(note.sectionMap.get('核心概念')?.body || '')
  const terms = parseTermTable(note.sectionMap.get('术语表')?.body || '')
  const rows = []
  const conceptKeys = new Set()
  const conceptNames = []
  for (const concept of concepts) {
    const key = conceptKey(concept.name)
    if (!key || conceptKeys.has(key)) continue
    conceptKeys.add(key)
    conceptNames.push(key)
    for (const alias of concept.aliases) {
      const aliasKey = conceptKey(alias)
      if (aliasKey) conceptKeys.add(aliasKey)
    }
    const name = concept.aliases.length > 0
      ? concept.name + '（' + concept.aliases.join('、') + '）'
      : concept.name
    rows.push([name, concept.definition || '—'])
  }
  for (const term of terms) {
    const key = conceptKey(term.name)
    if (!key || conceptKeys.has(key)) continue
    if (conceptNames.some((name) => name.length >= 2 && (key.includes(name) || name.includes(key)))) continue
    conceptKeys.add(key)
    rows.push([term.name, term.definition || '—'])
  }
  return rows
}

function buildReviewCards(note) {
  const cards = []
  for (const line of String(note.sectionMap.get('复习卡片')?.body || '').split('\n')) {
    const text = line.trim()
    const index = text.indexOf('::')
    if (index <= 0) continue
    const question = clean(text.slice(0, index))
    const answer = clean(text.slice(index + 2))
    if (!question || !answer || !/[?？]$/.test(question)) continue
    if (cards.some((card) => card.question.toLowerCase() === question.toLowerCase())) continue
    cards.push({ question, answer })
  }
  return cards.slice(0, 5)
}

function buildAbstract(body, video) {
  const overview = clean(extractCallout(body, 'abstract')) || clean(video.summary)
  const question = clean(extractCallout(body, 'question')) || clean(video.question)
  const answer = clean(extractCallout(body, 'success')) || clean(video.answer)
  const lines = ['> [!abstract] 摘要', '> **概述**']
  if (overview) lines.push('> ' + overview.replace(/\n/g, '\n> '))
  if (question) {
    lines.push('>', '> **核心问题**', '> ' + question.replace(/\n/g, '\n> '))
  }
  if (answer) {
    lines.push('>', '> **核心结论**', '> ' + answer.replace(/\n/g, '\n> '))
  }
  return lines
}

function buildManual(note) {
  const body = note.sectionMap.get('我的补充')?.body || ''
  const start = body.indexOf(MANUAL_START)
  const end = body.indexOf(MANUAL_END)
  if (start >= 0 && end > start) {
    return body.slice(start + MANUAL_START.length, end).replace(/^\n+|\n+$/g, '')
  }
  return ''
}

function transformNote(note, video, originalTitle) {
  const displayTitle = safeFilename(cleanDisplayTitle(originalTitle), 80)
  const oldRel = toPosix(video.notePath)
  const dir = dirname(oldRel)
  const newRel = (dir && dir !== '.' ? dir + '/' : '') + displayTitle + '.md'
  const info = parseInfoTable(note.sectionMap.get('视频信息')?.body || '')
  const durationSeconds = note.duration || clockSeconds(info.get('时长') || '')
  const duration = durationText(durationSeconds, info.get('时长') || '')
  const url = clean(note.meta.url) || clean(info.get('链接'))
  const source = clean(note.meta.source)
  const author = clean(note.meta.author) || clean(info.get(authorKey(source))) || clean(info.get('UP 主')) || clean(info.get('频道')) || clean(info.get('作者'))
  const subject = clean(note.meta.subject) || clean(video.subject) || '未分类'
  const createdAt = clean(note.meta.created) || dateOnly(video.createdAt)
  const updatedAt = dateOnly()
  const contentSource = clean(note.meta.contentSource)
  const contentQuality = clean(note.meta.contentQuality) || 'full'
  const contentType = clean(note.meta.contentType) || 'other'
  const quality = Number(note.meta.quality) || 0
  const oldTags = Array.isArray(note.tags) ? note.tags.map(String) : []
  const themeTags = oldTags.filter((tag) => tag && tag !== subject && !tag.includes('/') && tag !== 'flashcards')
  const noteTags = [subject, ...themeTags.slice(0, 4)]
  const cards = buildReviewCards(note)
  if (cards.length > 0) noteTags.push('flashcards')
  const conceptRows = buildConceptRows(note)

  let review = null
  if (typeof note.meta.review === 'string') {
    try { review = JSON.parse(note.meta.review) } catch { review = null }
  } else if (note.meta.review && typeof note.meta.review === 'object') {
    review = note.meta.review
  }

  const frontmatter = [
    '---',
    '平台: ' + yamlString(PLATFORM_LABEL[source] || source || '未知'),
    '类型: ' + yamlString(TYPE_LABEL[contentType] || contentType),
    authorKey(source) + ': ' + yamlString(author),
    '时长: ' + yamlString(duration),
    ...(clean(note.meta.publishedAt) ? ['发布时间: ' + yamlString(note.meta.publishedAt)] : []),
    '字幕: ' + yamlString(subtitleLabel(source, contentSource)),
    '视频链接: ' + yamlString(url),
    '学科: ' + yamlString(subject),
    '笔记创建: ' + yamlString(createdAt),
    '笔记更新: ' + yamlString(updatedAt),
    'tags: ' + JSON.stringify(noteTags),
    'cssclasses: ["seen-note"]',
    '---',
    '',
  ]

  const bodyLines = []
  if (contentQuality !== 'full') {
    bodyLines.push('> [!warning] 内容依据有限', '> 未获取到视频字幕/转写，本文主要基于简介、标签和观众讨论整理，知识点可能不完整或有偏差。', '')
  }
  bodyLines.push(...buildAbstract(note.body, video), '')
  const manualTarget = note.manualLinkTarget || (noteRoot + '/资料/手册/' + subject)
  bodyLines.push('学科：[[' + manualTarget + '|' + subject + ' 学习手册]]', '')

  const speed = []
  for (const section of note.sections) {
    if (!OVERVIEW_TITLES.has(section.title)) continue
    const body = section.body.trim()
    if (!body) continue
    speed.push('### ' + section.title, '', body, '')
  }
  if (speed.length > 0) bodyLines.push('## 01 速览', '', ...speed)

  const knowledge = note.sectionMap.get('核心知识点')?.body.trim() || ''
  if (knowledge) bodyLines.push('## 02 核心知识点', '', knowledge, '')

  const doubts = note.sectionMap.get('可质疑之处')?.body.trim() || ''
  const misconceptions = note.sectionMap.get('常见误解')?.body.trim() || ''
  if (doubts || misconceptions) {
    const title = doubts ? '可质疑之处' : '常见误解'
    bodyLines.push('## 03 ' + title, '')
    if (doubts) bodyLines.push(doubts, '')
    if (misconceptions) {
      if (doubts) bodyLines.push('### 常见误解', '')
      bodyLines.push(misconceptions, '')
    }
  }

  if (conceptRows.length > 0) {
    bodyLines.push('## 04 核心概念与术语', '', '| 概念 / 术语 | 解释 |', '| --- | --- |')
    for (const row of conceptRows) bodyLines.push('| ' + escapeCell(row[0]) + ' | ' + escapeCell(row[1]) + ' |')
    bodyLines.push('')
  }

  const related = note.sectionMap.get('相关笔记')?.body.trim() || ''
  if (related) bodyLines.push('## 05 相关笔记', '', related, '')

  if (cards.length > 0) {
    bodyLines.push('## 06 复习卡片', '', '> [!summary]- 展开 ' + cards.length + ' 张卡片', '>')
    cards.forEach((card, index) => {
      bodyLines.push('> **' + card.question + '**', '>', '> ?', '>', '> **答案：** ' + card.answer)
      if (index < cards.length - 1) bodyLines.push('>')
    })
    bodyLines.push('')
  }

  const appendix = []
  const quotes = []
  for (const line of String(note.sectionMap.get('原话摘录')?.body || '').split('\n')) {
    const text = line.replace(/^>\s?/, '').trim()
    if (text) quotes.push('- ' + text)
  }
  if (quotes.length > 0) appendix.push(calloutText('quote', '原话摘录（' + quotes.length + ' 条）', quotes), '')

  const resources = String(note.sectionMap.get('提到的资源')?.body || '').split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '))
  if (resources.length > 0) appendix.push(calloutText('note', '提到的资源（' + resources.length + ' 个）', resources), '')

  const discussion = String(note.sectionMap.get('讨论焦点')?.body || note.sectionMap.get('弹幕与评论讨论焦点')?.body || '').split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- '))
  const stats = parseStats(note.sectionMap.get('来源统计')?.body || '')
  if (discussion.length > 0) {
    const label = hasRealDiscussion(stats)
      ? (source === 'youtube' ? '讨论焦点（YouTube 评论）' : '观众讨论（B 站弹幕 / 评论）')
      : '延伸思考'
    appendix.push(calloutText('note', label, discussion), '')
  }
  if (stats.length > 0) appendix.push(calloutText('info', '抓取统计', stats), '')
  if (appendix.length > 0) bodyLines.push(...appendix)

  bodyLines.push('## 07 我的补充', '', '> 记录疑问、联想或待查资料。', '', MANUAL_START, buildManual(note), MANUAL_END, '')

  let sectionNumber = 0
  for (let i = 0; i < bodyLines.length; i += 1) {
    if (/^## \d{2} /.test(bodyLines[i])) {
      sectionNumber += 1
      bodyLines[i] = bodyLines[i].replace(/^## \d{2} /, '## ' + String(sectionNumber).padStart(2, '0') + ' ')
    }
  }

  const meta = {
    title: originalTitle,
    displayTitle,
    subject,
    source,
    url,
    author,
    contentSource,
    contentQuality,
    contentType,
    quality,
    type: 'video-note',
    format: 5,
    duration: durationSeconds,
    ...(clean(note.meta.publishedAt) ? { publishedAt: clean(note.meta.publishedAt) } : {}),
    ...(review && typeof review === 'object' ? { review } : {}),
    ...(clean(note.meta.bvid) ? { bvid: clean(note.meta.bvid) } : {}),
    ...(clean(note.meta.videoId) ? { videoId: clean(note.meta.videoId) } : {}),
    ...(clean(note.meta.transcriptOrigin) ? { transcriptOrigin: clean(note.meta.transcriptOrigin) } : {}),
  }
  bodyLines.push('<!-- seen-meta', JSON.stringify(meta, null, 2), '-->', '')

  return {
    oldRel,
    newRel,
    displayTitle,
    originalTitle,
    content: frontmatter.join('\n') + bodyLines.join('\n'),
    noteTags,
    cards,
    concepts: conceptRows.length,
    durationSeconds,
    oldTranscriptRel: clean(video.transcriptPath),
  }
}

function linkKey(value) {
  return toPosix(String(value ?? '').trim()).replace(/^\.\//, '').replace(/\.md$/i, '')
}

function rewriteLinks(text, linkMap, titleMap) {
  return String(text ?? '').replace(/\[\[([^\]|#\\]+)(#[^\]|]*)?(?:(\\)?\|([^\]]*))?\]\]/g, (full, target, hash = '', escaped = '', alias = '') => {
    const rawTarget = clean(target)
    const key = linkKey(rawTarget)
    const replacement = linkMap.get(key)
    if (!replacement) return full
    const sep = escaped ? '\\|' : '|'
    let nextAlias = alias
    if (alias) {
      const oldBase = basename(rawTarget)
      const oldTitle = titleMap.get(key)
      if (alias === oldTitle || alias === oldBase || alias === rawTarget) {
        nextAlias = replacement.split('/').pop().replace(/\.md$/i, '')
      }
      return '[[' + replacement + (hash || '') + sep + nextAlias + ']]'
    }
    return '[[' + replacement + (hash || '') + ']]'
  })
}

function walkMarkdown(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(abs))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(abs)
  }
  return out
}

async function main() {
  if (!existsSync(rootAbs)) throw new Error('笔记根目录不存在：' + rootAbs)
  const state = loadState(statePath, { strict: true })
  const records = []
  for (const [subject, group] of Object.entries(state.subjects || {})) {
    for (const video of group.videos || []) {
      if (!video.notePath) continue
      const abs = join(vaultPath, video.notePath)
      if (!existsSync(abs)) continue
      records.push({ subject, video, abs, markdown: readFileSync(abs, 'utf8') })
    }
  }
  console.log('找到 ' + records.length + ' 篇 format 4 笔记')

  const transformed = []
  for (const record of records) {
    const note = parseNoteMarkdown(record.markdown)
    if (note.format >= 5) continue
    const title = clean(note.meta.title) || clean(record.video.title) || basename(record.abs, '.md')
    const result = transformNote(note, record.video, title)
    const check = checkNoteShape(parseNoteMarkdown(result.content))
    transformed.push({ ...record, ...result, check })
  }

  const collisions = new Map()
  for (const item of transformed) {
    const key = item.newRel.toLowerCase()
    if (collisions.has(key)) throw new Error('文件名冲突：' + item.newRel)
    collisions.set(key, item)
  }
  for (const item of transformed) {
    if (item.newRel !== item.oldRel && existsSync(join(vaultPath, item.newRel))) {
      const target = transformed.find((other) => other.oldRel === item.newRel)
      if (!target) throw new Error('目标文件已存在：' + item.newRel)
    }
  }

  const linkMap = new Map()
  const titleMap = new Map()
  for (const item of transformed) {
    const oldKey = linkKey(item.oldRel)
    const newKey = linkKey(item.newRel)
    if (oldKey !== newKey) {
      linkMap.set(oldKey, newKey)
      titleMap.set(oldKey, item.originalTitle)
    }
    if (item.oldTranscriptRel) {
      const oldTranscriptKey = linkKey(item.oldTranscriptRel)
      const newTranscriptRel = item.newRel.replace(/\.md$/i, '') === item.oldRel.replace(/\.md$/i, '')
        ? item.oldTranscriptRel
        : item.oldTranscriptRel.replace(/[^/]+\.md$/i, item.displayTitle + '.md')
      if (oldTranscriptKey !== linkKey(newTranscriptRel)) {
        linkMap.set(oldTranscriptKey, linkKey(newTranscriptRel))
      }
      item.newTranscriptRel = newTranscriptRel
    }
  }

  const outputs = new Map()
  for (const item of transformed) {
    const rewritten = spaceCjkMarkdown(rewriteLinks(item.content, linkMap, titleMap))
    outputs.set(item.newRel, rewritten)
    const after = parseNoteMarkdown(rewritten)
    item.findings = checkNoteShape(after)
  }
  const allFiles = walkMarkdown(rootAbs)
  const oldNoteRels = new Set(transformed.map((item) => item.oldRel))
  let linkChanges = 0
  for (const abs of allFiles) {
    const rel = toPosix(abs.slice(vaultPath.length + 1))
    if (oldNoteRels.has(rel)) continue
    const before = readFileSync(abs, 'utf8')
    const after = rewriteLinks(before, linkMap, titleMap)
    if (after !== before) {
      outputs.set(rel, after)
      linkChanges += 1
    }
  }

  let errors = 0
  for (const item of transformed) {
    const errs = item.findings.filter((finding) => finding.level === 'error')
    errors += errs.length
    console.log('---')
    console.log(item.oldRel)
    console.log('  -> ' + item.newRel)
    console.log('  标签 ' + JSON.stringify(item.noteTags) + '，概念 ' + item.concepts + '，卡片 ' + item.cards.length)
    if (errs.length > 0) console.log('  错误 ' + errs.map((finding) => finding.code + ':' + finding.message).join('；'))
  }
  console.log('---')
  console.log('改名 ' + transformed.filter((item) => item.newRel !== item.oldRel).length + ' 篇；引用会改 ' + linkChanges + ' 个文件；结构错误 ' + errors + ' 项')
  if (errors > 0) {
    console.error('存在结构错误，停止。先修正转换规则再执行 --apply。')
    process.exit(1)
  }

  if (!apply) {
    console.log('dry-run：没有写任何文件。确认后运行 --apply。')
    return
  }

  const backupRoot = join(stateDir, '..', 'backups', 'v5-' + STAMP)
  mkdirSync(backupRoot, { recursive: true })
  cpSync(rootAbs, join(backupRoot, noteRoot), { recursive: true, preserveTimestamps: true })
  cpSync(statePath, join(backupRoot, 'state.json'))
  console.log('备份完成：' + backupRoot)

  return withInstanceLock(stateDir, async () => {
    // 先把改名文件移到新路径，再统一写内容；否则旧文件会留在原处变成重复笔记。
    for (const item of transformed) {
      if (item.newRel === item.oldRel) continue
      const oldAbs = join(vaultPath, item.oldRel)
      const newAbs = join(vaultPath, item.newRel)
      if (!existsSync(oldAbs)) continue
      if (existsSync(newAbs)) throw new Error('新旧文件同时存在，停止改名：' + item.oldRel + ' -> ' + item.newRel)
      mkdirSync(dirname(newAbs), { recursive: true })
      renameSync(oldAbs, newAbs)
    }
    for (const [rel, content] of outputs) {
      const abs = join(vaultPath, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content, 'utf8')
    }

    for (const item of transformed) {
      if (item.newTranscriptRel && item.newTranscriptRel !== item.oldTranscriptRel && existsSync(join(vaultPath, item.oldTranscriptRel))) {
        const target = join(vaultPath, item.newTranscriptRel)
        if (!existsSync(target)) {
          mkdirSync(dirname(target), { recursive: true })
          const oldAbs = join(vaultPath, item.oldTranscriptRel)
          let archiveText = readFileSync(oldAbs, 'utf8')
          archiveText = archiveText.replace(/^notePath:.*$/m, 'notePath: ' + JSON.stringify(item.newRel))
          archiveText = rewriteLinks(archiveText, linkMap, titleMap)
          renameSync(oldAbs, target)
          writeFileSync(target, archiveText, 'utf8')
        }
      }
    }

    for (const item of transformed) {
      const video = item.video
      video.title = item.displayTitle
      video.originalTitle = item.originalTitle
      video.displayTitle = item.displayTitle
      video.notePath = item.newRel
      if (item.newTranscriptRel) video.transcriptPath = item.newTranscriptRel
      video.noteTags = item.noteTags
      video.duration = item.durationSeconds
      if (!Array.isArray(video.tags)) video.tags = []
    }
    saveState(statePath, state)
    console.log('已写入 ' + outputs.size + ' 个文件，state 已更新。')
  })
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
