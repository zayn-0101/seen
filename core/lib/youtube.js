/**
 * YouTube 支持。
 *
 * 数据路径（逐级降级，全部在本机完成，不依赖 YouTube Data API）：
 *  1. yt-dlp -J 取元数据：标题 / 频道 / 时长 / 简介 / 章节 / 字幕轨道清单；
 *  2. 人工字幕优先、自动字幕其次，用 yt-dlp 下载 SRT 交给 transcript.js 解析；
 *  3. 没有可用字幕时下载音频，用本地 whisper.cpp 转写；
 *  4. 全都失败时只保留元数据，交给上层生成 metadata-only 笔记。
 *
 * 结果缓存到 ~/.seen/cache/youtube，避免重复下载与转写。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureYtDlp, findYtDlp } from './ytdlp.js'
import { buildTimedTranscript, parseSrtSegments } from './transcript.js'
import { ensureFfmpeg, ensureWhisperModel, findFfmpeg, transcribeAudio } from './whisper.js'
import { extractYoutubeId, sourceLabel } from './source.js'

const execFileP = promisify(execFile)
const CACHE_DIR = join(homedir(), '.seen', 'cache', 'youtube')
const META_TIMEOUT_MS = 120000
const SUB_TIMEOUT_MS = 120000
const MEDIA_TIMEOUT_MS = 600000
const FFMPEG_TIMEOUT_MS = 600000
const MAX_OUTPUT = 60 * 1024 * 1024

// 人工字幕：YouTube 用的是 zh / zh-CN / zh-TW / en 这类键。
const MANUAL_LANGS = ['zh-Hans', 'zh-CN', 'zh', 'zh-TW', 'zh-Hant', 'zh-HK', 'en', 'en-US', 'en-GB']
// 自动字幕：键名是 zh-Hans / en-orig 这类，另有大量 "x from y" 翻译轨道。
const AUTO_LANGS = ['zh-Hans', 'zh-CN', 'zh', 'zh-TW', 'zh-Hant', 'zh-HK', 'en', 'en-orig', 'en-US', 'ja', 'ko']
// 默认 client 取媒体直链常被 403，tv / web_embedded 明显更宽松。
const MEDIA_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=tv,web_embedded']

function cachePath(id) {
  return join(CACHE_DIR, String(id) + '.json')
}

function readCache(id, config = {}) {
  try {
    const file = cachePath(id)
    if (!existsSync(file)) return null
    const days = Number(config.youtubeCacheDays ?? 7)
    const maxAge = (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000
    if (Date.now() - statSync(file).mtimeMs > maxAge) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || !data.content || String(data.content.videoId || '') !== String(id)) return null
    return data.content
  } catch { return null }
}

function writeCache(id, content) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath(id), JSON.stringify({ content, savedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch { /* 缓存失败不影响主流程 */ }
}

export function youtubeWatchUrl(id) {
  return 'https://www.youtube.com/watch?v=' + String(id ?? '').trim()
}

/** YouTube chapters（[{start_time,title}]）→ 渲染层用的 [{from,content}]。 */
export function buildYoutubeChapters(chapters) {
  if (!Array.isArray(chapters)) return []
  return chapters
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      from: Math.max(0, Math.floor(Number(item.start_time) || 0)),
      content: String(item.title || '').trim(),
    }))
    .filter((item) => item.content)
    .sort((a, b) => a.from - b.from)
}

/** 归一化 yt-dlp -J 的 JSON（字符串或对象）。无法识别时返回 null。 */
export function parseYoutubeJson(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return null }
  }
  if (!data || typeof data !== 'object') return null
  const videoId = String(data.id || '').trim()
  if (!videoId) return null
  const subtitles = data.subtitles && typeof data.subtitles === 'object' ? data.subtitles : {}
  const automaticCaptions = data.automatic_captions && typeof data.automatic_captions === 'object' ? data.automatic_captions : {}
  return {
    videoId,
    title: String(data.title || '').trim(),
    author: String(data.uploader || data.channel || '').trim(),
    duration: Number(data.duration) || 0,
    desc: String(data.description || '').trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
    isLive: Boolean(data.is_live),
    thumbnail: String(data.thumbnail || ''),
    chapters: buildYoutubeChapters(data.chapters),
    subtitles,
    automaticCaptions,
  }
}

function pickTrack(tracks, priority) {
  if (!tracks || typeof tracks !== 'object') return null
  const keys = Object.keys(tracks).filter((key) => Array.isArray(tracks[key]) && tracks[key].length > 0)
  if (keys.length === 0) return null
  const lower = new Map(keys.map((key) => [key.toLowerCase(), key]))
  for (const lang of priority) {
    const hit = lower.get(lang.toLowerCase())
    if (hit) return hit
  }
  // 原声轨道（自动字幕里以 -orig 结尾）
  const orig = keys.find((key) => /-orig$/i.test(key))
  if (orig) return orig
  // 无翻译后缀的轨道（如 ja / de），避免拿到 "xx from yy" 这类机翻字幕
  const plain = keys.find((key) => !/^[a-z]{2,3}-[a-z]{2,3}(-[a-z]{2,4})?$/i.test(key))
  return plain || keys[0]
}

/** 挑选字幕轨道：人工中文 > 人工英文 > 自动中文 > 自动英文 > 原声。 */
export function pickYoutubeSubtitle(meta) {
  const manual = pickTrack(meta?.subtitles, MANUAL_LANGS)
  if (manual) return { lang: manual, auto: false }
  const auto = pickTrack(meta?.automaticCaptions, AUTO_LANGS)
  if (auto) return { lang: auto, auto: true }
  return null
}

async function runYtDlp(args, { config = {}, timeout = META_TIMEOUT_MS } = {}) {
  const bin = findYtDlp(config)
  if (!bin) throw new Error('未找到 yt-dlp，也无法自动安装（可运行 brew install yt-dlp 手动安装）')
  try {
    const result = await execFileP(bin, args, { timeout, maxBuffer: MAX_OUTPUT, encoding: 'utf8' })
    return String(result.stdout || '')
  } catch (error) {
    const detail = String((error && (error.stderr || error.message)) || error || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^\[download\]/.test(line))
      .slice(-3)
      .join(' / ')
    throw new Error('yt-dlp 执行失败：' + (detail || '未知错误'))
  }
}

/**
 * 轻量探测 yt-dlp 能否解析一条公开 YouTube 视频，供诊断使用。
 * Node 的 fetch 在开启 HTTPS 中间人代理的机器上会因证书链失败，所以这里走 yt-dlp 本身。
 */
export async function probeYoutube(config = {}) {
  try {
    const stdout = await runYtDlp([
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      '--print', 'id',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ], { config, timeout: 20000 })
    const id = String(stdout || '').trim().split(/\r?\n/).pop()
    if (!id) return { ok: false, detail: 'yt-dlp 没有返回视频信息' }
    return { ok: true, detail: 'yt-dlp 可解析 YouTube（' + id.slice(0, 16) + '）' }
  } catch (error) {
    return { ok: false, detail: String(error?.message || error).slice(0, 160) }
  }
}

async function fetchMetadata({ url, config, onProgress }) {
  if (onProgress) onProgress({ stage: 'meta', message: '读取 YouTube 视频信息' })
  const stdout = await runYtDlp([
    '-J',
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    url,
  ], { config })
  const meta = parseYoutubeJson(stdout)
  if (!meta) throw new Error('yt-dlp 返回的 YouTube 数据无法解析')
  return meta
}

async function downloadSubtitle({ url, track, config }) {
  const dir = mkdtempSync(join(tmpdir(), 'seen-youtube-sub-'))
  try {
    // 只指定一个精确语言键：一次请求几十条轨道会触发 YouTube 429。
    await runYtDlp([
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      '--sub-format', 'srt',
      track.auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs', track.lang,
      '-o', join(dir, '%(id)s.%(ext)s'),
      url,
    ], { config, timeout: SUB_TIMEOUT_MS })
    const files = readdirSync(dir).filter((name) => /\.srt$/i.test(name))
    if (files.length === 0) return null
    const raw = readFileSync(join(dir, files[0]), 'utf8')
    const segments = parseSrtSegments(raw)
    const text = segments.length
      ? segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim()
      : ''
    if (!text) return null
    return {
      text,
      timed: segments.length ? buildTimedTranscript(segments) : '',
      source: track.auto ? 'auto-subtitle' : 'youtube-subtitle',
      lang: track.lang,
    }
  } catch {
    return null
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

/** 中文视频让 Whisper 按中文识别，其余交给自动语言检测。 */
function guessLanguage(meta) {
  const text = String((meta?.title || '') + ' ' + (meta?.desc || '').slice(0, 500))
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'auto'
}

async function downloadAudioOnce({ url, config, onProgress }) {
  const ready = await ensureFfmpeg(config, { onProgress })
  if (!ready.ok || !ready.path) throw new Error('未找到 ffmpeg，自动下载也失败：' + (ready.error || '未知原因'))
  const ffmpeg = ready.path
  const dir = mkdtempSync(join(tmpdir(), 'seen-youtube-audio-'))
  try {
    await runYtDlp([
      '--no-warnings',
      '--no-playlist',
      '-f', 'bestaudio',
      ...MEDIA_CLIENT_ARGS,
      '-o', join(dir, 'audio.%(ext)s'),
      url,
    ], { config, timeout: MEDIA_TIMEOUT_MS })
    const files = readdirSync(dir).filter((name) => /^audio\./i.test(name))
    if (files.length === 0) throw new Error('yt-dlp 没有下载到 YouTube 音频')
    const wav = join(dir, 'audio.wav')
    await execFileP(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', join(dir, files[0]),
      '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 })
    if (!existsSync(wav) || statSync(wav).size < 1000) throw new Error('YouTube 音频提取结果为空')
    return { dir, wav }
  } catch (error) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    throw error
  }
}

/** YouTube 的媒体直链偶发 403，重试一次（实测第二次通常能过）。 */
async function downloadAudio({ url, config, onProgress }) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await downloadAudioOnce({ url, config, onProgress })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('YouTube 音频下载失败')
}

/** 组装与 fetchContent 同形的内容对象。 */
export function buildYoutubeContent({ meta = {}, id, url, transcript = '', transcriptSource = '' } = {}) {
  const videoId = String(id || meta.videoId || '').trim()
  const text = String(transcript || '').trim()
  const desc = String(meta.desc || '')
  const tags = Array.isArray(meta.tags) ? meta.tags : []
  const chapters = Array.isArray(meta.chapters) ? meta.chapters : []
  const contentSource = text ? (transcriptSource || 'youtube-subtitle') : 'metadata'
  return {
    source: 'youtube',
    platform: 'youtube',
    sourceLabel: sourceLabel('youtube'),
    videoId,
    bvid: null,
    title: String(meta.title || '').trim() || '未命名 YouTube 视频',
    url: String(url || '').trim() || youtubeWatchUrl(videoId),
    author: String(meta.author || '').trim(),
    owner: String(meta.author || '').trim(),
    desc,
    tags,
    duration: Number(meta.duration) || 0,
    chapters,
    transcript: text,
    transcriptSource: text ? contentSource : '',
    contentSource,
    comments: [],
    danmaku: [],
    matched: true,
    cover: String(meta.thumbnail || ''),
    fetchStats: {
      desc: desc.length,
      tags: tags.length,
      transcript: text.length,
      danmaku: 0,
      comments: 0,
      totalDanmaku: 0,
      totalComments: 0,
    },
  }
}

/**
 * 抓取 YouTube 视频内容。
 * @param {{ url?: string, title?: string, config?: object, force?: boolean, onProgress?: Function }} input
 */
export async function fetchYoutubeContent({ url = '', title = '', config = {}, force = false, onProgress } = {}) {
  const id = extractYoutubeId(url)
  if (!id) throw new Error('无法从链接中识别 YouTube 视频 ID')
  if (!force) {
    const cached = readCache(id, config)
    if (cached) {
      if (onProgress) onProgress({ stage: 'cache', message: '命中 YouTube 缓存', videoId: id })
      return cached
    }
  }

  const ready = await ensureYtDlp(config, { onProgress })
  if (!ready.ok) throw new Error('未找到 yt-dlp，自动安装也失败：' + (ready.error || '未知原因'))

  const watchUrl = youtubeWatchUrl(id)
  const meta = await fetchMetadata({ url: watchUrl, config, onProgress })
  if (meta.isLive) throw new Error('该 YouTube 视频正在直播，暂不处理')

  let transcript = ''
  let transcriptSource = ''
  const track = pickYoutubeSubtitle(meta)
  if (track) {
    if (onProgress) {
      onProgress({
        stage: 'subtitle',
        message: track.auto ? '下载 YouTube 自动字幕' : '下载 YouTube 字幕',
        videoId: id,
        lang: track.lang,
      })
    }
    const subtitle = await downloadSubtitle({ url: watchUrl, track, config })
    if (subtitle?.text) {
      transcript = subtitle.text
      transcriptSource = subtitle.source
      if (onProgress) onProgress({ stage: 'subtitle-ok', message: '已获取 YouTube 字幕', videoId: id, length: transcript.length })
    }
  }

  if (!transcript && config.fetchTranscript !== false) {
    try {
      const modelReady = await ensureWhisperModel(config, { onProgress })
      if (!modelReady.ok) throw new Error('未找到 Whisper 模型，自动下载也失败：' + (modelReady.error || '未知原因'))
      if (onProgress) onProgress({ stage: 'audio', message: '没有可用字幕，下载音频后本地转写', videoId: id })
      const audio = await downloadAudio({ url: watchUrl, config, onProgress })
      try {
        if (onProgress) onProgress({ stage: 'transcribe', message: '本地 Whisper 转写中', videoId: id })
        transcript = await transcribeAudio(audio.wav, {
          title: meta.title,
          author: meta.author,
          tags: meta.tags,
          config,
          language: guessLanguage(meta),
        })
        transcriptSource = 'whisper'
      } finally {
        try { rmSync(audio.dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
      }
    } catch (error) {
      // 转写失败不影响元数据笔记，交给上层标记「内容依据有限」。
      if (onProgress) {
        onProgress({
          stage: 'transcribe-failed',
          message: '音频转写失败：' + (error?.message || error),
          videoId: id,
        })
      }
    }
  }

  const content = buildYoutubeContent({ meta, id, url: watchUrl, transcript, transcriptSource })
  writeCache(id, content)
  return content
}
