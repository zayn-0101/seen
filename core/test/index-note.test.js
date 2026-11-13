import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndexMarkdown } from '../lib/index-note.js'

test('buildIndexMarkdown renders table sorted by date', () => {
  const md = buildIndexMarkdown([
    { title: '旧视频', subject: '语言文化', source: 'bilibili', notePath: '课程知识地图/语言文化/a.md', createdAt: new Date(2026, 10, 10).getTime() },
    { title: '新视频', subject: '人工智能', source: 'douyin', notePath: '课程知识地图/人工智能/b.md', createdAt: new Date(2026, 10, 12).getTime() },
  ])
  assert.match(md, /\| 日期 \| 标题 \| 学科 \| 来源 \|/)
  assert.match(md, /\[\[课程知识地图\/人工智能\/b\|新视频\]\]/)
  const newIndex = md.indexOf('新视频')
  const oldIndex = md.indexOf('旧视频')
  assert.ok(newIndex > 0 && oldIndex > newIndex, 'newest first')
  assert.match(md, /语言文化：1 个/)
  assert.match(md, /人工智能：1 个/)
})

test('buildIndexMarkdown handles empty history', () => {
  const md = buildIndexMarkdown([])
  assert.match(md, /还没有视频笔记/)
  assert.match(md, /学科分布/)
})

test('buildIndexMarkdown escapes pipes in titles', () => {
  const md = buildIndexMarkdown([{ title: 'a|b', subject: '未分类', notePath: '课程知识地图/x/a.md', createdAt: Date.now() }])
  assert.match(md, /a｜b/)
})

test('buildIndexMarkdown skips malformed rows', () => {
  const md = buildIndexMarkdown([null, {}, { title: 'ok', createdAt: Date.now() }])
  assert.match(md, /ok/)
})
