/**
 * seen-core · Obsidian 写入层
 *
 * 纯 ESM、零运行时依赖。
 *  - vault / noteRoot / stateDir 目录准备
 *  - 视频笔记文件名清洗与 bvid 冲突处理（skipped / 追加 " (BVxxxx)" / force 备份）
 *  - 学科学习手册与课程总览只更新 <!-- AUTO:START --> 与 <!-- AUTO:END --> 之间的内容
 *  - 所有写入使用 tmp + rename 原子替换
 *  - obsidian-cli 仅用于可选的 openInObsidian，失败只返回 error，绝不抛错
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { detectObsidianVault, sanitizeFilename } from './config.js'
import {
  autoBlock,
  overviewAutoBody,
  renderOverview,
  renderSubjectManual,
  subjectManualAutoBody,
  upsertAutoBlock,
} from './render.js'

const DEFAULT_NOTE_ROOT = '课程知识地图'
const DEFAULT_SUBJECT = '未分类'
const OVERVIEW_FILENAME = '课程总览.md'
const MANUAL_SUFFIX = ' 学习手册.md'
const OBSIDIAN_CLI_CANDIDATES = ['/opt/homebrew/bin/obsidian-cli', '/usr/local/bin/obsidian-cli']

function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

/** 把路径统一成 POSIX 形式（Obsidian 链接与状态文件里统一用 /）。 */
export function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/')
}

function normalizeNoteRoot(noteRoot) {
  const root = toPosix(noteRoot)
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '')
    .trim()
  return root || DEFAULT_NOTE_ROOT
}

function absoluteFromRel(vaultPath, relPath) {
  return join(String(vaultPath), ...toPosix(relPath).split('/'))
}

/** 文件名清洗：与 config.sanitizeFilename 保持一致。 */
export function safeFilename(name, max = 80) {
  return sanitizeFilename(name, max)
}

/** 原子写：同目录临时文件写入后 rename 覆盖。 */
function atomicWrite(file, content) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    writeFileSync(tmp, String(content ?? ''), 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // 清理失败忽略，保留原始错误
    }
    throw error
  }
}

/** 解析配置中的 vault 路径；显式配置优先，其次自动检测，最后尝试默认目录。 */
export function resolveVaultPath(config = {}) {
  const configured = config && typeof config === 'object' ? config.vaultPath : null
  if (typeof configured === 'string' && configured.trim() !== '') {
    return expandHome(configured)
  }
  const detected = detectObsidianVault()
  if (detected) return detected
  const fallback = join(homedir(), 'Documents', 'Obsidian Vault')
  if (existsSync(fallback)) return fallback
  throw new Error('未找到 Obsidian vault（可在配置中设置 vaultPath）')
}

/** 确保 vault、笔记根目录、状态目录存在。 */
export function ensureVaultDirs({ vaultPath, noteRoot, stateDir } = {}) {
  if (!vaultPath) throw new Error('ensureVaultDirs: 缺少 vaultPath')
  mkdirSync(String(vaultPath), { recursive: true })
  const root = normalizeNoteRoot(noteRoot)
  mkdirSync(join(String(vaultPath), ...root.split('/')), { recursive: true })
  if (stateDir) mkdirSync(String(stateDir), { recursive: true })
}

/** 视频笔记路径：<noteRoot>/<学科>/<标题>.md。 */
export function videoNotePath({ vaultPath, noteRoot, subject, title, bvid } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const subjectName = safeFilename(subject || DEFAULT_SUBJECT, 80)
  const noteName = safeFilename(title || bvid || '未命名视频', 80)
  const relPath = toPosix(join(root, subjectName, `${noteName}.md`))
  return { absPath: absoluteFromRel(vaultPath, relPath), relPath }
}

/** 读取 frontmatter 中的 bvid（无 frontmatter / 无 bvid 返回 null）。 */
export function readFrontmatterBvid(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!frontmatter) return null
    const line = frontmatter[1].match(/^\s*bvid\s*:\s*(.+?)\s*$/m)
    if (!line) return null
    let value = line[1].trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        value = value.slice(1, -1)
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    return value || null
  } catch {
    return null
  }
}

function siblingNotePath(base, suffix) {
  const dir = dirname(base.absPath)
  const name = basename(base.absPath, '.md') + suffix + '.md'
  const absPath = join(dir, name)
  const relDir = base.relPath.includes('/') ? base.relPath.slice(0, base.relPath.lastIndexOf('/') + 1) : ''
  return { absPath, relPath: relDir + name }
}

function backupFile(file) {
  let backup = `${file}.bak-${Date.now()}`
  let index = 1
  while (existsSync(backup)) {
    backup = `${file}.bak-${Date.now()}-${index}`
    index += 1
  }
  copyFileSync(file, backup)
  return backup
}

/**
 * 写入视频笔记。
 *  - 同 bvid 且 !force：skipped，不覆盖
 *  - 不同 bvid：文件名追加 " (BVxxxx)"
 *  - force：备份 .bak-<timestamp> 后覆盖
 */
export function writeVideoNote({ vaultPath, noteRoot, subject, title, bvid, content, force = false } = {}) {
  const base = videoNotePath({ vaultPath, noteRoot, subject, title, bvid })
  const targetBvid = String(bvid ?? '').trim()
  let target = base

  if (existsSync(target.absPath)) {
    const existingBvid = readFrontmatterBvid(target.absPath)
    const sameBvid = Boolean(
      targetBvid &&
      existingBvid &&
      existingBvid.toLowerCase() === targetBvid.toLowerCase()
    )

    if (!force && sameBvid) {
      return { relPath: target.relPath, absPath: target.absPath, skipped: true }
    }

    if (!force) {
      const tag = targetBvid || '重名'
      let index = 1
      let found = null
      while (index <= 100) {
        const suffix = index === 1 ? ` (${tag})` : ` (${tag}-${index})`
        const candidate = siblingNotePath(base, suffix)
        if (!existsSync(candidate.absPath)) {
          found = candidate
          break
        }
        const candidateBvid = readFrontmatterBvid(candidate.absPath)
        if (targetBvid && candidateBvid && candidateBvid.toLowerCase() === targetBvid.toLowerCase()) {
          return { relPath: candidate.relPath, absPath: candidate.absPath, skipped: true }
        }
        index += 1
      }
      target = found ?? siblingNotePath(base, ` (${tag}-${Date.now()})`)
    } else {
      backupFile(target.absPath)
    }
  }

  atomicWrite(target.absPath, content)
  return { relPath: target.relPath, absPath: target.absPath, skipped: false }
}

function manualNotePath({ vaultPath, noteRoot, subject }) {
  const root = normalizeNoteRoot(noteRoot)
  const subjectName = safeFilename(subject || DEFAULT_SUBJECT, 80)
  const relPath = toPosix(join(root, subjectName, `${subjectName}${MANUAL_SUFFIX}`))
  return { absPath: absoluteFromRel(vaultPath, relPath), relPath }
}

/** 更新/创建学科学习手册：只替换 AUTO 区，保留用户内容；不存在时创建完整骨架。 */
export function updateSubjectManual({ vaultPath, noteRoot, subject, videos } = {}) {
  const target = manualNotePath({ vaultPath, noteRoot, subject })
  if (!existsSync(target.absPath)) {
    atomicWrite(target.absPath, renderSubjectManual({ subject, videos, noteRoot, updatedAt: Date.now() }))
  } else {
    const current = readFileSync(target.absPath, 'utf8')
    const next = upsertAutoBlock(current, autoBlock(subjectManualAutoBody({ subject, videos })))
    atomicWrite(target.absPath, next)
  }
  return { relPath: target.relPath, absPath: target.absPath }
}

/** 更新/创建课程总览：只替换 AUTO 区，保留用户内容；不存在时创建完整骨架。 */
export function updateOverview({ vaultPath, noteRoot, subjects } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, OVERVIEW_FILENAME))
  const target = { absPath: absoluteFromRel(vaultPath, relPath), relPath }
  if (!existsSync(target.absPath)) {
    atomicWrite(target.absPath, renderOverview({ subjects, noteRoot: root, updatedAt: Date.now() }))
  } else {
    const current = readFileSync(target.absPath, 'utf8')
    const next = upsertAutoBlock(current, autoBlock(overviewAutoBody({ subjects, noteRoot: root })))
    atomicWrite(target.absPath, next)
  }
  return target
}

function findObsidianCli() {
  for (const candidate of OBSIDIAN_CLI_CANDIDATES) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // 继续尝试下一个
    }
  }
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['obsidian-cli'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (result.status === 0) {
      const first = String(result.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      if (first) return first
    }
  } catch {
    // 找不到就返回 null
  }
  return null
}

/** 可选：在 Obsidian 中打开笔记。失败只返回 { ok:false, error }，绝不抛错。 */
export function openInObsidian({ vaultPath, notePath } = {}) {
  try {
    if (process.platform !== 'darwin') return { ok: false, error: '仅支持 macOS 的 obsidian-cli' }
    const bin = findObsidianCli()
    if (!bin) return { ok: false, error: '未找到 obsidian-cli' }
    const vaultName = basename(String(vaultPath ?? '').replace(/[\\/]+$/, '')) || 'Obsidian Vault'
    const note = String(notePath ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.?\/+/, '')
      .replace(/\.md$/i, '')
    if (!note) return { ok: false, error: '缺少 notePath' }
    const result = spawnSync(bin, ['open', '--vault', vaultName, note], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    })
    if (result.error) return { ok: false, error: String(result.error.message || result.error) }
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim()
      return { ok: false, error: detail || `obsidian-cli exited with code ${result.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}
