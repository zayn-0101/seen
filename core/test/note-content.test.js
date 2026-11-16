import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTENT_TYPES,
  TEMPLATE_LIMITS,
  normalizeContentType,
  normalizeKeyPointPoints,
  normalizeQuality,
  normalizeQuotes,
  normalizeResources,
  normalizeTemplate,
  normalizeTerms,
  scoreNoteQuality,
  templateSections,
} from '../lib/note-content.js'

test('normalizeContentType accepts labels and aliases', () => {
  assert.equal(normalizeContentType('教程'), 'tutorial')
  assert.equal(normalizeContentType('观点'), 'opinion')
  assert.equal(normalizeContentType('科普'), 'science')
  assert.equal(normalizeContentType('评测'), 'review')
  assert.equal(normalizeContentType('访谈'), 'interview')
  assert.equal(normalizeContentType('纪录'), 'documentary')
  assert.equal(normalizeContentType('课程'), 'course')
  assert.equal(normalizeContentType('tutorial'), 'tutorial')
  assert.equal(normalizeContentType('unknown'), 'other')
  assert.equal(normalizeContentType(''), 'other')
})

test('normalizeKeyPointPoints turns strings and objects into text/time points', () => {
  const points = normalizeKeyPointPoints([
    '第一条',
    { text: '第二条', time: 83 },
    { text: '', time: 10 },
    null,
  ])
  assert.deepEqual(points, [
    { text: '第一条' },
    { text: '第二条', time: 83 },
  ])
  assert.equal(normalizeKeyPointPoints('nope').length, 0)
})

test('normalizeTemplate keeps only keys for the content type', () => {
  const raw = {
    prerequisites: ['装了 Node'],
    steps: [{ text: '打开终端', time: 12 }],
    exercises: ['练习一'],
    arguments: [{ claim: '不该这样', basis: '因为…' }],
  }
  const tutorial = normalizeTemplate(raw, 'tutorial')
  assert.deepEqual(Object.keys(tutorial).sort(), ['prerequisites', 'steps'])
  assert.equal(tutorial.steps[0].time, 12)
  const course = normalizeTemplate(raw, 'course')
  assert.deepEqual(Object.keys(course).sort(), ['exercises', 'prerequisites', 'steps'])
  assert.equal(normalizeTemplate(raw, 'other').steps, undefined)
})

test('normalizeTemplate caps steps and prerequisites', () => {
  const steps = Array.from({ length: 20 }, (_, index) => ({ text: '步骤 ' + index }))
  const template = normalizeTemplate({ steps, prerequisites: Array.from({ length: 20 }, (_, i) => '前置 ' + i) }, 'tutorial')
  assert.equal(template.steps.length, TEMPLATE_LIMITS.steps)
  assert.equal(template.prerequisites.length, TEMPLATE_LIMITS.prerequisites)
})

test('normalizeQuotes keeps at most three short quotes', () => {
  const quotes = normalizeQuotes([
    { text: '第一句', time: 1 },
    { text: '第二句' },
    { text: '第三句' },
    { text: '第四句' },
    { text: 'x'.repeat(90) },
  ])
  assert.equal(quotes.length, 3)
  assert.equal(quotes[0].time, 1)
  assert.equal(normalizeQuotes('bad').length, 0)
})

test('normalizeTerms filters bad names and caps definitions', () => {
  const terms = normalizeTerms([
    { name: '闭包', definition: '函数与其词法环境的组合' },
    { name: 'A', definition: '太短' },
    { name: '很长的术语名称超过十二个字啊啊', definition: '超长' },
    { name: '递归', definition: 'x'.repeat(120) },
    '字符串术语',
  ])
  assert.deepEqual(terms.map((item) => item.name), ['闭包', '递归'])
  assert.equal(terms[1].definition.length, 80)
})

test('normalizeResources caps name/note and item count', () => {
  const resources = normalizeResources(Array.from({ length: 10 }, (_, index) => ({ name: '资源 ' + index, note: '说明' })))
  assert.equal(resources.length, TEMPLATE_LIMITS.resources)
  assert.equal(normalizeResources([{ name: '' }]).length, 0)
})

test('templateSections maps content types to ordered sections', () => {
  assert.deepEqual(templateSections('tutorial').map((item) => item.title), ['前置条件', '操作步骤'])
  assert.deepEqual(templateSections('course').map((item) => item.title), ['前置条件', '课程脉络', '练习'])
  assert.deepEqual(templateSections('opinion').map((item) => item.title), ['论证结构', '可质疑之处'])
  assert.deepEqual(templateSections('science').map((item) => item.title), ['机制与证据', '常见误解'])
  assert.deepEqual(templateSections('other'), [])
})

test('scoreNoteQuality rewards rich transcripts and penalises thin notes', () => {
  assert.equal(scoreNoteQuality({ contentQuality: 'metadata-only' }), 1)
  assert.equal(scoreNoteQuality({ contentQuality: 'full', transcriptSource: 'whisper', transcriptLength: 1000, keyPointCount: 3, conceptCount: 2 }), 3)
  assert.equal(scoreNoteQuality({ contentQuality: 'full', transcriptSource: 'up-subtitle', transcriptLength: 1000, keyPointCount: 6, conceptCount: 4 }), 5)
  assert.equal(scoreNoteQuality({ contentQuality: 'full', transcriptSource: 'whisper', transcriptLength: 9000, keyPointCount: 2, conceptCount: 1 }), 3)
  assert.equal(normalizeQuality('4'), 4)
  assert.equal(normalizeQuality(5), 5)
  assert.equal(normalizeQuality(9), 1)
  assert.equal(normalizeQuality(0, 2), 2)
})

test('CONTENT_TYPES has stable ids', () => {
  assert.deepEqual(CONTENT_TYPES.map((item) => item.id), [
    'tutorial', 'opinion', 'science', 'review', 'interview', 'documentary', 'course', 'other',
  ])
})
