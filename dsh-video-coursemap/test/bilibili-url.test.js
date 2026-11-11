import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractBvid, extractPage, cleanBiliTitle, titleSimilarity } from '../lib/bilibili.js'

test('extractBvid supports URLs and bare BV', () => {
  assert.equal(extractBvid('https://www.bilibili.com/video/BV1GJ411x7h7?p=2'), 'BV1GJ411x7h7')
  assert.equal(extractBvid('BV1GJ411x7h7'), 'BV1GJ411x7h7')
  assert.equal(extractBvid('https://b23.tv/abc'), null)
  assert.equal(extractBvid('no video here'), null)
})

test('extractPage', () => {
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x?p=3'), 3)
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x'), 1)
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x?p=abc'), 1)
})

test('cleanBiliTitle strips platform suffix', () => {
  assert.equal(cleanBiliTitle('梯度下降详解_哔哩哔哩_bilibili'), '梯度下降详解')
  assert.equal(cleanBiliTitle('机器学习 - Google Chrome'), '机器学习')
  assert.equal(cleanBiliTitle('  A   B  '), 'A B')
})

test('titleSimilarity', () => {
  assert.equal(titleSimilarity('梯度下降详解', '梯度下降详解'), 1)
  assert.ok(titleSimilarity('梯度下降详解', '梯度下降') >= 0.5)
  assert.ok(titleSimilarity('完全不同的标题', '机器学习入门') < 0.5)
})
