import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSrt, chooseSubtitle } from '../lib/transcript.js'

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
