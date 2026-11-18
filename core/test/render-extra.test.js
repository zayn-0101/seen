import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderVideoNote, formatDuration } from '../lib/render.js'

test('renderVideoNote warns when no transcript and shows real totals', () => {
  const md = renderVideoNote({
    title: '测试课程',
    subject: '机器学习',
    bvid: 'BV1GJ411x7h7',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    summary: '摘要',
    keyPoints: [{ title: '主题', points: ['要点'] }],
    discussion: ['讨论'],
    fetchStats: { desc: 71, tags: 9, transcript: 0, danmaku: 150, comments: 3, totalDanmaku: 3557, totalComments: 12513 },
    contentSource: 'metadata',
    contentQuality: 'metadata-only',
    chapters: [{ from: 0, content: '导入' }, { from: 45, content: '技术概念' }],
  })
  assert.ok(md.includes('内容依据有限'))
  assert.ok(md.includes('全站 3557 条'))
  assert.ok(md.includes('全站 12513 条'))
  assert.ok(md.includes('## 章节'))
  assert.ok(md.includes('[00:45](https://www.bilibili.com/video/BV1GJ411x7h7?t=45) 技术概念'))
  assert.equal(formatDuration(3041), '50:41')
})

test('renderVideoNote keeps original transcript origin for archive re-summaries', () => {
  const md = renderVideoNote({
    title: '存档重整理',
    subject: '测试学科',
    source: 'bilibili',
    bvid: 'BV1GJ411x7h7',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    summary: '摘要',
    keyPoints: Array.from({ length: 6 }, (_, index) => ({ title: '主题' + index, points: ['要点'] })),
    concepts: Array.from({ length: 4 }, (_, index) => ({ name: '概念' + index, brief: '说明' })),
    fetchStats: { desc: 20, tags: 3, transcript: 4000, danmaku: 1, comments: 1 },
    contentSource: 'archive',
    transcriptOrigin: 'up-subtitle',
    transcriptLength: 4000,
    contentQuality: 'full',
  })
  assert.ok(md.includes('quality: 5'))
  assert.ok(md.includes('transcriptOrigin: "up-subtitle"'))
  assert.ok(md.includes('内容来源：本地字幕存档'))
  assert.ok(md.includes('原文来自 UP 主字幕'))
  assert.ok(md.includes('字幕：4000 字（本地字幕存档，原文来自 UP 主字幕）'))
  assert.ok(!md.includes('音频转写：4000 字（本地 Whisper）'))
})

test('renderVideoNote labels AI subtitle', () => {
  const md = renderVideoNote({
    title: '测试课程', subject: '机器学习', summary: '摘要',
    keyPoints: [{ title: '主题', points: ['要点'] }],
    fetchStats: { desc: 71, tags: 9, transcript: 18954, danmaku: 150, comments: 20, totalDanmaku: 3557, totalComments: 12513 },
    contentSource: 'ai-subtitle', contentQuality: 'full',
  })
  assert.ok(md.includes('B站 AI 字幕'))
  assert.ok(md.includes('字幕：18954 字（B站 AI 字幕）'))
  assert.ok(!md.includes('内容依据有限'))
})
