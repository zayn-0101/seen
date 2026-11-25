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
import { withInstanceLock } from '../core/lib/instance-lock.js'
import { randomUUID } from 'node:crypto'
import { join, relative } from 'node:path'

import { callLlm, normalizeConcepts, parseJson } from '../core/lib/analyze.js'
import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { splitFrontmatter } from '../core/lib/note-check.js'
import { readVaultText, resolveVaultPath, updateNoteTags } from '../core/lib/obsidian.js'
import { buildHistoryFromState, writeKnowledgeIndexes } from '../core/lib/rebuild.js'
import { loadState, saveState } from '../core/lib/state.js'
import {
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
const limitText = limitIndex < 0 ? '0' : argv[limitIndex + 1] || ''
const limit = Number(limitText)
if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit)) {
  console.error('--limit 需要非负整数，0 表示全部')
  process.exit(2)
}

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

/** 读 frontmatter 里现有的 tags 数组。 */
function readTags(frontmatter) {
  const line = String(frontmatter || '')
    .split(/\r?\n/)
    .find((item) => /^tags:/.test(item))
  if (!line) return []
  if (line.slice(5).trim() === '') {
    const list = frontmatter.match(/^tags:[ \t]*((?:\r?\n[ \t]*-[ \t]+[^\r\n]+)+)/m)
    return list ? list[1].trim().split(/\r?\n/).map(item => item.replace(/^\s*-\s+/, '').trim().replace(/^(["'])(.*)\1$/, '$2')) : []
  }
  try {
    const parsed = JSON.parse(line.slice(5).trim())
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** 从旧标签的「概念/xxx」还原概念名，给状态里没存概念的早期笔记兜底。 */
function conceptsFromTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag ?? '').trim())
    .filter((tag) => tag.startsWith('概念/'))
    .map((tag) => tag.slice(3).trim())
    .filter(Boolean)
}

function buildPrompt({ title, subject, summary, concepts, body, vocabulary, needConcepts }) {
  const parts = [
    '标题：' + title,
    '学科：' + subject,
  ]
  if (summary) parts.push('现有摘要：' + summary)
  if (concepts.length) parts.push('核心概念：' + concepts.join('、'))
  if (vocabulary.length) {
    parts.push(
      '【已有主题词表】' + vocabulary.join('、'),
      '主题能归入上表的，必须原样复用写法，不要另造近义词或上义词；用不上的词一条都不要硬套。',
    )
  }
  parts.push(
    '',
    '【正文节选】',
    body,
    '',
    '【任务】为这篇视频笔记重新给一组标签：',
    '- themes：2~4 个主题词，每个 2~6 个汉字（英文名不超过 12 个字符），写视频主体所属的领域或主题，例如「人工智能」「游戏设计」「语言文化」；只是顺带提到的大领域不算，不要写具体概念名，不要写平台名（B站/抖音/YouTube），不要重复「学科」那一栏的学科名，不要写「视频」「教程」「干货」这类形态词，不要带括号、书名号、引号。',
    '- types：从「教程、科普、访谈、评测、观点、纪录、播客、课程」里选 0~2 个，必须原样使用。',
    ...(needConcepts ? [
      '- concepts：3~6 个具体概念，每个 2~8 个汉字，写视频里真正讲到的术语、方法、模型或框架（例如「双向链接」「边际效用」）；不要写学科名和主题词，不要写「方法」「技巧」「原理」这类空泛词，不要带括号。',
    ] : []),
    '- 宁可少而准，不要堆砌。',
    needConcepts
      ? '只输出 JSON：{"concepts":["..."],"themes":["..."],"types":["..."]}'
      : '只输出 JSON：{"themes":["..."],"types":["..."]}',
  )
  return parts.join('\n')
}

async function retagNotes() {
  const vaultPath = resolveVaultPath(config)
  const stateFile = join(config.stateDir, 'state.json')
  const state = loadState(stateFile, { strict: true })

  const llmConfig = loadLlmConfig()
  const client = createLlmClient(llmConfig)
  const ctx = { llm: client }
  const llmOptions = { provider: llmConfig.provider, model: llmConfig.model }

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

  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
  const backupRoot = join(config.stateDir, '..', 'backups', '重打标签-' + stamp)

  let changed = 0
  let failed = 0
  let backedUp = false
  for (const [index, item] of picked.entries()) {
    const { subject, video } = item
    const absPath = join(vaultPath, video.notePath)
    const label = '[' + (index + 1) + '/' + picked.length + '] ' + video.title
    const note = await readVaultText({ vaultPath, relPath: video.notePath })
    if (!note.ok) {
      console.log(label + ' → ' + note.error)
      failed += 1
      continue
    }
    const { frontmatter, body } = splitFrontmatter(note.text)
    if (!frontmatter) {
      console.log(label + ' → 缺少笔记属性区，已跳过')
      failed += 1
      continue
    }
    const oldTags = readTags(frontmatter)
    const storedConcepts = Array.isArray(video.concepts) ? video.concepts : []
    // 早期笔记的状态里没有 concepts 字段，但旧标签可能留着「概念/xxx」，用它兜底
    let concepts = storedConcepts.length ? storedConcepts : conceptsFromTags(oldTags)
    // 仍然没有概念的，就让模型顺手从正文里抽一批，补上概念索引的数据缺口
    const needConcepts = concepts.length === 0
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
          needConcepts,
        }) }] }],
        maxTokens: needConcepts ? 1200 : 800,
      })
      parsed = parseJson(raw)
      const themes = parsed?.themes ?? parsed?.tags?.themes ?? parsed?.tagSet?.themes
      const types = parsed?.types ?? parsed?.tags?.types ?? parsed?.tagSet?.types
      if (![themes, types].some(value => Array.isArray(value) || typeof value === 'string')) {
        throw new Error('模型未返回可用的主题词或类型')
      }
    } catch (error) {
      console.log(label + ' → 失败：' + String((error && error.message) || error))
      failed += 1
      continue
    }

    if (needConcepts) {
      concepts = normalizeConcepts(parsed?.concepts ?? []).map((item) => item.name)
    }
    const themes = normalizeThemes(parsed?.themes ?? parsed?.tags?.themes ?? parsed?.tagSet?.themes ?? [])
    const types = normalizeTagTypes(parsed?.types ?? parsed?.tags?.types ?? parsed?.tagSet?.types ?? [])
    const tags = mergeTags({ subject, themes, types, concepts })

    console.log(label)
    console.log('  旧：' + (oldTags.length ? oldTags.join(' · ') : '（无）'))
    console.log('  新：' + tags.join(' · '))
    const noteChanged = JSON.stringify(tags) !== JSON.stringify(oldTags)
    const stateTagsChanged = JSON.stringify(tags) !== JSON.stringify(video.tags || [])
    const addConcepts = !storedConcepts.length && concepts.length > 0
    if (!tags.length || (!noteChanged && !stateTagsChanged && !addConcepts)) {
      console.log('  → 无变化')
      continue
    }
    if (!apply) {
      changed += 1
      // 预演也把新词累加进内存词表，让后面的篇目复用同一套写法（不落盘）
      if (stateTagsChanged) rememberTags(state, tags)
      continue
    }

    if (noteChanged) {
      const result = await updateNoteTags({
        vaultPath, notePath: video.notePath, tags,
        backup: { root: backupRoot, destRelPath: relative(join(vaultPath, config.noteRoot), absPath) },
      })
      if (!result.ok) {
        console.log(label + ' → ' + result.error)
        failed += 1
        continue
      }
      backedUp = true
    }
    changed += 1
    video.tags = tags
    // 从旧标签还原出来的概念要落回状态，否则概念索引还是缺这几篇
    if (addConcepts) video.concepts = concepts
    if (stateTagsChanged) rememberTags(state, tags)
    const { backupError } = saveState(stateFile, state)
    if (backupError) console.warn('状态已保存，更新备份失败：' + backupError)
  }

  // 即使笔记已在上次写完，重试也要补齐随后未成功的索引。
  if (apply && picked.length > failed) {
    await writeKnowledgeIndexes({ vaultPath, noteRoot: config.noteRoot, history: buildHistoryFromState(state) })
    console.log('')
    if (backedUp) console.log('备份：' + backupRoot)
    console.log('索引已重建：视频索引.md / 概念索引.md / 标签索引.md')
  }

  console.log('')
  console.log('完成：处理 ' + picked.length + ' 篇，需改动 ' + changed + ' 篇，失败 ' + failed + ' 篇')
  if (failed) process.exitCode = 1
  if (!apply && changed > 0) console.log('加 --apply 写入时，每篇原文会备份到 ' + join(config.stateDir, '..', 'backups') + ' 下独立的重打标签目录')
}

try {
  await (apply ? withInstanceLock(config.stateDir, retagNotes) : retagNotes())
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
