import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignSubject, sharedHanziRun } from '../lib/subject.js'

test('sharedHanziRun finds longest common run', () => {
  assert.equal(sharedHanziRun('物理学', '物理'), 2)
  assert.equal(sharedHanziRun('量子力学', '力学'), 2)
  assert.equal(sharedHanziRun('历史', '文学'), 0)
})

test('alignSubject keeps exact match', () => {
  const r = alignSubject('物理学', ['物理学', '历史'])
  assert.equal(r.subject, '物理学')
  assert.equal(r.reason, 'exact')
  assert.equal(r.merged, true)
})

test('alignSubject collapses narrower name into broader one', () => {
  const r = alignSubject('量子力学', ['力学', '历史'])
  assert.equal(r.subject, '力学')
  assert.equal(r.reason, 'contain')
})

test('alignSubject merges by shared hanzi run', () => {
  const r = alignSubject('物理学', ['物理', '化学'])
  assert.equal(r.subject, '物理')
})

test('alignSubject adds new broad subject when nothing matches', () => {
  const r = alignSubject('写作', ['物理学', '历史'])
  assert.equal(r.subject, '写作')
  assert.equal(r.reason, 'new')
  assert.equal(r.merged, false)
})

test('alignSubject rejects single-character subject', () => {
  const r = alignSubject('学', ['物理学'])
  assert.equal(r.subject, '未分类')
  assert.equal(r.reason, 'invalid')
})

test('alignSubject caps subject count and falls back to closest', () => {
  const existing = Array.from({ length: 12 }, (_, i) => `领域${'甲乙丙丁戊己庚辛壬癸子丑'[i]}`)
  const r = alignSubject('写作技巧', existing, { maxSubjects: 12 })
  assert.equal(r.merged, true)
  assert.ok(existing.includes(r.subject))
})

test('alignSubject ignores whitespace differences', () => {
  const r = alignSubject(' 物理 学 ', ['物理学'])
  assert.equal(r.subject, '物理学')
  assert.equal(r.reason, 'exact')
})
