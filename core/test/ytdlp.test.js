import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ensureYtDlp,
  findYtDlp,
  ytDlpAssetName,
  ytDlpInstallPath,
  ytDlpReleaseUrl,
} from '../lib/ytdlp.js'

test('ytDlpAssetName maps platforms to official release assets', () => {
  assert.equal(ytDlpAssetName('darwin'), 'yt-dlp_macos')
  assert.equal(ytDlpAssetName('linux'), 'yt-dlp_linux')
  assert.equal(ytDlpAssetName('win32'), 'yt-dlp.exe')
  assert.equal(ytDlpAssetName('freebsd'), 'yt-dlp')
})

test('ytDlpReleaseUrl points at the latest official release', () => {
  const url = ytDlpReleaseUrl('darwin')
  assert.match(url, /^https:\/\/github\.com\/yt-dlp\/yt-dlp\/releases\/latest\/download\//)
  assert.ok(url.endsWith('yt-dlp_macos'))
})

test('ytDlpInstallPath lives under ~/.seen/bin', () => {
  assert.match(ytDlpInstallPath('darwin'), /\/\.seen\/bin\/yt-dlp$/)
  assert.match(ytDlpInstallPath('win32'), /\/\.seen\/bin\/yt-dlp\.exe$/)
})

test('findYtDlp honours a configured binary', () => {
  assert.equal(findYtDlp({ ytdlpBin: process.execPath }), process.execPath)
  // 配置了不存在的路径时应回退到正常探测，结果与默认调用一致
  assert.equal(findYtDlp({ ytdlpBin: '/definitely/not/here/yt-dlp' }), findYtDlp({}))
})

test('ensureYtDlp reuses an installed binary without downloading', async () => {
  const result = await ensureYtDlp({ ytdlpBin: process.execPath })
  assert.equal(result.ok, true)
  assert.equal(result.path, process.execPath)
  assert.equal(result.skipped, true)
})
