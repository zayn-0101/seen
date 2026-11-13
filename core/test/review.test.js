import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWeeklyReview, isoWeek, weekLabel, weekRange } from '../lib/review.js'

test('isoWeek maps dates to ISO weeks', () => {
  assert.deepEqual(isoWeek(new Date(2026, 10, 16)), { year: 2026, week: 47 })
  assert.deepEqual(isoWeek(new Date(2026, 0, 4)), { year: 2026, week: 1 })
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 })
})

test('weekRange starts on Monday and ends on Sunday', () => {
  const { start, end } = weekRange(2026, 47)
  assert.equal(start.getDay(), 1)
  assert.equal(end.getDay(), 0)
  assert.equal(end.getTime() - start.getTime(), 7 * 86400000 - 1)
})

test('weekLabel pads the week number', () => {
  assert.equal(weekLabel(2026, 7), '2026-W07')
  assert.equal(weekLabel(2026, 47), '2026-W47')
})

test('buildWeeklyReview filters by week and groups by day', () => {
  const now = new Date(2026, 10, 18)
  const { start } = weekRange(2026, 47)
  const day = 86400000
  const videos = [
    { title: '周一视频', subject: '语言文化', source: 'bilibili', notePath: '课程知识地图/语言文化/a.md', createdAt: start.getTime() + 3600000, keywords: ['汉字'] },
    { title: '周三视频', subject: '人工智能', source: 'douyin', notePath: '课程知识地图/人工智能/b.md', createdAt: start.getTime() + 2 * day + 3600000, keywords: ['模型'] },
    { title: '上周视频', subject: '语言文化', source: 'bilibili', createdAt: start.getTime() - day },
  ]
  const review = buildWeeklyReview({ videos, now })
  assert.equal(review.label, '2026-W47')
  assert.equal(review.count, 2)
  assert.match(review.markdown, /新增 2 个视频，覆盖 2 个学科/)
  assert.match(review.markdown, /来源：B站 1 · 抖音 1/)
  assert.match(review.markdown, /### 11-16 周一/)
  assert.match(review.markdown, /\[\[课程知识地图\/语言文化\/a\|周一视频\]\]/)
  assert.match(review.markdown, /关键词/)
  assert.match(review.markdown, /汉字/)
  assert.doesNotMatch(review.markdown, /上周视频/)
})

test('buildWeeklyReview handles empty weeks', () => {
  const review = buildWeeklyReview({ videos: [], now: new Date(2026, 10, 18) })
  assert.equal(review.count, 0)
  assert.match(review.markdown, /本周没有新增视频笔记/)
  assert.doesNotMatch(review.markdown, /## 按天记录/)
})

test('buildWeeklyReview survives malformed rows', () => {
  const review = buildWeeklyReview({ videos: [null, { title: 'x' }, { createdAt: 'bad' }], now: new Date(2026, 10, 18) })
  assert.equal(review.count, 0)
})
