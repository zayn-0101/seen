/**
 * 抖音精选长视频支持。
 *
 * 数据路径：
 *  1. 用无头 Chrome 打开抖音页面，读取 SSR 的 RENDER_DATA（不需要登录）；
 *  2. 从 videoDetail 取标题、作者、标签、统计和视频直链；
 *  3. 用 ffmpeg 抽音频，用本地 whisper.cpp 转写；
 *  4. 结果缓存到 ~/.seen/cache/douyin，避免重复下载/转写。
 *
 * 不使用 Douyin 私有的签名接口，也不保存 Cookie。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractDouyinId, sourceLabel } from './source.js'

const execFileP = promisify(execFile)
const CACHE_DIR = join(homedir(), '.seen', 'cache', 'douyin')
const MODEL_DIR = join(homedir(), '.seen', 'models')
const CHROME_TIMEOUT_MS = 70000
const FFMPEG_TIMEOUT_MS = 600000
const WHISPER_TIMEOUT_MS = 30 * 60 * 1000
const MAX_DOM_BYTES = 30 * 1024 * 1024

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

export function findChrome(config = {}) {
  return firstFile([
    config.chromePath ? expandHome(config.chromePath) : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ])
}

export function findFfmpeg(config = {}) {
  return firstFile([
    config.ffmpegBin ? expandHome(config.ffmpegBin) : null,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ])
}

export function findWhisperCli(config = {}) {
  return firstFile([
    config.whisperBin ? expandHome(config.whisperBin) : null,
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    join(homedir(), '.local', 'bin', 'whisper-cli'),
    join(homedir(), 'bin', 'whisper-cli'),
  ])
}

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

/** 从 SSR HTML 中提取 RENDER_DATA → videoDetail。 */
export function parseRenderData(html) {
  const source = String(html ?? '')
  const match = source.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match) return null
  let raw = match[1].trim().replace(/&amp;/g, '&')
  let decoded
  try { decoded = decodeURIComponent(raw) } catch { decoded = raw }
  let data
  try { data = JSON.parse(decoded) } catch { return null }
  const direct = data?.app?.videoDetail
  if (direct && direct.awemeId) return direct
  const found = []
  const stack = [{ value: data, depth: 0 }]
  while (stack.length && found.length < 5) {
    const { value, depth } = stack.pop()
    if (!value || typeof value !== 'object' || depth > 7) continue
    if (value.awemeId && (value.video || value.desc || value.itemTitle)) found.push(value)
    for (const key of Object.keys(value)) {
      const child = value[key]
      if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 })
    }
  }
  return found[0] || null
}

function mediaUrl(videoDetail) {
  const list = videoDetail?.video?.playAddr
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === 'string' && item.trim()) return item.trim()
      if (item && typeof item.src === 'string' && item.src.trim()) return item.src.trim()
    }
  }
  if (typeof videoDetail?.video?.playApi === 'string') return videoDetail.video.playApi
  return ''
}

function normalizeTags(detail) {
  const tags = []
  if (Array.isArray(detail?.textExtra)) {
    for (const item of detail.textExtra) {
      const name = String(item?.hashtagName ?? '').trim()
      if (name) tags.push(name)
    }
  }
  return [...new Set(tags)].slice(0, 20)
}

function buildContent(detail, { url, id, transcript, transcriptSource = 'whisper' } = {}) {
  const title = String(detail?.itemTitle || detail?.desc || '').split(/\n/)[0].trim() || '未命名抖音视频'
  const desc = String(detail?.desc || '').trim()
  const tags = normalizeTags(detail)
  const durationUs = Number(detail?.video?.duration) || 0
  const duration = durationUs > 100000 ? Math.round(durationUs / 1000) : Math.round(durationUs)
  const totalComments = Number(detail?.stats?.commentCount) || 0
  const totalDanmaku = Number(detail?.danmakuControl?.danmakuCnt) || 0
  const text = String(transcript || '').trim()
  return {
    source: 'douyin',
    platform: 'douyin',
    sourceLabel: sourceLabel('douyin'),
    videoId: String(id || detail?.awemeId || ''),
    bvid: null,
    title,
    url: String(url || ''),
    author: String(detail?.authorInfo?.nickname || '').trim(),
    owner: String(detail?.authorInfo?.nickname || '').trim(),
    desc,
    tags,
    duration,
    chapters: [],
    transcript: text,
    transcriptSource: text ? transcriptSource : '',
    contentSource: text ? 'whisper' : 'metadata',
    comments: [],
    danmaku: [],
    matched: true,
    fetchStats: {
      desc: desc.length,
      tags: tags.length,
      transcript: text.length,
      danmaku: 0,
      comments: 0,
      totalDanmaku,
      totalComments,
    },
    cover: typeof detail?.video?.cover === 'string' ? detail.video.cover : '',
  }
}

function cachePath(id) {
  return join(CACHE_DIR, String(id) + '.json')
}

function readCache(id, config = {}) {
  try {
    const file = cachePath(id)
    if (!existsSync(file)) return null
    const days = Number(config.douyinCacheDays ?? 7)
    const maxAge = (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000
    if (Date.now() - statSync(file).mtimeMs > maxAge) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || !data.content || !data.content.videoId) return null
    return data.content
  } catch { return null }
}

function writeCache(id, content) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath(id), JSON.stringify({ content, savedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch { /* 缓存失败不影响主流程 */ }
}

async function readPage(url, config) {
  const chrome = findChrome(config)
  if (!chrome) throw new Error('未找到 Google Chrome，无法解析抖音页面')
  const profile = mkdtempSync(join(tmpdir(), 'seen-douyin-chrome-'))
  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=25000',
      '--dump-dom',
      url,
    ]
    const result = await execFileP(chrome, args, {
      timeout: CHROME_TIMEOUT_MS,
      maxBuffer: MAX_DOM_BYTES,
      encoding: 'utf8',
    })
    const detail = parseRenderData(result.stdout)
    if (!detail) throw new Error('抖音页面没有返回可解析的视频数据（可能触发了验证页）')
    return detail
  } finally {
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

async function downloadAudio(playUrl, config) {
  const ffmpeg = findFfmpeg(config)
  if (!ffmpeg) throw new Error('未找到 ffmpeg，无法提取抖音音频')
  const dir = mkdtempSync(join(tmpdir(), 'seen-douyin-audio-'))
  const wav = join(dir, 'audio.wav')
  try {
    await execFileP(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-referer', 'https://www.douyin.com/',
      '-i', playUrl,
      '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 })
    if (!existsSync(wav) || statSync(wav).size < 1000) throw new Error('抖音音频提取结果为空')
    return { dir, wav }
  } catch (error) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    throw error
  }
}

async function transcribeAudio(wav, { title, author, tags, config }) {
  const bin = findWhisperCli(config)
  if (!bin) throw new Error('未找到 whisper-cli，无法转写抖音音频')
  const model = findWhisperModel(config)
  if (!model) throw new Error('未找到 Whisper 模型；请运行 node scripts/install-whisper-model.mjs，或配置 whisperModel')
  const base = wav.replace(/\.wav$/i, '')
  const prompt = [title, author, ...(Array.isArray(tags) ? tags.slice(0, 8) : [])]
    .filter(Boolean).join(' ').slice(0, 500)
  await execFileP(bin, [
    '-m', model,
    '-f', wav,
    '-l', 'zh',
    '-otxt',
    '-of', base,
    '-np',
    '--prompt', prompt,
  ], { timeout: WHISPER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
  const txt = base + '.txt'
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

/**
 * 抓取抖音精选视频内容和转写。
 * @param {object} input { url, title, config, force, onProgress }
 */
export async function fetchDouyinContent({ url, title = '', config = {}, force = false, onProgress } = {}) {
  const id = extractDouyinId(url)
  if (!id) throw new Error('无法从抖音链接中识别视频 ID')
  if (!force) {
    const cached = readCache(id, config)
    if (cached) {
      if (onProgress) onProgress({ stage: 'cache', message: '命中抖音缓存', videoId: id })
      return cached
    }
  }

  if (onProgress) onProgress({ stage: 'page', message: '解析抖音精选页面', videoId: id })
  let detail = await readPage(url, config)
  if (String(detail.awemeId || '') !== String(id)) {
    throw new Error('抖音页面返回的视频与链接不一致')
  }
  const playUrl = mediaUrl(detail)
  if (!playUrl) throw new Error('抖音页面没有返回可播放地址')
  const meta = buildContent(detail, { url, id })
  if (onProgress) onProgress({ stage: 'audio', message: '下载并提取音频', videoId: id, duration: meta.duration })
  const audio = await downloadAudio(playUrl, config)
  try {
    if (onProgress) onProgress({ stage: 'transcribe', message: '本地 Whisper 转写中', videoId: id, duration: meta.duration })
    const transcript = await transcribeAudio(audio.wav, {
      title: meta.title,
      author: meta.author,
      tags: meta.tags,
      config,
    })
    const content = buildContent(detail, { url, id, transcript })
    writeCache(id, content)
    if (onProgress) onProgress({ stage: 'transcribed', message: '转写完成', videoId: id, length: transcript.length })
    return content
  } finally {
    try { rmSync(audio.dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}
