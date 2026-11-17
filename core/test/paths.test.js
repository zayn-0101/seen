import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUX_DIR,
  MANUAL_DIR,
  MANUAL_SUFFIX,
  VIDEO_DIR,
  manualNoteLinkTarget,
  manualNoteRelPath,
  normalizeAuxRelPath,
  normalizeNoteLayout,
  normalizeStateAuxPaths,
  remapStateNotePaths,
  videoNoteRelPath,
  weeklyReviewRelPath,
} from '../lib/paths.js'

test('normalizeNoteLayout defaults to structured', () => {
  assert.equal(normalizeNoteLayout('structured'), 'structured')
  assert.equal(normalizeNoteLayout('STRUCTURED'), 'structured')
  assert.equal(normalizeNoteLayout('flat'), 'flat')
  assert.equal(normalizeNoteLayout('FLAT'), 'flat')
  assert.equal(normalizeNoteLayout(''), 'structured')
  assert.equal(normalizeNoteLayout(undefined), 'structured')
  assert.equal(normalizeNoteLayout('other'), 'structured')
})

test('videoNoteRelPath switches by layout', () => {
  assert.equal(
    videoNoteRelPath({ noteRoot: '视频笔记', subject: '写作', noteName: '标题', layout: 'flat' }),
    '视频笔记/写作/标题.md',
  )
  assert.equal(
    videoNoteRelPath({ noteRoot: '视频笔记', subject: '写作', noteName: '标题', layout: 'structured' }),
    `视频笔记/${VIDEO_DIR}/写作/标题.md`,
  )
})

test('manualNoteRelPath switches by layout', () => {
  assert.equal(
    manualNoteRelPath({ noteRoot: '视频笔记', subject: '写作', layout: 'flat' }),
    `视频笔记/写作/写作${MANUAL_SUFFIX}.md`,
  )
  assert.equal(
    manualNoteRelPath({ noteRoot: '视频笔记', subject: '写作', layout: 'structured' }),
    `视频笔记/${AUX_DIR}/${MANUAL_DIR}/写作.md`,
  )
})

test('manualNoteLinkTarget drops .md and handles missing values', () => {
  assert.equal(
    manualNoteLinkTarget({ noteRoot: '视频笔记', subject: '写作', layout: 'structured' }),
    `视频笔记/${AUX_DIR}/${MANUAL_DIR}/写作`,
  )
  assert.equal(manualNoteLinkTarget({ subject: '', layout: 'structured' }), `视频笔记/${AUX_DIR}/${MANUAL_DIR}/未分类`)
})

test('weeklyReviewRelPath lives under 资料/回顾', () => {
  assert.equal(
    weeklyReviewRelPath({ noteRoot: '视频笔记', label: '2026-W46' }),
    `视频笔记/${AUX_DIR}/回顾/2026-W46.md`,
  )
})

test('normalizeAuxRelPath moves legacy aux dirs under 资料 and strips vault prefix', () => {
  assert.equal(
    normalizeAuxRelPath('视频笔记/字幕/标题.md', { noteRoot: '视频笔记' }),
    '视频笔记/资料/字幕/标题.md',
  )
  assert.equal(
    normalizeAuxRelPath('视频笔记/每周回顾/2026-W46.md', { noteRoot: '视频笔记' }),
    '视频笔记/资料/回顾/2026-W46.md',
  )
  assert.equal(
    normalizeAuxRelPath('/Users/me/Obsidian/视频笔记/手册/写作.md', {
      vaultPath: '/Users/me/Obsidian', noteRoot: '视频笔记',
    }),
    '视频笔记/资料/手册/写作.md',
  )
  assert.equal(
    normalizeAuxRelPath('视频笔记/资料/字幕/标题.md', { noteRoot: '视频笔记' }),
    '视频笔记/资料/字幕/标题.md',
  )
})

test('normalizeStateAuxPaths updates transcript paths and counts changes', () => {
  const state = { subjects: { 写作: { videos: [
    { transcriptPath: '视频笔记/字幕/a.md' },
    { transcriptPath: '视频笔记/资料/字幕/b.md' },
    { title: '没有字幕路径' },
  ] } } }
  assert.equal(normalizeStateAuxPaths(state, { noteRoot: '视频笔记' }), 1)
  assert.equal(state.subjects.写作.videos[0].transcriptPath, '视频笔记/资料/字幕/a.md')
  assert.equal(state.subjects.写作.videos[1].transcriptPath, '视频笔记/资料/字幕/b.md')
})

test('remapStateNotePaths rewrites moved notes only', () => {
  const state = {
    subjects: {
      写作: {
        videos: [
          { notePath: '视频笔记/写作/标题.md' },
          { notePath: '视频笔记/写作/没动.md' },
          { title: '没有 notePath' },
        ],
      },
      别的: { videos: [{ notePath: '视频笔记/别的/a.md' }] },
    },
  }
  const changed = remapStateNotePaths(
    state,
    new Map([['视频笔记/写作/标题.md', '视频笔记/视频笔记/写作/标题.md']]),
  )
  assert.equal(changed, 1)
  assert.equal(state.subjects.写作.videos[0].notePath, '视频笔记/视频笔记/写作/标题.md')
  assert.equal(state.subjects.写作.videos[1].notePath, '视频笔记/写作/没动.md')
  assert.equal(state.subjects.别的.videos[0].notePath, '视频笔记/别的/a.md')
})

test('remapStateNotePaths tolerates empty state and plain objects', () => {
  assert.equal(remapStateNotePaths({}, new Map()), 0)
  assert.equal(remapStateNotePaths(null, new Map()), 0)
  const state = { subjects: { a: { videos: [{ notePath: 'x.md' }] } } }
  assert.equal(remapStateNotePaths(state, { 'x.md': 'y.md' }), 1)
  assert.equal(state.subjects.a.videos[0].notePath, 'y.md')
})
