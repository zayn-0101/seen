import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NOTE_FORMAT,
  checkIndexLinks,
  checkNoteLinks,
  checkNoteShape,
  checkSegments,
  checkSummaryShape,
  clockSeconds,
  parseNoteMarkdown,
  splitFrontmatter,
  summarizeFindings,
} from '../lib/note-check.js'

function noteMarkdown(overrides = {}) {
  const tags = overrides.tags ?? ['知识管理', '笔记工具', '效率软件', '类型/教程', '概念/Obsidian']
  const frontmatter = [
    '---',
    'title: "测试笔记"',
    'subject: "知识管理"',
    'source: "bilibili"',
    'url: "https://www.bilibili.com/video/BV1test00001"',
    'created: "2026-11-15 10:00"',
    `tags: ${JSON.stringify(tags)}`,
    'contentQuality: "transcript"',
    'contentType: "tutorial"',
    'quality: 4',
    'type: "video-note"',
    'format: ' + (overrides.format ?? NOTE_FORMAT),
    '---',
    '',
  ].join('\n')
  const chapters = overrides.chapters ?? [
    '## 章节',
    '',
    '- [00:00](https://www.bilibili.com/video/BV1test00001?t=0) 开场',
    '- [03:20](https://www.bilibili.com/video/BV1test00001?t=200) 中段',
    '',
  ]
  return [
    frontmatter,
    '## 视频信息',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 时长 | 10:00 |',
    '',
    '## 关键数字',
    '',
    '| 数字 | 说明 |',
    '| --- | --- |',
    '| 3 条 | 原则数量 |',
    '',
    ...chapters,
    '## 核心知识点',
    '',
    '### 要点一',
    '',
    '- 细节',
    '',
    '## 核心概念',
    '',
    '- **Obsidian** ^concept-obsidian',
    '- **双向链接**（别称：backlink） ^concept-backlink',
    '',
    '## 相关笔记',
    '',
    '- [[视频笔记/笔记/知识管理/另一篇|另一篇]] — 共同概念：Obsidian',
    '',
    '## 弹幕与评论讨论焦点',
    '',
    '1. 讨论一',
    '',
    '## 我的补充',
    '',
    '<!-- MANUAL:START -->',
    '<!-- MANUAL:END -->',
    '',
    '[[视频笔记/资料/手册/知识管理|知识管理 学习手册]]',
    '',
    '## 来源统计',
    '',
    '<details>',
    '<summary>展开技术细节</summary>',
    '',
    '- 链接：https://www.bilibili.com/video/BV1test00001',
    '',
    '</details>',
    '',
  ].join('\n')
}

const codes = (findings) => findings.map((item) => item.code)
const exists = () => true

test('parseNoteMarkdown reads frontmatter, tags, duration and sections', () => {
  const note = parseNoteMarkdown(noteMarkdown())
  assert.equal(note.title, '测试笔记')
  assert.equal(note.subject, '知识管理')
  assert.equal(note.source, 'bilibili')
  assert.equal(note.format, NOTE_FORMAT)
  assert.deepEqual(note.tags, ['知识管理', '笔记工具', '效率软件', '类型/教程', '概念/Obsidian'])
  assert.equal(note.duration, 600)
  assert.ok(note.sectionTitles.includes('核心概念'))
  assert.equal(note.conceptEntries.length, 2)
  assert.equal(note.conceptEntries[0].hasBlockId, true)
  assert.equal(note.manualLinkTarget, '视频笔记/资料/手册/知识管理')
  assert.equal(note.manualMarkersOk, true)
  assert.equal(note.detailsOk, true)
  assert.deepEqual(note.relatedLinks, ['视频笔记/笔记/知识管理/另一篇'])
})

test('splitFrontmatter and clockSeconds handle edge cases', () => {
  assert.deepEqual(splitFrontmatter('no frontmatter'), { frontmatter: '', body: 'no frontmatter' })
  assert.equal(clockSeconds('00:05'), 5)
  assert.equal(clockSeconds('1:02:03'), 3723)
  assert.equal(clockSeconds(''), 0)
})

test('checkNoteShape accepts a well-formed current note', () => {
  const note = parseNoteMarkdown(noteMarkdown())
  assert.deepEqual(checkNoteShape(note), [])
  assert.deepEqual(checkNoteLinks(note, { exists }), [])
})

test('legacy notes degrade structural findings to warnings', () => {
  const legacy = [
    '---',
    'title: "旧笔记"',
    'subject: "知识管理"',
    'source: "bilibili"',
    'tags: ["知识管理", "笔记工具"]',
    'type: "video-note"',
    '---',
    '',
    '## 视频信息',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 时长 | 10:00 |',
    '',
    '## 核心知识点',
    '',
    '### 要点一',
    '',
    '## 思维导图',
    '',
    '```mermaid',
    'mindmap',
    '  root((旧))',
    '```',
    '',
    '## 来源统计',
    '',
    '<details><summary>展开</summary></details>',
    '',
  ].join('\n')
  const findings = checkNoteShape(parseNoteMarkdown(legacy))
  assert.ok(findings.length > 0)
  assert.equal(findings.every((item) => item.level === 'warn'), true)
  assert.ok(codes(findings).includes('missing-section'))
})

test('missing required section or wrong section order is an error', () => {
  const missing = noteMarkdown().replace(/## 核心知识点[\s\S]*?(?=## 核心概念)/, '')
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(missing))).includes('missing-section'))

  const swapped = noteMarkdown()
    .replace('## 核心知识点', '@@A@@')
    .replace('## 核心概念', '## 核心知识点')
    .replace('@@A@@', '## 核心概念')
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(swapped))).includes('section-order'))
})

test('dirty tags, bare type words and non-subject first tag are rejected', () => {
  const dirty = checkNoteShape(parseNoteMarkdown(noteMarkdown({ tags: ['知识管理', '视频课程', '教程', '类型/教程'] })))
  assert.ok(codes(dirty).includes('tag-dirty'))
  assert.ok(codes(dirty).includes('tag-bare-type'))

  const wrongFirst = checkNoteShape(parseNoteMarkdown(noteMarkdown({ tags: ['笔记工具', '知识管理', '类型/教程'] })))
  assert.ok(codes(wrongFirst).includes('tag-subject-first'))

  const tooLong = checkNoteShape(parseNoteMarkdown(noteMarkdown({ tags: ['知识管理', '这是一个特别长的主题标签', '类型/教程'] })))
  assert.ok(codes(tooLong).includes('theme-length'))

  const unknownType = checkNoteShape(parseNoteMarkdown(noteMarkdown({ tags: ['知识管理', '笔记工具', '类型/不存在'] })))
  assert.ok(codes(unknownType).includes('type-unknown'))
})

test('concept tags must match 核心概念 entries and carry block ids', () => {
  const mismatch = noteMarkdown().replace('概念/Obsidian', '概念/不存在的概念')
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(mismatch))).includes('concept-tag-mismatch'))

  const noBlock = noteMarkdown().replace('- **Obsidian** ^concept-obsidian', '- **Obsidian**（别称：黑曜石）')
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(noBlock))).includes('concept-block-id'))
})

test('concept matching tolerates spaces and legacy concept drift only warns', () => {
  const spaced = noteMarkdown()
    .replace('- **Obsidian** ^concept-obsidian', '- **30 帧** ^concept-30')
    .replace('概念/Obsidian', '概念/30帧')
  assert.ok(!codes(checkNoteShape(parseNoteMarkdown(spaced))).includes('concept-tag-mismatch'))

  const legacy = noteMarkdown({ format: 0 })
    .replace('概念/Obsidian', '概念/仓库')
    .replace('- **Obsidian** ^concept-obsidian', '- **双向链接** ^concept-backlink')
  const findings = checkNoteShape(parseNoteMarkdown(legacy))
  const mismatch = findings.find((item) => item.code === 'concept-tag-mismatch')
  assert.ok(mismatch)
  assert.equal(mismatch.level, 'warn')
})

test('chapter timestamps must ascend and carry t= on bilibili', () => {
  const outOfOrder = noteMarkdown({ chapters: ['## 章节', '', '- [05:00](https://x?t=300) 后', '- [01:00](https://x?t=60) 前', ''] })
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(outOfOrder))).includes('chapter-order'))

  const noTime = noteMarkdown({ chapters: ['## 章节', '', '- [00:00](https://www.bilibili.com/video/BV1test00001) 开场', ''] })
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(noTime))).includes('chapter-link'))

  const overflow = noteMarkdown({ chapters: ['## 章节', '', '- [59:00](https://x?t=3540) 超长', ''] })
  assert.ok(codes(checkNoteShape(parseNoteMarkdown(overflow))).includes('chapter-overflow'))
})

test('douyin notes must not carry t= in chapter links', () => {
  const markdown = noteMarkdown()
    .replace('source: "bilibili"', 'source: "douyin"')
    .replace('## 弹幕与评论讨论焦点', '## 弹幕与评论讨论焦点')
  const findings = checkNoteShape(parseNoteMarkdown(markdown))
  assert.ok(codes(findings).includes('chapter-link'))
})

test('checkNoteLinks reports broken related links, self links and manual links', () => {
  const note = parseNoteMarkdown(noteMarkdown())
  const broken = checkNoteLinks(note, { exists: () => false })
  assert.deepEqual(codes(broken).sort(), ['manual-broken', 'related-broken'].sort())

  const self = checkNoteLinks(note, { exists, selfPath: '视频笔记/笔记/知识管理/另一篇.md' })
  assert.deepEqual(codes(self), ['related-self'])
})

test('checkIndexLinks finds broken wiki links', () => {
  const good = checkIndexLinks('- [[视频笔记/笔记/知识管理/另一篇]]', { exists })
  assert.deepEqual(good, [])
  const bad = checkIndexLinks('- [[视频笔记/笔记/知识管理/缺失]]\n- [[视频笔记/资料/手册/知识管理|知识管理]]', { exists: (rel) => rel === '视频笔记/资料/手册/知识管理.md' })
  assert.deepEqual(codes(bad), ['index-broken'])
})

test('checkIndexLinks ignores the escaped pipe used in tables', () => {
  const markdown = '| 2026-11-26 | [[视频笔记/笔记/知识管理/另一篇\\|另一篇]] | 知识管理 |'
  const findings = checkIndexLinks(markdown, { exists })
  assert.deepEqual(findings, [])
})

test('checkSummaryShape enforces the whole summary contract', () => {
  const valid = {
    summary: '这一期讲了知识管理的三条核心原则，并演示了具体做法。',
    question: '个人知识库怎么搭？',
    answer: '先固定入口，再保持双向链接。',
    keyPoints: [{ title: '入口', points: ['每天从索引进入'] }],
    concepts: [{ name: '双向链接', brief: '互链' }],
    tags: { themes: ['笔记工具'], types: ['教程'] },
    numbers: [{ value: '3 条', note: '原则' }],
  }
  assert.deepEqual(checkSummaryShape(valid), [])

  const empty = checkSummaryShape(null)
  assert.ok(codes(empty).includes('summary-empty'))
  assert.ok(codes(empty).includes('summary-keypoints'))

  // 提示词允许「只是知识罗列」的视频把 question/answer 都留空
  const noQuestion = checkSummaryShape({ ...valid, question: '', answer: '' })
  assert.deepEqual(noQuestion, [])
  const halfQuestion = checkSummaryShape({ ...valid, answer: '' })
  assert.deepEqual(codes(halfQuestion), ['summary-qa'])

  const manyPoints = checkSummaryShape({ ...valid, keyPoints: new Array(21).fill({ title: '要点', points: ['x'] }) })
  assert.ok(codes(manyPoints).includes('summary-keypoints'))

  const broken = checkSummaryShape({
    summary: '太短',
    question: '',
    answer: '',
    keyPoints: [{ title: '', points: [] }],
    concepts: [{ name: '这个概念的标题实在是太长了' }],
    tags: { themes: ['a', 'b', 'c', 'd', 'e'], types: ['不存在'] },
    numbers: new Array(7).fill({ value: '1' }),
  })
  assert.ok(codes(broken).includes('summary-keypoints'))
  assert.ok(codes(broken).includes('summary-concepts'))
  assert.ok(codes(broken).includes('summary-themes'))
  assert.ok(codes(broken).includes('summary-types'))
  assert.ok(codes(broken).includes('summary-numbers'))
})

test('checkSegments validates count, order, titles and overflow', () => {
  const good = [
    { from: 0, content: '开场' },
    { from: 60, content: '中段' },
    { from: 180, content: '转折' },
    { from: 300, content: '收尾' },
  ]
  assert.deepEqual(checkSegments(good, { duration: 400 }), [])
  assert.deepEqual(codes(checkSegments([], { duration: 400 })), ['segment-empty'])
  assert.ok(codes(checkSegments(good.slice(0, 2))).includes('segment-count'))

  const bad = [
    { from: 0, content: '开场' },
    { from: 0, content: '开场' },
    { from: 900, content: '超出时长的段落标题' },
  ]
  const findings = checkSegments(bad, { duration: 400 })
  assert.ok(codes(findings).includes('segment-order'))
  assert.ok(codes(findings).includes('segment-title'))
  assert.ok(codes(findings).includes('segment-overflow'))
})

test('summarizeFindings groups by code and severity', () => {
  const summary = summarizeFindings([
    { code: 'a', level: 'error', message: '一' },
    { code: 'a', level: 'error', message: '二' },
    { code: 'b', level: 'warn', message: '三' },
  ])
  assert.equal(summary.errors.length, 2)
  assert.equal(summary.warnings.length, 1)
  assert.equal(summary.errorGroups[0].code, 'a')
  assert.equal(summary.errorGroups[0].count, 2)
})

test('format 3 rejects decorative leftovers from earlier layouts', () => {
  const decorated = noteMarkdown()
    .replace('type: "video-note"', 'type: "video-note"\ncover: "https://example.com/c.jpg"')
    .replace('## 核心知识点', '![封面|360](https://example.com/c.jpg)\n\n## 核心知识点')
    .replace('## 我的补充', '## 思维导图\n\n```mermaid\nmindmap\n  root((测试))\n```\n\n## 我的补充')
    .replace('### 要点一', '### 要点一 [00:10](https://www.bilibili.com/video/BV1test00001?t=10)（所属章节：开场）')
  const found = codes(checkNoteShape(parseNoteMarkdown(decorated)))
  assert.ok(found.includes('legacy-cover'))
  assert.ok(found.includes('legacy-mindmap'))
  assert.ok(found.includes('legacy-chapter-tag'))

  // 旧格式笔记里的封面只当历史遗留，不报当前格式的错误
  const legacy = noteMarkdown({ format: 2 }).replace('type: "video-note"', 'type: "video-note"\ncover: "https://example.com/c.jpg"')
  assert.ok(!codes(checkNoteShape(parseNoteMarkdown(legacy))).includes('legacy-cover'))
})

test('v5 notes parse Chinese properties, seen-meta and concept table', async () => {
  const { renderVideoNoteV5 } = await import('../lib/render.js')
  const md = renderVideoNoteV5({
    originalTitle: '原题 #话题',
    displayTitle: '原题',
    subject: '游戏产业',
    source: 'bilibili',
    url: 'https://www.bilibili.com/video/BV1check',
    bvid: 'BV1check',
    author: '作者',
    createdAt: '2026-11-18',
    updatedAt: '2026-11-26',
    duration: 2414,
    contentType: 'opinion',
    contentQuality: 'full',
    quality: 5,
    summary: '概述',
    question: '问题？',
    answer: '答案。',
    keyPoints: [{ title: '主题', points: ['要点'] }],
    numbers: [{ value: '1 个', meaning: '测试数字', time: 60 }],
    concepts: [{ name: '3A 游戏', brief: '营销标签', aliases: ['AAA'] }],
    terms: [{ name: '买断制', definition: '一次性付费' }],
    tags: ['游戏产业', '主机游戏', '行业趋势', '公司治理', '玩家体验'],
    noteRoot: '视频笔记',
  })
  const note = parseNoteMarkdown(md)
  assert.equal(note.format, 5)
  assert.equal(note.isV5, true)
  assert.equal(note.title, '原题 #话题')
  assert.equal(note.displayTitle, '原题')
  assert.equal(note.subject, '游戏产业')
  assert.equal(note.source, 'bilibili')
  assert.equal(note.duration, 2414)
  assert.deepEqual(note.sectionTitles, ['02 速览', '03 核心知识点', '04 核心概念与术语', '05 复习卡片', '06 我的补充'].map((item) => item.replace(/^\d+\s+/, '')))
  assert.ok(note.subsectionMap.has('关键数字'))
  assert.deepEqual(note.conceptEntries.map((item) => item.name), ['3A 游戏', '买断制'])
  assert.deepEqual(checkNoteShape(note), [])
})
