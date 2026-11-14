import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildYoutubeChapters,
  buildYoutubeContent,
  parseYoutubeJson,
  pickYoutubeSubtitle,
  youtubeWatchUrl,
} from '../lib/youtube.js'
import { detectSource, extractYoutubeId, isYoutubeUrl, sourceLabel } from '../lib/source.js'
import { buildTimeLink, renderVideoNote } from '../lib/render.js'

const META_JSON = JSON.stringify({
  id: 'aircAruvnKk',
  title: 'But what is a neural network?',
  uploader: '3Blue1Brown',
  duration: 1120,
  description: 'This is the first video in a series.',
  tags: ['neural network', 'deep learning'],
  thumbnail: 'https://i.ytimg.com/vi/aircAruvnKk/maxresdefault.jpg',
  chapters: [
    { start_time: 67, title: 'Series preview' },
    { start_time: 0, title: 'Introduction example' },
  ],
  subtitles: { zh: [{ ext: 'vtt', url: 'https://example.com/zh.vtt' }], en: [{ ext: 'vtt', url: 'https://example.com/en.vtt' }] },
  automatic_captions: { 'zh-Hans': [{ ext: 'vtt' }], en: [{ ext: 'vtt' }] },
})

test('extractYoutubeId supports every URL shape', () => {
  assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=aircAruvnKk'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('https://youtu.be/aircAruvnKk?t=30'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('https://www.youtube.com/shorts/abc123XYZ_-'), 'abc123XYZ_-')
  assert.equal(extractYoutubeId('https://www.youtube.com/embed/aircAruvnKk'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('https://www.youtube.com/live/aircAruvnKk'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=aircAruvnKk&list=PL123'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('aircAruvnKk'), 'aircAruvnKk')
  assert.equal(extractYoutubeId('https://www.bilibili.com/video/BV1GJ411x7h7'), '')
  assert.equal(extractYoutubeId(''), '')
})

test('detectSource recognises YouTube without breaking other platforms', () => {
  assert.equal(detectSource({ url: 'https://www.youtube.com/watch?v=aircAruvnKk' }), 'youtube')
  assert.equal(detectSource({ url: 'https://youtu.be/aircAruvnKk' }), 'youtube')
  assert.equal(detectSource({ title: '线性代数 - YouTube' }), 'youtube')
  assert.equal(detectSource({ url: 'https://www.bilibili.com/video/BV1GJ411x7h7' }), 'bilibili')
  assert.equal(detectSource({ url: 'https://b23.tv/abc123' }), 'bilibili')
  assert.equal(detectSource({ url: 'https://www.douyin.com/video/7699902138868059392' }), 'douyin')
  assert.equal(detectSource({ url: 'https://example.com/' }), null)
  assert.equal(isYoutubeUrl('https://m.youtube.com/watch?v=aircAruvnKk'), true)
  assert.equal(isYoutubeUrl('https://notyoutube.com/watch?v=aircAruvnKk'), false)
  assert.equal(sourceLabel('youtube'), 'YouTube')
  assert.equal(youtubeWatchUrl('aircAruvnKk'), 'https://www.youtube.com/watch?v=aircAruvnKk')
})

test('parseYoutubeJson normalises yt-dlp output', () => {
  const meta = parseYoutubeJson(META_JSON)
  assert.equal(meta.videoId, 'aircAruvnKk')
  assert.equal(meta.title, 'But what is a neural network?')
  assert.equal(meta.author, '3Blue1Brown')
  assert.equal(meta.duration, 1120)
  assert.equal(meta.tags.length, 2)
  assert.equal(meta.thumbnail, 'https://i.ytimg.com/vi/aircAruvnKk/maxresdefault.jpg')
  assert.deepEqual(meta.chapters, [
    { from: 0, content: 'Introduction example' },
    { from: 67, content: 'Series preview' },
  ])
  assert.equal(typeof meta.subtitles, 'object')
  assert.equal(typeof meta.automaticCaptions, 'object')
})

test('parseYoutubeJson rejects unusable payloads', () => {
  assert.equal(parseYoutubeJson('not json'), null)
  assert.equal(parseYoutubeJson('{}'), null)
  assert.equal(parseYoutubeJson(null), null)
  assert.equal(parseYoutubeJson({ id: 'abc' }).videoId, 'abc')
})

test('pickYoutubeSubtitle prefers manual Chinese, then manual English, then auto', () => {
  assert.deepEqual(pickYoutubeSubtitle({ subtitles: { zh: [{}], en: [{}] }, automaticCaptions: {} }), { lang: 'zh', auto: false })
  assert.deepEqual(pickYoutubeSubtitle({ subtitles: { en: [{}] }, automaticCaptions: { 'zh-Hans': [{}] } }), { lang: 'en', auto: false })
  assert.deepEqual(pickYoutubeSubtitle({ subtitles: {}, automaticCaptions: { 'zh-Hans': [{}], en: [{}] } }), { lang: 'zh-Hans', auto: true })
  assert.deepEqual(pickYoutubeSubtitle({ subtitles: {}, automaticCaptions: { 'en-orig': [{}] } }), { lang: 'en-orig', auto: true })
  assert.equal(pickYoutubeSubtitle({ subtitles: {}, automaticCaptions: {} }), null)
  assert.equal(pickYoutubeSubtitle({}), null)
  // 只有各语言空数组时也应视为无字幕
  assert.equal(pickYoutubeSubtitle({ subtitles: { zh: [] }, automaticCaptions: {} }), null)
  // live_chat 是直播聊天回放，不能当字幕
  assert.equal(pickYoutubeSubtitle({ subtitles: { live_chat: [{}] }, automaticCaptions: {} }), null)
  assert.deepEqual(
    pickYoutubeSubtitle({ subtitles: { live_chat: [{}], en: [{}] }, automaticCaptions: {} }),
    { lang: 'en', auto: false }
  )
})

test('buildYoutubeChapters maps start_time and drops empty titles', () => {
  assert.deepEqual(buildYoutubeChapters([{ start_time: 90, title: 'B' }, { start_time: 10, title: 'A' }]), [
    { from: 10, content: 'A' },
    { from: 90, content: 'B' },
  ])
  assert.deepEqual(buildYoutubeChapters([{ start_time: 5, title: '  ' }]), [])
  assert.deepEqual(buildYoutubeChapters(null), [])
})

test('buildYoutubeContent mirrors the fetchContent shape', () => {
  const meta = parseYoutubeJson(META_JSON)
  const full = buildYoutubeContent({ meta, id: 'aircAruvnKk', transcript: '字幕内容', transcriptSource: 'youtube-subtitle' })
  assert.equal(full.source, 'youtube')
  assert.equal(full.platform, 'youtube')
  assert.equal(full.videoId, 'aircAruvnKk')
  assert.equal(full.bvid, null)
  assert.equal(full.url, 'https://www.youtube.com/watch?v=aircAruvnKk')
  assert.equal(full.author, '3Blue1Brown')
  assert.equal(full.transcript, '字幕内容')
  assert.equal(full.transcriptSource, 'youtube-subtitle')
  assert.equal(full.contentSource, 'youtube-subtitle')
  assert.equal(full.fetchStats.transcript, 4)
  assert.equal(full.fetchStats.danmaku, 0)
  assert.deepEqual(full.chapters.length, 2)

  const bare = buildYoutubeContent({ meta, id: 'aircAruvnKk', transcript: '', transcriptSource: '' })
  assert.equal(bare.transcriptSource, '')
  assert.equal(bare.contentSource, 'metadata')
})

test('renderVideoNote renders YouTube source, chapters and timestamp links', () => {
  const note = renderVideoNote({
    title: '神经网络是什么',
    subject: '机器学习',
    source: 'youtube',
    videoId: 'aircAruvnKk',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    author: '3Blue1Brown',
    summary: '讲解神经网络结构。',
    keyPoints: [{ title: '神经元', points: ['加权求和'], time: 162 }],
    chapters: [{ from: 0, content: '引入' }, { from: 67, content: '预览' }],
    fetchStats: { desc: 120, tags: 2, transcript: 5000, danmaku: 0, comments: 0, totalDanmaku: 0, totalComments: 0 },
    contentSource: 'youtube-subtitle',
    contentQuality: 'full',
  })
  assert.match(note, /source: "youtube"/)
  assert.match(note, /videoId: "aircAruvnKk"/)
  assert.match(note, /内容来源：YouTube 字幕/)
  assert.match(note, /YouTube 不提供弹幕/)
  assert.match(note, /&t=67s/)
  assert.match(note, /&t=162s/)
  assert.match(note, /- 章节：2 个/)
  assert.match(note, /- 评论：暂未抓取/)
  assert.match(note, /## 讨论焦点/)
  assert.doesNotMatch(note, /## 弹幕与评论讨论焦点/)
})

test('buildTimeLink supports bilibili and youtube only', () => {
  assert.equal(buildTimeLink('https://www.bilibili.com/video/BV1xx?p=2', 'bilibili', 45), 'https://www.bilibili.com/video/BV1xx?p=2&t=45')
  assert.equal(buildTimeLink('https://www.youtube.com/watch?v=abc', 'youtube', 45), 'https://www.youtube.com/watch?v=abc&t=45s')
  assert.equal(buildTimeLink('https://youtu.be/abc', 'youtube', 0), 'https://youtu.be/abc?t=0s')
  assert.equal(buildTimeLink('https://example.com/x', 'youtube', 5), '')
  assert.equal(buildTimeLink('https://www.bilibili.com/video/BV1xx', 'youtube', 5), '')
  assert.equal(buildTimeLink('https://www.youtube.com/watch?v=abc', 'douyin', 5), '')
  assert.equal(buildTimeLink('', 'youtube', 5), '')
})
