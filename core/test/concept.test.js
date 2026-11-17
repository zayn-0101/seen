import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conceptKey, findRelatedVideos, buildConceptIndex } from '../lib/concept.js'

test('conceptKey strips punctuation, spaces and case', () => {
  assert.equal(conceptKey('责任前置'), '责任前置')
  assert.equal(conceptKey(' 责任 前置 '), '责任前置')
  assert.equal(conceptKey('Active Listening'), 'activelistening')
  assert.equal(conceptKey('责任前置（原则）'), '责任前置原则')
  assert.equal(conceptKey(''), '')
  assert.equal(conceptKey(null), '')
})

test('findRelatedVideos ranks by shared concepts then keywords', () => {
  const current = { title: 'A', bvid: 'BV1', concepts: ['责任前置', '信任重建'], keywords: ['沟通'] }
  const videos = [
    { title: '自己', bvid: 'BV1', notePath: 'x/自己.md', concepts: ['责任前置'] },
    { title: '两条概念', bvid: 'BV2', notePath: 'x/两条.md', concepts: ['责任 前置', '信任重建'] },
    { title: '一条概念', bvid: 'BV3', notePath: 'x/一条.md', concepts: ['责任前置'] },
    { title: '只有关键词', bvid: 'BV4', notePath: 'x/关键词.md', keywords: ['沟通'] },
    { title: '无关', bvid: 'BV5', notePath: 'x/无关.md', concepts: ['天体物理'] },
  ]
  const result = findRelatedVideos(current, videos)
  assert.equal(result.length, 3)
  assert.equal(result[0].title, '两条概念')
  assert.equal(result[1].title, '一条概念')
  assert.equal(result[2].title, '只有关键词')
  assert.ok(result[0].reason.includes('共同概念'))
  assert.ok(!result.some((item) => item.title === '自己'))
})

test('findRelatedVideos respects limit and empty input', () => {
  const current = { title: 'A', concepts: ['甲'] }
  const videos = Array.from({ length: 9 }, (_, i) => ({ title: 'v' + i, bvid: 'B' + i, concepts: ['甲'] }))
  assert.equal(findRelatedVideos(current, videos, { limit: 2 }).length, 2)
  assert.deepEqual(findRelatedVideos({ title: 'A', concepts: [] }, videos), [])
})

test('同一 B 站视频的不同分 P 可以互相关联，但不会关联自身', () => {
  const current = { title: '第二集', bvid: 'BV1aaaaaaaaa', page: 2, concepts: ['共同概念'] }
  const result = findRelatedVideos(current, [
    { title: '第一集', bvid: 'BV1aaaaaaaaa', page: 1, notePath: '示例/第一集.md', concepts: ['共同概念'] },
    { title: '第二集', bvid: 'BV1aaaaaaaaa', page: 2, notePath: '示例/第二集.md', concepts: ['共同概念'] },
  ])
  assert.deepEqual(result.map(row => row.title), ['第一集'])
})

test('buildConceptIndex groups videos by concept', () => {
  const index = buildConceptIndex([
    { title: 'v1', notePath: 'a/v1.md', subject: '写作', concepts: ['责任前置', '信任重建'] },
    { title: 'v2', notePath: 'a/v2.md', subject: '写作', concepts: ['责任 前置'] },
  ])
  assert.equal(index.length, 2)
  assert.equal(index[0].name, '责任前置')
  assert.equal(index[0].videos.length, 2)
})

test('findRelatedVideos matches concept aliases', () => {
  const current = { title: 'A', concepts: [{ name: '责任前置', aliases: ['先认错后解释'] }] }
  const videos = [{ title: '旧笔记', bvid: 'B9', notePath: 'a/old.md', concepts: ['先认错 后解释'] }]
  const result = findRelatedVideos(current, videos)
  assert.equal(result.length, 1)
  assert.equal(result[0].title, '旧笔记')
  assert.ok(result[0].reason.includes('共同概念'))
})
