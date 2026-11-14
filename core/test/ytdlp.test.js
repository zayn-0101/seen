import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ensureYtDlp,
  findYtDlp,
  parseChecksums,
  ytDlpAssetName,
  ytDlpChecksumUrl,
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

const HASH_A = 'a'.repeat(64)
const HASH_B = '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa'

test('parseChecksums parses SHA2-256SUMS lines', () => {
  const text = [
    'e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3  yt-dlp',
    HASH_B + '  yt-dlp_macos',
    '   ',
    '# 注释行',
    'NOTAHASH  nope',
  ].join('\n')
  const map = parseChecksums(text)
  assert.equal(map.get('yt-dlp'), 'e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3')
  assert.equal(map.get('yt-dlp_macos'), HASH_B)
  assert.equal(map.has('nope'), false)
  assert.equal(parseChecksums('').size, 0)
  assert.equal(parseChecksums(null).size, 0)
})

test('parseChecksums accepts binary-mode asterisk prefix', () => {
  const map = parseChecksums(HASH_A + ' *yt-dlp_macos')
  assert.equal(map.get('yt-dlp_macos'), HASH_A)
})

test('ytDlpChecksumUrl points at the official SHA2-256SUMS', () => {
  assert.equal(ytDlpChecksumUrl(), 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS')
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
