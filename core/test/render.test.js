import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mermaidSafe, renderVideoNote, renderSubjectManual, renderOverview, upsertAutoBlock, autoBlock,
} from '../lib/render.js'

test('mermaidSafe strips syntax characters', () => {
  assert.equal(mermaidSafe('主题 (一) [二] {三}'), '主题 一 二 三')
  assert.ok(mermaidSafe('x'.repeat(100), 10).length <= 10)
})

test('renderVideoNote contains required sections', () => {
  const md = renderVideoNote({
    title: '梯度下降详解',
    subject: '机器学习',
    bvid: 'BV1GJ411x7h7',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    author: 'UP主',
    createdAt: Date.now(),
    summary: '一句话摘要',
    keyPoints: [{ title: '学习率', points: ['太大震荡', '太小收敛慢'] }],
    discussion: ['观众关心学习率怎么选'],
    fetchStats: { desc: 100, tags: 3, transcript: 0, danmaku: 150, comments: 3 },
    noteRoot: '课程知识地图',
  })
  assert.ok(md.startsWith('---'))
  assert.ok(md.includes('title: "梯度下降详解"'))
  assert.ok(md.includes('bvid: "BV1GJ411x7h7"'))
  assert.ok(md.includes('## 核心知识点'))
  assert.ok(md.includes('## 弹幕与评论讨论焦点'))
  assert.ok(md.includes('## 思维导图'))
  assert.ok(md.includes('root((梯度下降详解))'))
  assert.ok(md.includes('## 来源统计'))
})

test('manual and overview render with AUTO block', () => {
  const manual = renderSubjectManual({
    subject: '机器学习',
    videos: [{ title: '梯度下降详解', notePath: '课程知识地图/机器学习/梯度下降详解', summary: '摘要', createdAt: Date.now() }],
    noteRoot: '课程知识地图',
  })
  assert.ok(manual.includes('<!-- AUTO:START -->'))
  assert.ok(manual.includes('## 我的补充'))
  assert.ok(manual.includes('[[课程知识地图/机器学习/梯度下降详解|梯度下降详解]]'))
  const overview = renderOverview({ subjects: ['机器学习'], noteRoot: '课程知识地图' })
  assert.ok(overview.includes('[[课程知识地图/机器学习/机器学习 学习手册|机器学习]]'))
})

test('upsertAutoBlock preserves user content', () => {
  const original = 'header\n\n<!-- AUTO:START -->\nold\n<!-- AUTO:END -->\n\nUSER CONTENT'
  const updated = upsertAutoBlock(original, autoBlock('new body'))
  assert.ok(updated.includes('header'))
  assert.ok(updated.includes('USER CONTENT'))
  assert.ok(updated.includes('new body'))
  assert.ok(!updated.includes('old'))
})
