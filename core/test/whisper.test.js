import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWhisperArgs } from '../lib/whisper.js'

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
