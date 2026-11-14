#!/usr/bin/env node
/**
 * 下载 ffmpeg 静态二进制到 ~/.seen/bin。
 *
 * 服务运行时也会在首次需要时自动下载，这个脚本用于提前装好。
 * 来源是 ffmpeg-static 的预编译产物，不需要 Homebrew，也不需要编译。
 *
 * 用法：
 *   node scripts/install-ffmpeg.mjs
 *   node scripts/install-ffmpeg.mjs --force
 */
import { ffmpegInstallPath, ffmpegReleaseUrl, findFfmpeg, installFfmpeg } from '../core/lib/whisper.js'

const force = process.argv.includes('--force')

const existing = findFfmpeg({})
if (existing && !force) {
  console.log('已安装：' + existing)
  console.log('如需重新下载自动安装版本，加 --force。')
  process.exit(0)
}

const url = ffmpegReleaseUrl()
if (!url) {
  console.error('当前平台没有可用的 ffmpeg 静态构建：' + process.platform + ' / ' + process.arch)
  process.exit(1)
}

console.log('下载地址：' + url)
console.log('安装位置：' + ffmpegInstallPath())

const result = await installFfmpeg({
  force,
  onProgress: (p) => {
    if (p.percent === null || p.percent === undefined) return
    process.stdout.write('\r  ' + p.percent + '%  ' + Math.round(p.received / 1024 / 1024) + ' / ' + Math.round(p.total / 1024 / 1024) + ' MB')
  },
})

if (!result.ok) {
  console.error('\n安装失败：' + (result.error || '未知原因'))
  console.error('可以改用系统包管理器安装：macOS「brew install ffmpeg」。')
  process.exit(1)
}

console.log('\n完成：' + result.path)
