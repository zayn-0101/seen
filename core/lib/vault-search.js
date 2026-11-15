/**
 * seen-core · 笔记库全文搜索
 *
 * 只扫描 <vault>/<noteRoot> 下的 Markdown，不碰用户其他目录。
 * 打分：文件名命中 ×3，正文命中 ×1；多关键词取总分。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const MAX_FILE_BYTES = 200 * 1024
const MAX_FILES = 2000

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function walkMarkdown(dir, bucket, depth = 0) {
  if (depth > 6 || bucket.length >= MAX_FILES) return
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (bucket.length >= MAX_FILES) return
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '_备份') continue
      walkMarkdown(full, bucket, depth + 1)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      bucket.push(full)
    }
  }
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

/**
 * 搜索笔记库。
 * @returns {{ title: string, relPath: string, snippet: string, score: number }[]}
 */
export function searchVault({ vaultPath, noteRoot, query, limit = 20 } = {}) {
  const terms = splitTerms(query)
  if (!vaultPath || terms.length === 0) return []
  const rootAbs = join(String(vaultPath), String(noteRoot || '视频笔记'))
  const files = []
  walkMarkdown(rootAbs, files)

  const results = []
  for (const file of files) {
    let content = ''
    try {
      const info = statSync(file)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
      content = readFileSync(file, 'utf8')
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
