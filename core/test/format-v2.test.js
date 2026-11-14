import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSummary, normalizeConcepts, normalizeNumbers } from '../lib/analyze.js'
import { renderVideoNote, mergeManualSection, extractManualSection } from '../lib/render.js'

test('normalizeConcepts filters generic words, dedupes and caps', () => {
  const list = normalizeConcepts([
    '视频',
    '梯度下降',
    { name: '梯度下降', brief: '沿负梯度方向更新' },
    { name: '学习率', brief: '步长', aliases: ['步长', 'lr'] },
    { name: '这是一个非常非常长的概念名称超过十二个字' },
    '反向传播',
  ])
  assert.deepEqual(list.map((item) => item.name), ['梯度下降', '学习率', '反向传播'])
  assert.equal(list[1].brief, '步长')
  assert.deepEqual(list[1].aliases, ['步长', 'lr'])
})

test('normalizeConcepts caps at 8', () => {
  const input = Array.from({ length: 20 }, (_, i) => `概念词${i}`)
  assert.equal(normalizeConcepts(input).length, 8)
})

test('normalizeNumbers drops empty meaning and caps at 6', () => {
  const list = normalizeNumbers([
    { value: '260 词', meaning: '道歉信篇幅' },
    { value: '10 天', meaning: '' },
    '纯字符串',
    ...Array.from({ length: 10 }, (_, i) => ({ value: `${i} 个`, meaning: `含义${i}` })),
  ])
  assert.ok(list.length <= 6)
  assert.equal(list[0].value, '260 词')
  assert.ok(!list.some((item) => item.meaning === ''))
})

test('normalizeSummary keeps question, answer, concepts and numbers', () => {
  const s = normalizeSummary({
    summary: '讲道歉信怎么写',
    question: '道歉信该写多长',
    answer: '260 词以内',
    keyPoints: [{ title: '结构', points: ['开头道歉'] }],
    concepts: [{ name: '道歉信', brief: '正式致歉文书' }],
    numbers: [{ value: '260 词', meaning: '推荐篇幅' }],
    discussion: ['要不要手写'],
  }, '标题')
  assert.equal(s.question, '道歉信该写多长')
  assert.equal(s.answer, '260 词以内')
  assert.equal(s.concepts.length, 1)
  assert.equal(s.numbers.length, 1)
})

test('normalizeSummary falls back to empty new fields', () => {
  const s = normalizeSummary(null, '只有标题')
  assert.equal(s.summary, '只有标题')
  assert.equal(s.question, '')
  assert.deepEqual(s.concepts, [])
  assert.deepEqual(s.numbers, [])
})

test('renderVideoNote renders abstract, meta table, numbers and concepts', () => {
  const md = renderVideoNote({
    title: '梯度下降详解',
    subject: '机器学习',
    source: 'youtube',
    url: 'https://www.youtube.com/watch?v=abc',
    author: '频道A',
    createdAt: Date.UTC(2026, 0, 2),
    summary: '一句话摘要',
    question: '为什么学习率难调',
    answer: '因为它决定了步长',
    duration: 754,
    keyPoints: [{ title: '学习率', time: 60, points: ['太大震荡'] }],
    concepts: [{ name: '学习率', brief: '更新步长', aliases: ['步长'] }],
    numbers: [{ value: '0.01', meaning: '常用初始值' }],
    chapters: [{ from: 0, content: '开场' }],
    contentSource: 'youtube-subtitle',
    contentQuality: 'full',
    noteRoot: '课程知识地图',
  })
  assert.ok(md.includes('> [!abstract] 一句话总结'))
  assert.ok(md.includes('> [!question] 这期想回答'))
  assert.ok(md.includes('> [!success] 给出的答案'))
  assert.ok(md.includes('## 视频信息'))
  assert.ok(md.includes('| 时长 | 12:34 |'))
  assert.ok(md.includes('## 关键数字'))
  assert.ok(md.includes('| 0.01 | 常用初始值 |'))
  assert.ok(md.includes('## 核心概念'))
  assert.ok(md.includes('**学习率** — 更新步长（别称：步长）'))
  assert.ok(md.includes('## 我的补充'))
  assert.ok(md.includes('<!-- MANUAL:START -->'))
})

test('renderVideoNote skips empty optional sections', () => {
  const md = renderVideoNote({
    title: '只有标题',
    subject: '常识',
    summary: '一句',
    keyPoints: [],
    noteRoot: '课程知识地图',
  })
  assert.ok(!md.includes('## 关键数字'))
  assert.ok(!md.includes('## 核心概念'))
  assert.ok(!md.includes('> [!question]'))
})

test('mergeManualSection carries handwritten content into regenerated note', () => {
  const old = '# 旧\n\n## 我的补充\n\n<!-- MANUAL:START -->\n我自己的笔记\n第二行\n<!-- MANUAL:END -->\n'
  const next = renderVideoNote({ title: 'X', subject: 'Y', summary: 's', noteRoot: '课程知识地图' })
  const merged = mergeManualSection(old, next)
  assert.equal(extractManualSection(merged), '我自己的笔记\n第二行')
})

test('mergeManualSection leaves note untouched when nothing handwritten', () => {
  const next = renderVideoNote({ title: 'X', subject: 'Y', summary: 's', noteRoot: '课程知识地图' })
  assert.equal(mergeManualSection('# 没有手写区', next), next)
})

test('renderVideoNote adds nested concept tags to frontmatter', () => {
  const md = renderVideoNote({
    title: '标签测试',
    subject: '写作',
    summary: 's',
    concepts: [{ name: '责任前置', brief: '先认错' }, { name: '被动 语态', brief: '稀释责任' }],
    noteRoot: '课程知识地图',
  })
  assert.ok(md.includes('"概念/责任前置"'))
  assert.ok(md.includes('"概念/被动语态"'))
})

test('renderVideoNote renders cover image after info table', () => {
  const md = renderVideoNote({
    title: '封面测试',
    subject: '写作',
    summary: 's',
    cover: 'https://example.com/c.jpg',
    noteRoot: '课程知识地图',
  })
  assert.ok(md.includes('![封面|360](https://example.com/c.jpg)'))
  assert.ok(md.includes('cover: https://example.com/c.jpg') || md.includes('cover: "https://example.com/c.jpg"'))
})
