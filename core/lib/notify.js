/**
 * seen-core · 系统通知
 *
 * macOS 下用 osascript display notification 发通知；其它平台跳过。
 * 通知失败一律静默，不影响主流程；同一内容 5 秒内只发一次。
 */
import { spawn } from 'node:child_process'

const DEDUPE_MS = 5000
const DEFAULT_TITLE = '拾影 Seen'

/** AppleScript 字符串转义：反斜杠、双引号、换行。 */
export function escapeAppleScript(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
}

/** 生成 display notification 的 AppleScript 片段。 */
export function buildNotificationScript({ title = DEFAULT_TITLE, subtitle = '', body = '' } = {}) {
  const parts = [
    'display notification "' + escapeAppleScript(body) + '"',
    'with title "' + escapeAppleScript(title) + '"',
  ]
  if (subtitle) parts.push('subtitle "' + escapeAppleScript(subtitle) + '"')
  return parts.join(' ')
}

/**
 * 创建通知器。
 * @param {object} options
 * @param {boolean} [options.enabled] 关闭时直接跳过
 * @param {string} [options.platform] 覆盖 process.platform（便于测试）
 * @param {Function} [options.spawnImpl] 注入 spawn（便于测试）
 */
export function createNotifier({ enabled = true, platform = process.platform, spawnImpl = spawn } = {}) {
  const recent = new Map()

  return {
    notify({ title, subtitle, body } = {}) {
      if (!enabled) return { ok: false, skipped: 'disabled' }
      if (platform !== 'darwin') return { ok: false, skipped: 'unsupported' }

      const key = String(title || '') + '\u0000' + String(body || '')
      const now = Date.now()
      if (now - (recent.get(key) || 0) < DEDUPE_MS) return { ok: false, skipped: 'duplicate' }
      recent.set(key, now)
      for (const [entry, at] of recent) {
        if (now - at > DEDUPE_MS * 4) recent.delete(entry)
      }

      try {
        const child = spawnImpl('osascript', ['-e', buildNotificationScript({ title, subtitle, body })], {
          stdio: 'ignore',
          detached: true,
        })
        if (child && typeof child.on === 'function') child.on('error', () => {})
        if (child && typeof child.unref === 'function') child.unref()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error?.message || error) }
      }
    },
  }
}
