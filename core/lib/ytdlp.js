/**
 * yt-dlp 定位工具。
 * 只负责找到可执行文件，不读取任何 Cookie。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  join(homedir(), '.local', 'bin', 'yt-dlp'),
  join(homedir(), 'bin', 'yt-dlp'),
]

/** 查找 yt-dlp；配置 ytDlpBin 优先。返回绝对路径或 null。 */
export function findYtDlp(config = {}) {
  const configured = config && typeof config === 'object' ? config.ytDlpBin : null
  if (typeof configured === 'string' && configured.trim()) {
    const text = configured.trim()
    const expanded = text.startsWith('~/') ? join(homedir(), text.slice(2)) : text
    if (existsSync(expanded)) return expanded
  }
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['yt-dlp'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (result.status === 0) {
      const first = String(result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first && existsSync(first)) return first
    }
  } catch { /* 继续找常见路径 */ }
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
