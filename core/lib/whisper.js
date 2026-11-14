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
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const execFileP = promisify(execFile)
const BIN_DIR = join(homedir(), '.seen', 'bin')
const MODEL_DIR = join(homedir(), '.seen', 'models')
const WHISPER_TIMEOUT_MS = 30 * 60 * 1000
const VERIFY_TIMEOUT_MS = 20000
const BINARY_DOWNLOAD_TIMEOUT_MS = 300000
const MODEL_DOWNLOAD_TIMEOUT_MS = 900000
const DEFAULT_MODEL = 'small'

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
      await downloadTo(url, target, {
        timeout: BINARY_DOWNLOAD_TIMEOUT_MS,
        minBytes: 1024 * 1024,
        onProgress: (p) => onProgress && onProgress({ ...p, stage: 'download', message: '正在下载 ffmpeg' }),
      })
      chmodSync(target, 0o755)
      if (!await verifyRuns(target)) throw new Error('下载的 ffmpeg 无法运行')
      return { ok: true, path: target }
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
let modelTried = false

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

/** 确保有可用的 Whisper 模型：已安装直接用，缺失时自动下载一次。 */
export async function ensureWhisperModel(config = {}, { model, onProgress } = {}) {
  const found = findWhisperModel(config)
  if (found) return { ok: true, path: found, skipped: true }
  if (modelTried) return { ok: false, error: 'Whisper 模型不可用（本次运行已尝试过自动下载）' }
  modelTried = true
  const result = await installWhisperModel({ model: model || DEFAULT_MODEL, onProgress })
  if (!result.ok) return result
  const after = findWhisperModel(config)
  return after ? { ok: true, path: after } : { ok: false, error: '下载完成但找不到 Whisper 模型' }
}

/** 仅测试用：重置自动安装状态。 */
export function resetWhisperState() {
  ffmpegTask = null
  ffmpegTried = false
  modelTask = null
  modelTried = false
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
  const args = [
    '-m', String(model ?? ''),
    '-f', String(wav ?? ''),
    '-l', String(language || 'zh'),
    '-otxt',
    '-of', base,
    '-np',
  ]
  const text = String(prompt ?? '').trim()
  if (text) args.push('--prompt', text.slice(0, 500))
  return [String(bin ?? ''), ...args]
}

/**
 * 转写一段 wav 音频（调用前请确保模型已就绪，可用 ensureWhisperModel）。
 * @param {string} wav 16kHz 单声道 wav 绝对路径
 * @param {{ title?: string, author?: string, tags?: string[], config?: object, language?: string }} options
 * @returns {Promise<string>} 纯文本（可能多行）
 */
export async function transcribeAudio(wav, { title = '', author = '', tags = [], config = {}, language = 'zh' } = {}) {
  const bin = findWhisperCli(config)
  if (!bin) throw new Error('未找到 whisper-cli：请运行 brew install whisper.cpp（官方没有免安装的预编译包）')
  const model = findWhisperModel(config)
  if (!model) throw new Error('未找到 Whisper 模型；首次使用会自动下载，也可运行 node scripts/install-whisper-model.mjs')
  const prompt = [title, author, ...(Array.isArray(tags) ? tags.slice(0, 8) : [])]
    .filter(Boolean).join(' ')
  const argv = buildWhisperArgs({ bin, model, wav, prompt, language })
  await execFileP(argv[0], argv.slice(1), { timeout: WHISPER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
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
