/**
 * seen-core · 状态持久化
 *
 * 纯 ESM、零依赖。状态文件采用「临时文件 + rename」原子写；
 * 严格读取区分初次运行和损坏的状态；另外保留最近两份已确认的状态。
 */

import { mkdirSync, readFileSync, statSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { alignSubject } from './subject.js'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 默认状态（版本 2） */
export function defaultState() {
  return {
    version: 2,
    seen: {},
    subjects: {},
    lastTitle: '',
    lastRunAt: 0,
    failures: {},
    stats: { processed: 0, skipped: 0, failed: 0, lastMnemon: null },
    // 主题词 → 出现次数，供提示词复用与标签收敛；旧状态缺这一项时按空表处理
    tagVocabulary: {},
    // 崩溃恢复：先落盘的「正在写笔记」与「正在写复习」意图，启动时按身份核对后补状态
    pendingVideos: {},
    pendingReviews: {},
  }
}

function normalizeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** 词表只接受「非空词 → 正整数」，脏数据整项丢弃 */
function normalizeTagVocabulary(value) {
  if (!isPlainObject(value)) return {}
  const result = {}
  for (const [name, count] of Object.entries(value)) {
    const key = String(name ?? '').trim()
    const hits = Number(count)
    if (!key || !Number.isFinite(hits) || hits <= 0) continue
    result[key] = Math.floor(hits)
  }
  return result
}

/** 把任意输入合并到默认状态结构上，并清洗字段类型 */
function mergeState(input) {
  const base = defaultState()
  if (!isPlainObject(input)) return base

  const merged = { ...base, ...input, version: 2 }
  merged.seen = isPlainObject(input.seen) ? { ...input.seen } : {}
  merged.subjects = isPlainObject(input.subjects) ? { ...input.subjects } : {}
  merged.failures = isPlainObject(input.failures) ? { ...input.failures } : {}
  merged.tagVocabulary = normalizeTagVocabulary(input.tagVocabulary)
  merged.pendingVideos = isPlainObject(input.pendingVideos) ? { ...input.pendingVideos } : {}
  merged.pendingReviews = isPlainObject(input.pendingReviews) ? { ...input.pendingReviews } : {}
  merged.lastTitle = typeof input.lastTitle === 'string' ? input.lastTitle : ''
  merged.lastRunAt = normalizeNumber(input.lastRunAt, 0)
  merged.stats = { ...base.stats, ...(isPlainObject(input.stats) ? input.stats : {}) }
  merged.stats.processed = normalizeNumber(merged.stats.processed, 0)
  merged.stats.skipped = normalizeNumber(merged.stats.skipped, 0)
  merged.stats.failed = normalizeNumber(merged.stats.failed, 0)
  if (merged.stats.lastMnemon !== null && !isPlainObject(merged.stats.lastMnemon)) {
    merged.stats.lastMnemon = null
  }
  return merged
}

/** 原子写：先写同目录临时文件，再 rename 覆盖目标 */
export function atomicWrite(file, content, { mode = 0o666 } = {}) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', mode })
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

function readStateDocument(file, strict) {
  const text = readFileSync(file, 'utf8')
  const parsed = JSON.parse(text)
  if (strict && (!isPlainObject(parsed) || ('subjects' in parsed && !isPlainObject(parsed.subjects)))) {
    throw new Error('状态结构无效')
  }
  return { text, state: mergeState(parsed) }
}

/** 首次运行使用默认状态。strict 让写入方区分已有文件损坏与首次运行。 */
export function loadState(statePath, { strict = false } = {}) {
  try {
    return readStateDocument(statePath, strict).state
  } catch (error) {
    if (strict && error.code !== 'ENOENT') {
      throw new Error('state.json 无法读取或格式无效，请检查权限或从备份恢复')
    }
    return defaultState()
  }
}

const BACKUP_SLOTS = ['latest', 'previous']

function stateBackupPath(statePath, slot) {
  if (!BACKUP_SLOTS.includes(slot)) throw new Error('备份只能选择 latest 或 previous')
  return statePath + '.backup.' + slot
}

function writeCheckpoint(statePath, text) {
  const latest = stateBackupPath(statePath, 'latest')
  let previous
  try { previous = readStateDocument(latest, true).text } catch { /* 保留另一个有效备份 */ }
  if (previous === text) return
  if (previous) atomicWrite(stateBackupPath(statePath, 'previous'), previous, { mode: 0o600 })
  atomicWrite(latest, text, { mode: 0o600 })
}

export function saveState(statePath, state, { checkpoint = true } = {}) {
  const text = JSON.stringify(mergeState(state), null, 2) + '\n'
  atomicWrite(statePath, text, { mode: 0o600 })
  if (checkpoint) {
    try {
      writeCheckpoint(statePath, text)
    } catch (error) {
      return { backupError: error.code || error.message }
    }
  }
  return {}
}

/** 为升级前已有的有效状态生成第一份备份。调用方须持有实例锁。 */
export function seedStateBackup(statePath) {
  if (listStateBackups(statePath).some(backup => backup.valid)) return
  try {
    writeCheckpoint(statePath, readStateDocument(statePath, true).text)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

export function listStateBackups(statePath) {
  return BACKUP_SLOTS.map(slot => {
    const path = stateBackupPath(statePath, slot)
    try {
      const { state } = readStateDocument(path, true)
      return { slot, path, valid: true, lastRunAt: state.lastRunAt, updatedAt: statSync(path).mtimeMs }
    } catch (error) {
      return { slot, path, valid: false, missing: error.code === 'ENOENT' }
    }
  })
}

/** 从已存在的快照恢复。先保存当前文件原样，调用方须持有实例锁。 */
export function restoreStateBackup(statePath, slot) {
  const path = stateBackupPath(statePath, slot)
  let snapshot
  try { snapshot = readStateDocument(path, true) } catch { throw new Error('所选状态备份不存在或无法读取') }

  let preservedPath = ''
  let original
  try {
    original = readFileSync(statePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (original) {
    preservedPath = statePath + '.before-restore.' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + randomBytes(6).toString('hex')
    atomicWrite(preservedPath, original, { mode: 0o600 })
  }
  atomicWrite(statePath, snapshot.text, { mode: 0o600 })
  return { path, preservedPath }
}

/** 生成去重键：优先 bvid / 平台视频 ID，否则标题小写去空白/标点 */
export function seenKey({ bvid, videoId, source, title, page } = {}) {
  if (bvid !== null && bvid !== undefined && String(bvid).trim() !== '') {
    const pageNum = Number(page)
    return 'bvid:' + String(bvid).trim() + (Number.isInteger(pageNum) && pageNum > 1 ? ':p' + pageNum : '')
  }
  if (videoId !== null && videoId !== undefined && String(videoId).trim() !== '') {
    return String(source || 'video') + ':' + String(videoId).trim()
  }
  const normalized = String(title ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '')
  return 'title:' + normalized
}

export function isSeen(state, key) {
  return Boolean(state && isPlainObject(state.seen) && Object.prototype.hasOwnProperty.call(state.seen, key))
}

/** 标记已处理；info 会与 at 合并写入 seen[key] */
export function markSeen(state, key, info) {
  if (!state || typeof state !== 'object') return
  if (!isPlainObject(state.seen)) state.seen = {}
  const record = isPlainObject(info) ? { ...info } : {}
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) record.at = Date.now()
  state.seen[key] = record
}

/** 只保留最近 max 条 seen 记录（按 at 升序淘汰最旧） */
export function pruneSeen(state, max = 1000) {
  if (!state || !isPlainObject(state.seen)) return
  const limit = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 1000
  const keys = Object.keys(state.seen)
  if (keys.length <= limit) return
  const timeOf = (entry) => (isPlainObject(entry) && typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0)
  keys.sort((a, b) => timeOf(state.seen[a]) - timeOf(state.seen[b]))
  for (let index = 0; index < keys.length - limit; index += 1) {
    delete state.seen[keys[index]]
  }
}

/**
 * 解析学科名：
 * 1) 完全一致 → 原样返回；
 * 2) 归一化后一致 / 互相包含 → 复用已有学科；
 * 3) 否则返回归一化后的新学科名。
 */
export function resolveSubjectName(subject, existing = [], options = {}) {
  return alignSubject(subject, existing, options).subject
}

/**
 * 记录失败：count 累加、记录时间与最后一次错误。
 * meta 保留视频信息（title / url / source / bvid / videoId），用于面板展示与一键重试。
 */
export function recordFailure(state, key, error, meta = null) {
  if (!state || typeof state !== 'object') return
  if (!isPlainObject(state.failures)) state.failures = {}
  const previous = isPlainObject(state.failures[key]) ? state.failures[key] : null
  const count = previous && typeof previous.count === 'number' && Number.isFinite(previous.count) ? previous.count : 0
  const record = {
    count: count + 1,
    at: Date.now(),
    lastError: String(error ?? '').slice(0, 500),
  }
  if (isPlainObject(meta)) {
    const clean = {}
    for (const field of ['title', 'url', 'source', 'bvid', 'videoId']) {
      const value = meta[field]
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        clean[field] = String(value).slice(0, 500)
      }
    }
    if (Object.keys(clean).length > 0) record.meta = clean
  } else if (previous && isPlainObject(previous.meta)) {
    record.meta = previous.meta
  }
  state.failures[key] = record
}

/** 列出最近失败记录（按时间倒序），供面板展示与重试 */
export function listFailures(state, limit = 20) {
  if (!state || !isPlainObject(state.failures)) return []
  const entries = Object.entries(state.failures).map(([key, record]) => ({
    key,
    count: isPlainObject(record) && Number.isFinite(record.count) ? record.count : 0,
    at: isPlainObject(record) && Number.isFinite(record.at) ? record.at : 0,
    lastError: isPlainObject(record) && typeof record.lastError === 'string' ? record.lastError : '',
    meta: isPlainObject(record) && isPlainObject(record.meta) ? record.meta : null,
  }))
  entries.sort((a, b) => b.at - a.at)
  const max = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 20
  return entries.slice(0, max)
}

/** 连续失败 >= 3 次且仍在冷却期内 → 跳过 */
export function shouldSkipFailure(state, key, now = Date.now(), cooldownMs = 60 * 60 * 1000) {
  if (!state || !isPlainObject(state.failures)) return false
  const failure = state.failures[key]
  if (!isPlainObject(failure)) return false
  if (typeof failure.count !== 'number' || !Number.isFinite(failure.count) || failure.count < 3) return false
  const at = typeof failure.at === 'number' && Number.isFinite(failure.at) ? failure.at : 0
  const cooldown = Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : 60 * 60 * 1000
  return now - at < cooldown
}

/** 成功后清除失败记录 */
export function clearFailure(state, key) {
  if (!state || !isPlainObject(state.failures)) return
  delete state.failures[key]
}


