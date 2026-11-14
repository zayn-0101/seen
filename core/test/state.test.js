import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultState, loadState, saveState, seenKey, isSeen, markSeen, pruneSeen,
  resolveSubjectName, recordFailure, shouldSkipFailure, clearFailure, listFailures,
} from '../lib/state.js'

test('state save/load roundtrip and corrupt fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = defaultState()
    state.lastTitle = 'hello'
    state.seen['bvid:BV1'] = { at: 1 }
    saveState(path, state)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).lastTitle, 'hello')
    const loaded = loadState(path)
    assert.equal(loaded.lastTitle, 'hello')
    assert.ok(isSeen(loaded, 'bvid:BV1'))
    writeFileSync(path, '{broken json')
    assert.deepEqual(loadState(path), defaultState())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('seenKey prefers bvid and normalizes title', () => {
  assert.equal(seenKey({ bvid: 'BV1abc', title: 'x' }), 'bvid:BV1abc')
  assert.equal(seenKey({ title: ' Hello, World! ' }), 'title:helloworld')
  assert.equal(seenKey({ title: '机器学习' }), 'title:机器学习')
})

test('subject resolution and failure cooldown', () => {
  assert.equal(resolveSubjectName('机器学习', ['机器学习', '前端开发']), '机器学习')
  assert.equal(resolveSubjectName('机器学习基础', ['机器学习']), '机器学习')
  assert.equal(resolveSubjectName('大数据', ['机器学习']), '大数据')
  assert.equal(resolveSubjectName('', ['机器学习']), '未分类')

  const state = defaultState()
  const key = 'bvid:BV1'
  recordFailure(state, key, 'boom')
  recordFailure(state, key, 'boom2')
  recordFailure(state, key, 'boom3')
  assert.equal(state.failures[key].count, 3)
  assert.equal(shouldSkipFailure(state, key, Date.now(), 60_000), true)
  assert.equal(shouldSkipFailure(state, key, Date.now() + 120_000, 60_000), false)
  clearFailure(state, key)
  assert.equal(state.failures[key], undefined)
})

test('recordFailure keeps video meta so the task can be retried', () => {
  const state = defaultState()
  recordFailure(state, 'bvid:BV1abc', 'yt-dlp 超时', {
    title: '梯度下降',
    url: 'https://www.bilibili.com/video/BV1abc',
    source: 'bilibili',
    bvid: 'BV1abc',
  })
  const first = state.failures['bvid:BV1abc']
  assert.equal(first.count, 1)
  assert.equal(first.meta.title, '梯度下降')
  assert.equal(first.meta.source, 'bilibili')
  assert.ok(first.at > 0)

  // 不带 meta 时保留上一次的视频信息，避免重试时丢链接
  recordFailure(state, 'bvid:BV1abc', '又失败了')
  assert.equal(state.failures['bvid:BV1abc'].count, 2)
  assert.equal(state.failures['bvid:BV1abc'].meta.url, 'https://www.bilibili.com/video/BV1abc')
})

test('listFailures returns newest first and honours the limit', () => {
  const state = defaultState()
  state.failures = {
    old: { count: 1, at: 1000, lastError: 'a', meta: { title: 'old' } },
    mid: { count: 2, at: 2000, lastError: 'b', meta: { title: 'mid' } },
    new: { count: 1, at: 3000, lastError: 'c', meta: { title: 'new' } },
  }
  const all = listFailures(state)
  assert.deepEqual(all.map((row) => row.key), ['new', 'mid', 'old'])
  assert.deepEqual(listFailures(state, 2).map((row) => row.key), ['new', 'mid'])
  assert.deepEqual(listFailures(defaultState()), [])
  assert.deepEqual(listFailures(null), [])
})

test('markSeen and pruneSeen keep newest', () => {
  const state = defaultState()
  for (let i = 0; i < 5; i++) markSeen(state, 'k' + i, { at: i })
  pruneSeen(state, 2)
  assert.deepEqual(Object.keys(state.seen).sort(), ['k3', 'k4'])
})
