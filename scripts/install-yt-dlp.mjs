#!/usr/bin/env node
/**
 * 安装 yt-dlp 到 ~/.seen/bin。
 *
 * 服务运行时也会在首次需要时自动安装，这个脚本用于提前装好（例如离线准备环境）。
 *
 * 用法：
 *   node scripts/install-yt-dlp.mjs
 *   node scripts/install-yt-dlp.mjs --force     # 已存在也重新下载
 */
import { ensureYtDlp, findYtDlp, installYtDlp, ytDlpInstallPath, ytDlpReleaseUrl } from '../core/lib/ytdlp.js'

const force = process.argv.includes('--force')

const existing = findYtDlp({})
if (existing && !force) {
  console.log('已安装：' + existing)
  console.log('如需重新下载自动安装版本，加 --force。')
  process.exit(0)
}

console.log('下载地址：' + ytDlpReleaseUrl())
console.log('安装位置：' + ytDlpInstallPath())

const result = force
  ? await installYtDlp({ force: true, onProgress: (p) => console.log('· ' + (p.message || p.stage)) })
  : await ensureYtDlp({}, { onProgress: (p) => console.log('· ' + (p.message || p.stage)) })

if (!result.ok) {
  console.error('安装失败：' + (result.error || '未知原因'))
  console.error('可以改用系统包管理器安装：macOS「brew install yt-dlp」，Windows「winget install yt-dlp」')
  process.exit(1)
}

console.log('完成：' + result.path)
