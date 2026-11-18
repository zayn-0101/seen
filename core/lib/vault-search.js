/**
 * seen-core · 笔记库全文搜索
 *
 * 只扫描 <vault>/<noteRoot> 下的 Markdown，不碰用户其他目录。
 * 打分：文件名命中 ×3，正文命中 ×1；多关键词取总分。
 * 走 obsidian 的 vault 守卫：没有「文稿文件夹」权限时快速失败，不会挂起服务。
 */

import { basename, join } from 'node:path'
import { runVaultTask } from './obsidian.js'
import { safeReadFile, safeReaddir, safeStat } from './vault-path.js'

const MAX_FILE_BYTES = 200 * 1024
const MAX_FILES = 2000
const MAX_DEPTH = 6

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function normalizeRoot(noteRoot) {
  return toPosix(noteRoot || '视频笔记').replace(/^\.?\/+/, '').replace(/\/+$/, '') || '视频笔记'
}

/** 单个目录/文件不可访问时跳过整次搜索即可，不应让 vault 里一个坏链接拖垮全部结果。 */
function skippable(error) {
  const code = String(error?.code || '')
  return code === 'ENOENT' || code === 'vault-path-missing' || code === 'vault-path-escape' || code === 'vault-path-broken-symlink' || code === 'vault-path-invalid'
}

async function walkMarkdown(vaultPath, rootRel, dirRel, bucket, depth = 0, stats = null) {
  if (depth > MAX_DEPTH || bucket.length >= MAX_FILES) {
    if (stats) stats.truncated = true
    return
  }
  let entries = []
  try {
    entries = await safeReaddir({ vaultPath, relPath: dirRel })
  } catch (error) {
    if (skippable(error)) {
      if (stats) stats.skipped += 1
      return
    }
    throw error
  }
  for (const entry of entries) {
    if (bucket.length >= MAX_FILES) {
      if (stats) stats.truncated = true
      return
    }
    if (entry.name.startsWith('.')) continue
    const childRel = (dirRel ? dirRel + '/' : '') + entry.name
    if (entry.isDirectory()) {
      if (entry.name === '_备份') continue
      await walkMarkdown(vaultPath, rootRel, childRel, bucket, depth + 1, stats)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      bucket.push(childRel.slice(rootRel.length + 1))
    }
  }
}

/**
 * 列出笔记库里的 Markdown 绝对路径与扫描完整性（跳过 _备份、点开头目录）。
 * 崩溃恢复要靠它判断“确实没有笔记”还是“只扫到了一部分”，不能把截断当成不存在。
 * @returns {Promise<{ files: string[], truncated: boolean, skipped: number }>}
 */
export async function listMarkdownFilesDetailed({ vaultPath, noteRoot = '视频笔记' } = {}) {
  if (!vaultPath) return { files: [], truncated: false, skipped: 0 }
  const rootRel = normalizeRoot(noteRoot)
  return runVaultTask(async () => {
    const files = []
    const stats = { truncated: false, skipped: 0 }
    await walkMarkdown(vaultPath, rootRel, rootRel, files, 0, stats)
    return { files: files.map((rel) => join(String(vaultPath), rootRel, rel)), ...stats }
  })
}

/**
 * 列出笔记库里的 Markdown 绝对路径（跳过 _备份、点开头目录）。
 * 供工具脚本（自检）复用；不做词典与打分，直接走文件系统。
 * @returns {Promise<string[]>}
 */
export async function listMarkdownFiles(args = {}) {
  return (await listMarkdownFilesDetailed(args)).files
}

function splitTerms(query) {
  const text = String(query ?? '').trim().toLowerCase()
  if (!text) return []
  const spaced = text.split(/\s+/).map((term) => term.trim()).filter(Boolean)
  if (spaced.length > 1) return [...new Set(spaced)]
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    const words = [...segmenter.segment(text)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment.trim())
      .filter((term) => term && [...term].length >= 2)
    if (words.length > 1) return [...new Set(words)]
  } catch { /* 旧运行时没有 Intl.Segmenter 时退回整串匹配 */ }
  return spaced
}

function makeSnippet(text, term) {
  const lower = text.toLowerCase()
  const at = lower.indexOf(term)
  if (at < 0) return ''
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + term.length + 60)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
}

function kindOf(relPath) {
  const parts = toPosix(relPath).split('/')
  const first = parts[0] || ''
  if (first === '笔记') return '视频笔记'
  if (first === '资料') {
    const kind = parts[1] || ''
    if (kind === '字幕') return '字幕'
    if (kind === '手册') return '学科手册'
    if (kind === '概念') return '概念页'
    if (kind === '主题') return '主题综述'
    if (kind === '回顾') return '周回顾'
  }
  if (first === '字幕') return '字幕'
  if (first === '手册') return '学科手册'
  if (first === '概念') return '概念页'
  if (first === '主题') return '主题综述'
  if (first === '回顾') return '周回顾'
  if (first === '总览.md' || first === '视频索引.md' || first === '概念索引.md' || first === '标签索引.md') return '索引'
  if (String(parts[parts.length - 1] || '').includes('学习手册')) return '学科手册'
  return '视频笔记'
}

async function search(vaultPath, noteRoot, terms, limit) {
  const rootRel = normalizeRoot(noteRoot)
  const files = []
  const stats = { truncated: false, skipped: 0 }
  try {
    await walkMarkdown(vaultPath, rootRel, rootRel, files, 0, stats)
  } catch (error) {
    if (skippable(error)) return { results: [], scanned: 0, skipped: 0, truncated: false }
    throw error
  }

  const results = []
  for (const relPath of files) {
    const fullRel = rootRel + '/' + relPath
    let content = ''
    try {
      const info = await safeStat({ vaultPath, relPath: fullRel })
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        stats.skipped += 1
        continue
      }
      content = await safeReadFile({ vaultPath, relPath: fullRel })
    } catch (error) {
      if (skippable(error)) {
        stats.skipped += 1
        continue
      }
      throw error
    }
    const name = basename(relPath, '.md')
    const lowerName = name.toLowerCase()
    const lowerContent = content.toLowerCase()
    let score = 0
    let firstSnippet = ''
    let nameHit = false
    for (const term of terms) {
      if (lowerName.includes(term)) {
        score += 3
        nameHit = true
      } else if (lowerContent.includes(term)) {
        score += 1
        if (!firstSnippet) firstSnippet = makeSnippet(content, term)
      }
    }
    if (score === 0) continue
    results.push({ title: name, relPath, snippet: firstSnippet, score, kind: kindOf(relPath), match: nameHit ? 'title' : 'content' })
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  return {
    results: results.slice(0, max),
    scanned: files.length,
    skipped: stats.skipped,
    truncated: stats.truncated,
  }
}

/**
 * 搜索笔记库，并返回扫描统计（是否因上限截断、跳过多少文件）。
 * @returns {Promise<{ results: object[], scanned: number, skipped: number, truncated: boolean }>}
 */
export async function searchVaultDetailed({ vaultPath, noteRoot, query, limit = 20 } = {}) {
  const terms = splitTerms(query)
  if (!vaultPath || terms.length === 0) return { results: [], scanned: 0, skipped: 0, truncated: false }
  return runVaultTask(() => search(vaultPath, noteRoot, terms, limit))
}

/**
 * 搜索笔记库。
 * @returns {Promise<{ title: string, relPath: string, snippet: string, score: number }[]>}
 */
export async function searchVault({ vaultPath, noteRoot, query, limit = 20 } = {}) {
  const detailed = await searchVaultDetailed({ vaultPath, noteRoot, query, limit })
  return detailed.results
}
