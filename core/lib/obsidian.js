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
import { lstat, mkdir } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { detectObsidianVault, sanitizeFilename } from './config.js'
import { extractPage } from './bilibili.js'
import { TRANSCRIPT_DIR, conceptPageRelPath, manualNoteRelPath, normalizeNoteLayout, topicPageRelPath, transcriptNoteRelPath, videoNoteRelPath, weeklyReviewRelPath } from './paths.js'
import { transcriptNoteOwner } from './transcript-note.js'
import { VAULT_IO_TIMEOUT_MS, createVaultQueue, withVaultTimeout } from './vault-access.js'
import {
  ensureVaultRoot,
  ensureVaultDir,
  safeReadFile,
  safeWriteFile,
  safeReaddir,
  safeStat,
  safeUnlink,
  safeRename,
  safeCopyFile,
  safeCopyToExternal,
  resolveExternalPath,
} from './vault-path.js'
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

/** 等待 vault 串行队列真正排空；超时返回 { ok:false, timedOut:true }，未完成的任务仍占用队列。 */
export function drainVaultQueue(options = {}) {
  return vaultQueue.drain(options)
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
  // 超时只能包在队列外层：队列的 tail 必须等底层 task 真正 settle，
  // 否则超时后旧 I/O 仍可能在后台完成并覆盖后续写入。
  const operation = vaultQueue.run(async () => {
    // 任务排队期间前一个操作可能已经触发熔断，执行前需再次检查。
    if (guard) guard.ensure()
    try {
      const result = await Promise.resolve().then(task)
      // 本次调用已经超时熔断时，晚到的成功不能解除熔断；队列虽然排空，
      // 仍应由 reprobe 重新探测后再恢复可用。
      if (guard && !guard.isBlocked()) guard.noteOk()
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
  return withVaultTimeout(operation, vaultTimeoutMs, guard)
}

async function vaultPathExists(vaultPath, relPath) {
  try {
    await safeStat({ vaultPath, relPath })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'vault-path-missing') return false
    throw error
  }
}

async function externalPathExists(file) {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
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
  const root = resolve(String(vaultPath))
  const parts = toPosix(relPath).split('/')
  if (parts.includes('..')) throw new Error('笔记路径不能包含 .. 路径段')
  const target = resolve(root, ...parts)
  const relativePath = relative(root, target)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('笔记路径必须位于 vault 内')
  }
  return target
}

/** 文件名清洗：与 config.sanitizeFilename 保持一致。 */
export function safeFilename(name, max = 80) {
  return sanitizeFilename(name, max)
}

/** 原子写：同目录临时文件写入后 rename 覆盖，所有路径都经过 vault 安全层。 */
async function atomicWrite({ vaultPath, relPath, content } = {}) {
  const parts = toPosix(relPath).split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('缺少文件路径')
  const dirRel = parts.slice(0, -1).join('/')
  await ensureVaultDir({ vaultPath, relDir: dirRel })
  const tmpRel = relPath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8)
  try {
    await safeWriteFile({ vaultPath, relPath: tmpRel, content })
    await safeRename({ vaultPath, fromRelPath: tmpRel, toRelPath: relPath })
  } catch (error) {
    try {
      await safeUnlink({ vaultPath, relPath: tmpRel })
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
    await ensureVaultRoot(vaultPath)
    await ensureVaultDir({ vaultPath, relDir: root })
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
export async function readFrontmatterBvid({ vaultPath, relPath } = {}) {
  return runVault(async () => (await readNoteIdentityUnsafe({ vaultPath, relPath })).bvid || null)
}

/** 读取笔记身份；走 vault 守卫、串行队列和超时。 */
export async function readNoteIdentity({ vaultPath, relPath } = {}) {
  return runVault(() => readNoteIdentityUnsafe({ vaultPath, relPath }))
}

/** 内部版本：调用方已经在 runVault 内时使用，避免重复排队死锁。 */
async function readNoteIdentityUnsafe({ vaultPath, relPath } = {}) {
  try {
    const text = (await safeReadFile({ vaultPath, relPath })).replace(/^\uFEFF/, '')
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!frontmatter) return {}
    const field = (name) => {
      const line = frontmatter[1].match(new RegExp('^\\s*' + name + '\\s*:\\s*(.+?)\\s*$', 'm'))
      if (!line) return ''
      let value = line[1].trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        try { value = JSON.parse(value) } catch { value = value.slice(1, -1) }
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1)
      }
      return String(value || '').trim()
    }
    return { bvid: field('bvid'), videoId: field('videoId'), source: field('source'), page: extractPage(field('url')) }
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

function noteIdentity({ bvid, videoId, source, page } = {}) {
  if (bvid) return 'bilibili:' + String(bvid).trim().toLowerCase() + ':p' + (Number(page) > 0 ? Number(page) : 1)
  if (videoId && source) return String(source) + ':' + String(videoId)
  return ''
}

function siblingNotePath(base, suffix) {
  const dir = dirname(base.absPath)
  const name = basename(base.absPath, '.md') + suffix + '.md'
  const absPath = join(dir, name)
  const relDir = base.relPath.includes('/') ? base.relPath.slice(0, base.relPath.lastIndexOf('/') + 1) : ''
  return { absPath, relPath: relDir + name }
}

async function backupFile(vaultPath, relPath, backupDir = '') {
  const stamp = Date.now()
  const name = basename(relPath)
  let index = 0
  for (;;) {
    const suffix = index === 0 ? '' : '-' + index
    if (backupDir) {
      const { target } = await resolveExternalPath({ root: backupDir, relPath: name + '.bak-' + stamp + suffix })
      if (!(await externalPathExists(target))) {
        await safeCopyToExternal({ vaultPath, relPath, root: backupDir, destRelPath: name + '.bak-' + stamp + suffix })
        return target
      }
    } else {
      const backupRel = relPath + '.bak-' + stamp + suffix
      if (!(await vaultPathExists(vaultPath, backupRel))) {
        await safeCopyFile({ vaultPath, fromRelPath: relPath, toRelPath: backupRel })
        return join(vaultPath, backupRel)
      }
    }
    index += 1
  }
}

/**
 * 写入视频笔记。
 *  - 同一视频且 !force：skipped，不覆盖
 *  - 同名但身份不同或未知：选择带视频标识的副本
 *  - force 仅覆盖已确认同一视频的笔记，并先备份
 */
export function writeVideoNote({ vaultPath, noteRoot, subject, title, bvid, page = 1, videoId, source, previousNotePath = '', content, force = false, layout, backupDir = '' } = {}) {
  const base = videoNotePath({ vaultPath, noteRoot, subject, title, bvid, layout })
  const targetBvid = String(bvid ?? '').trim()
  const targetVideoId = String(videoId ?? '').trim()
  const identity = noteIdentity({ bvid: targetBvid, page, videoId: targetVideoId, source })
  const previous = toPosix(previousNotePath)

  return runVault(async () => {
    let target = base

    const tag = safeFilename((targetBvid ? targetBvid + (Number(page) > 1 ? '-p' + Number(page) : '') : targetVideoId) || '重名', 80)
    for (let index = 0; index <= 100; index += 1) {
      if (index > 0) target = siblingNotePath(base, index === 1 ? ` (${tag})` : ` (${tag}-${index})`)
      if (!(await vaultPathExists(vaultPath, target.relPath))) break
      const existing = noteIdentity(await readNoteIdentityUnsafe({ vaultPath, relPath: target.relPath }))
      const matches = Boolean(identity && existing && identity === existing)
      // 只有目标视频身份明确时才信任旧的无身份笔记：仅凭同名/旧路径可能是另一条视频，
      // 覆盖会丢掉用户手写内容。
      const trustedLegacy = Boolean(identity && !existing && previous && previous === target.relPath)
      if (matches || trustedLegacy) {
        if (!force) return { relPath: target.relPath, absPath: target.absPath, skipped: true }
        await backupFile(vaultPath, target.relPath, backupDir)
        break
      }
      if (index === 100) target = siblingNotePath(base, ` (${tag}-${Date.now()})`)
    }

    // force 重写时把旧笔记里的手写内容搬回来，避免整篇覆盖丢掉
    let finalContent = content
    try {
      if (await vaultPathExists(vaultPath, target.relPath)) {
        finalContent = mergeManualSection(await safeReadFile({ vaultPath, relPath: target.relPath }), content)
      }
    } catch {
      finalContent = content
    }

    await atomicWrite({ vaultPath, relPath: target.relPath, content: finalContent })
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
    if (!(await vaultPathExists(vaultPath, target.relPath))) {
      await atomicWrite({ vaultPath, relPath: target.relPath, content: renderSubjectManual({ subject, videos, noteRoot, layout, updatedAt: Date.now() }) })
    } else {
      const current = await safeReadFile({ vaultPath, relPath: target.relPath })
      const next = upsertAutoBlock(current, autoBlock(subjectManualAutoBody({ subject, videos })))
      await atomicWrite({ vaultPath, relPath: target.relPath, content: next })
    }
    return { relPath: target.relPath, absPath: target.absPath }
  })
}

/** 写入字幕存档；不同笔记或归属不明的同名存档保留为独立文件。 */
export function writeTranscriptNote({ vaultPath, noteRoot, noteName, content } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const name = safeFilename(noteName || '未命名视频', 80)
  const relPath = toPosix(transcriptNoteRelPath({ noteRoot: root, noteName: name }))
  const base = { absPath: absoluteFromRel(vaultPath, relPath), relPath }
  const owner = toPosix(transcriptNoteOwner(content))
  const hash = createHash('sha256').update(owner || String(content ?? '')).digest('hex').slice(0, 12)
  return runVault(async () => {
    let target = base
    let index = 0
    for (;;) {
      let state = 'missing'
      try {
        await safeStat({ vaultPath, relPath: target.relPath })
        state = 'present'
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'vault-path-missing') state = 'missing'
        else if (error?.code === 'vault-path-broken-symlink') state = 'broken'
        else throw error
      }
      if (state === 'missing') break
      if (state === 'present') {
        const existing = await safeReadFile({ vaultPath, relPath: target.relPath })
        const existingOwner = toPosix(transcriptNoteOwner(existing))
        if ((owner && existingOwner === owner) || existing === String(content ?? '')) break
      }
      // 同名但归属不同，或 base 是坏链：换一个带哈希后缀的副本，绝不覆盖。
      index += 1
      target = siblingNotePath(base, ` (字幕-${hash}${index > 1 ? '-' + index : ''})`)
    }
    await atomicWrite({ vaultPath, relPath: target.relPath, content })
    return target
  })
}

/** 读取字幕存档原文。文件不存在返回 null。 */
export async function readTranscriptNote({ vaultPath, noteRoot, noteName, owner = '', allowUnowned = false } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const name = safeFilename(noteName || '未命名视频', 80)
  const relPath = toPosix(transcriptNoteRelPath({ noteRoot: root, noteName: name }))
  const targetOwner = toPosix(owner)
  return runVault(async () => {
    let baseText = null
    try {
      baseText = await safeReadFile({ vaultPath, relPath })
    } catch (error) {
      // 坏链等同 base 不存在：仍应扫描副本，而不是整次读取失败。
      if (error?.code !== 'ENOENT' && error?.code !== 'vault-path-broken-symlink') throw error
    }
    let baseOwner = ''
    let baseParsed = false
    if (baseText !== null) {
      try {
        baseOwner = toPosix(transcriptNoteOwner(baseText))
        baseParsed = true
      } catch {
        baseParsed = false
      }
      if (baseParsed && targetOwner && baseOwner === targetOwner) return baseText
    }
    if (!targetOwner) {
      if (baseText === null || !baseParsed) return null
      // 没有 owner 就无从确认归属：有主和无主的 base 都只有调用方显式允许时才返回。
      if (baseOwner) return allowUnowned ? baseText : null
      return allowUnowned ? baseText : null
    }

    // base 不存在、无法解析，或明确属于别的笔记：扫描同目录的「(字幕-*)」副本。
    const directory = dirname(relPath)
    const baseName = basename(relPath, '.md')
    const findCopy = async (dirRel, name) => {
      let entries = []
      try {
        entries = await safeReaddir({ vaultPath, relPath: dirRel })
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!entry.name.startsWith(name + ' (字幕-') || !entry.name.endsWith('.md')) continue
        const candidateRel = toPosix(join(dirRel, entry.name))
        let text
        try {
          text = await safeReadFile({ vaultPath, relPath: candidateRel })
        } catch (error) {
          if (error?.code === 'ENOENT') continue
          throw error
        }
        let candidateOwner = ''
        try { candidateOwner = toPosix(transcriptNoteOwner(text)) } catch { continue }
        if (candidateOwner && candidateOwner === targetOwner) return text
      }
      return null
    }
    const copy = await findCopy(directory, baseName)
    if (copy !== null) return copy

    // 升级前的旧目录 <noteRoot>/字幕/：只读回退，不自动移动文件。
    const legacyRel = toPosix(join(root, TRANSCRIPT_DIR, name + '.md'))
    let legacyText = null
    try {
      legacyText = await safeReadFile({ vaultPath, relPath: legacyRel })
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'vault-path-broken-symlink') throw error
    }
    if (legacyText !== null) {
      let legacyOwner = ''
      try { legacyOwner = toPosix(transcriptNoteOwner(legacyText)) } catch { legacyOwner = '' }
      if (legacyOwner && legacyOwner === targetOwner) return legacyText
      const legacyCopy = await findCopy(dirname(legacyRel), baseName)
      if (legacyCopy !== null) return legacyCopy
      if (allowUnowned && !legacyOwner) return legacyText
    }

    // 旧的无主存档只有在调用方确认「同名唯一」时才可用。
    if (allowUnowned && baseText !== null && baseParsed && !baseOwner) return baseText
    return null
  })
}

/** 读取一篇 vault 内的 Markdown（relPath 相对 vault 根）。 */
export function readVaultText({ vaultPath, relPath } = {}) {
  const rel = toPosix(String(relPath ?? '')).replace(/^\/+/, '')
  if (!rel) return Promise.resolve({ ok: false, error: '缺少文件路径' })
  return runVaultTask(async () => {
    try {
      return { ok: true, relPath: rel, text: await safeReadFile({ vaultPath, relPath: rel }) }
    } catch (error) {
      const code = String(error?.code || '')
      // vault 根不存在不是「这篇笔记不存在」：要保留恢复意图，等笔记库重新可访问再试。
      if (code === 'vault-path-missing') return { ok: false, code: 'vault-unavailable', error: '笔记库不可访问：' + rel }
      if (code.startsWith('vault-path-')) return { ok: false, code, error: '读取失败：' + rel + '（' + (error?.message || error) + '）' }
      if (code === 'ENOENT') return { ok: false, code: 'not-found', error: '文件不存在：' + rel }
      return { ok: false, code: 'read-failed', error: '读取失败：' + rel + '（' + (error?.message || error) + '）' }
    }
  })
}

/** 只改 frontmatter 的 tags 行（保留其它字段与正文）。 */
export function updateNoteTags({ vaultPath, notePath, tags } = {}) {
  const relPath = toPosix(String(notePath ?? ''))
  const json = JSON.stringify(Array.isArray(tags) ? tags : [])
  return runVault(async () => {
    let markdown
    try {
      markdown = await safeReadFile({ vaultPath, relPath })
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: false, error: '笔记不存在：' + relPath }
      throw error
    }
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return { ok: false, error: '笔记没有 frontmatter：' + relPath }
    const block = match[1]
    const line = 'tags: ' + json
    const nextBlock = /^tags:.*$/m.test(block)
      ? block.replace(/^tags:.*$/m, line)
      : block.replace(/\s*$/, '') + '\n' + line
    const next = markdown.slice(0, match.index) + '---\n' + nextBlock + '\n---' + markdown.slice(match.index + match[0].length)
    await atomicWrite({ vaultPath, relPath, content: next })
    return { ok: true, relPath }
  })
}

/** 更新笔记 frontmatter 里的 review 字段（复习状态），保留其余内容。 */
export function updateNoteReview({ vaultPath, notePath, review } = {}) {
  const relPath = String(notePath || '').trim().replace(/\\/g, '/')
  if (!relPath) return Promise.resolve({ ok: false, error: '缺少 notePath' })
  const json = JSON.stringify(review && typeof review === 'object' ? review : {})
  return runVault(async () => {
    let markdown
    try {
      markdown = await safeReadFile({ vaultPath, relPath })
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: false, error: '笔记不存在：' + relPath }
      throw error
    }
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return { ok: false, error: '笔记没有 frontmatter：' + relPath }
    const block = match[1]
    const line = 'review: ' + json
    const nextBlock = /^review:.*$/m.test(block)
      ? block.replace(/^review:.*$/m, line)
      : block.replace(/\s*$/, '') + '\n' + line
    const next = markdown.slice(0, match.index) + '---\n' + nextBlock + '\n---' + markdown.slice(match.index + match[0].length)
    await atomicWrite({ vaultPath, relPath, content: next })
    return { ok: true, relPath }
  })
}

/** 更新/创建总览：只替换 AUTO 区，保留用户内容；不存在时创建完整骨架。 */
export function updateOverview({ vaultPath, noteRoot, subjects, videos, layout } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, OVERVIEW_FILENAME))
  const target = { absPath: absoluteFromRel(vaultPath, relPath), relPath }
  return runVault(async () => {
    if (!(await vaultPathExists(vaultPath, relPath))) {
      await atomicWrite({ vaultPath, relPath, content: renderOverview({ subjects, videos, noteRoot: root, layout, updatedAt: Date.now() }) })
    } else {
      const current = await safeReadFile({ vaultPath, relPath })
      const next = upsertAutoBlock(current, autoBlock(overviewAutoBody({ subjects, videos, noteRoot: root, layout })))
      await atomicWrite({ vaultPath, relPath, content: next })
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
  const relPath = toPosix(weeklyReviewRelPath({ noteRoot: root, label }))
  return runVault(async () => {
    if (await vaultPathExists(vaultPath, relPath)) return { ok: true, skipped: true, relPath, absPath: absoluteFromRel(vaultPath, relPath) }
    await atomicWrite({ vaultPath, relPath, content: markdown })
    return { ok: true, skipped: false, relPath, absPath: absoluteFromRel(vaultPath, relPath) }
  })
}

/** 写入 AUTO 区块型索引笔记：已有文件只更新 AUTO 区，保留用户内容。 */
function writeAutoNote({ vaultPath, noteRoot, filename, title, type, markdown } = {}) {
  if (!vaultPath) throw new Error('writeAutoNote: 缺少 vaultPath')
  const root = normalizeNoteRoot(noteRoot)
  const relPath = toPosix(join(root, filename))
  const body = autoBlock(String(markdown || ''))
  return runVault(async () => {
    if (await vaultPathExists(vaultPath, relPath)) {
      const current = await safeReadFile({ vaultPath, relPath })
      const next = upsertAutoBlock(current, body)
      if (next !== current) await atomicWrite({ vaultPath, relPath, content: next })
      return { ok: true, relPath, absPath: absoluteFromRel(vaultPath, relPath), created: false }
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
    await atomicWrite({ vaultPath, relPath, content })
    return { ok: true, relPath, absPath: absoluteFromRel(vaultPath, relPath), created: true }
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

/** 写入概念页：<noteRoot>/资料/概念/<概念>.md，只更新 AUTO 区。 */
export function writeConceptPage({ vaultPath, noteRoot, name, markdown } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const label = safeFilename(name || '未命名概念', 80)
  const relPath = conceptPageRelPath({ noteRoot: root, name: label })
  return writeAutoNote({ vaultPath, noteRoot: root, filename: relPath.slice(root.length + 1), title: label, type: 'concept', markdown })
}

/** 写入主题综述：<noteRoot>/资料/主题/<主题>.md，只更新 AUTO 区。 */
export function writeTopicPage({ vaultPath, noteRoot, name, markdown } = {}) {
  const root = normalizeNoteRoot(noteRoot)
  const label = safeFilename(name || '未命名主题', 80)
  const relPath = topicPageRelPath({ noteRoot: root, name: label })
  return writeAutoNote({ vaultPath, noteRoot: root, filename: relPath.slice(root.length + 1), title: label, type: 'topic', markdown })
}
