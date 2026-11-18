/**
 * seen-core · 字幕存档只读审计
 *
 * 对照状态里的 transcriptPath 与 <noteRoot>/资料/字幕、<noteRoot>/字幕 的实际存档，
 * 找出旧路径、缺失、重复和归属不一致。只读，不修改 vault 或 state。
 */
import { basename } from 'node:path'

import { normalizeAuxRelPath, normalizeNoteRoot, TRANSCRIPT_DIR } from './paths.js'
import { transcriptNoteOwner } from './transcript-note.js'
import { runVaultTask } from './obsidian.js'
import { safeReadFile, safeReaddir, safeStat } from './vault-path.js'

const SCHEMA = 'seen.transcript-audit'
const VERSION = 1
const HASH_SUFFIX = / \(字幕-[0-9a-f]{6,}(?:-\d+)?\)$/

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function baseNameOf(relPath) {
  const name = basename(relPath, '.md')
  return name.replace(HASH_SUFFIX, '')
}

function cleanNotePath(value) {
  return toPosix(value).replace(/^\.\/+/, '').replace(/\/+/g, '/')
}

function makeIssue(severity, type, file, notePath, message) {
  return {
    id: type + ':' + (file || '-') + ':' + (notePath || '-'),
    severity,
    type,
    file: file || '',
    notePath: notePath || '',
    message,
  }
}

async function probePath(vaultPath, relPath) {
  try {
    // 状态里的路径也要经过 vault 队列和超时保护；单条坏路径不能中止整次审计。
    await runVaultTask(() => safeStat({ vaultPath, relPath }))
    return { present: true }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'vault-path-missing') return { present: false }
    return { present: false, error }
  }
}

/**
 * @param {{ vaultPath: string, noteRoot: string, state?: object }} input
 * @returns {Promise<object>} JSON v1 报告
 */
export async function auditTranscripts({ vaultPath, noteRoot, state } = {}) {
  const issues = []
  const videos = []
  for (const [subject, entry] of Object.entries(state?.subjects || {})) {
    for (const video of entry?.videos || []) {
      if (video && typeof video === 'object') videos.push({ ...video, subject })
    }
  }
  const notes = new Map()
  for (const video of videos) {
    const notePath = cleanNotePath(video.notePath)
    if (!notePath) continue
    notes.set(notePath, video)
  }

  let archives = 0
  const archiveRows = []
  const root = normalizeNoteRoot(noteRoot)
  const newDir = root + '/' + '资料' + '/' + TRANSCRIPT_DIR + '/'
  const oldDir = root + '/' + TRANSCRIPT_DIR + '/'
  const archivePaths = []
  for (const dir of [newDir.slice(0, -1), oldDir.slice(0, -1)]) {
    let entries
    try {
      entries = await runVaultTask(() => safeReaddir({ vaultPath, relPath: dir }))
    } catch (error) {
      const code = String(error?.code || '')
      if (code === 'ENOENT' || code === 'vault-path-missing') continue
      issues.push(makeIssue('error', 'archive-dir-unreadable', dir, '', '字幕目录读取失败：' + String(error?.message || error)))
      continue
    }
    for (const entry of entries) {
      const isMarkdown = entry.name.toLowerCase().endsWith('.md')
      if (isMarkdown && (entry.isFile() || entry.isSymbolicLink())) archivePaths.push(dir + '/' + entry.name)
    }
  }
  for (const relPath of archivePaths) {
    archives += 1
    const legacyLocation = !relPath.startsWith(newDir)
    if (legacyLocation) {
      issues.push(makeIssue('warn', 'archive-legacy-location', relPath, '', '字幕存档还在旧目录，建议运行迁移脚本：' + relPath))
    }
    let markdown = ''
    try {
      // 逐份读取也走 vault 队列：列表成功后 guard 可能变为 blocked。
      markdown = (await runVaultTask(() => safeReadFile({ vaultPath, relPath }))).toString('utf8')
    } catch (error) {
      issues.push(makeIssue('error', 'archive-unreadable', relPath, '', '字幕存档读取失败：' + String(error?.message || error)))
      continue
    }
    const owner = toPosix(transcriptNoteOwner(markdown))
    archiveRows.push({ relPath, base: baseNameOf(relPath), owner })
  }

  for (const video of videos) {
    if (!video.transcriptPath) continue
    const raw = toPosix(video.transcriptPath)
    const notePath = cleanNotePath(video.notePath)
    const normalized = normalizeAuxRelPath(raw, { vaultPath, noteRoot: root })
    if (normalized && normalized !== raw) {
      issues.push(makeIssue('warn', 'state-transcript-legacy', raw, notePath, '状态里的字幕路径还是旧格式：' + raw))
    }
    // 旧路径归一后可能指向新目录，但旧目录里的文件仍可能被 state 引用；两个候选都要核对 owner。
    const candidates = []
    if (normalized) candidates.push(cleanNotePath(normalized))
    const rawClean = cleanNotePath(raw)
    if (rawClean && !candidates.includes(rawClean)) candidates.push(rawClean)
    let found = false
    let invalid = false
    for (const candidate of candidates) {
      const probe = await probePath(vaultPath, candidate)
      if (probe.error) {
        invalid = true
        issues.push(makeIssue('error', 'state-transcript-invalid', candidate, notePath, '状态里的字幕路径无法检查：' + candidate + ' → ' + String(probe.error?.message || probe.error)))
        continue
      }
      if (!probe.present) continue
      found = true
      const row = archiveRows.find((item) => item.relPath === candidate)
      if (row?.owner && notePath && row.owner !== notePath) {
        issues.push(makeIssue('error', 'state-transcript-owner-mismatch', candidate, notePath, '状态里的字幕存档属于另一篇笔记：' + candidate + ' → ' + row.owner))
      } else if (!row && !candidate.startsWith(newDir) && !candidate.startsWith(oldDir)) {
        issues.push(makeIssue('error', 'state-transcript-outside-archive', candidate, notePath, '状态里的字幕路径不在字幕目录里：' + candidate))
      }
    }
    if (!found && !invalid) {
      const hasAny = archiveRows.some((row) => row.owner === notePath)
      if (!hasAny) {
        issues.push(makeIssue('warn', 'state-transcript-missing', raw, notePath, '状态里的字幕存档不存在：' + raw))
      }
    }
  }

  const ownerCounts = new Map()
  for (const row of archiveRows) {
    if (!row.owner) {
      issues.push(makeIssue('warn', 'archive-owner-missing', row.relPath, '', '字幕存档没有所属笔记信息（旧存档）：' + row.relPath))
    } else if (!notes.has(row.owner)) {
      issues.push(makeIssue('warn', 'archive-owner-unknown', row.relPath, row.owner, '字幕存档指向的笔记不在状态里：' + row.owner))
    } else if (baseNameOf(row.owner) !== row.base) {
      issues.push(makeIssue('error', 'archive-owner-mismatch', row.relPath, row.owner, '字幕存档名与所属笔记不一致：' + row.relPath + ' → ' + row.owner))
    }
    const key = row.owner ? 'owner:' + row.owner : 'base:' + row.base
    ownerCounts.set(key, (ownerCounts.get(key) || 0) + 1)
  }
  for (const [key, count] of ownerCounts) {
    if (count < 2) continue
    const row = archiveRows.find((item) => (item.owner ? 'owner:' + item.owner : 'base:' + item.base) === key)
    issues.push(makeIssue('error', row?.owner ? 'archive-duplicate-owner' : 'archive-duplicate-name', row?.relPath || '', row?.owner || '', (row?.owner ? '同一篇笔记有多份字幕存档：' : '同名字幕存档有多份：') + (row?.owner || row?.base || key)))
  }

  const order = { error: 0, warn: 1 }
  issues.sort((a, b) => (order[a.severity] - order[b.severity]) || a.id.localeCompare(b.id))
  const errors = issues.filter((item) => item.severity === 'error').length
  const warnings = issues.filter((item) => item.severity === 'warn').length
  return {
    schema: SCHEMA,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    vaultPath: String(vaultPath || ''),
    noteRoot: String(noteRoot || ''),
    summary: { archives, videos: videos.length, issues: issues.length, errors, warnings },
    issues,
  }
}
