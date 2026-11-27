#!/usr/bin/env node
/**
 * 给旧笔记补 3~5 张真正的复习问答卡。
 *
 * 默认只生成并打印，不写文件；加 --apply 才写入，写前把每篇原文和生成结果备份到
 * ~/.seen/backups/review-cards-<时间>/manifest.json。
 *
 * 用法：
 *   node scripts/refill-review-cards.mjs
 *   node scripts/refill-review-cards.mjs --limit=1 --only=3A
 *   node scripts/refill-review-cards.mjs --apply --cache=/tmp/review-cards.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../core/lib/config.js'
import { readVaultText, resolveVaultPath, writeVaultText } from '../core/lib/obsidian.js'
import { loadState } from '../core/lib/state.js'
import { parseNoteMarkdown } from '../core/lib/note-check.js'
import { normalizeReviewCards } from '../core/lib/note-content.js'
import { spaceCjk } from '../core/lib/text.js'
import { callLlm, parseJson } from '../core/lib/analyze.js'
import { createLlmClient, resolveLlmConfig } from '../server/llm.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const refresh = args.includes('--refresh')
const limitArg = args.find((item) => item.startsWith('--limit=')) || ''
const limit = Number(limitArg.split('=')[1]) || 0
const onlyArg = args.find((item) => item.startsWith('--only=')) || ''
const only = onlyArg.slice('--only='.length).trim()
const cacheArg = args.find((item) => item.startsWith('--cache=')) || ''
const cachePath = cacheArg ? cacheArg.slice('--cache='.length) : join(homedir(), '.seen', 'cache', 'review-cards-draft.json')

const SYSTEM = '你是视频笔记的复习卡编辑。只输出 JSON，不要 Markdown 代码块，不要解释。'

function log(message) {
  process.stdout.write(message + '\n')
}

function readCache() {
  if (!existsSync(cachePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveCache(cache) {
  mkdirSync(join(homedir(), '.seen', 'cache'), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 })
}

function collectNotes(state) {
  const records = []
  const seen = new Set()
  for (const bucket of Object.values(state.subjects || {})) {
    for (const video of Object.values(bucket?.videos || {})) {
      const relPath = String(video?.notePath || '').trim()
      if (!relPath || seen.has(relPath)) continue
      seen.add(relPath)
      records.push({ relPath, subject: String(video?.subject || bucket?.name || ''), title: String(video?.displayTitle || video?.title || '') })
    }
  }
  return records.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'))
}

function findReviewBlock(text) {
  const lines = text.split('\n')
  let heading = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+(?:\d{1,2}\s+)?复习卡片\s*$/.test(lines[i])) {
      heading = i
      break
    }
  }
  if (heading < 0) return null
  let start = -1
  for (let i = heading + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break
    if (/^> \[!summary\]/.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (/^> \[!/.test(line)) break
    if (line.startsWith('>')) {
      end += 1
      continue
    }
    if (line.trim() === '') {
      end += 1
      continue
    }
    break
  }
  return { lines, heading, start, end }
}

function contextBeforeReview(text, block) {
  const lines = block.lines.slice(0, block.heading)
  const abstractIndex = lines.findIndex((line) => line.startsWith('> [!abstract]'))
  const body = abstractIndex >= 0 ? lines.slice(abstractIndex) : lines
  return body.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 9000)
}

function renderBlock(cards) {
  const lines = ['> [!summary]- 展开 ' + cards.length + ' 张卡片', '>']
  cards.forEach((card, index) => {
    lines.push('> **' + spaceCjk(card.question) + '**', '>', '> ?', '>', '> **答案：** ' + spaceCjk(card.answer))
    if (index < cards.length - 1) lines.push('>')
  })
  return lines
}

function replaceReviewBlock(text, block, cards) {
  const lines = block.lines.slice(0, block.start).concat(renderBlock(cards))
  if (block.end < block.lines.length) lines.push('')
  lines.push(...block.lines.slice(block.end))
  return lines.join('\n')
}

function isMetaQuestion(question) {
  return /笔记|视频|作者|主播|文中|片中|本集|本期/.test(String(question || ''))
}

function usableCards(value) {
  return normalizeReviewCards(value).filter((card) => !isMetaQuestion(card.question))
}

function buildPrompt(title, context) {
  return [
    '下面是一篇视频笔记。请根据笔记内容出 3~5 组真正可自测的问答。',
    '',
    '要求：',
    '1. 只考笔记里已经出现的事实、判断、数字或因果关系，不要引入外部知识。',
    '2. 问题必须是完整问句，以问号结尾；不要用“核心判断”“成本膨胀”这类名词短语当问题。',
    '3. 答案只写结论，最多 60 个汉字；不要写“视频提到”“作者认为”。',
    '4. 覆盖不同主题，优先核心结论、关键数字、易混淆概念和争议点；不要问“这篇笔记讲了什么”。',
    '5. 输出 JSON 数组，格式：[{"question":"问题？","answer":"答案"}]。不要 Markdown，不要解释。',
    '6. 问题里不要出现“笔记”“视频”“作者”“主播”“文中”“片中”等指代材料的词，直接问知识本身。',
    '',
    '标题：' + title,
    '',
    '笔记：',
    context
  ].join('\n')
}

async function generateCards(client, config, title, context) {
  let prompt = buildPrompt(title, context)
  let lastCards = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text = ''
    try {
      text = await callLlm({ llm: client }, config, {
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1600
      })
    } catch (error) {
      if (attempt === 0) continue
      throw error
    }
    let parsed = null
    try {
      parsed = parseJson(text)
    } catch {
      parsed = null
    }
    const rawCards = Array.isArray(parsed) ? parsed : parsed?.cards
    const cards = usableCards(rawCards)
    lastCards = cards
    if (cards.length >= 3) return cards
    prompt += '\n\n上一次只生成了 ' + cards.length + ' 张。请补足 3~5 张，只输出 JSON 数组。'
  }
  if (lastCards.length > 0) return lastCards
  throw new Error('模型没有返回可用的问答')
}

function countQuestions(text) {
  return (text.match(/^> \?$/gm) || []).length
}

function stamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

async function main() {
  const config = resolveConfig()
  const vaultPath = resolveVaultPath(config)
  const state = loadState(join(config.stateDir, 'state.json'))
  let notes = collectNotes(state)
  if (only) notes = notes.filter((note) => note.relPath.includes(only) || note.title.includes(only))
  if (limit > 0) notes = notes.slice(0, limit)
  if (notes.length === 0) {
    log('没有匹配的笔记')
    return
  }

  const cache = refresh ? {} : readCache()
  const llmConfig = await resolveLlmConfig()
  const client = createLlmClient(llmConfig)
  const prepared = []

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]
    const result = await readVaultText({ vaultPath, relPath: note.relPath })
    if (!result.ok) {
      log('[' + (index + 1) + '/' + notes.length + '] 跳过（读不到）：' + note.relPath + '：' + result.error)
      continue
    }
    const text = result.text
    const parsed = parseNoteMarkdown(text)
    if (!parsed.isV5) {
      log('[' + (index + 1) + '/' + notes.length + '] 跳过（不是 format 5）：' + note.relPath)
      continue
    }
    const block = findReviewBlock(text)
    if (!block) {
      log('[' + (index + 1) + '/' + notes.length + '] 跳过（没有复习卡片 callout）：' + note.relPath)
      continue
    }
    const title = parsed.title || note.title || note.relPath
    let cards = usableCards(cache[note.relPath])
    if (cards.length < 3) {
      log('[' + (index + 1) + '/' + notes.length + '] 生成：' + title)
      cards = await generateCards(client, llmConfig, title, contextBeforeReview(text, block))
      cache[note.relPath] = cards
      saveCache(cache)
    } else {
      log('[' + (index + 1) + '/' + notes.length + '] 用缓存：' + title)
    }
    prepared.push({ ...note, title, original: text, cards, next: replaceReviewBlock(text, block, cards) })
    cards.forEach((card, cardIndex) => {
      log('  ' + (cardIndex + 1) + '. ' + card.question + ' -> ' + card.answer)
    })
  }

  if (!apply) {
    log('\\n预演完成：' + prepared.length + ' 篇，未写文件。加 --apply 写入。')
    return
  }
  if (prepared.length === 0) {
    log('没有可写入的笔记')
    return
  }

  const backupDir = join(homedir(), '.seen', 'backups', 'review-cards-' + stamp())
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(prepared.map((item) => ({
    relPath: item.relPath,
    title: item.title,
    cards: item.cards,
    original: item.original
  })), null, 2) + '\n', { mode: 0o600 })
  log('备份完成：' + backupDir)

  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index]
    const written = await writeVaultText({ vaultPath, relPath: item.relPath, content: item.next })
    if (!written.ok) throw new Error('写入失败：' + item.relPath + '：' + written.error)
    const verify = await readVaultText({ vaultPath, relPath: item.relPath })
    if (!verify.ok) throw new Error('写入后读回失败：' + item.relPath + '：' + verify.error)
    const count = countQuestions(verify.text)
    if (count !== item.cards.length) throw new Error('写入后卡片数量不对：' + item.relPath + '，期望 ' + item.cards.length + '，实际 ' + count)
    log('[' + (index + 1) + '/' + prepared.length + '] 已写：' + item.relPath + '（' + count + ' 张）')
  }
  log('完成：' + prepared.length + ' 篇。')
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exitCode = 1
})
