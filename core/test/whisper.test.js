import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWhisperArgs,
  ensureFfmpeg,
  findHomebrew,
  installWhisperCli,
  ffmpegAssetName,
  ffmpegInstallPath,
  ffmpegReleaseUrl,
  findFfmpeg,
  whisperModelPath,
  whisperModelUrls,
} from '../lib/whisper.js'

test('buildWhisperArgs produces whisper-cli argv with language', () => {
  const argv = buildWhisperArgs({ bin: '/opt/homebrew/bin/whisper-cli', model: '/models/ggml-small.bin', wav: '/tmp/a.wav', language: 'zh' })
  assert.equal(argv[0], '/opt/homebrew/bin/whisper-cli')
  assert.equal(argv[argv.indexOf('-m') + 1], '/models/ggml-small.bin')
  assert.equal(argv[argv.indexOf('-f') + 1], '/tmp/a.wav')
  assert.equal(argv[argv.indexOf('-l') + 1], 'zh')
  assert.equal(argv[argv.indexOf('-of') + 1], '/tmp/a')
  assert.ok(argv.includes('-otxt'))
  assert.ok(argv.includes('-np'))
  assert.ok(!argv.includes('--prompt'))
})

test('buildWhisperArgs passes prompt only when present', () => {
  const withPrompt = buildWhisperArgs({ bin: 'w', model: 'm', wav: '/tmp/a.wav', prompt: '  标题  ', language: 'auto' })
  assert.equal(withPrompt[withPrompt.indexOf('-l') + 1], 'auto')
  assert.equal(withPrompt[withPrompt.indexOf('--prompt') + 1], '标题')

  const long = buildWhisperArgs({ bin: 'w', model: 'm', wav: '/tmp/a.wav', prompt: 'x'.repeat(900) })
  assert.equal(long[long.indexOf('--prompt') + 1].length, 500)
  assert.equal(long[long.indexOf('-l') + 1], 'zh')
})

test('buildWhisperArgs tolerates missing values', () => {
  const argv = buildWhisperArgs({})
  assert.equal(argv[0], '')
  assert.equal(argv[argv.indexOf('-m') + 1], '')
  assert.equal(argv[argv.indexOf('-f') + 1], '')
  assert.equal(argv[argv.indexOf('-of') + 1], '')
})

test('ffmpegAssetName maps platform and arch', () => {
  assert.equal(ffmpegAssetName('darwin', 'arm64'), 'ffmpeg-darwin-arm64')
  assert.equal(ffmpegAssetName('darwin', 'x64'), 'ffmpeg-darwin-x64')
  assert.equal(ffmpegAssetName('win32', 'x64'), 'ffmpeg-win32-x64')
  assert.equal(ffmpegAssetName('linux', 'arm64'), 'ffmpeg-linux-arm64')
  assert.equal(ffmpegAssetName('linux', 'x64'), 'ffmpeg-linux-x64')
  assert.equal(ffmpegAssetName('linux', 'arm'), 'ffmpeg-linux-arm')
  assert.equal(ffmpegAssetName('freebsd', 'x64'), null)
})

test('ffmpegReleaseUrl points at the ffmpeg-static release', () => {
  const url = ffmpegReleaseUrl('darwin', 'arm64')
  assert.match(url, /^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/latest\/download\//)
  assert.ok(url.endsWith('ffmpeg-darwin-arm64'))
  assert.equal(ffmpegReleaseUrl('freebsd', 'x64'), null)
})

test('ffmpegInstallPath lives under ~/.seen/bin', () => {
  assert.match(ffmpegInstallPath('darwin'), /\/\.seen\/bin\/ffmpeg$/)
  assert.match(ffmpegInstallPath('win32'), /\/\.seen\/bin\/ffmpeg\.exe$/)
})

test('whisperModelUrls prefers HF_ENDPOINT, then official, then mirror', () => {
  const original = process.env.HF_ENDPOINT
  delete process.env.HF_ENDPOINT
  try {
    const urls = whisperModelUrls('small')
    assert.equal(urls.length, 2)
    assert.ok(urls[0].startsWith('https://huggingface.co/'))
    assert.ok(urls[1].startsWith('https://hf-mirror.com/'))
    assert.ok(urls[0].endsWith('/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'))

    process.env.HF_ENDPOINT = 'https://example.com/'
    const mirrored = whisperModelUrls('base')
    assert.equal(mirrored[0], 'https://example.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin')
    assert.ok(mirrored.length >= 2)
  } finally {
    if (original === undefined) delete process.env.HF_ENDPOINT
    else process.env.HF_ENDPOINT = original
  }
})

test('whisperModelPath points at ggml-<model>.bin', () => {
  assert.match(whisperModelPath('small'), /\/\.seen\/models\/ggml-small\.bin$/)
  assert.match(whisperModelPath('base'), /ggml-base\.bin$/)
})

test('findFfmpeg honours a configured binary', () => {
  assert.equal(findFfmpeg({ ffmpegBin: process.execPath }), process.execPath)
})

test('ensureFfmpeg reuses an installed binary without downloading', async () => {
  const result = await ensureFfmpeg({ ffmpegBin: process.execPath })
  assert.equal(result.ok, true)
  assert.equal(result.path, process.execPath)
  assert.equal(result.skipped, true)
})

test('findHomebrew returns an absolute brew path or null', () => {
  const brew = findHomebrew()
  if (brew) {
    assert.match(brew, /\/brew$/)
    assert.ok(findHomebrew().length > 0)
  } else {
    assert.equal(brew, null)
  }
})

test('installWhisperCli never throws and reports path or error', async () => {
  const result = await installWhisperCli({ timeout: 2000 })
  assert.equal(typeof result.ok, 'boolean')
  if (result.ok) assert.ok(result.path)
  else assert.ok(result.error)
})
