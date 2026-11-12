import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectSource, extractDouyinId } from '../lib/source.js'
import { parseRenderData } from '../lib/douyin.js'
import { seenKey } from '../lib/state.js'
import { renderVideoNote } from '../lib/render.js'

test('detectSource and Douyin ID parsing', () => {
  assert.equal(detectSource({ url: 'https://www.bilibili.com/video/BV1REx46NEc4' }), 'bilibili')
  assert.equal(detectSource({ url: 'https://www.douyin.com/jingxuan?modal_id=7699902138868059392' }), 'douyin')
  assert.equal(detectSource({ title: '某个长视频 - 抖音' }), 'douyin')
  assert.equal(extractDouyinId('https://www.douyin.com/jingxuan?modal_id=7699902138868059392'), '7699902138868059392')
  assert.equal(extractDouyinId('https://www.douyin.com/video/7699902138868059392'), '7699902138868059392')
})

test('seenKey prefers platform video id', () => {
  assert.equal(seenKey({ videoId: '7699902138868059392', source: 'douyin', title: 'x' }), 'douyin:7699902138868059392')
  assert.equal(seenKey({ bvid: 'BV1REx46NEc4', title: 'x' }), 'bvid:BV1REx46NEc4')
})

test('parseRenderData extracts videoDetail', () => {
  const detail = { awemeId: '1234567890123', itemTitle: '标题', desc: '描述', video: { duration: 2868245, playAddr: [{ src: 'https://example.com/v.mp4' }] }, authorInfo: { nickname: '作者' }, stats: { commentCount: 10 }, danmakuControl: { danmakuCnt: 20 }, textExtra: [{ hashtagName: '标签' }] }
  const data = { app: { videoDetail: detail } }
  const html = '<script id="RENDER_DATA">' + encodeURIComponent(JSON.stringify(data)) + '</script>'
  const parsed = parseRenderData(html)
  assert.equal(parsed.awemeId, '1234567890123')
  assert.equal(parsed.itemTitle, '标题')
})

test('renderVideoNote marks Douyin source and stats', () => {
  const note = renderVideoNote({
    title: '抖音长视频',
    subject: '历史',
    source: 'douyin',
    videoId: '7699902138868059392',
    url: 'https://www.douyin.com/video/7699902138868059392',
    author: '易中天',
    summary: '总结',
    keyPoints: [],
    discussion: [],
    fetchStats: { transcript: 100, totalComments: 10, totalDanmaku: 20, comments: 0, danmaku: 0, desc: 3, tags: 1 },
    contentSource: 'whisper',
    contentQuality: 'full',
    tags: ['视频课程', '抖音精选', '历史'],
  })
  assert.match(note, /source: "douyin"/)
  assert.match(note, /videoId: "7699902138868059392"/)
  assert.match(note, /Whisper/)
  assert.match(note, /抖音精选/)
})
