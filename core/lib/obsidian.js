/**
 * seen-core · Obsidian 写入层
 *
 * 纯 ESM、零运行时依赖。
 *  - vault / noteRoot / stateDir 目录准备
 *  - 视频笔记文件名清洗与 bvid 冲突处理（skipped / 追加 " (BVxxxx)" / force 备份）
 *  - 学科学习手册与总览只更新 <!-- AUTO:START --> 与 <!-- AUTO:END --> 之间的内容
 *  - 所有写入使用 tmp + rename 原子替换
 *  - obsidian-cli 仅用于可选的 openInObsidian，失败只返回 error，绝不抛错
 *
 * vault 可能在 macOS 的「文稿文件夹」（TCC 保护）里：没有授权时同步 fs 会永久挂起。
 * 因此所有 vault I/O 一律异步，并交给 vault-access 的守卫、超时与串行队列。
 */

import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { detectObsidianVault, sanitizeFilename } from './config.js'
import { REVIEW_DIR, conceptPageRelPath, manualNoteRelPath, normalizeNoteLayout, topicPageRelPath, transcriptNoteRelPath, videoNoteRelPath } from './paths.js'
import { VAULT_IO_TIMEOUT_MS, createVaultQueue, withVaultTimeout } from './vault-access.js'
import {
  autoBlock,
  mergeManualSection,
  overviewAutoBody,
  renderOverview,
  renderSubjectManual,
  subjectManualAutoBody,
  upsertAutoBlock,
} from './render.js'

const DEFAULT_NOTE_ROOT = '视频笔记'
const DEFAULT_SUBJECT = '未分类'
const OVERVIEW_FILENAME = '总览.md'
const OBSIDIAN_CLI_CANDIDATES = ['/opt/homebrew/bin/obsidian-cli', '/usr/local/bin/obsidian-cli']

/** 当前生效的 vault 守卫（由引擎注入）；没有守卫时按可访问处理。 */
let activeGuard = null
/** vault 操作超时。 */
let vaultTimeoutMs = VAULT_IO_TIMEOUT_MS
/** 所有 vault 操作串行执行，避免权限挂起时堆满请求。 */
const vaultQueue = createVaultQueue()

/** 把一次 vault 操作交给守卫、超时与串行队列（其它模块复用）。 */
export function runVaultTask(task) {
  return runVault(task)
}

/** 注入 vault 守卫（引擎启动时调用）。 */
export function setVaultGuard(guard) {
  activeGuard = guard && typeof guard === 'object' ? guard : null
  return activeGuard
}

/** 读取当前 vault 守卫。 */
export function getVaultGuard() {
  return activeGuard
}

/** 调整 vault 操作超时（毫秒）。 */
export function setVaultTimeout(ms) {
  const value = Number(ms)
  if (Number.isFinite(value) && value > 0) vaultTimeoutMs = value
  return vaultTimeoutMs
}

function isPermissionError(error) {
  const code = String(error?.code || '')
  return code === 'EACCES' || code === 'EPERM'
}

/**
 * 在守卫保护下执行一次 vault 操作：blocked 直接失败、超时熔断、成功后解除熔断。
 * 注意：内部不得再调用其它走 runVault 的导出函数，否则会排队死锁。
 */
async function runVault(task) {
  const guard = activeGuard
  if (guard) guard.ensure()
  return vaultQueue.run(async () => {
    try {
      const result = await withVaultTimeout(Promise.resolve().then(task), vaultTimeoutMs, guard)
      if (guard) guard.noteOk()
      return result
    } catch (error) {
      if (guard) {
        if (error && error.vaultBlocked) {
          guard.noteBlocked(String(error.code || 'timeout'), String(error.detail || ''))
        } else if (isPermissionError(error)) {
          guard.noteBlocked('denied', String(error?.message || error))
        }
      }
      throw error
    }
  })
}

async function pathExists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

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
async function atomicWrite(file, content) {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    await writeFile(tmp, String(content ?? ''), 'utf8')
    await rename(tmp, file)
  } catch (error) {
    try {
      await unlink(tmp)
    } catch {
      // 清理失败忽略，保留原始错误
    }
    throw error
  }
}

/**
 * 解析配置中的 vault 路径：显式配置 → obsidian.json 检测 → 默认目录。
 * 这里不做任何文件系统校验（检测目录可能触发 TCC 弹窗并挂起），是否可读由探针负责。
 */
export function resolveVaultPath(config = {}) {
  const configured = config && typeof config === 'object' ? config.vaultPath : null
  if (typeof configured === 'string' && configured.trim() !== '') {
    return expandHome(configured)
  }
  const detected = detectObsidianVault(undefined, { verify: false })
  if (detected) return detected
  return join(homedir(), 'Documents', 'Obsidian Vault')
}

/** 确保 vault、笔记根目录、状态目录存在。stateDir 不受 vault 守卫影响。 */
export async function ensureVaultDirs({ vaultPath, noteRoot, stateDir } = {}) {
  if (!vaultPath) throw new Error('ensureVaultDirs: 缺少 vaultPath')
  const root = normalizeNoteRoot(noteRoot)
  await runVault(async () => {
    await mkdir(String(vaultPath), { recursive: true })
    await mkdir(join(String(vaultPath), ...root.split('/')), { recursive: true })
  })
  if (stateDir) await mkdir(String(stateDir), { recursive: true })
}

/** 视频笔记路径：结构化 <noteRoot>/笔记/<学科>/<标题>.md；扁平 <noteRoot>/<学科>/<标题>.md。 */
export function videoNotePath({ vaultPath, noteRoot, subject, title, bvid, layout } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const subjectName = safeFilename(subject || DEFAULT_SUBJECT, 80)
  const noteName = safeFilename(title || bvid || '未命名视频', 80)
  const relPath = toPosix(videoNoteRelPath({ noteRoot: root, subject: subjectName, noteName, layout }))
  return { absPath: absoluteFromRel(vaultPath, relPath), relPath }
}

/** 读取 frontmatter 中的 bvid（无 frontmatter / 无 bvid / 读不到返回 null）。 */
export async function readFrontmatterBvid(filePath) {
  return runVault(() => readBvidFile(filePath))
}

async function readBvidFile(filePath) {
  try {
    const text = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
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

async function backupFile(file) {
  const stamp = Date.now()
  let backup = `${file}.bak-${stamp}`
  let index = 1
  while (await pathExists(backup)) {
    backup = `${file}.bak-${stamp}-${index}`
    index += 1
  }
  await copyFile(file, backup)
  return backup
}

/**
 * 写入视频笔记。
 *  - 同 bvid 且 !force：skipped，不覆盖
 *  - 不同 bvid：文件名追加 " (BVxxxx)"
 *  - force：备份 .bak-<timestamp> 后覆盖
 */
export function writeVideoNote({ vaultPath, noteRoot, subject, title, bvid, content, force = false, layout } = {}) {
  const base = videoNotePath({ vaultPath, noteRoot, subject, title, bvid, layout })
  const targetBvid = String(bvid ?? '').trim()

  return runVault(async () => {
    let target = base

    if (await pathExists(target.absPath)) {
      const existingBvid = await readBvidFile(target.absPath)
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
          if (!(await pathExists(candidate.absPath))) {
            found = candidate
            break
          }
          const candidateBvid = await readBvidFile(candidate.absPath)
          if (targetBvid && candidateBvid && candidateBvid.toLowerCase() === targetBvid.toLowerCase()) {
            return { relPath: candidate.relPath, absPath: candidate.absPath, skipped: true }
          }
          index += 1
        }
        target = found ?? siblingNotePath(base, ` (${tag}-${Date.now()})`)
      } else {
        await backupFile(target.absPath)
      }
    }

    // force 重写时把旧笔记里的手写内容搬回来，避免整篇覆盖丢掉
    let finalContent = content
    try {
      if (await pathExists(target.absPath)) {
        finalContent = mergeManualSection(await readFile(target.absPath, 'utf8'), content)
      }
    } catch {
      finalContent = content
    }

    await atomicWrite(target.absPath, finalContent)
    return { relPath: target.relPath, absPath: target.absPath, skipped: false }
  })
}

function manualNotePath({ vaultPath, noteRoot, subject, layout }) {
  const root = normalizeNoteRoot(noteRoot)
  const subjectName = safeFilename(subject || DEFAULT_SUBJECT, 80)
  const relPath = toPosix(manualNoteRelPath({ noteRoot: root, subject: subjectName, layout }))
  return { absPath: absoluteFromRel(vaultPath, relPath), relPath }
}

/** 更新/创建学科学习手册：只替换 AUTO 区，保留用户内容；不存在时创建完整骨架。 */
export function updateSubjectManual({ vaultPath, noteRoot, subject, videos, layout } = {}) {
  const target = manualNotePath({ vaultPath, noteRoot, subject, layout })
  return runVault(async () => {
    if (!(await pathExists(target.absPath))) {
      await atomicWrite(target.absPath, renderSubjectManual({ subject, videos, noteRoot, layout, updatedAt: Date.now() }))
    } else {
      const current = await readFile(target.absPath, 'utf8')
      const next = upsertAutoBlock(current, autoBlock(subjectManualAutoBody({ subject, videos })))
      await atomicWrite(target.absPath, next)
    }
    return { relPath: target.relPath, absPath: target.absPath }
  })
}

/** 写入字幕存档：<noteRoot>/字幕/<笔记名>.md（覆盖同名字幕）。 */
export function writeTranscriptNote({ vaultPath, noteRoot, noteName, content } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const name = safeFilename(noteName || '未命名视频', 80)
  const relPath = toPosix(transcriptNoteRelPath({ noteRoot: root, noteName: name }))
  const target = { absPath: absoluteFromRel(vaultPath, relPath), relPath }
  return runVault(async () => {
    await atomicWrite(target.absPath, content)
    return target
  })
}

/** 读取字幕存档原文。文件不存在返回 null。 */
export async function readTranscriptNote({ vaultPath, noteRoot, noteName } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const name = safeFilename(noteName || '未命名视频', 80)
  const relPath = toPosix(transcriptNoteRelPath({ noteRoot: root, noteName: name }))
  return runVault(async () => {
    try {
      return await readFile(absoluteFromRel(vaultPath, relPath), 'utf8')
    } catch {
      return null
    }
  })
}

/** 更新笔记 frontmatter 里的 review 字段（复习状态），保留其余内容。 */
export function updateNoteReview({ vaultPath, notePath, review } = {}) {
  const relPath = String(notePath || '').trim().replace(/\\/g, '/')
  if (!relPath) return Promise.resolve({ ok: false, error: '缺少 notePath' })
  const absPath = absoluteFromRel(vaultPath, relPath)
  const json = JSON.stringify(review && typeof review === 'object' ? review : {})
  return runVault(async () => {
    let markdown
    try {
      markdown = await readFile(absPath, 'utf8')
    } catch {
      return { ok: false, error: '笔记不存在：' + relPath }
    }
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return { ok: false, error: '笔记没有 frontmatter：' + relPath }
    const block = match[1]
    const line = 'review: ' + json
    const nextBlock = /^review:.*$/m.test(block)
      ? block.replace(/^review:.*$/m, line)
      : block.replace(/\s*$/, '') + '\n' + line
    const next = markdown.slice(0, match.index) + '---\n' + nextBlock + '\n---' + markdown.slice(match.index + match[0].length)
    await atomicWrite(absPath, next)
    return { ok: true, relPath }
  })
}

/** 更新/创建总览：只替换 AUTO 区，保留用户内容；不存在时创建完整骨架。 */
export function updateOverview({ vaultPath, noteRoot, subjects, videos, layout } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, OVERVIEW_FILENAME))
  const target = { absPath: absoluteFromRel(vaultPath, relPath), relPath }
  return runVault(async () => {
    if (!(await pathExists(target.absPath))) {
      await atomicWrite(target.absPath, renderOverview({ subjects, videos, noteRoot: root, layout, updatedAt: Date.now() }))
    } else {
      const current = await readFile(target.absPath, 'utf8')
      const next = upsertAutoBlock(current, autoBlock(overviewAutoBody({ subjects, videos, noteRoot: root, layout })))
      await atomicWrite(target.absPath, next)
    }
    return target
  })
}

function findObsidianCli() {
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
    // 继续尝试常见路径
  }
  for (const candidate of OBSIDIAN_CLI_CANDIDATES) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

/** 执行外部命令并带超时；超时直接 KILL。 */
function runCommand(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let child = null
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child?.kill('SIGKILL') } catch { /* 已退出 */ }
      finish({ error: new Error('命令超时（' + timeoutMs + 'ms）') })
    }, timeoutMs)
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      finish({ error })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish({ error }))
    child.on('exit', (code) => finish({ code, stdout, stderr }))
  })
}

/** 可选：在 Obsidian 中打开笔记。失败只返回 { ok:false, error }，绝不抛错。 */
export async function openInObsidian({ vaultPath, notePath } = {}) {
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
    const result = await runCommand(bin, ['open', '--vault', vaultName, note], 10000)
    if (result.error) return { ok: false, error: String(result.error.message || result.error) }
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim()
      return { ok: false, error: detail || `obsidian-cli exited with code ${result.code}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

/** 写入每周回顾；文件已存在时跳过，不覆盖用户内容。 */
export function writeWeeklyReview({ vaultPath, noteRoot, label, markdown } = {}) {
  if (!vaultPath) throw new Error('writeWeeklyReview: 缺少 vaultPath')
  if (!label) throw new Error('writeWeeklyReview: 缺少 label')
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, REVIEW_DIR, label + '.md'))
  const absPath = absoluteFromRel(vaultPath, relPath)
  return runVault(async () => {
    if (await pathExists(absPath)) return { ok: true, skipped: true, relPath, absPath }
    await atomicWrite(absPath, markdown)
    return { ok: true, skipped: false, relPath, absPath }
  })
}

/** 写入 AUTO 区块型索引笔记：已有文件只更新 AUTO 区，保留用户内容。 */
function writeAutoNote({ vaultPath, noteRoot, filename, title, type, markdown } = {}) {
  if (!vaultPath) throw new Error('writeAutoNote: 缺少 vaultPath')
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, filename))
  const absPath = absoluteFromRel(vaultPath, relPath)
  const body = autoBlock(String(markdown || ''))
  return runVault(async () => {
    if (await pathExists(absPath)) {
      const current = await readFile(absPath, 'utf8')
      const next = upsertAutoBlock(current, body)
      if (next !== current) await atomicWrite(absPath, next)
      return { ok: true, relPath, absPath, created: false }
    }
    const content = [
      '---',
      'title: "' + title + '"',
      'type: ' + type,
      '---',
      '',
      '# ' + title,
      '',
      body,
      '',
      '## 我的补充',
      '',
      '',
    ].join('\n')
    await atomicWrite(absPath, content)
    return { ok: true, relPath, absPath, created: true }
  })
}

/** 写入知识索引；已有文件只更新 AUTO 区块，保留用户内容。 */
export function writeIndexNote({ vaultPath, noteRoot, markdown } = {}) {
  return writeAutoNote({ vaultPath, noteRoot, filename: '视频索引.md', title: '视频索引', type: 'index', markdown })
}

/** 写入概念索引；已有文件只更新 AUTO 区块，保留用户内容。 */
export function writeConceptIndexNote({ vaultPath, noteRoot, markdown } = {}) {
  return writeAutoNote({ vaultPath, noteRoot, filename: '概念索引.md', title: '概念索引', type: 'concept-index', markdown })
}

/** 写入标签索引；已有文件只更新 AUTO 区块，保留用户内容。 */
export function writeTagIndexNote({ vaultPath, noteRoot, markdown } = {}) {
  return writeAutoNote({ vaultPath, noteRoot, filename: '标签索引.md', title: '标签索引', type: 'tag-index', markdown })
}

/** 写入概念页：<noteRoot>/概念/<概念>.md，只更新 AUTO 区。 */
export function writeConceptPage({ vaultPath, noteRoot, name, markdown } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const label = safeFilename(name || '未命名概念', 80)
  const relPath = conceptPageRelPath({ noteRoot: root, name: label })
  return writeAutoNote({ vaultPath, noteRoot: root, filename: relPath.slice(root.length + 1), title: label, type: 'concept', markdown })
}

/** 写入主题综述：<noteRoot>/主题/<主题>.md，只更新 AUTO 区。 */
export function writeTopicPage({ vaultPath, noteRoot, name, markdown } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const label = safeFilename(name || '未命名主题', 80)
  const relPath = topicPageRelPath({ noteRoot: root, name: label })
  return writeAutoNote({ vaultPath, noteRoot: root, filename: relPath.slice(root.length + 1), title: label, type: 'topic', markdown })
}
