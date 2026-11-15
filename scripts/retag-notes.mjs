#!/usr/bin/env node
/**
 * 重打历史笔记的标签。
 *
 * 用法：
 *   node scripts/retag-notes.mjs                 预演，逐篇打印前后对照
 *   node scripts/retag-notes.mjs --apply         写回 frontmatter、同步 state、重建索引
 *   node scripts/retag-notes.mjs --limit 3       只处理前 3 篇（调试用）
 *
 * 只读笔记正文前 3000 字做判断，不重跑转写和总结。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { callLlm, parseJson } from '../core/lib/analyze.js'
import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { buildConceptIndex } from '../core/lib/concept.js'
import { buildConceptIndexMarkdown, buildIndexMarkdown, buildTagIndexMarkdown } from '../core/lib/index-note.js'
import {
  resolveVaultPath,
  writeConceptIndexNote,
  writeIndexNote,
  writeTagIndexNote,
} from '../core/lib/obsidian.js'
import { loadState, saveState } from '../core/lib/state.js'
import {
  buildTagIndex,
  buildTagVocabulary,
  mergeTags,
  normalizeTagTypes,
  normalizeThemes,
  rememberTags,
} from '../core/lib/tags.js'
import { createLlmClient, loadLlmConfig } from '../server/llm.js'

const BODY_CHARS = 3000

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const limitIndex = argv.indexOf('--limit')
const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) || 0 : 0

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

const vaultPath = resolveVaultPath(config)
const stateFile = join(config.stateDir, 'state.json')
const state = loadState(stateFile)

const llmConfig = loadLlmConfig()
const client = createLlmClient(llmConfig)
const ctx = { llm: client }
const llmOptions = { provider: llmConfig.provider, model: llmConfig.model }

/** 拆出 frontmatter 与正文。 */
function splitFrontmatter(markdown) {
  const text = String(markdown || '').replace(/^\uFEFF/, '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: '', body: text }
  return { frontmatter: match[1], body: text.slice(match[0].length) }
}

/** 读 frontmatter 里现有的 tags 数组。 */
function readTags(frontmatter) {
  const line = String(frontmatter || '')
    .split(/\r?\n/)
    .find((item) => /^tags:/.test(item))
  if (!line) return []
  try {
    const parsed = JSON.parse(line.slice(5).trim())
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** 替换（或补上）frontmatter 的 tags 行。 */
function writeTags(markdown, tags) {
  const lines = String(markdown || '').split('\n')
  if (lines[0] !== '---') return markdown
  const end = lines.indexOf('---', 1)
  if (end === -1) return markdown
  const value = 'tags: ' + JSON.stringify(tags)
  const index = lines.findIndex((line, i) => i > 0 && i < end && /^tags:/.test(line))
  if (index === -1) lines.splice(end, 0, value)
  else lines[index] = value
  return lines.join('\n')
}

function buildPrompt({ title, subject, summary, concepts, body, vocabulary }) {
  const parts = [
    '标题：' + title,
    '学科：' + subject,
  ]
  if (summary) parts.push('现有摘要：' + summary)
  if (concepts.length) parts.push('核心概念：' + concepts.join('、'))
  if (vocabulary.length) {
    parts.push(
      '【已有主题词表】' + vocabulary.join('、'),
      '主题能归入上表的，必须原样复用写法，不要另造近义词或上义词。',
    )
  }
  parts.push(
    '',
    '【正文节选】',
    body,
    '',
    '【任务】为这篇视频笔记重新给一组标签：',
    '- themes：2~4 个主题词，每个 2~6 个汉字（英文名不超过 12 个字符），写它所属的领域或主题，例如「人工智能」「游戏设计」「语言文化」；不要写具体概念名，不要写平台名（B站/抖音/YouTube），不要重复「学科」那一栏的学科名，不要写「视频」「教程」「干货」这类形态词，不要带括号、书名号、引号。',
    '- types：从「教程、科普、访谈、评测、观点、纪录、播客、课程」里选 0~2 个，必须原样使用。',
    '- 宁可少而准，不要堆砌。',
    '只输出 JSON：{"themes":["..."],"types":["..."]}',
  )
  return parts.join('\n')
}

const targets = []
for (const [subject, data] of Object.entries(state.subjects || {})) {
  for (const video of (data && data.videos) || []) {
    if (!video || !video.notePath) continue
    targets.push({ subject, video })
  }
}
targets.sort((a, b) => (b.video.createdAt || 0) - (a.video.createdAt || 0))
const picked = limit > 0 ? targets.slice(0, limit) : targets

console.log('vault：' + vaultPath)
console.log('状态：' + stateFile)
console.log('模型：' + (llmConfig.model || '（未配置）') + ' · ' + (llmConfig.baseURL || ''))
console.log((apply ? '【写入模式】' : '【预演模式】不会改任何文件，加 --apply 才写') + ' 共 ' + picked.length + ' 篇')
console.log('')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupRoot = join(vaultPath, config.noteRoot, '_备份', '重打标签-' + stamp)

let changed = 0
let failed = 0
for (const [index, item] of picked.entries()) {
  const { subject, video } = item
  const absPath = join(vaultPath, video.notePath)
  const label = '[' + (index + 1) + '/' + picked.length + '] ' + video.title
  if (!existsSync(absPath)) {
    console.log(label + ' → 跳过（笔记不存在：' + video.notePath + '）')
    failed += 1
    continue
  }
  const markdown = readFileSync(absPath, 'utf8')
  const { frontmatter, body } = splitFrontmatter(markdown)
  const oldTags = readTags(frontmatter)
  const concepts = Array.isArray(video.concepts) ? video.concepts : []
  let parsed = null
  try {
    const raw = await callLlm(ctx, llmOptions, {
      system: '你是笔记标签整理助手，只输出 JSON。',
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt({
        title: video.title || '',
        subject: subject,
        summary: video.summary || '',
        concepts,
        body: body.slice(0, BODY_CHARS),
        vocabulary: buildTagVocabulary(state),
      }) }] }],
      maxTokens: 800,
    })
    parsed = parseJson(raw)
  } catch (error) {
    console.log(label + ' → 失败：' + String((error && error.message) || error))
    failed += 1
    continue
  }

  const themes = normalizeThemes(parsed?.themes ?? parsed?.tags?.themes ?? parsed?.tagSet?.themes ?? [])
  const types = normalizeTagTypes(parsed?.types ?? parsed?.tags?.types ?? parsed?.tagSet?.types ?? [])
  const tags = mergeTags({ subject, themes, types, concepts })

  console.log(label)
  console.log('  旧：' + (oldTags.length ? oldTags.join(' · ') : '（无）'))
  console.log('  新：' + tags.join(' · '))
  if (!tags.length || tags.join('|') === oldTags.join('|')) {
    console.log('  → 无变化')
    continue
  }
  changed += 1
  if (!apply) {
    // 预演也把新词累加进内存词表，让后面的篇目复用同一套写法（不落盘）
    rememberTags(state, tags)
    continue
  }

  const backupPath = join(backupRoot, relative(join(vaultPath, config.noteRoot), absPath))
  mkdirSync(dirname(backupPath), { recursive: true })
  copyFileSync(absPath, backupPath)
  writeFileSync(absPath, writeTags(markdown, tags), 'utf8')
  video.tags = tags
  rememberTags(state, tags)
}

if (apply && changed > 0) {
  saveState(stateFile, state)
  const history = []
  for (const [subject, data] of Object.entries(state.subjects || {})) {
    for (const video of (data && data.videos) || []) {
      if (!video) continue
      history.push({
        subject,
        title: video.title || '',
        source: video.source || 'bilibili',
        bvid: video.bvid || '',
        videoId: video.videoId || '',
        url: video.url || '',
        author: video.author || '',
        notePath: video.notePath || '',
        summary: video.summary || '',
        keywords: video.keywords || [],
        concepts: Array.isArray(video.concepts) ? video.concepts : [],
        tags: Array.isArray(video.tags) ? video.tags : [],
        createdAt: video.createdAt || 0,
      })
    }
  }
  const noteRoot = config.noteRoot
  writeIndexNote({ vaultPath, noteRoot, markdown: buildIndexMarkdown(history, { noteRoot }) })
  writeConceptIndexNote({ vaultPath, noteRoot, markdown: buildConceptIndexMarkdown(buildConceptIndex(history), { noteRoot }) })
  writeTagIndexNote({ vaultPath, noteRoot, markdown: buildTagIndexMarkdown(buildTagIndex(history), { noteRoot }) })
  console.log('')
  console.log('备份：' + backupRoot)
  console.log('索引已重建：视频索引.md / 概念索引.md / 标签索引.md')
}

console.log('')
console.log('完成：处理 ' + picked.length + ' 篇，需改动 ' + changed + ' 篇，失败 ' + failed + ' 篇')
if (!apply && changed > 0) console.log('确认无误后加 --apply 写入（会先备份到 _备份/重打标签-<时间>）')
