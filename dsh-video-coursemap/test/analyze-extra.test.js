import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitTranscript } from '../lib/analyze.js'

test('splitTranscript covers full text with overlap', () => {
  const text = 'abcdefghij'.repeat(1000)
  const chunks = splitTranscript(text, 6000, 300)
  assert.ok(chunks.length >= 2)
  assert.equal(chunks.join('').includes('abcdefghij'), true)
  assert.ok(chunks[0].length <= 6000)
  assert.deepEqual(splitTranscript('', 100, 10), [])
})
