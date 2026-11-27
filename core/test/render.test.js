import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mermaidSafe, renderVideoNote, renderVideoNoteV5, renderSubjectManual, renderOverview, upsertAutoBlock, autoBlock,
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
    noteRoot: '视频笔记',
  })
  assert.ok(md.startsWith('---'))
  assert.ok(md.includes('title: "梯度下降详解"'))
  assert.ok(md.includes('bvid: "BV1GJ411x7h7"'))
  assert.ok(md.includes('## 核心知识点'))
  assert.ok(md.includes('## 弹幕与评论讨论焦点'))
  assert.ok(!md.includes('## 思维导图'))
  assert.ok(!md.includes('cover:'))
  assert.ok(md.includes('## 来源统计'))
})

test('renderVideoNote can omit concept tags from visible tags', () => {
  const md = renderVideoNote({
    title: '测试',
    subject: '知识管理',
    summary: '摘要',
    keyPoints: [],
    concepts: [{ name: '双向链接', brief: '概念' }],
    tags: ['知识管理', 'Obsidian'],
    includeConceptTags: false,
    contentQuality: 'full',
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('tags: ["知识管理","Obsidian"]'))
  assert.ok(!md.includes('概念/双向链接'))
})

test('renderVideoNote keeps created and updated separate', () => {
  const md = renderVideoNote({
    title: '测试',
    subject: '测试学科',
    createdAt: Date.UTC(2026, 10, 18),
    updatedAt: Date.UTC(2026, 10, 26),
    summary: '摘要',
    keyPoints: [],
    contentQuality: 'metadata-only',
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('created: "2026-11-18"'))
  assert.ok(md.includes('updated: "2026-11-26"'))
})

test('manual and overview render with AUTO block', () => {
  const manual = renderSubjectManual({
    subject: '机器学习',
    videos: [{ title: '梯度下降详解', notePath: '视频笔记/机器学习/梯度下降详解', summary: '摘要', createdAt: Date.now() }],
    noteRoot: '视频笔记',
  })
  assert.ok(manual.includes('<!-- AUTO:START -->'))
  assert.ok(manual.includes('## 我的补充'))
  assert.ok(manual.includes('[[视频笔记/机器学习/梯度下降详解|梯度下降详解]]'))
  const overview = renderOverview({ subjects: ['机器学习'], noteRoot: '视频笔记' })
  assert.ok(overview.includes('[[视频笔记/资料/手册/机器学习|机器学习]]'))
})

test('upsertAutoBlock preserves user content', () => {
  const original = 'header\n\n<!-- AUTO:START -->\nold\n<!-- AUTO:END -->\n\nUSER CONTENT'
  const updated = upsertAutoBlock(original, autoBlock('new body'))
  assert.ok(updated.includes('header'))
  assert.ok(updated.includes('USER CONTENT'))
  assert.ok(updated.includes('new body'))
  assert.ok(!updated.includes('old'))
})

test('renderVideoNoteV5 uses Chinese properties, numbered sections and collapsible cards', () => {
  const md = renderVideoNoteV5({
    title: '测试标题',
    originalTitle: '测试标题 #话题',
    displayTitle: '测试标题',
    subject: '知识管理',
    source: 'bilibili',
    url: 'https://www.bilibili.com/video/BV1test',
    bvid: 'BV1test',
    author: 'UP 主',
    publishedAt: '2026-11-18',
    createdAt: Date.UTC(2026, 10, 18),
    updatedAt: Date.UTC(2026, 10, 26),
    contentType: 'opinion',
    contentQuality: 'full',
    quality: 5,
    summary: '概述文本',
    question: '核心问题？',
    answer: '核心结论。',
    keyPoints: [{ title: '主题一', points: [{ text: '要点一', time: 12 }] }],
    numbers: [{ value: '200 倍', meaning: '成本增长', time: 300 }],
    concepts: [{ name: '3A 游戏', brief: '营销标签', aliases: ['AAA'] }],
    terms: [
      { name: '买断制', definition: '一次性付费' },
      { name: '3A', definition: '与概念重复的简称' },
    ],
    template: { doubts: ['这个判断有反例吗？'] },
    relatedNotes: [{ title: '另一篇', notePath: '视频笔记/笔记/知识管理/另一篇', reason: '共同概念' }],
    quotes: [{ text: '一句原话', time: 60 }],
    resources: [{ name: 'PC Gamer', note: '媒体' }],
    discussion: ['观众在讨论'],
    fetchStats: { transcript: 1000, danmaku: 10, totalDanmaku: 10000, comments: 5, totalComments: 500 },
    review: { due: '2026-11-18', interval: 0, ease: 2.5, reps: 0 },
    tags: ['知识管理', 'Obsidian'],
    noteRoot: '视频笔记',
  })
  assert.ok(md.startsWith('---\n平台: "B 站"'))
  assert.ok(md.includes('类型: "观点"'))
  assert.ok(md.includes('UP 主: "UP 主"'))
  assert.ok(md.includes('发布时间: "2026-11-18"'))
  assert.ok(md.includes('字幕: '))
  assert.ok(md.includes('学科: "知识管理"'))
  assert.ok(!/^# /m.test(md))
  assert.ok(md.includes('> [!abstract] 摘要'))
  assert.ok(md.includes('## 01 速览'))
  assert.ok(md.includes('## 02 核心知识点'))
  assert.ok(md.includes('## 03 可质疑之处'))
  assert.ok(md.includes('## 04 核心概念与术语'))
  assert.ok(md.includes('## 05 相关笔记'))
  assert.ok(md.includes('## 06 复习卡片'))
  assert.ok(md.includes('## 07 附录'))
  assert.ok(md.includes('## 08 我的补充'))
  assert.ok(md.includes('| 时间 | 数字 | 含义 |'))
  assert.ok(md.includes('| [05:00](https://www.bilibili.com/video/BV1test?t=300) | 200 倍 | 成本增长 |'))
  assert.ok(md.includes('| 3A 游戏（AAA） | 营销标签 |'))
  assert.ok(md.includes('| 买断制 | 一次性付费 |'))
  assert.ok(!md.includes('| 3A | 与概念重复的简称 |'))
  assert.ok(!md.includes('^concept-'))
  assert.ok(md.includes('> [!summary]- 展开 1 张卡片'))
  assert.ok(md.includes('> **核心问题？**\n>\n> ?\n>\n> **答案：** 核心结论。'))
  assert.ok(md.includes('观众讨论（B 站弹幕 / 评论）'))
  assert.ok(md.includes('> [!quote] 原话摘录（1 条）'))
  assert.ok(md.includes('> [!note] 提到的资源（1 个）'))
  assert.ok(md.includes('> [!info] 抓取统计'))
  assert.ok(!md.includes('章节：'))
  assert.ok(!md.includes('> [!quote]-'))
  assert.ok(md.indexOf('## 07 附录') < md.indexOf('> [!quote] 原话摘录'))
  assert.ok(md.indexOf('> [!quote] 原话摘录') < md.indexOf('## 08 我的补充'))
  assert.ok(md.includes('<!-- seen-meta'))
  assert.ok(md.includes('"format": 5'))
  assert.ok(md.includes('"publishedAt": "2026-11-18"'))
  assert.ok(md.includes('"bvid": "BV1test"'))
})

test('renderVideoNoteV5 metadata-only omits knowledge points and cards', () => {
  const md = renderVideoNoteV5({
    title: '仅元数据',
    subject: '测试学科',
    summary: '只有简介时的摘要',
    question: '能从简介回答的问题？',
    answer: '简短答案',
    keyPoints: [{ title: '编出来的主题', points: ['编出来的要点'] }],
    reviewCards: [{ question: '编出来的卡片？', answer: '编出来的答案' }],
    chapters: [{ from: 0, content: '<Untitled Chapter 1>' }, { from: 0, content: '开场' }],
    contentQuality: 'metadata-only',
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('> [!warning] 内容依据有限'))
  assert.ok(md.includes('## 01 速览'))
  assert.ok(!md.includes('<Untitled Chapter 1>'))
  assert.ok(!md.includes('## 02 核心知识点'))
  assert.ok(!md.includes('复习卡片'))
  assert.ok(!md.includes('flashcards'))
  assert.ok(md.includes('## 02 我的补充'))
})

test('renderVideoNoteV5 does not invent review cards from key points', () => {
  const md = renderVideoNoteV5({
    title: '没有问答',
    subject: '知识管理',
    summary: '摘要',
    keyPoints: [{ title: '主题', points: ['要点'] }],
    contentQuality: 'full',
    noteRoot: '视频笔记',
  })
  assert.ok(!md.includes('复习卡片'))
  assert.ok(md.includes('## 02 我的补充'))
})
