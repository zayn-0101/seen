import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSrt, chooseSubtitle, transcriptCacheName, buildBilibiliAudioArgs } from '../lib/transcript.js'

test('parseSrt strips indexes timestamps and tags', () => {
  const srt = [
    '1',
    '00:00:00,000 --> 00:00:02,880',
    '<b>第一句</b>',
    '',
    '2',
    '00:00:02,880 --> 00:00:04,480',
    '第二句',
  ].join('\n')
  assert.equal(parseSrt(srt), '第一句 第二句')
  assert.equal(parseSrt(''), '')
})

test('chooseSubtitle prefers AI Chinese', () => {
  const list = [
    { lan: 'en', subtitle_url: '//e' },
    { lan: 'ai-en', subtitle_url: '//ae' },
    { lan: 'ai-zh', subtitle_url: '//az' },
    { lan: 'zh-CN', subtitle_url: '//z' },
  ]
  assert.equal(chooseSubtitle(list).lan, 'ai-zh')
  assert.equal(chooseSubtitle([{ lan: 'zh-CN', subtitle_url: '//z' }]).lan, 'zh-CN')
  assert.equal(chooseSubtitle([]), null)
})

test('transcriptCacheName separates pages by cid', () => {
  assert.equal(transcriptCacheName('BV1abc'), 'BV1abc.json')
  assert.equal(transcriptCacheName('BV1abc', '123'), 'BV1abc__123.json')
  assert.notEqual(transcriptCacheName('BV1abc', '111'), transcriptCacheName('BV1abc', '222'))
})

test('buildBilibiliAudioArgs asks yt-dlp for the best audio track', () => {
  const args = buildBilibiliAudioArgs({ url: 'https://www.bilibili.com/video/BV1abc?p=2', dir: '/tmp/x' })
  assert.ok(args.includes('--no-playlist'))
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2), ['-f', 'bestaudio'])
  assert.ok(args.some((arg) => String(arg).endsWith('audio.%(ext)s')))
  assert.equal(args.at(-1), 'https://www.bilibili.com/video/BV1abc?p=2')
  assert.ok(buildBilibiliAudioArgs({ url: 'u', dir: '/tmp', cookieBrowser: 'chrome' }).includes('--cookies-from-browser'))
})
