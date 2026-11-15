import test from 'node:test'
import assert from 'node:assert/strict'

import { stripCover } from '../lib/note-clean.js'

const NOTE = [
  '---',
  'title: "带封面"',
  'type: "video-note"',
  'cover: "https://example.com/c.jpg"',
  'tags: ["写作"]',
  '---',
  '',
  '# 标题',
  '',
  '## 视频信息',
  '',
  '| 项目 | 内容 |',
  '| --- | --- |',
  '',
  '![封面|360](https://example.com/c.jpg)',
  '',
  '## 核心知识点',
  '',
  '- 要点',
  '',
].join('\n')

test('stripCover removes frontmatter cover and cover image line', () => {
  const result = stripCover(NOTE)
  assert.equal(result.changed, true)
  assert.ok(!result.markdown.includes('cover:'))
  assert.ok(!result.markdown.includes('![封面'))
  assert.ok(result.markdown.includes('type: "video-note"'))
  assert.ok(result.markdown.includes('## 核心知识点'))
})

test('stripCover leaves a clean note untouched', () => {
  const clean = NOTE.replace('cover: "https://example.com/c.jpg"\n', '').replace('![封面|360](https://example.com/c.jpg)\n\n', '')
  const result = stripCover(clean)
  assert.equal(result.changed, false)
  assert.equal(result.markdown, clean)
})

test('stripCover tolerates empty input', () => {
  assert.deepEqual(stripCover(''), { markdown: '', changed: false })
  assert.deepEqual(stripCover(null), { markdown: '', changed: false })
})
