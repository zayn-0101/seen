import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTranscriptNote, parseTranscriptNote } from '../lib/transcript-note.js'

test('renderTranscriptNote writes a transcript archive with note link', () => {
  const md = renderTranscriptNote({
    title: '测试视频',
    subject: '知识管理',
    source: 'bilibili',
    url: 'https://www.bilibili.com/video/BV1test00001',
    bvid: 'BV1test00001',
    createdAt: 1700000000000,
    transcript: '第一句。第二句。',
    timedTranscript: '[00:00] 第一句。\n[00:03] 第二句。',
    notePath: '视频笔记/笔记/知识管理/测试视频.md',
  })
  assert.match(md, /^created: "2023-11-14"$/m)
  assert.match(md, /^type: "transcript"$/m)
  assert.match(md, /^notePath: "视频笔记\/笔记\/知识管理\/测试视频\.md"$/m)
  assert.match(md, /所属笔记：\[\[视频笔记\/笔记\/知识管理\/测试视频\|测试视频\]\]/)
  assert.match(md, /## 带时间戳字幕/)
  assert.match(md, /## 纯文本/)
})

test('parseTranscriptNote restores text and timed sections', () => {
  const md = renderTranscriptNote({
    title: '测试视频',
    transcript: '第一句。第二句。',
    timedTranscript: '[00:00] 第一句。\n[00:03] 第二句。',
  })
  const parsed = parseTranscriptNote(md)
  assert.equal(parsed.timed, '[00:00] 第一句。\n[00:03] 第二句。')
  assert.equal(parsed.text, '第一句。第二句。')
})

test('parseTranscriptNote falls back to stripping timestamps when plain text is missing', () => {
  const parsed = parseTranscriptNote('## 带时间戳字幕\n\n[00:00] 你好。\n[00:02] 世界。')
  assert.equal(parsed.text, '你好。\n世界。')
})

test('parseTranscriptNote tolerates empty input', () => {
  assert.deepEqual(parseTranscriptNote(''), { text: '', timed: '' })
})
