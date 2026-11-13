import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTimedTranscript, parseSrtSegments } from '../lib/transcript.js'

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  '开场白',
  '',
  '2',
  '00:00:05,500 --> 00:00:09,000',
  '第二句话',
  '',
  '3',
  '00:02:31,000 --> 00:02:35,000',
  '时间点内容',
  '',
].join('\n')

test('parseSrtSegments keeps timestamps', () => {
  const segments = parseSrtSegments(SRT)
  assert.equal(segments.length, 3)
  assert.equal(segments[0].start, 1)
  assert.equal(segments[2].start, 151)
  assert.equal(segments[2].text, '时间点内容')
})

test('buildTimedTranscript groups segments into time buckets', () => {
  const timed = buildTimedTranscript(parseSrtSegments(SRT), { maxSeconds: 10 })
  assert.match(timed, /^\[00:01\] 开场白 第二句话/)
  assert.match(timed, /\[02:31\] 时间点内容/)
})

test('parseSrtSegments tolerates empty and malformed input', () => {
  assert.deepEqual(parseSrtSegments(''), [])
  assert.deepEqual(parseSrtSegments(null), [])
  assert.deepEqual(parseSrtSegments('no timestamps here'), [{ start: 0, end: 0, text: 'no timestamps here' }])
})
