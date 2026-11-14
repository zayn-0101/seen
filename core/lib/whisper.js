/**
 * 本地 whisper.cpp 语音转写。
 *
 * 抖音没有可用字幕、YouTube 字幕抓不到时都走这里：
 * 调用方先用 ffmpeg 把音频转成 16kHz 单声道 wav，本模块只负责调 whisper-cli 产出文本。
 * 与平台无关，不下载音频、不写缓存。
 */
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileP = promisify(execFile)
const MODEL_DIR = join(homedir(), '.seen', 'models')
const WHISPER_TIMEOUT_MS = 30 * 60 * 1000

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

/** 查找 ffmpeg（音频预处理必需）；配置 ffmpegBin 优先。返回绝对路径或 null。 */
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
  ])
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
 * 转写一段 wav 音频。
 * @param {string} wav 16kHz 单声道 wav 绝对路径
 * @param {{ title?: string, author?: string, tags?: string[], config?: object, language?: string }} options
 * @returns {Promise<string>} 纯文本（可能多行）
 */
export async function transcribeAudio(wav, { title = '', author = '', tags = [], config = {}, language = 'zh' } = {}) {
  const bin = findWhisperCli(config)
  if (!bin) throw new Error('未找到 whisper-cli，无法转写音频')
  const model = findWhisperModel(config)
  if (!model) throw new Error('未找到 Whisper 模型；请运行 node scripts/install-whisper-model.mjs，或配置 whisperModel')
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
