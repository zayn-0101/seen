import { test } from 'node:test'
import assert from 'node:assert/strict'
import { downloadCandidates, githubMirrors } from '../lib/download.js'

test('downloadCandidates keeps the official url first and appends mirrors', () => {
  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
  const list = downloadCandidates(url)
  assert.equal(list[0], url)
  assert.ok(list.length >= 2)
  assert.ok(list[1].endsWith(url))
  assert.ok(list[1].startsWith('https://'))
})

test('downloadCandidates leaves non-GitHub urls untouched', () => {
  const model = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
  assert.deepEqual(downloadCandidates(model), [model])
  assert.deepEqual(downloadCandidates('https://example.com/file.bin'), ['https://example.com/file.bin'])
  assert.deepEqual(downloadCandidates(''), [])
  assert.deepEqual(downloadCandidates(null), [])
})

test('downloadCandidates ignores GitHub repo pages that are not releases', () => {
  const url = 'https://github.com/yt-dlp/yt-dlp'
  assert.deepEqual(downloadCandidates(url), [url])
})

test('SEEN_GH_MIRROR overrides the built-in mirrors', () => {
  const original = process.env.SEEN_GH_MIRROR
  try {
    process.env.SEEN_GH_MIRROR = 'https://my.mirror/'
    assert.deepEqual(githubMirrors(), ['https://my.mirror/'])
    const list = downloadCandidates('https://github.com/a/b/releases/download/v1/x')
    assert.equal(list[1], 'https://my.mirror/https://github.com/a/b/releases/download/v1/x')

    // 多个镜像用逗号分隔，末尾斜杠自动补齐
    process.env.SEEN_GH_MIRROR = 'https://one.example, https://two.example/'
    assert.deepEqual(githubMirrors(), ['https://one.example/', 'https://two.example/'])
  } finally {
    if (original === undefined) delete process.env.SEEN_GH_MIRROR
    else process.env.SEEN_GH_MIRROR = original
  }
})
