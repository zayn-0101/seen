/**
 * dsh-video-coursemap · 配置解析
 *
 * 纯 ESM、零依赖。负责默认值、校验、Obsidian vault 自动检测与状态目录推导。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 插件默认配置（契约见 docs/contracts.md） */
export const DEFAULTS = Object.freeze({
  enabled: true,
  autoStart: true,
  exposeController: false,
  pollIntervalMs: 15000,
  stablePolls: 2,
  vaultPath: null,
  noteRoot: '课程知识地图',
  stateDir: null,
  provider: null,
  model: null,
  maxTokens: 4096,
  titleMinLen: 4,
  fetchContent: true,
  fetchTranscript: true,
  ytDlpBin: null,
  useBrowserCookies: true,
  cookieBrowser: 'chrome',
  transcriptLangs: ['ai-zh', 'zh-Hans', 'zh-CN', 'zh'],
  useTranscriptCache: true,
  transcriptCacheDays: 7,
  douyinCacheDays: 7,
  chromePath: null,
  ffmpegBin: null,
  whisperBin: null,
  whisperModel: null,
  commentLimit: 50,
  enableMnemon: true,
  mnemonBin: null,
  mnemonStore: 'default',
  openInObsidian: false,
  browserNames: null,
})

const POSITIVE_NUMBER_KEYS = ['pollIntervalMs', 'stablePolls', 'maxTokens', 'titleMinLen', 'commentLimit', 'transcriptCacheDays', 'douyinCacheDays']
const BOOLEAN_KEYS = ['enabled', 'autoStart', 'exposeController', 'fetchContent', 'fetchTranscript', 'useBrowserCookies', 'useTranscriptCache', 'enableMnemon', 'openInObsidian']
const NULLABLE_NON_EMPTY_STRING_KEYS = ['provider', 'model', 'mnemonBin', 'ytDlpBin', 'chromePath', 'ffmpegBin', 'whisperBin', 'whisperModel']

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireNonEmptyString(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-video-coursemap: ${key} 必须是非空字符串`)
  }
}

/** 读取 obsidian.json 并挑选可用的 vault 目录 */
export function detectObsidianVault(home = homedir()) {
  try {
    const homeDir = typeof home === 'string' && home ? home : homedir()
    const configPath = join(homeDir, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
    if (!existsSync(configPath)) return null

    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    if (!isPlainObject(raw)) return null
    const vaults = raw.vaults
    if (!isPlainObject(vaults)) return null

    const candidates = []
    // 1) last_open 指向的 vault
    if (typeof raw.last_open === 'string' && isPlainObject(vaults[raw.last_open])) {
      candidates.push(vaults[raw.last_open])
    }
    // 2) 任意 open:true 的 vault
    for (const vault of Object.values(vaults)) {
      if (isPlainObject(vault) && vault.open === true) candidates.push(vault)
    }
    // 3) 第一个 vault
    for (const vault of Object.values(vaults)) candidates.push(vault)

    const checked = new Set()
    for (const vault of candidates) {
      if (!isPlainObject(vault) || typeof vault.path !== 'string') continue
      const vaultPath = vault.path.trim()
      if (!vaultPath || checked.has(vaultPath)) continue
      checked.add(vaultPath)
      try {
        if (existsSync(vaultPath) && statSync(vaultPath).isDirectory()) return vaultPath
      } catch {
        // 目录不可访问，继续尝试下一个候选
      }
    }
    return null
  } catch {
    return null
  }
}

/** 默认状态/日志目录：~/.dsh/state/seen */
export function defaultStateDir(home = homedir()) {
  const homeDir = typeof home === 'string' && home ? home : homedir()
  return join(homeDir, '.dsh', 'state', 'seen')
}

/** 清洗文件名：去掉非法字符、压缩空白、trim 首尾点和空格 */
export function sanitizeFilename(name, max = 80) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 80
  let result = String(name ?? '')
    // 删除 Windows/macOS 非法文件名字符与控制字符
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 首尾的点和空格都不允许（Windows 不允许尾部点）
  result = result.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (result.length > limit) result = result.slice(0, limit)
  result = result.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  return result || '未命名'
}

/** 学科名归一化：NFC、trim、压缩空白；空值归为「未分类」 */
export function normalizeSubjectName(name) {
  const result = String(name ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
  return result || '未分类'
}

/**
 * 合并并校验配置。
 * raw 必须是普通对象；未知配置项直接抛错。
 */
export function resolveConfig(raw = {}) {
  if (!isPlainObject(raw)) {
    throw new Error('dsh-video-coursemap: 配置必须是普通对象')
  }

  const config = { ...DEFAULTS }

  for (const [key, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      throw new Error(`dsh-video-coursemap: 未知配置项 "${key}"`)
    }
    if (value === undefined) continue
    config[key] = value
  }

  for (const key of BOOLEAN_KEYS) {
    if (typeof config[key] !== 'boolean') {
      throw new Error(`dsh-video-coursemap: ${key} 必须是布尔值`)
    }
  }

  for (const key of POSITIVE_NUMBER_KEYS) {
    const value = config[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`dsh-video-coursemap: ${key} 必须是正数`)
    }
  }

  for (const key of NULLABLE_NON_EMPTY_STRING_KEYS) {
    if (config[key] === null || config[key] === undefined) {
      config[key] = null
      continue
    }
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`dsh-video-coursemap: ${key} 必须是 null 或非空字符串`)
    }
    config[key] = config[key].trim()
  }

  requireNonEmptyString(config.noteRoot, 'noteRoot')
  config.noteRoot = config.noteRoot.trim()

  if (typeof config.mnemonStore !== 'string' || config.mnemonStore.trim() === '') {
    throw new Error('dsh-video-coursemap: mnemonStore 必须是非空字符串')
  }
  config.mnemonStore = config.mnemonStore.trim()

  if (typeof config.cookieBrowser !== 'string' || config.cookieBrowser.trim() === '') {
    throw new Error('dsh-video-coursemap: cookieBrowser 必须是非空字符串')
  }
  config.cookieBrowser = config.cookieBrowser.trim()

  if (!Array.isArray(config.transcriptLangs) || config.transcriptLangs.length === 0) {
    throw new Error('dsh-video-coursemap: transcriptLangs 必须是非空字符串数组')
  }
  config.transcriptLangs = config.transcriptLangs.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('dsh-video-coursemap: transcriptLangs 必须是非空字符串数组')
    }
    return item.trim()
  })

  for (const key of ['vaultPath', 'stateDir']) {
    if (config[key] === null || config[key] === undefined) {
      config[key] = null
      continue
    }
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`dsh-video-coursemap: ${key} 必须是 null 或非空字符串`)
    }
    config[key] = config[key].trim()
  }

  if (config.browserNames !== null && config.browserNames !== undefined) {
    if (!Array.isArray(config.browserNames)) {
      throw new Error('dsh-video-coursemap: browserNames 必须是 null 或字符串数组')
    }
    config.browserNames = config.browserNames.map((item) => {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error('dsh-video-coursemap: browserNames 必须是 null 或字符串数组')
      }
      return item.trim()
    })
  } else {
    config.browserNames = null
  }

  if (!config.vaultPath) config.vaultPath = detectObsidianVault()
  if (!config.stateDir) config.stateDir = defaultStateDir()

  return config
}
