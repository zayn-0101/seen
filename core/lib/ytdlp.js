/**
 * yt-dlp 定位与安装。
 *
 * 优先级：配置 ytdlpBin → PATH → ~/.seen/bin（自动安装）→ 常见安装位置。
 * 运行时通过 ensureYtDlp() 在缺失时自动下载官方二进制，用户不必先装 brew。
 * 只负责找到/安装可执行文件，不读取任何 Cookie。
 */
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { downloadCandidates } from './download.js'

const execFileP = promisify(execFile)
const INSTALL_DIR = join(homedir(), '.seen', 'bin')
const DOWNLOAD_TIMEOUT_MS = 180000
const VERSION_TIMEOUT_MS = 15000

/** 自动安装位置：~/.seen/bin/yt-dlp（Windows 为 yt-dlp.exe）。 */
export function ytDlpInstallPath(platform = process.platform) {
  return join(INSTALL_DIR, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
}

/** 官方 release 里对应平台的资产名。 */
export function ytDlpAssetName(platform = process.platform) {
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'linux') return 'yt-dlp_linux'
  return 'yt-dlp'
}

/** 官方最新版下载地址。 */
export function ytDlpReleaseUrl(platform = process.platform) {
  return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + ytDlpAssetName(platform)
}

const CANDIDATES = [
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  join(homedir(), '.local', 'bin', 'yt-dlp'),
  join(homedir(), 'bin', 'yt-dlp'),
]

/** 查找 yt-dlp（只看已安装的）；配置 ytdlpBin 优先。返回绝对路径或 null。 */
export function findYtDlp(config = {}) {
  const configured = config && typeof config === 'object' ? config.ytdlpBin : null
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
  const installed = ytDlpInstallPath()
  if (existsSync(installed)) return installed
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function verifyYtDlp(file) {
  try {
    const result = await execFileP(file, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' })
    return /^\d{4}\.\d{2}\.\d{2}/.test(String(result.stdout || '').trim())
  } catch {
    return false
  }
}

async function downloadOnce(url, tempPath) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'seen-ytdlp-installer' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length < 1024) throw new Error('下载内容过小')
    writeFileSync(tempPath, buffer)
    return
  } catch (error) {
    // 部分代理环境下 Node 的证书链不可用，退回系统 curl（走系统证书）
    try {
      await execFileP('curl', ['-fsSL', '--max-time', '180', '-o', tempPath, url], { timeout: DOWNLOAD_TIMEOUT_MS })
      if (statSync(tempPath).size < 1024) throw new Error('下载内容过小')
    } catch {
      throw error
    }
  }
}

/** 官方地址失败后按镜像重试（国内直连 GitHub 常常超时）。 */
async function downloadFile(url, tempPath) {
  const candidates = downloadCandidates(url)
  let lastError = null
  for (const candidate of candidates) {
    try {
      await downloadOnce(candidate, tempPath)
      return
    } catch (error) {
      lastError = error
      try { rmSync(tempPath, { force: true }) } catch { /* 忽略 */ }
    }
  }
  throw lastError || new Error('下载失败')
}

let installTask = null

/**
 * 下载官方 yt-dlp 到 ~/.seen/bin 并校验可执行。
 * 并发调用共享同一次下载；失败不会重试（由 ensureYtDlp 控制）。
 */
export async function installYtDlp({ force = false, onProgress } = {}) {
  const target = ytDlpInstallPath()
  if (!force && existsSync(target) && await verifyYtDlp(target)) {
    return { ok: true, path: target, skipped: true }
  }
  if (installTask) return installTask
  installTask = (async () => {
    const temp = target + '.part'
    try {
      if (onProgress) onProgress({ stage: 'download', message: '正在下载 yt-dlp（约 37MB）' })
      mkdirSync(dirname(target), { recursive: true })
      await downloadFile(ytDlpReleaseUrl(), temp)
      chmodSync(temp, 0o755)
      renameSync(temp, target)
      if (!await verifyYtDlp(target)) throw new Error('下载的 yt-dlp 无法运行')
      return { ok: true, path: target }
    } catch (error) {
      try { rmSync(temp, { force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: String(error?.message || error || '下载失败') }
    } finally {
      installTask = null
    }
  })()
  return installTask
}

let autoInstallTried = false

/**
 * 确保有可用的 yt-dlp：已安装直接用，缺失时自动下载一次。
 * 返回 { ok, path?, error?, skipped? }，不抛错。
 */
export async function ensureYtDlp(config = {}, { onProgress } = {}) {
  const found = findYtDlp(config)
  if (found) return { ok: true, path: found, skipped: true }
  if (autoInstallTried) {
    return { ok: false, error: 'yt-dlp 不可用（本次运行已尝试过自动安装）' }
  }
  autoInstallTried = true
  const result = await installYtDlp({ onProgress })
  if (!result.ok) return result
  const after = findYtDlp(config)
  return after ? { ok: true, path: after } : { ok: false, error: '安装完成但找不到 yt-dlp' }
}

/** 仅测试用：重置自动安装状态。 */
export function resetYtDlpState() {
  autoInstallTried = false
  installTask = null
}
