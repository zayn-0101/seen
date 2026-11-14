import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MANUAL_DIR,
  MANUAL_SUFFIX,
  VIDEO_DIR,
  manualNoteLinkTarget,
  manualNoteRelPath,
  normalizeNoteLayout,
  remapStateNotePaths,
  videoNoteRelPath,
} from '../lib/paths.js'

test('normalizeNoteLayout falls back to flat', () => {
  assert.equal(normalizeNoteLayout('structured'), 'structured')
  assert.equal(normalizeNoteLayout('STRUCTURED'), 'structured')
  assert.equal(normalizeNoteLayout(''), 'flat')
  assert.equal(normalizeNoteLayout(undefined), 'flat')
  assert.equal(normalizeNoteLayout('other'), 'flat')
})

test('videoNoteRelPath switches by layout', () => {
  assert.equal(
    videoNoteRelPath({ noteRoot: '课程知识地图', subject: '写作', noteName: '标题', layout: 'flat' }),
    '课程知识地图/写作/标题.md',
  )
  assert.equal(
    videoNoteRelPath({ noteRoot: '课程知识地图', subject: '写作', noteName: '标题', layout: 'structured' }),
    `课程知识地图/${VIDEO_DIR}/写作/标题.md`,
  )
})

test('manualNoteRelPath switches by layout', () => {
  assert.equal(
    manualNoteRelPath({ noteRoot: '课程知识地图', subject: '写作', layout: 'flat' }),
    `课程知识地图/写作/写作${MANUAL_SUFFIX}.md`,
  )
  assert.equal(
    manualNoteRelPath({ noteRoot: '课程知识地图', subject: '写作', layout: 'structured' }),
    `课程知识地图/${MANUAL_DIR}/写作.md`,
  )
})

test('manualNoteLinkTarget drops .md and handles missing values', () => {
  assert.equal(
    manualNoteLinkTarget({ noteRoot: '课程知识地图', subject: '写作', layout: 'structured' }),
    '课程知识地图/手册/写作',
  )
  assert.equal(manualNoteLinkTarget({ subject: '', layout: 'structured' }), '课程知识地图/手册/未分类')
})

test('remapStateNotePaths rewrites moved notes only', () => {
  const state = {
    subjects: {
      写作: {
        videos: [
          { notePath: '课程知识地图/写作/标题.md' },
          { notePath: '课程知识地图/写作/没动.md' },
          { title: '没有 notePath' },
        ],
      },
      别的: { videos: [{ notePath: '课程知识地图/别的/a.md' }] },
    },
  }
  const changed = remapStateNotePaths(
    state,
    new Map([['课程知识地图/写作/标题.md', '课程知识地图/视频笔记/写作/标题.md']]),
  )
  assert.equal(changed, 1)
  assert.equal(state.subjects.写作.videos[0].notePath, '课程知识地图/视频笔记/写作/标题.md')
  assert.equal(state.subjects.写作.videos[1].notePath, '课程知识地图/写作/没动.md')
  assert.equal(state.subjects.别的.videos[0].notePath, '课程知识地图/别的/a.md')
})

test('remapStateNotePaths tolerates empty state and plain objects', () => {
  assert.equal(remapStateNotePaths({}, new Map()), 0)
  assert.equal(remapStateNotePaths(null, new Map()), 0)
  const state = { subjects: { a: { videos: [{ notePath: 'x.md' }] } } }
  assert.equal(remapStateNotePaths(state, { 'x.md': 'y.md' }), 1)
  assert.equal(state.subjects.a.videos[0].notePath, 'y.md')
})
