import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TAG_TYPES,
  normalizeTagName,
  normalizeThemes,
  normalizeTagTypes,
  mergeTags,
  buildTagVocabulary,
  rememberTags,
  buildTagIndex,
} from '../lib/tags.js'
import { buildTagIndexMarkdown } from '../lib/index-note.js'

test('normalizeTagName strips brackets, punctuation and fullwidth chars', () => {
  assert.equal(normalizeTagName('仓库（Vault）'), '仓库')
  assert.equal(normalizeTagName('全网最全！'), '全网最全')
  assert.equal(normalizeTagName('  #DeepSeek-Harness  '), 'DeepSeekHarness')
  assert.equal(normalizeTagName('（只有括号）'), '')
  assert.equal(TAG_TYPES.length, 8)
})

test('normalizeThemes drops generic words and merges containment', () => {
  assert.deepEqual(normalizeThemes(['视频', '知识管理', '个人知识管理', '干货']), ['个人知识管理'])
})

test('normalizeThemes caps at 4 and keeps latin names', () => {
  const themes = normalizeThemes(['人工智能', '游戏设计', '语言文化', 'Obsidian', '量子物理'])
  assert.equal(themes.length, 4)
  assert.ok(themes.includes('Obsidian'))
})

test('normalizeTagTypes only accepts the enum, capped at 2', () => {
  assert.deepEqual(normalizeTagTypes(['教程', '干货', '科普', '教程']), ['教程', '科普'])
  assert.deepEqual(normalizeTagTypes('评测,访谈'), ['评测', '访谈'])
})

test('mergeTags orders subject, themes, types, concepts', () => {
  const tags = mergeTags({
    subject: '知识管理',
    themes: ['知识管理', 'Obsidian'],
    types: ['教程'],
    concepts: [{ name: '双向链接' }, { name: '仓库（Vault）' }],
  })
  assert.deepEqual(tags, ['知识管理', 'Obsidian', '类型/教程', '概念/双向链接', '概念/仓库'])
})

test('buildTagVocabulary returns the most used terms first', () => {
  const state = { tagVocabulary: { 人工智能: 3, 游戏设计: 9, 语言文化: 0 } }
  assert.deepEqual(buildTagVocabulary(state, 2), ['游戏设计', '人工智能'])
  assert.deepEqual(buildTagVocabulary(null), [])
  assert.deepEqual(buildTagVocabulary({ tagVocabulary: ['bad'] }), [])
})

test('rememberTags counts themes and skips nested tags', () => {
  const state = {}
  rememberTags(state, ['知识管理', '概念/双向链接', '类型/教程'])
  rememberTags(state, ['知识管理'])
  assert.deepEqual(state.tagVocabulary, { 知识管理: 2 })
  assert.equal(rememberTags(null, ['x']), 0)
})

test('buildTagIndex groups tags by kind with counts', () => {
  const index = buildTagIndex([
    { title: 'A', notePath: 'p/A.md', subject: '知识管理', tags: ['知识管理', '类型/教程', '概念/双向链接'] },
    { title: 'B', notePath: 'p/B.md', subject: '知识管理', tags: ['知识管理'] },
  ])
  assert.equal(index[0].name, '知识管理')
  assert.equal(index[0].videos.length, 2)
  assert.equal(index[0].type, 'subject')
  assert.equal(index.find((item) => item.name === '概念/双向链接').type, 'concept')
  assert.equal(index.find((item) => item.name === '类型/教程').type, 'type')
})

test('buildTagIndexMarkdown renders sections and note links', () => {
  const markdown = buildTagIndexMarkdown(
    buildTagIndex([
      { title: 'A', notePath: 'p/A.md', subject: '知识管理', tags: ['知识管理', '类型/教程', '概念/双向链接'] },
    ]),
    { noteRoot: '视频笔记' }
  )
  assert.match(markdown, /## 学科/)
  assert.match(markdown, /## 类型/)
  assert.match(markdown, /## 概念/)
  // 该笔记没有裸主题标签，主题分区应整块省略
  assert.doesNotMatch(markdown, /## 主题/)
  assert.match(markdown, /笔记根目录：视频笔记/)
})
