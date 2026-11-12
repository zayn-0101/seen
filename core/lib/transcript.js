/**
 * 视频字幕 / 转写获取。
 *
 * 优先级：
 *  1) 登录态 x/player/v2 的 AI 字幕或 UP 主字幕（需要浏览器 Cookie）
 *  2) yt-dlp 直接下载 AI 字幕（--cookies-from-browser）
 *  3) 官方 view.subtitle（由 bilibili.js 的 fetchSubtitle 处理）
 *
 * 所有失败都静默降级，返回空文本。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { BILI_UA, BILI_REFERER } from './bilibili.js'
import { findYtDlp } from './ytdlp.js'

const execFileP = promisify(execFile)
const SUBTITLE_TIMEOUT_MS = 30000
const CACHE_DIR = join(homedir(), '.seen', 'cache', 'transcripts')

function cachePath(bvid) {
  return join(CACHE_DIR, encodeURIComponent(String(bvid || '')) + '.json')
}

function readCache(bvid, config = {}) {
  if (!bvid || config.useTranscriptCache === false) return null
  try {
    const file = cachePath(bvid)
    if (!existsSync(file)) return null
    const days = Number(config.transcriptCacheDays ?? 7)
    const maxAge = (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000
    if (Date.now() - statSync(file).mtimeMs > maxAge) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof data?.text === 'string' && data.text.length > 0) {
      return { text: data.text, source: data.source || 'ai-subtitle', detail: 'cache' }
    }
  } catch { /* 忽略缓存错误 */ }
  return null
}

function writeCache(bvid, result) {
  if (!bvid || !result?.text) return
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cachePath(bvid), JSON.stringify({
      text: result.text,
      source: result.source || 'ai-subtitle',
      savedAt: new Date().toISOString(),
    }), 'utf8')
  } catch { /* 缓存失败不影响主流程 */ }
}

/** 解析 SRT 字幕为纯文本。 */
export function parseSrt(text) {
  const blocks = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  const lines = []
  for (const block of blocks) {
    const rawLines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    if (rawLines.length === 0) continue
    let start = 0
    if (/^\d+$/.test(rawLines[0])) start = 1
    if (rawLines[start] && /-->/.test(rawLines[start])) start += 1
    for (let i = start; i < rawLines.length; i++) {
      const cleaned = rawLines[i]
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+\}/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .trim()
      if (cleaned) lines.push(cleaned)
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

/** 选择字幕：优先 AI 中文，其次中文，最后任意字幕。 */
export function chooseSubtitle(subtitles) {
  if (!Array.isArray(subtitles)) return null
  const list = subtitles.filter((item) => item && typeof item.subtitle_url === 'string' && item.subtitle_url.trim())
  if (list.length === 0) return null
  const priority = ['ai-zh', 'zh-Hans', 'zh-CN', 'zh', 'ai-en', 'en']
  for (const lang of priority) {
    const found = list.find((item) => String(item.lan || '').toLowerCase() === lang.toLowerCase())
    if (found) return found
  }
  const ai = list.find((item) => String(item.lan || '').toLowerCase().startsWith('ai-'))
  return ai || list[0]
}

function subtitleSource(entry) {
  const lan = String(entry?.lan || '').toLowerCase()
  const doc = String(entry?.lan_doc || '').toLowerCase()
  return lan.startsWith('ai-') || doc.includes('ai') || doc.includes('自动') ? 'ai-subtitle' : 'up-subtitle'
}

async function fetchSubtitleText(entry, cookieHeader = '') {
  let url = String(entry?.subtitle_url || '').trim()
  if (!url) return ''
  if (url.startsWith('//')) url = 'https:' + url
  const headers = {
    'User-Agent': BILI_UA,
    Referer: BILI_REFERER,
    Accept: 'application/json, text/plain, */*',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  }
  const res = await fetch(url, { headers })
  if (!res.ok) return ''
  const data = await res.json()
  const body = Array.isArray(data?.body) ? data.body : []
  return body.map((item) => String(item?.content || '').trim()).filter(Boolean).join(' ')
}

async function downloadViaYtDlp({ url, config = {} } = {}) {
  const ytdlp = findYtDlp(config)
  if (!ytdlp || !url) return null
  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-video-coursemap-subs-'))
  try {
    const langs = Array.isArray(config.transcriptLangs) && config.transcriptLangs.length
      ? config.transcriptLangs.join(',')
      : 'ai-zh,zh-Hans,zh-CN,zh'
    const args = [
      '--no-warnings',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', langs,
      '--sub-format', 'srt',
      '--no-playlist',
      '-o', join(tmpDir, '%(id)s.%(ext)s'),
    ]
    if (config.useBrowserCookies !== false) {
      args.push('--cookies-from-browser', config.cookieBrowser || 'chrome')
    }
    args.push(url)
    await execFileP(ytdlp, args, { timeout: 120000, maxBuffer: 30 * 1024 * 1024 })
    const files = []
    for (const entry of readdirSync(tmpDir)) {
      const file = join(tmpDir, entry)
      try { if (statSync(file).isFile() && /\.srt$/i.test(entry)) files.push(file) } catch { /* 忽略 */ }
    }
    if (files.length === 0) return null
    files.sort((a, b) => {
      const score = (file) => {
        const name = basename(file).toLowerCase()
        if (name.includes('ai-zh')) return 0
        if (name.includes('zh-hans') || name.includes('zh-cn')) return 1
        return 2
      }
      return score(a) - score(b)
    })
    const file = files[0]
    const text = parseSrt(readFileSync(file, 'utf8'))
    if (!text) return null
    return { text, source: /ai-zh/i.test(basename(file)) ? 'ai-subtitle' : 'up-subtitle' }
  } catch {
    return null
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

/**
 * 获取视频字幕文本。
 * @returns {Promise<{ text: string, source: 'ai-subtitle'|'up-subtitle'|'', detail: string }>}
 */
export async function fetchTranscript({ bvid, cid, url, config = {}, cookieHeader = '', force = false } = {}) {
  try {
    if (!force) {
      const cached = readCache(bvid, config)
      if (cached) return cached
    }
    // 以 yt-dlp 为主：它会按视频自身解析 B站 AI 字幕，避免 player/v2 在某些登录态下
    // 返回“最近观看视频”的字幕 URL，导致把别的视频内容当成本视频讲解。
    const downloaded = await downloadViaYtDlp({ url, config })
    if (downloaded?.text) {
      const result = { ...downloaded, detail: 'yt-dlp' }
      writeCache(bvid, result)
      return result
    }
  } catch { /* 降级 */ }
  return { text: '', source: '', detail: '' }
}
