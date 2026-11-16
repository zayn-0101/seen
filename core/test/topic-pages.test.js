import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConceptPageMarkdown,
  buildTopicPageMarkdown,
  collectConceptPages,
  collectTopicPages,
} from '../lib/topic-pages.js'

const history = [
  {
    title: '第一篇',
    subject: '知识管理',
    notePath: '视频笔记/笔记/知识管理/第一篇.md',
    tags: ['知识管理', '笔记工具', '类型/教程'],
    concepts: ['双向链接', '卡片笔记'],
    conceptDetails: [
      { name: '双向链接', brief: '两条笔记互相指向' },
      { name: '卡片笔记', brief: '一张卡片一个想法' },
    ],
  },
  {
    title: '第二篇',
    subject: '知识管理',
    notePath: '视频笔记/笔记/知识管理/第二篇.md',
    tags: ['知识管理', '笔记工具', '效率'],
    concepts: ['双向链接'],
    conceptDetails: [{ name: '双向链接', brief: '两条笔记互相指向' }],
  },
  {
    title: '第三篇',
    subject: '科技评论',
    notePath: '视频笔记/笔记/科技评论/第三篇.md',
    tags: ['科技评论', '笔记工具'],
    concepts: ['双向链接', '开放世界'],
    conceptDetails: [{ name: '开放世界', brief: '可自由探索的游戏世界' }],
  },
]

test('collectConceptPages keeps concepts seen in at least two notes', () => {
  const pages = collectConceptPages(history)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].name, '双向链接')
  assert.equal(pages[0].definition, '两条笔记互相指向')
  assert.equal(pages[0].videos.length, 3)
  assert.deepEqual(pages[0].related, [])
})

test('collectConceptPages accepts a custom threshold and drops low-frequency concepts', () => {
  const pages = collectConceptPages(history, { minVideos: 3 })
  assert.equal(pages.length, 1)
  assert.equal(collectConceptPages(history, { minVideos: 4 }).length, 0)
})

test('collectTopicPages uses theme tags and ignores subject and type tags', () => {
  const pages = collectTopicPages(history)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].name, '笔记工具')
  assert.equal(pages[0].videos.length, 3)
  assert.deepEqual(pages[0].concepts.map((item) => item.name), ['双向链接', '卡片笔记', '开放世界'])
})

test('buildConceptPageMarkdown renders definition, notes and related concepts', () => {
  const markdown = buildConceptPageMarkdown({
    name: '双向链接',
    definition: '两条笔记互相指向',
    videos: history.slice(0, 2),
    related: [{ name: '卡片笔记', count: 1 }],
    noteRoot: '视频笔记',
  })
  assert.match(markdown, /## 概念释义/)
  assert.match(markdown, /两条笔记互相指向/)
  assert.match(markdown, /\[\[视频笔记\/笔记\/知识管理\/第一篇\|第一篇\]\]/)
  assert.match(markdown, /\[\[视频笔记\/概念\/卡片笔记\|卡片笔记\]\] · 共同出现 1 次/)
})

test('buildTopicPageMarkdown renders overview, notes and concepts', () => {
  const markdown = buildTopicPageMarkdown({
    name: '笔记工具',
    videos: history,
    concepts: [{ name: '双向链接', count: 3 }],
    noteRoot: '视频笔记',
  })
  assert.match(markdown, /共 3 篇视频笔记/)
  assert.match(markdown, /## 视频笔记/)
  assert.match(markdown, /\[\[视频笔记\/概念\/双向链接\|双向链接\]\] · 出现 3 次/)
})
