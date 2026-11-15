import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeSummary } from '../lib/analyze.js'
import { defaultState, loadState } from '../lib/state.js'
import { renderVideoNote } from '../lib/render.js'

test('normalizeSummary normalises themes and types', () => {
  const result = normalizeSummary(
    { summary: '一句话', tags: { themes: ['人工智能', '人工智能', '教程'], types: ['教程', '纪录片'] } },
    '标题'
  )
  assert.deepEqual(result.tags, { themes: ['人工智能'], types: ['教程'] })
})

test('normalizeSummary falls back to empty tags when the model omits them', () => {
  const result = normalizeSummary({ summary: '一句话' }, '标题')
  assert.deepEqual(result.tags, { themes: [], types: [] })
  assert.deepEqual(normalizeSummary(null, '标题').tags, { themes: [], types: [] })
})

test('defaultState carries an empty tag vocabulary', () => {
  assert.deepEqual(defaultState().tagVocabulary, {})
})

test('loadState sanitises tag vocabulary entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-tags-'))
  const file = join(dir, 'state.json')
  try {
    writeFileSync(file, JSON.stringify({ tagVocabulary: { 知识管理: 3, 负数: -1, '': 2, 字符串: 'x' } }))
    assert.deepEqual(loadState(file).tagVocabulary, { 知识管理: 3 })
    writeFileSync(file, JSON.stringify({ tagVocabulary: ['bad'] }))
    assert.deepEqual(loadState(file).tagVocabulary, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('renderVideoNote writes four-layer tags without zero-information entries', () => {
  const note = renderVideoNote({
    title: '测试视频',
    subject: '知识管理',
    source: 'douyin',
    url: 'https://www.douyin.com/video/1',
    tags: ['知识管理', '类型/教程', '概念/双向链接'],
    concepts: [{ name: '双向链接', brief: '笔记之间互相引用' }],
  })
  const frontmatter = note.split('---')[1] || ''
  assert.match(frontmatter, /tags: \["知识管理","类型\/教程","概念\/双向链接"\]/)
  assert.ok(!frontmatter.includes('视频课程'))
  assert.ok(!frontmatter.includes('抖音精选'))
})

test('renderVideoNote still appends concept tags when the caller only passes themes', () => {
  const note = renderVideoNote({
    title: '测试视频',
    subject: '知识管理',
    source: 'bilibili',
    url: 'https://www.bilibili.com/video/BV1xx',
    tags: ['知识管理'],
    concepts: [{ name: '被动语态', brief: '' }],
  })
  assert.match(note, /"概念\/被动语态"/)
})
