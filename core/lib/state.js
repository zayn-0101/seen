/**
 * seen-core · 状态持久化
 *
 * 纯 ESM、零依赖。状态文件采用「临时文件 + rename」原子写；
 * 损坏或缺失的 JSON 一律回退到默认状态并做默认值合并。
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

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
  }
}

function normalizeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** 把任意输入合并到默认状态结构上，并清洗字段类型 */
function mergeState(input) {
  const base = defaultState()
  if (!isPlainObject(input)) return base

  const merged = { ...base, ...input, version: 2 }
  merged.seen = isPlainObject(input.seen) ? { ...input.seen } : {}
  merged.subjects = isPlainObject(input.subjects) ? { ...input.subjects } : {}
  merged.failures = isPlainObject(input.failures) ? { ...input.failures } : {}
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
export function atomicWrite(file, content) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(tmp, content, 'utf8')
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

/** 读取状态；文件缺失/损坏时返回默认状态 */
export function loadState(statePath) {
  try {
    const text = readFileSync(statePath, 'utf8')
    const parsed = JSON.parse(text)
    return mergeState(parsed)
  } catch {
    return defaultState()
  }
}

/** 保存状态（自动补齐默认值，UTF-8 末尾换行） */
export function saveState(statePath, state) {
  atomicWrite(statePath, JSON.stringify(mergeState(state), null, 2) + '\n')
}

/** 生成去重键：优先 bvid / 平台视频 ID，否则标题小写去空白/标点 */
export function seenKey({ bvid, videoId, source, title } = {}) {
  if (bvid !== null && bvid !== undefined && String(bvid).trim() !== '') {
    return 'bvid:' + String(bvid).trim()
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
export function resolveSubjectName(subject, existing = []) {
  const list = Array.isArray(existing) ? existing.filter((item) => typeof item === 'string' && item.trim() !== '') : []
  const raw = String(subject ?? '').trim()
  if (raw && list.includes(raw)) return raw

  const normalized = normalizeSubjectName(subject)
  for (const name of list) {
    if (normalizeSubjectName(name) === normalized) return name
  }
  for (const name of list) {
    const candidate = normalizeSubjectName(name)
    if (candidate && normalized && (candidate.includes(normalized) || normalized.includes(candidate))) {
      return name
    }
  }
  return normalized
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

function normalizeSubjectName(name) {
  const result = String(name ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
  return result || '未分类'
}
