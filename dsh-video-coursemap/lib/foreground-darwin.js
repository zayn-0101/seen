/**
 * dsh-video-coursemap · macOS 前台窗口观察
 *
 * 1) lsappinfo 取前台 App 名称；
 * 2) Chrome / Safari / Edge / Brave / Chromium / Arc 通过 AppleScript 读 active tab 的 title + URL；
 * 3) AppleScript 失败（或 Firefox）回退 System Events 窗口标题。
 *
 * 所有子进程 timeout 5s；失败不抛错，按 denied / timeout / unknown 分类。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const TIMEOUT_MS = 5000
const MAX_BUFFER = 1024 * 1024

// macOS 不同版本 lsappinfo 位置不同，按顺序尝试
const LSAPPINFO_BINS = [
  '/usr/bin/lsappinfo',
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsappinfo',
  'lsappinfo',
]

// Chromium 系：AppleScript 字典与 Chrome 一致
const CHROMIUM_APPS = new Map([
  ['google chrome', 'Google Chrome'],
  ['chrome', 'Google Chrome'],
  ['chromium', 'Chromium'],
  ['microsoft edge', 'Microsoft Edge'],
  ['brave browser', 'Brave Browser'],
  ['brave', 'Brave Browser'],
  ['arc', 'Arc'],
])

const SAFARI_APPS = new Map([
  ['safari', 'Safari'],
])

const FIREFOX_NAMES = new Set(['firefox', 'mozilla firefox', 'firefox developer edition'])

async function runExec(file, args, timeout = TIMEOUT_MS) {
  try {
    const result = await execFileP(file, args, {
      timeout,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      windowsHide: true,
    })
    return { ok: true, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') }
  } catch (error) {
    return { ok: false, error }
  }
}

function appKey(name) {
  return String(name || '').trim().toLowerCase()
}

function isFirefox(name) {
  return FIREFOX_NAMES.has(appKey(name))
}

/** 解析 lsappinfo front 输出的 ASN，例如 "ASN:0x0-0x146146:" */
export function parseLsappinfoFront(stdout) {
  const text = String(stdout === null || stdout === undefined ? '' : stdout)
  const match = text.match(/ASN:0x[0-9a-fA-F]+(?:-0x[0-9a-fA-F]+)*:?/)
  return match ? match[0] : null
}

/** 解析 lsappinfo info 输出中的 App 名称（LSDisplayName 或首行引号名） */
export function parseLsappinfoName(stdout) {
  const text = String(stdout === null || stdout === undefined ? '' : stdout)
  if (!text.trim()) return null

  // 常见格式："Google Chrome" ASN:0x0-0x...: (in front)
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || ''
  const headMatch = firstLine.match(/^\s*"([^"]+)"\s+ASN:/)
  if (headMatch) return headMatch[1].trim()

  // 其他格式："LSDisplayName"="Google Chrome" / "name"="Safari"
  const keyMatch = text.match(/"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"/i)
  if (keyMatch && keyMatch[1].trim()) return keyMatch[1].trim()

  const bareMatch = text.match(/"(?:LSDisplayName|name)"\s*=\s*([^\r\n"]+)/i)
  if (bareMatch && bareMatch[1].trim()) return bareMatch[1].trim()

  // 少数系统输出不带引号：LSDisplayName=Google Chrome
  const looseMatch = text.match(/(?:^|\n)\s*(?:LSDisplayName|name)\s*=\s*"?([^"\r\n]+)"?/i)
  if (looseMatch && looseMatch[1].trim()) return looseMatch[1].trim()

  return null
}

/** 解析 AppleScript 返回的 "标题\nURL" */
export function parseAppleScriptTab(stdout) {
  const text = String(stdout === null || stdout === undefined ? '' : stdout)
    .replace(/^\uFEFF/, '')
    .trim()
  if (!text) return null
  const newlineIndex = text.indexOf('\n')
  if (newlineIndex === -1) return { title: text, url: '' }
  const title = text.slice(0, newlineIndex).trim()
  const url = text.slice(newlineIndex + 1).trim()
  if (!title && !url) return null
  return { title, url }
}

/** 错误分类：denied / timeout / unknown */
export function classifyForegroundError(error) {
  if (!error) return 'unknown'
  const message = typeof error === 'string'
    ? error
    : String((error && (error.stderr || error.message)) || error || '')

  const code = error && typeof error === 'object' ? error.code : null
  const killed = Boolean(error && typeof error === 'object' && (error.killed || error.signal === 'SIGTERM'))
  if (killed || code === -1712 || code === 'ETIMEDOUT' || /(-1712)|AppleEvent timed out|timed?\s*out|timeout|ETIMEDOUT/i.test(message)) {
    return 'timeout'
  }
  if (code === -1743 || code === -25211 || /(-1743)|(-25211)|not authori[sz]ed|not allowed|assistive access|accessibility|automation|operation not permitted|permission denied|不允许|未授权|辅助功能|无权限/i.test(message)) {
    return 'denied'
  }
  return 'unknown'
}

function errorMessage(error) {
  if (!error) return ''
  const text = typeof error === 'string'
    ? error
    : String((error && (error.stderr || error.message)) || error || '')
  return text.trim().slice(0, 500)
}

function chromiumScript(appName) {
  return [
    'tell application "' + appName + '"',
    '  if (count of windows) > 0 then',
    '    set tabTitle to title of active tab of front window',
    '    set tabUrl to URL of active tab of front window',
    '    return tabTitle & linefeed & tabUrl',
    '  end if',
    'end tell',
  ].join('\n')
}

function safariScript() {
  return [
    'tell application "Safari"',
    '  if (count of windows) > 0 then',
    '    set tabTitle to name of current tab of front window',
    '    set tabUrl to URL of current tab of front window',
    '    return tabTitle & linefeed & tabUrl',
    '  end if',
    'end tell',
  ].join('\n')
}

function escapeAppleScriptString(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function systemEventsScript(appName) {
  return [
    'tell application "System Events"',
    '  tell process "' + escapeAppleScriptString(appName) + '"',
    '    if (count of windows) > 0 then',
    '      return name of front window',
    '    end if',
    '  end tell',
    'end tell',
  ].join('\n')
}

async function readFrontApp() {
  let lastError = null
  for (const bin of LSAPPINFO_BINS) {
    const front = await runExec(bin, ['front'])
    if (!front.ok) {
      lastError = front.error
      continue
    }
    const asn = parseLsappinfoFront(front.stdout)
    if (!asn) continue
    const info = await runExec(bin, ['info', asn])
    if (!info.ok) {
      lastError = info.error
      continue
    }
    const app = parseLsappinfoName(info.stdout)
    if (app) return { app, asn, error: null }
  }

  // 回退：System Events 取 frontmost 进程名
  const fallback = await runExec('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ])
  if (fallback.ok) {
    const app = String(fallback.stdout || '').trim()
    if (app) return { app, asn: null, error: null }
  } else {
    lastError = fallback.error
  }
  return { app: '', asn: null, error: lastError || new Error('无法读取前台应用') }
}

function matchesCustomBrowser(app, config) {
  const names = config && Array.isArray(config.browserNames) ? config.browserNames : null
  if (!names || names.length === 0) return false
  const key = appKey(app)
  return names.some((name) => appKey(name) === key)
}

/**
 * 观察 macOS 前台窗口。
 * 返回 ForegroundResult；权限不足时 error 带可读原因、permission 标明分类。
 */
export async function observeDarwin(config = {}) {
  const front = await readFrontApp()
  const app = front.app

  if (!app) {
    return {
      platform: 'darwin',
      app: '',
      title: '',
      url: '',
      source: 'none',
      error: errorMessage(front.error) || '无法读取前台应用',
      permission: classifyForegroundError(front.error),
    }
  }

  const key = appKey(app)
  const chromiumApp = CHROMIUM_APPS.get(key)
  const safariApp = SAFARI_APPS.get(key)
  const firefox = isFirefox(app)
  const customBrowser = matchesCustomBrowser(app, config)
  const supported = Boolean(chromiumApp || safariApp || firefox || customBrowser)

  let lastError = null
  let permission = null

  // 1) AppleScript 读 active tab（Firefox 不支持，直接走 System Events）
  if (chromiumApp || safariApp) {
    const script = safariApp ? safariScript() : chromiumScript(chromiumApp)
    const result = await runExec('osascript', ['-e', script])
    if (result.ok) {
      const tab = parseAppleScriptTab(result.stdout)
      if (tab && tab.title) {
        return {
          platform: 'darwin',
          app,
          title: tab.title,
          url: tab.url,
          source: 'applescript',
          permission: 'ok',
        }
      }
    } else {
      lastError = result.error
      permission = classifyForegroundError(result.error)
    }
  }

  // 2) System Events 读窗口标题（Firefox / 自定义浏览器 / AppleScript 失败回退）
  if (supported) {
    const result = await runExec('osascript', ['-e', systemEventsScript(app)])
    if (result.ok) {
      const title = String(result.stdout || '').trim()
      if (title) {
        return {
          platform: 'darwin',
          app,
          title,
          url: '',
          source: 'system-events',
          permission: 'ok',
        }
      }
    } else {
      lastError = result.error
      permission = classifyForegroundError(result.error)
    }
  }

  const out = { platform: 'darwin', app, title: '', url: '', source: 'none' }
  if (lastError) {
    out.error = errorMessage(lastError)
    out.permission = permission || classifyForegroundError(lastError)
  } else if (supported) {
    out.error = '未能读取窗口标题'
    out.permission = 'unknown'
  }
  return out
}

/** 诊断 macOS 辅助功能 / 自动化权限 */
export async function probeDarwinPermission() {
  let lsOk = false
  let lsError = null
  for (const bin of LSAPPINFO_BINS) {
    const ls = await runExec(bin, ['front'])
    if (ls.ok) {
      lsOk = true
      break
    }
    lsError = ls.error
  }
  if (!lsOk) {
    return { ok: false, detail: 'lsappinfo 不可用：' + (errorMessage(lsError) || '未知错误') }
  }

  const ui = await runExec('osascript', [
    '-e',
    'tell application "System Events" to get UI elements enabled',
  ])
  if (!ui.ok) {
    const kind = classifyForegroundError(ui.error)
    return { ok: false, detail: '辅助功能检测失败（' + kind + '）：' + (errorMessage(ui.error) || '未知错误') }
  }
  const enabled = String(ui.stdout || '').trim().toLowerCase()
  if (enabled !== 'true') {
    return {
      ok: false,
      detail: '辅助功能未授权：请在「系统设置 → 隐私与安全性 → 辅助功能」中授权 DeepSeek Harness',
    }
  }

  const front = await runExec('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ])
  if (!front.ok) {
    const kind = classifyForegroundError(front.error)
    return { ok: false, detail: '自动化权限检测失败（' + kind + '）：' + (errorMessage(front.error) || '未知错误') }
  }
  const appName = String(front.stdout || '').trim()
  return { ok: true, detail: '辅助功能与自动化权限正常' + (appName ? '（前台：' + appName + '）' : '') }
}
