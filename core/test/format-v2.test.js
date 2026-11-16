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

  const meta = normalizeNumbers([
    { value: '12:19', meaning: '视频总时长' },
    { value: '150 条', meaning: '本次收集到的观众弹幕数量' },
    { value: '37 MB', meaning: '安装包体积' },
    { value: '40 字', meaning: '每句标题上限' },
  ])
  assert.deepEqual(meta.map((item) => item.value), ['40 字'])
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
  assert.match(md, /^format: 4$/m)
  assert.match(md, /^type: "video-note"$/m)
})

test('renderVideoNote adds nested concept tags to frontmatter', () => {
  const md = renderVideoNote({
    title: '标签测试',
    subject: '写作',
    summary: 's',
    contentQuality: 'full',
    concepts: [{ name: '责任前置', brief: '先认错' }, { name: '被动 语态', brief: '稀释责任' }],
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('"概念/责任前置"'))
  assert.ok(md.includes('"概念/被动语态"'))
})

test('renderVideoNote no longer stamps cover or mindmap', () => {
  const md = renderVideoNote({
    title: '去装饰测试',
    subject: '写作',
    summary: 's',
    cover: 'https://example.com/c.jpg',
    noteRoot: '视频笔记',
  })
  assert.ok(!md.includes('![封面'))
  assert.ok(!md.includes('cover:'))
  assert.ok(!md.includes('## 思维导图'))
  assert.ok(!md.includes('所属章节：'))
})

test('metadata-only notes skip concepts and numbers even when supplied', () => {
  const md = renderVideoNote({
    title: '元数据版',
    subject: '写作',
    summary: '未获取到完整视频内容，信息有限',
    contentQuality: 'metadata-only',
    concepts: [{ name: '责任前置', brief: '先认错' }],
    numbers: [{ value: '100 万', meaning: '播放量' }],
    noteRoot: '视频笔记',
  })
  assert.ok(!md.includes('## 关键数字'))
  assert.ok(!md.includes('## 核心概念'))
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

test('renderVideoNote renders tutorial template with step time links', () => {
  const md = renderVideoNote({
    title: '教程测试',
    subject: '写作',
    summary: '一篇教程',
    url: 'https://www.bilibili.com/video/BV1test00002',
    platform: 'bilibili',
    contentQuality: 'full',
    contentType: 'tutorial',
    template: {
      prerequisites: ['装好 Node'],
      steps: [{ text: '打开终端', time: 12 }, { text: '运行命令', time: 75 }],
    },
    noteRoot: '视频笔记',
  })
  assert.match(md, /^contentType: "tutorial"$/m)
  assert.match(md, /^quality: [1-5]$/m)
  assert.ok(md.includes('## 前置条件'))
  assert.ok(md.includes('- 装好 Node'))
  assert.ok(md.includes('## 操作步骤'))
  assert.ok(md.includes('1. [00:12](https://www.bilibili.com/video/BV1test00002?t=12) 打开终端'))
  assert.ok(md.includes('2. [01:15](https://www.bilibili.com/video/BV1test00002?t=75) 运行命令'))
})

test('renderVideoNote renders opinion arguments table and doubts', () => {
  const md = renderVideoNote({
    title: '观点测试',
    subject: '科技评论',
    summary: '一篇观点',
    contentQuality: 'full',
    contentType: 'opinion',
    template: {
      arguments: [{ claim: '该换工具', basis: '旧工具太慢' }],
      doubts: ['样本只有一台机器'],
    },
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('## 论证结构'))
  assert.ok(md.includes('| 论点 | 依据 |'))
  assert.ok(md.includes('| 该换工具 | 旧工具太慢 |'))
  assert.ok(md.includes('## 可质疑之处'))
  assert.ok(md.includes('- 样本只有一台机器'))
})

test('renderVideoNote writes review state and spaced repetition cards', () => {
  const md = renderVideoNote({
    title: '复习测试',
    subject: '写作',
    summary: 's',
    question: '为什么要复习',
    answer: '因为会忘',
    keyPoints: [{ title: '间隔重复', points: ['按间隔安排复习'] }],
    contentQuality: 'full',
    review: { due: '2026-11-16', interval: 0, ease: 2.5, reps: 0 },
    noteRoot: '视频笔记',
  })
  assert.match(md, /^review: \{"due":"2026-11-16","interval":0,"ease":2.5,"reps":0\}$/m)
  assert.ok(md.includes('## 复习卡片'))
  assert.ok(md.includes('为什么要复习::因为会忘'))
  assert.ok(md.includes('间隔重复::按间隔安排复习'))
  const plain = renderVideoNote({ title: '无复习', subject: '写作', summary: 's', noteRoot: '视频笔记' })
  assert.ok(!/^review:/m.test(plain))
  assert.ok(!plain.includes('## 复习卡片'))
})

test('renderVideoNote renders key point times, quotes, terms and resources', () => {
  const md = renderVideoNote({
    title: '内容丰富测试',
    subject: '写作',
    summary: '一篇内容丰富的视频',
    url: 'https://www.bilibili.com/video/BV1test00003',
    platform: 'bilibili',
    contentQuality: 'full',
    contentType: 'science',
    keyPoints: [{ title: '机制', time: 30, points: [{ text: '因为这样', time: 45 }, { text: '所以那样' }] }],
    quotes: [{ text: '原话一句', time: 100 }],
    terms: [{ name: '闭包', definition: '函数与其词法环境的组合' }],
    resources: [{ name: 'MDN', note: '查文档' }],
    noteRoot: '视频笔记',
  })
  assert.ok(md.includes('- [00:45](https://www.bilibili.com/video/BV1test00003?t=45) 因为这样'))
  assert.ok(md.includes('- 所以那样'))
  assert.ok(md.includes('## 原话摘录'))
  assert.ok(md.includes('> [01:40](https://www.bilibili.com/video/BV1test00003?t=100) 原话一句'))
  assert.ok(md.includes('## 术语表'))
  assert.ok(md.includes('| 闭包 | 函数与其词法环境的组合 |'))
  assert.ok(md.includes('## 提到的资源'))
  assert.ok(md.includes('- **MDN** — 查文档'))
})
