/**
 * dsh-video-coursemap · 前台窗口观察入口
 *
 * 按平台分派到 macOS / Windows 实现；其他平台返回 unsupported。
 */

import { observeDarwin } from './foreground-darwin.js'
import { observeWin32 } from './foreground-win32.js'

// 浏览器 / 视频客户端 / 本地播放器名称（统一小写；Windows 进程名会去掉 .exe）
const DEFAULT_BROWSER_NAMES = [
  // 浏览器
  'google chrome', 'chrome', 'chromium', 'safari', 'microsoft edge', 'msedge', 'edge',
  'brave browser', 'brave', 'arc', 'firefox', 'mozilla firefox', 'opera', 'vivaldi',
  'yandex', 'yandexbrowser', 'librewolf', 'waterfox',
  '360chrome', '360se', '360browser', 'qqbrowser', 'sogouexplorer', 'maxthon',
  'ucbrowser', 'quark', '夸克',
  // 视频客户端
  'bilibili', '哔哩哔哩', 'douyin', '抖音', 'aweme', 'kuaishou', '快手',
  'xigua', '西瓜视频', 'youku', '优酷', 'iqiyi', '爱奇艺', 'pps',
  'qqlive', 'tencentvideo', '腾讯视频', 'mgtv', '芒果tv', 'migu', '咪咕视频',
  'weishi', '微视', 'sohuvideo', '搜狐视频', 'letv', '乐视',
  // 本地播放器
  'potplayer', 'vlc', 'mpv', 'kmplayer', 'mpc-hc', 'mpc-be',
]

const DEFAULT_BROWSER_NAME_SET = new Set(DEFAULT_BROWSER_NAMES)

function normalizeProcessName(name) {
  const text = String(name === null || name === undefined ? '' : name).trim()
  if (!text) return ''
  // 去掉完整路径，取最后一段；去掉 .exe 后缀
  const base = text.split(/[\\/]/).pop() || ''
  return base.toLowerCase().replace(/\.exe$/i, '').trim()
}

/** 判断前台 App / 进程名是否为浏览器（含视频客户端与本地播放器） */
export function isBrowserName(name, config = {}) {
  const normalized = normalizeProcessName(name)
  if (!normalized) return false

  const custom = config && config.browserNames
  if (Array.isArray(custom) && custom.length > 0) {
    return custom.some((item) => normalizeProcessName(item) === normalized)
  }
  if (typeof custom === 'string' && custom.trim()) {
    return normalizeProcessName(custom) === normalized
  }
  return DEFAULT_BROWSER_NAME_SET.has(normalized)
}

function failureResult(platform, error) {
  return {
    platform,
    app: '',
    title: '',
    url: '',
    source: 'none',
    error: String((error && error.message) || error || '未知错误'),
    permission: 'unknown',
  }
}

/** 观察当前前台窗口；任何异常都降级为带 error 的结果，不抛错 */
export async function observeForeground(config = {}) {
  if (process.platform === 'darwin') {
    try {
      return await observeDarwin(config)
    } catch (error) {
      return failureResult('darwin', error)
    }
  }
  if (process.platform === 'win32') {
    try {
      return await observeWin32(config)
    } catch (error) {
      return failureResult('win32', error)
    }
  }
  return {
    platform: 'other',
    app: '',
    title: '',
    url: '',
    source: 'unsupported',
    error: '当前平台不支持前台窗口读取（仅支持 macOS / Windows）',
  }
}
