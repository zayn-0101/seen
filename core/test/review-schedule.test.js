import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REVIEW_RATINGS,
  collectReviews,
  dateKey,
  initialReview,
  isDue,
  nextReview,
  normalizeRating,
} from '../lib/review-schedule.js'

const DAY = 24 * 3600 * 1000

test('initialReview starts due today with zero reps', () => {
  const now = new Date(2026, 10, 16, 12, 0, 0).getTime()
  assert.deepEqual(initialReview(now), { due: '2026-11-16', interval: 0, ease: 2.5, reps: 0 })
})

test('easy advances along the 1/3/7/16/35 day ladder', () => {
  let review = initialReview(new Date(2026, 10, 16).getTime())
  const intervals = []
  let now = new Date(2026, 10, 16).getTime()
  for (let i = 0; i < 5; i += 1) {
    review = nextReview(review, 'easy', now)
    intervals.push(review.interval)
    now = new Date(review.due + 'T12:00:00').getTime()
  }
  assert.deepEqual(intervals, [1, 3, 7, 16, 35])
  assert.equal(review.reps, 5)
})

test('again resets to tomorrow and hard keeps at least 3 days', () => {
  const now = new Date(2026, 10, 16).getTime()
  const base = { due: '2026-11-16', interval: 10, ease: 2.5, reps: 3 }
  const again = nextReview(base, 'again', now)
  assert.equal(again.interval, 1)
  assert.equal(again.due, '2026-11-17')
  assert.equal(again.reps, 0)
  assert.equal(again.ease, 2.3)
  const hard = nextReview(base, 'hard', now)
  assert.equal(hard.interval, 15)
  assert.equal(hard.reps, 3)
  assert.equal(nextReview(initialReview(now), 'hard', now).interval, 3)
})

test('normalizeRating only accepts the three ratings', () => {
  assert.deepEqual(REVIEW_RATINGS, ['again', 'hard', 'easy'])
  assert.equal(normalizeRating('EASY'), 'easy')
  assert.equal(normalizeRating('good'), '')
})

test('isDue treats missing review as due and respects the date', () => {
  const now = new Date(2026, 10, 16).getTime()
  assert.equal(isDue(null, now), true)
  assert.equal(isDue({ due: '2026-11-16' }, now), true)
  assert.equal(isDue({ due: '2026-11-17' }, now), false)
  assert.equal(dateKey(now), '2026-11-16')
})

test('collectReviews sorts due rows and reports stats', () => {
  const now = new Date(2026, 10, 16).getTime()
  const videos = [
    { title: 'A', subject: '写作', quality: 4, notePath: 'a.md', review: { due: '2026-11-18', reps: 1 } },
    { title: 'B', subject: '写作', quality: 5, notePath: 'b.md', review: { due: '2026-11-16', reps: 0 } },
    { title: 'C', subject: '科技', quality: 3, notePath: 'c.md', review: { due: '2026-11-10', reps: 2 } },
  ]
  const result = collectReviews(videos, { now, limit: 10 })
  assert.deepEqual(result.due.map((row) => row.title), ['C', 'B'])
  assert.equal(result.stats.total, 3)
  assert.equal(result.stats.reviewed, 2)
  assert.equal(result.stats.due, 2)
  assert.equal(result.stats.averageQuality, 4)
  assert.equal(result.stats.subjects, 2)
  assert.equal(collectReviews(videos, { now, limit: 1 }).due.length, 1)
})
