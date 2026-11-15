/**
 * seen-core · 笔记库全文搜索
 *
 * 只扫描 <vault>/<noteRoot> 下的 Markdown，不碰用户其他目录。
 * 打分：文件名命中 ×3，正文命中 ×1；多关键词取总分。
 * 走 obsidian 的 vault 守卫：没有「文稿文件夹」权限时快速失败，不会挂起服务。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { runVaultTask } from './obsidian.js'

const MAX_FILE_BYTES = 200 * 1024
const MAX_FILES = 2000
const MAX_DEPTH = 6

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

async function walkMarkdown(dir, bucket, depth = 0) {
  if (depth > MAX_DEPTH || bucket.length >= MAX_FILES) return
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (bucket.length >= MAX_FILES) return
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '_备份') continue
      await walkMarkdown(full, bucket, depth + 1)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      bucket.push(full)
    }
  }
}

/**
 * 列出笔记库里的 Markdown 绝对路径（跳过 _备份、点开头目录）。
 * 供工具脚本（自检）复用；不做词典与打分，直接走文件系统。
 * @returns {Promise<string[]>}
 */
export async function listMarkdownFiles({ vaultPath, noteRoot = '视频笔记' } = {}) {
  if (!vaultPath) return []
  const rootAbs = join(String(vaultPath), String(noteRoot || '视频笔记'))
  const files = []
  await walkMarkdown(rootAbs, files)
  return files
}

function splitTerms(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function makeSnippet(text, term) {
  const lower = text.toLowerCase()
  const at = lower.indexOf(term)
  if (at < 0) return ''
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + term.length + 60)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
}

async function search(vaultPath, noteRoot, terms, limit) {
  const rootAbs = join(String(vaultPath), String(noteRoot || '视频笔记'))
  const files = []
  await walkMarkdown(rootAbs, files)

  const results = []
  for (const file of files) {
    let content = ''
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const name = basename(file, '.md')
    const lowerName = name.toLowerCase()
    const lowerContent = content.toLowerCase()
    let score = 0
    let firstSnippet = ''
    for (const term of terms) {
      if (lowerName.includes(term)) score += 3
      else if (lowerContent.includes(term)) {
        score += 1
        if (!firstSnippet) firstSnippet = makeSnippet(content, term)
      }
    }
    if (score === 0) continue
    const relPath = toPosix(file).slice(toPosix(rootAbs).length + 1)
    results.push({ title: name, relPath, snippet: firstSnippet, score })
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  return results.slice(0, max)
}

/**
 * 搜索笔记库。
 * @returns {Promise<{ title: string, relPath: string, snippet: string, score: number }[]>}
 */
export async function searchVault({ vaultPath, noteRoot, query, limit = 20 } = {}) {
  const terms = splitTerms(query)
  if (!vaultPath || terms.length === 0) return []
  return runVaultTask(() => search(vaultPath, noteRoot, terms, limit))
}
