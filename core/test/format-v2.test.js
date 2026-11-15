import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSummary, normalizeConcepts, normalizeNumbers } from '../lib/analyze.js'
import { renderVideoNote, mergeManualSection, extractManualSection, subjectManualAutoBody } from '../lib/render.js'
import { buildConceptIndexMarkdown } from '../lib/index-note.js'

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

test('normalizeConcepts caps at 6 and drops bracketed names', () => {
  const input = Array.from({ length: 20 }, (_, i) => `概念词${i}`)
  assert.equal(normalizeConcepts(input).length, 6)
  assert.deepEqual(
    normalizeConcepts(['仓库（Vault）', '双向链接', '双向 链接']).map((item) => item.name),
    ['双向链接']
  )
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
    noteRoot: '视频笔记',
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
    noteRoot: '视频笔记',
  })
  assert.ok(!md.includes('## 关键数字'))
  assert.ok(!md.includes('## 核心概念'))
  assert.ok(!md.includes('> [!question]'))
})

test('mergeManualSection carries handwritten content into regenerated note', () => {
  const old = '# 旧\n\n## 我的补充\n\n<!-- MANUAL:START -->\n我自己的笔记\n第二行\n<!-- MANUAL:END -->\n'
  const next = renderVideoNote({ title: 'X', subject: 'Y', summary: 's', noteRoot: '视频笔记' })
  const merged = mergeManualSection(old, next)
  assert.equal(extractManualSection(merged), '我自己的笔记\n第二行')
})

test('mergeManualSection leaves note untouched when nothing handwritten', () => {
  const next = renderVideoNote({ title: 'X', subject: 'Y', summary: 's', noteRoot: '视频笔记' })
  assert.equal(mergeManualSection('# 没有手写区', next), next)
})

test('renderVideoNote stamps the note format version', () => {
  const md = renderVideoNote({ title: '格式版本', subject: '写作', summary: 's', noteRoot: '视频笔记' })
  assert.match(md, /^format: 2$/m)
  assert.match(md, /^type: "video-note"$/m)
})

test('renderVideoNote adds nested concept tags to frontmatter', () => {
  const md = renderVideoNote({
    title: '标签测试',
    subject: '写作',
    summary: 's',
    concepts: [{ name: '责任前置', brief: '先认错' }, { name: '被动 语态', brief: '稀释责任' }],
    noteRoot: '视频笔记',
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
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('![封面|360](https://example.com/c.jpg)'))
  assert.ok(md.includes('cover: https://example.com/c.jpg') || md.includes('cover: "https://example.com/c.jpg"'))
})

test('renderVideoNote renders related notes with wiki links', () => {
  const md = renderVideoNote({
    title: '当前视频',
    subject: '写作',
    summary: 's',
    noteRoot: '视频笔记',
    relatedNotes: [
      { title: '旧视频', notePath: '视频笔记/写作/旧视频.md', reason: '共同概念：责任前置' },
      { title: '无路径视频', notePath: '', reason: '' },
    ],
  })
  assert.ok(md.includes('## 相关笔记'))
  assert.ok(md.includes('[[视频笔记/写作/旧视频|旧视频]] — 共同概念：责任前置'))
  assert.ok(md.includes('- 无路径视频'))
})

test('buildConceptIndexMarkdown lists concepts with note links', () => {
  const md = buildConceptIndexMarkdown([
    { name: '责任前置', videos: [{ title: '视频A', notePath: '视频笔记/写作/视频A.md' }] },
    { name: '空概念', videos: [] },
  ])
  assert.ok(md.includes('### 责任前置'))
  assert.ok(md.includes('[[视频笔记/写作/视频A|视频A]]'))
  assert.ok(!md.includes('空概念'))
})

test('subjectManualAutoBody lists core concepts with counts', () => {
  const body = subjectManualAutoBody({
    subject: '写作',
    videos: [
      { title: '甲', notePath: 'a/甲.md', concepts: ['责任前置'] },
      { title: '乙', notePath: 'a/乙.md', concepts: ['责任 前置'] },
      { title: '丙', notePath: 'a/丙.md' },
    ],
  })
  assert.ok(body.includes('## 本学科核心概念'))
  assert.ok(body.includes('**责任前置**（2）'))
})

test('subjectManualAutoBody skips concepts seen in only one video', () => {
  const body = subjectManualAutoBody({
    subject: '写作',
    videos: [
      { title: '甲', notePath: 'a/甲.md', concepts: ['只出现一次'] },
      { title: '乙', notePath: 'a/乙.md', concepts: ['只出现一次'] },
      { title: '丙', notePath: 'a/丙.md', concepts: ['孤例'] },
    ],
  })
  assert.ok(body.includes('**只出现一次**（2）'))
  assert.ok(!body.includes('孤例'))
})

test('subjectManualAutoBody omits the section when no concept repeats', () => {
  const body = subjectManualAutoBody({
    subject: '写作',
    videos: [{ title: '甲', notePath: 'a/甲.md', concepts: ['独一份'] }],
  })
  assert.ok(!body.includes('本学科核心概念'))
})
