import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callLlm,
  formatClock,
  normalizeSegments,
  parseTimedLines,
  sampleTimedPoints,
  segmentTranscript,
} from '../lib/analyze.js'

test('parseTimedLines handles mm:ss and hh:mm:ss', () => {
  const rows = parseTimedLines('[00:00] 开场\n[01:02:03] 很长的视频\n没有时间戳\n[] 空')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].seconds, 0)
  assert.equal(rows[1].seconds, 3723)
  assert.equal(rows[1].text, '很长的视频')
})

test('sampleTimedPoints respects step and cap', () => {
  const lines = Array.from({ length: 100 }, (_, i) => ({ seconds: i * 10, text: 'x' }))
  const points = sampleTimedPoints(lines, { stepSeconds: 30, maxPoints: 5 })
  assert.equal(points.length, 5)
  assert.equal(points[1].seconds, 30)
})

test('normalizeSegments rejects invented timestamps and sorts', () => {
  const points = [{ seconds: 0 }, { seconds: 45 }, { seconds: 90 }]
  const result = normalizeSegments({
    segments: [
      { at: '01:30', title: '后半段' },
      { at: '09:99', title: '编造时间' },
      { at: '00:45', title: '前半段' },
    ],
  }, points)
  assert.deepEqual(result.map((item) => item.content), ['前半段', '后半段'])
  assert.deepEqual(result.map((item) => item.from), [45, 90])
})

test('normalizeSegments needs at least two segments', () => {
  assert.deepEqual(normalizeSegments([{ at: '00:45', title: '只有一段' }], [{ seconds: 45 }]), [])
  assert.deepEqual(normalizeSegments('garbage', []), [])
})

test('formatClock switches to hh:mm:ss past an hour', () => {
  assert.equal(formatClock(45), '00:45')
  assert.equal(formatClock(3723), '01:02:03')
  assert.equal(formatClock(-5), '00:00')
})

test('segmentTranscript skips short videos without calling the model', async () => {
  let called = false
  const ctx = { llm: { stream: () => { called = true; return '' } } }
  const result = await segmentTranscript(ctx, {}, { title: '短片', timedTranscript: '[00:00] a\n[00:45] b', duration: 120 })
  assert.deepEqual(result, [])
  assert.equal(called, false)
})

test('segmentTranscript parses model JSON into chapters', async () => {
  const json = JSON.stringify({ segments: [{ at: '00:00', title: '开场' }, { at: '01:30', title: '正题' }] })
  const ctx = { llm: { stream: () => [json] } }
  const timed = '[00:00] 开场\n[00:45] 过渡\n[01:30] 正题\n[02:15] 收尾'
  const result = await segmentTranscript(ctx, {}, { title: '长片', timedTranscript: timed, duration: 600 })
  assert.equal(result.length, 2)
  assert.equal(result[1].from, 90)
})

test('normalizeSegments snaps near-miss timestamps to candidates', () => {
  const points = [{ seconds: 0 }, { seconds: 90 }, { seconds: 180 }]
  const result = normalizeSegments([
    { at: '00:00', title: '开场' },
    { at: '01:34', title: '差 4 秒' },
    { at: '05:00', title: '差太远' },
  ], points)
  assert.deepEqual(result.map((item) => item.from), [0, 90])
})

test('callLlm retries with a bigger budget when the model returns nothing', async () => {
  const budgets = []
  const ctx = {
    llm: {
      stream: ({ maxTokens }) => {
        budgets.push(maxTokens)
        return budgets.length === 1 ? '' : ['{"ok":true}']
      },
    },
  }
  const text = await callLlm(ctx, {}, { system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 })
  assert.equal(text, '{"ok":true}')
  assert.deepEqual(budgets, [100, 200])
})
