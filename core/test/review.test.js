import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('weekRange follows local calendar days across daylight saving changes', () => {
  const moduleUrl = new URL('../lib/review.js', import.meta.url).href
  const script = `import { weekRange } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([10, 44].map(week => {
      const { start, end } = weekRange(2026, week);
      const next = new Date(end.getTime() + 1);
      return [start.getDay(), start.getHours(), end.getDay(), end.getHours(), end.getMinutes(), next.getDay(), next.getHours()];
    })))`
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  })
  assert.deepEqual(JSON.parse(output), [[1, 0, 0, 23, 59, 1, 0], [1, 0, 0, 23, 59, 1, 0]])
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
    { title: '周一视频', subject: '语言文化', source: 'bilibili', notePath: '视频笔记/语言文化/a.md', createdAt: start.getTime() + 3600000, keywords: ['汉字'] },
    { title: '周三视频', subject: '人工智能', source: 'douyin', notePath: '视频笔记/人工智能/b.md', createdAt: start.getTime() + 2 * day + 3600000, keywords: ['模型'] },
    { title: '上周视频', subject: '语言文化', source: 'bilibili', createdAt: start.getTime() - day },
  ]
  const review = buildWeeklyReview({ videos, now })
  assert.equal(review.label, '2026-W47')
  assert.equal(review.count, 2)
  assert.match(review.markdown, /新增 2 个视频，覆盖 2 个学科/)
  assert.match(review.markdown, /来源：B站 1 · 抖音 1/)
  assert.match(review.markdown, /### 11-16 周一/)
  assert.match(review.markdown, /\[\[视频笔记\/语言文化\/a\|周一视频\]\]/)
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

test('buildWeeklyReview adds review status and learning stats', () => {
  const now = new Date(2026, 10, 18)
  const { start } = weekRange(2026, 47)
  const videos = [
    { title: '本周视频', subject: '写作', source: 'bilibili', notePath: '视频笔记/写作/a.md', createdAt: start.getTime() + 3600000, quality: 4, contentType: 'tutorial', review: { due: '2026-11-18', interval: 1, ease: 2.5, reps: 1 } },
    { title: '旧视频', subject: '写作', source: 'bilibili', notePath: '视频笔记/写作/b.md', createdAt: start.getTime() - 9 * 86400000, quality: 2, contentType: 'opinion', review: { due: '2026-11-01', interval: 3, ease: 2.4, reps: 2 } },
  ]
  const review = buildWeeklyReview({ videos, now })
  assert.match(review.markdown, /## 复习情况/)
  assert.match(review.markdown, /已复习 2 篇 · 待复习 2 篇/)
  assert.match(review.markdown, /本周优先：\[\[视频笔记\/写作\/a\|本周视频\]\]/)
  assert.match(review.markdown, /## 学习统计/)
  assert.match(review.markdown, /平均质量分：3 \/ 5/)
  assert.match(review.markdown, /内容类型：tutorial 1 · opinion 1/)
})

test('buildWeeklyReview survives malformed rows', () => {
  const review = buildWeeklyReview({ videos: [null, { title: 'x' }, { createdAt: 'bad' }], now: new Date(2026, 10, 18) })
  assert.equal(review.count, 0)
})

test('库里积压超过 100 篇旧笔记时本周仍能列出到期笔记', () => {
  const now = new Date(2026, 10, 18, 12)
  const old = Array.from({ length: 110 }, (_, n) => ({
    title: '历史' + n, notePath: '历史/' + n + '.md', createdAt: new Date(2026, 9, 1).getTime(), review: { due: '2026-10-02' },
  }))
  const current = { title: '本周新笔记', notePath: '本周/新笔记.md', createdAt: now.getTime(), review: { due: '2026-11-18' } }
  const result = buildWeeklyReview({ now, videos: [...old, current] })
  assert.match(result.markdown, /本周优先：.*本周新笔记/)
  assert.match(result.markdown, /待复习 111 篇/)
})
