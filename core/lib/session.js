/**
 * B 站登录态工具：从浏览器 Cookie 导出临时 Cookie 头。
 *
 * 仅用于调用 B 站需要登录的接口（AI 字幕、评论分页）。
 * Cookie 文件只写入系统临时目录，读取后立即删除；不记录内容、不落日志。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findYtDlp } from './ytdlp.js'

const execFileP = promisify(execFile)
const CACHE_TTL_MS = 10 * 60 * 1000
const cookieCache = new Map()

/** 解析 Netscape cookies.txt，返回 bilibili 域的 Cookie 头。 */
export function parseNetscapeCookies(text) {
  const pairs = []
  const seen = new Set()
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    const domain = parts[0]
    const name = parts[5]
    const value = parts[6]
    if (!/bilibili\.com$/i.test(domain.replace(/^\./, ''))) continue
    if (!name || value === undefined) continue
    const key = name
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push(name + '=' + value)
  }
  return pairs.join('; ')
}

/** 清除内存中的 Cookie 缓存（测试或用户退出登录时使用）。 */
export function clearCookieCache() {
  cookieCache.clear()
}

/**
 * 通过 yt-dlp 从浏览器导出 B 站 Cookie 头。
 * 返回 string 或 null；不抛错。
 */
export async function getBilibiliCookieHeader({ config = {}, url } = {}) {
  if (config.useBrowserCookies === false) return null
  const targetUrl = typeof url === 'string' ? url.trim() : ''
  if (!targetUrl) return null
  const browser = typeof config.cookieBrowser === 'string' && config.cookieBrowser.trim()
    ? config.cookieBrowser.trim()
    : 'chrome'
  const cacheKey = browser
  const cached = cookieCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.header

  const ytdlp = findYtDlp(config)
  if (!ytdlp) return null

  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-video-coursemap-cookies-'))
  const cookiePath = join(tmpDir, 'cookies.txt')
  try {
    await execFileP(ytdlp, [
      '--no-warnings',
      '--skip-download',
      '--no-playlist',
      '--cookies-from-browser', browser,
      '--cookies', cookiePath,
      targetUrl,
    ], { timeout: 30000, maxBuffer: 30 * 1024 * 1024 })
    const header = parseNetscapeCookies(readFileSync(cookiePath, 'utf8'))
    if (!header) return null
    cookieCache.set(cacheKey, { header, at: Date.now() })
    return header
  } catch {
    return null
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}
