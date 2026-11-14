/**
 * 本地音频工具与 whisper.cpp 语音转写。
 *
 * 抖音没有可用字幕、YouTube 字幕抓不到时都走这里：
 * 调用方先用 ffmpeg 把音频转成 16kHz 单声道 wav，本模块负责调 whisper-cli 产出文本。
 *
 * 依赖策略（尽量让用户省心）：
 *  - ffmpeg：缺失时自动下载 ffmpeg-static 的静态二进制到 ~/.seen/bin；
 *  - Whisper 模型：缺失时自动下载（HF_ENDPOINT / huggingface / hf-mirror 依次尝试）到 ~/.seen/models；
 *  - whisper-cli：官方没有预编译二进制，只能提示用包管理器安装。
 * 系统里已装的始终优先，不会被自动下载的副本覆盖。
 */
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { downloadCandidates } from './download.js'

const execFileP = promisify(execFile)
const BIN_DIR = join(homedir(), '.seen', 'bin')
const MODEL_DIR = join(homedir(), '.seen', 'models')
const WHISPER_TIMEOUT_MS = 30 * 60 * 1000
const VERIFY_TIMEOUT_MS = 20000
const BINARY_DOWNLOAD_TIMEOUT_MS = 300000
const MODEL_DOWNLOAD_TIMEOUT_MS = 900000
const DEFAULT_MODEL = 'large-v3-turbo'

/**
 * 可选转写模型，按推荐力度排序。
 * 面板上「缺少模型」时按这个顺序给用户选。
 */
export const WHISPER_MODELS = Object.freeze([
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    sizeMb: 1550,
    recommended: true,
    note: '准确率接近最强的 large-v3，速度约为它的 6 倍。中文长视频首选，20 分钟视频约 3–4 分钟。',
  },
  {
    id: 'small',
    label: 'Small',
    sizeMb: 445,
    recommended: false,
    note: '速度约为 turbo 的两倍；同音字和专业术语容易出错，适合短视频或只求能看的场景。',
  },
  {
    id: 'medium',
    label: 'Medium',
    sizeMb: 1450,
    recommended: false,
    note: '比 small 准，但更慢更占空间；已有 turbo 的情况下一般不需要选它。',
  },
  {
    id: 'base',
    label: 'Base',
    sizeMb: 135,
    recommended: false,
    note: '只适合快速验证链路，中文准确率明显不足，不建议用它生成课程笔记。',
  },
])

function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

function isFile(file) {
  try { return statSync(file).isFile() } catch { return null }
}

function firstFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && isFile(candidate)) return candidate
  }
  return null
}

function whichSync(command) {
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (result.status !== 0) return null
    return String(result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 定位                                                                 */
/* ------------------------------------------------------------------ */

/** 查找 whisper-cli；配置 whisperBin 优先。返回绝对路径或 null。 */
export function findWhisperCli(config = {}) {
  const configured = config.whisperBin ? expandHome(config.whisperBin) : null
  const fromEnv = process.env.SEEN_WHISPER_BIN ? expandHome(process.env.SEEN_WHISPER_BIN) : null
  return firstFile([
    configured,
    fromEnv,
    whichSync('whisper-cli'),
    whichSync('whisper-cpp'),
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    join(homedir(), '.local', 'bin', 'whisper-cli'),
    join(homedir(), 'bin', 'whisper-cli'),
  ])
}

/** 自动安装的 ffmpeg 位置：~/.seen/bin/ffmpeg。 */
export function ffmpegInstallPath(platform = process.platform) {
  return join(BIN_DIR, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

/** 查找 ffmpeg（只看已安装的）；配置 ffmpegBin 优先。返回绝对路径或 null。 */
export function findFfmpeg(config = {}) {
  const configured = config.ffmpegBin ? expandHome(config.ffmpegBin) : null
  const fromEnv = process.env.SEEN_FFMPEG_BIN ? expandHome(process.env.SEEN_FFMPEG_BIN) : null
  return firstFile([
    configured,
    fromEnv,
    whichSync('ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    ffmpegInstallPath(),
  ])
}

/** 默认 Whisper 模型路径。 */
export function whisperModelPath(model = DEFAULT_MODEL) {
  return join(MODEL_DIR, 'ggml-' + model + '.bin')
}

/** 查找 whisper 模型；配置 whisperModel 优先。返回绝对路径或 null。 */
export function findWhisperModel(config = {}) {
  return firstFile([
    config.whisperModel ? expandHome(config.whisperModel) : null,
    // 用户手动装了更准的模型时优先用；模型越大越准，同名冲突按准确率排序。
    join(MODEL_DIR, 'ggml-large-v3-turbo.bin'),
    join(MODEL_DIR, 'ggml-medium.bin'),
    join(MODEL_DIR, 'ggml-small.bin'),
    join(MODEL_DIR, 'ggml-base.bin'),
    join(process.cwd(), 'models', 'ggml-small.bin'),
    join(process.cwd(), 'models', 'ggml-base.bin'),
    join(homedir(), '.cache', 'whisper', 'ggml-small.bin'),
  ])
}

/* ------------------------------------------------------------------ */
/* 下载安装                                                             */
/* ------------------------------------------------------------------ */

/** ffmpeg-static 对应平台的资产名；不支持的平台返回 null。 */
export function ffmpegAssetName(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'ffmpeg-darwin-arm64' : 'ffmpeg-darwin-x64'
  if (platform === 'win32') return 'ffmpeg-win32-x64'
  if (platform === 'linux') {
    if (arch === 'arm64') return 'ffmpeg-linux-arm64'
    if (arch === 'ia32') return 'ffmpeg-linux-ia32'
    if (arch === 'arm') return 'ffmpeg-linux-arm'
    return 'ffmpeg-linux-x64'
  }
  return null
}

/** ffmpeg 静态二进制下载地址；不支持的平台返回 null。 */
export function ffmpegReleaseUrl(platform = process.platform, arch = process.arch) {
  const asset = ffmpegAssetName(platform, arch)
  return asset ? 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/' + asset : null
}

/** Whisper 模型下载地址列表：HF_ENDPOINT 优先，其次官方，最后国内镜像。 */
export function whisperModelUrls(model = DEFAULT_MODEL) {
  const endpoint = String(process.env.HF_ENDPOINT || '').trim().replace(/\/+$/, '')
  const bases = []
  if (endpoint) bases.push(endpoint)
  bases.push('https://huggingface.co', 'https://hf-mirror.com')
  return [...new Set(bases)].map((base) => base + '/ggerganov/whisper.cpp/resolve/main/ggml-' + model + '.bin')
}

async function downloadTo(url, target, { timeout = BINARY_DOWNLOAD_TIMEOUT_MS, minBytes = 1024, onProgress } = {}) {
  mkdirSync(dirname(target), { recursive: true })
  const temp = target + '.part'
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  let lastReport = 0
  const out = createWriteStream(temp)
  const reader = res.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      received += value.length
      const now = Date.now()
      if (onProgress && now - lastReport > 800) {
        lastReport = now
        onProgress({
          received,
          total,
          percent: total ? Math.round((received / total) * 100) : null,
        })
      }
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())))
  } catch (error) {
    try { out.destroy() } catch { /* 忽略 */ }
    try { rmSync(temp, { force: true }) } catch { /* 忽略 */ }
    throw error
  }
  const size = statSync(temp).size
  if (size < minBytes) {
    try { rmSync(temp, { force: true }) } catch { /* 忽略 */ }
    throw new Error('下载内容过小（' + size + ' 字节）')
  }
  renameSync(temp, target)
  return size
}

async function verifyRuns(file, args = ['-version']) {
  try {
    const result = await execFileP(file, args, { timeout: VERIFY_TIMEOUT_MS, encoding: 'utf8' })
    return Boolean(String((result.stdout || '') + (result.stderr || '')).trim())
  } catch {
    return false
  }
}

let ffmpegTask = null
let ffmpegTried = false

/** 下载 ffmpeg 静态二进制到 ~/.seen/bin 并校验；并发调用共享同一次下载。 */
export async function installFfmpeg({ force = false, onProgress } = {}) {
  const target = ffmpegInstallPath()
  if (!force && existsSync(target) && await verifyRuns(target)) {
    return { ok: true, path: target, skipped: true }
  }
  if (ffmpegTask) return ffmpegTask
  ffmpegTask = (async () => {
    const url = ffmpegReleaseUrl()
    if (!url) return { ok: false, error: '当前平台没有可用的 ffmpeg 静态构建' }
    try {
      if (onProgress) onProgress({ stage: 'download', message: '正在下载 ffmpeg（约 45MB）' })
      // 官方 GitHub 失败时按镜像重试（国内直连常常超时）
      let lastError = null
      for (const candidate of downloadCandidates(url)) {
        try {
          await downloadTo(candidate, target, {
            timeout: BINARY_DOWNLOAD_TIMEOUT_MS,
            minBytes: 1024 * 1024,
            onProgress: (p) => onProgress && onProgress({ ...p, stage: 'download', message: '正在下载 ffmpeg' }),
          })
          chmodSync(target, 0o755)
          if (!await verifyRuns(target)) throw new Error('下载的 ffmpeg 无法运行')
          return { ok: true, path: target }
        } catch (error) {
          lastError = error
          try { rmSync(target, { force: true }) } catch { /* 忽略 */ }
        }
      }
      throw lastError || new Error('下载失败')
    } catch (error) {
      try { rmSync(target, { force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: String(error?.message || error || '下载失败') }
    } finally {
      ffmpegTask = null
    }
  })()
  return ffmpegTask
}

/** 确保有可用的 ffmpeg：已安装直接用，缺失时自动下载一次。 */
export async function ensureFfmpeg(config = {}, { onProgress } = {}) {
  const found = findFfmpeg(config)
  if (found) return { ok: true, path: found, skipped: true }
  if (ffmpegTried) return { ok: false, error: 'ffmpeg 不可用（本次运行已尝试过自动下载）' }
  ffmpegTried = true
  const result = await installFfmpeg({ onProgress })
  if (!result.ok) return result
  const after = findFfmpeg(config)
  return after ? { ok: true, path: after } : { ok: false, error: '安装完成但找不到 ffmpeg' }
}

let modelTask = null

/** 下载 Whisper 模型到 ~/.seen/models；HF_ENDPOINT → huggingface → hf-mirror 依次尝试。 */
export async function installWhisperModel({ model = DEFAULT_MODEL, force = false, onProgress } = {}) {
  const target = whisperModelPath(model)
  if (!force && existsSync(target) && statSync(target).size > 100 * 1024 * 1024) {
    return { ok: true, path: target, skipped: true }
  }
  if (modelTask) return modelTask
  modelTask = (async () => {
    const urls = whisperModelUrls(model)
    let lastError = null
    for (const url of urls) {
      try {
        if (onProgress) onProgress({ stage: 'download', message: '正在下载 Whisper 模型（约 465MB）' })
        await downloadTo(url, target, {
          timeout: MODEL_DOWNLOAD_TIMEOUT_MS,
          minBytes: 100 * 1024 * 1024,
          onProgress: (p) => onProgress && onProgress({
            ...p,
            stage: 'download',
            message: '正在下载 Whisper 模型' + (p.percent === null ? '' : ' ' + p.percent + '%'),
          }),
        })
        return { ok: true, path: target }
      } catch (error) {
        lastError = error
        try { rmSync(target + '.part', { force: true }) } catch { /* 忽略 */ }
      }
    }
    return { ok: false, error: String(lastError?.message || lastError || '下载失败') }
  })()
  try {
    return await modelTask
  } finally {
    modelTask = null
  }
}

/**
 * 确保有可用的 Whisper 模型。
 * 不再静默下载：缺失时返回 needsChoice，由面板让用户按推荐选一个（模型从 135MB 到 1.6GB，体积差异大）。
 */
export async function ensureWhisperModel(config = {}) {
  const found = findWhisperModel(config)
  if (found) return { ok: true, path: found, skipped: true }
  return {
    ok: false,
    needsChoice: true,
    models: WHISPER_MODELS,
    error: '还没有转写模型：请在面板「诊断」里选择并下载（推荐 Large v3 Turbo）',
  }
}

/** 仅测试用：重置自动安装状态。 */
export function resetWhisperState() {
  ffmpegTask = null
  ffmpegTried = false
  modelTask = null
}

/* ------------------------------------------------------------------ */
/* whisper-cli（Homebrew）                                              */
/* ------------------------------------------------------------------ */

/** 探测 Homebrew 可执行文件。 */
export function findHomebrew() {
  const candidates = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return whichSync('brew')
}

/**
 * 用 Homebrew 安装 whisper.cpp（官方没有免安装的预编译包）。
 * 只在用户明确触发时调用；进度按 brew 的输出行回调。
 */
export async function installWhisperCli({ onProgress, timeout = 15 * 60 * 1000 } = {}) {
  const existing = findWhisperCli()
  if (existing) return { ok: true, path: existing, skipped: true }

  const brew = findHomebrew()
  if (!brew) {
    return { ok: false, error: '未找到 Homebrew：请先安装 https://brew.sh，或自行编译 whisper.cpp' }
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      HOMEBREW_NO_AUTO_UPDATE: '1',
      HOMEBREW_NO_INSTALL_CLEANUP: '1',
      HOMEBREW_NO_ENV_HINTS: '1',
    }
    const child = spawn(brew, ['install', 'whisper.cpp'], { env, windowsHide: true })
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch { /* 忽略 */ }
      finish({ ok: false, error: '安装超时（15 分钟）' })
    }, timeout)
    const report = (chunk) => {
      if (!onProgress) return
      const lines = String(chunk || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      if (lines.length === 0) return
      onProgress({ message: lines[lines.length - 1].slice(0, 200) })
    }
    child.stdout.on('data', report)
    child.stderr.on('data', report)
    child.on('error', (error) => finish({ ok: false, error: String(error?.message || error) }))
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: 'brew install 退出码 ' + code })
      const bin = findWhisperCli()
      finish(bin ? { ok: true, path: bin } : { ok: false, error: '安装完成但找不到 whisper-cli' })
    })
  })
}

/**
 * 估算转写耗时（分钟），只用于给用户一个心理预期。
 * 实测 large-v3-turbo 在 M3 上约 3 倍速：45 分钟音频约 15 分钟。
 */
export function estimateTranscribeMinutes(seconds) {
  const total = Number(seconds) || 0
  if (total <= 0) return 0
  return Math.max(1, Math.round(total / 180))
}

/* ------------------------------------------------------------------ */
/* 转写                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 组装 whisper-cli 参数（argv[0] 为 bin）。
 * language 默认 zh；外文视频传 auto 让 whisper 自行判断。
 */
export function buildWhisperArgs({ bin, model, wav, prompt = '', language = 'zh' } = {}) {
  const base = String(wav ?? '').replace(/\.wav$/i, '')
  // 不加 -np：保留分段输出，才能解析时间戳算转写进度。
  const args = [
    '-m', String(model ?? ''),
    '-f', String(wav ?? ''),
    '-l', String(language || 'zh'),
    '-otxt',
    '-of', base,
  ]
  const text = String(prompt ?? '').trim()
  if (text) args.push('--prompt', text.slice(0, 500))
  return [String(bin ?? ''), ...args]
}

/**
 * 从 whisper-cli 的 stderr 片段里解析进度百分比。
 * 时间戳形如「[00:00:05.000 --> 00:00:08.000]」，用结束时间 / 音频总长估算。
 * 没有新进度时返回 null。
 */
export function parseWhisperProgress(chunk, totalSeconds, previous = 0) {
  if (!(Number(totalSeconds) > 0)) return null
  const matches = String(chunk ?? '').match(/-->\s*(\d{2}):(\d{2}):(\d{2})\.\d{3}/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1].match(/-->\s*(\d{2}):(\d{2}):(\d{2})/)
  if (!last) return null
  const end = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
  const percent = Math.max(0, Math.min(99, Math.round((end / Number(totalSeconds)) * 100)))
  return percent > previous ? percent : null
}

/**
 * 跑 whisper-cli，同时从 stderr 的分段输出里解析进度。
 */
function runWhisper(argv, { timeout = WHISPER_TIMEOUT_MS, totalSeconds = 0, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { windowsHide: true })
    let stderrTail = ''
    let lastPercent = 0
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 忽略 */ }
      reject(new Error('Whisper 转写超时'))
    }, timeout)
    const handleOutput = (chunk) => {
      const text = String(chunk ?? '')
      stderrTail = (stderrTail + text).slice(-4000)
      if (!onProgress) return
      // 分段文本可能走 stdout，进度日志走 stderr，两边都解析。
      const percent = parseWhisperProgress(text, totalSeconds, lastPercent)
      if (percent !== null) {
        lastPercent = percent
        onProgress({ percent })
      }
    }
    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const detail = stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' / ')
        return reject(new Error('whisper-cli 退出码 ' + code + (detail ? '：' + detail.slice(0, 200) : '')))
      }
      resolve()
    })
  })
}

/**
 * 转写一段 wav 音频（调用前请确保模型已就绪，可用 ensureWhisperModel）。
 * @param {string} wav 16kHz 单声道 wav 绝对路径
 * @param {{ title?: string, author?: string, tags?: string[], config?: object, language?: string }} options
 * @returns {Promise<string>} 纯文本（可能多行）
 */
export async function transcribeAudio(wav, {
  title = '',
  author = '',
  tags = [],
  config = {},
  language = 'zh',
  totalSeconds = 0,
  onProgress,
} = {}) {
  const bin = findWhisperCli(config)
  if (!bin) throw new Error('未找到 whisper-cli：请运行 brew install whisper.cpp（官方没有免安装的预编译包）')
  const model = findWhisperModel(config)
  if (!model) throw new Error('未找到 Whisper 模型；首次使用会自动下载，也可运行 node scripts/install-whisper-model.mjs')
  const prompt = [title, author, ...(Array.isArray(tags) ? tags.slice(0, 8) : [])]
    .filter(Boolean).join(' ')
  const argv = buildWhisperArgs({ bin, model, wav, prompt, language })
  await runWhisper(argv, { timeout: WHISPER_TIMEOUT_MS, totalSeconds, onProgress })
  const txt = String(wav).replace(/\.wav$/i, '') + '.txt'
  if (!existsSync(txt)) throw new Error('Whisper 没有生成转写文本')
  const text = readFileSync(txt, 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (!text) throw new Error('Whisper 转写结果为空')
  return text
}
