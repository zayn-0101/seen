import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAskPrompt, extractCitations, answerQuestion } from '../lib/ask.js'

const notes = [
  { title: 'Obsidian 入门', notePath: '视频笔记/笔记/知识管理/Obsidian 入门.md', body: '双链用 [[笔记名]] 写法，反链由 Obsidian 自动维护。' },
  { title: '个人知识库', notePath: '视频笔记/笔记/知识管理/个人知识库.md', body: '仓库是笔记的存放位置。' },
]

test('buildAskPrompt includes note paths and the question', () => {
  const prompt = buildAskPrompt({ question: '双链和反链有什么区别？', notes })
  assert.match(prompt, /双链和反链有什么区别？/)
  assert.match(prompt, /视频笔记\/笔记\/知识管理\/Obsidian 入门/)
  assert.match(prompt, /只根据下面这些笔记回答/)
})

test('buildAskPrompt truncates overlong note bodies', () => {
  const long = { title: '长笔记', notePath: 'p/long.md', body: 'x'.repeat(6000) }
  const prompt = buildAskPrompt({ question: 'q', notes: [long] })
  assert.match(prompt, /正文过长，已截断/)
})

test('extractCitations maps wiki links back to notes in order without duplicates', () => {
  const answer = '双链是手动写 [[视频笔记/笔记/知识管理/Obsidian 入门|Obsidian 入门]]，反链自动生成。再提一次 [[Obsidian 入门]]。另一篇 [[视频笔记/笔记/知识管理/个人知识库]]。'
  const citations = extractCitations(answer, notes)
  assert.deepEqual(citations, [
    { title: 'Obsidian 入门', notePath: '视频笔记/笔记/知识管理/Obsidian 入门.md' },
    { title: '个人知识库', notePath: '视频笔记/笔记/知识管理/个人知识库.md' },
  ])
})

test('answerQuestion returns the model answer and citations', async () => {
  const ctx = {
    llm: {
      stream: () => ['结论：双链是手动引用，反链自动生成。[[视频笔记/笔记/知识管理/Obsidian 入门|Obsidian 入门]]'],
    },
  }
  const result = await answerQuestion({ question: '双链和反链区别？', notes, llm: ctx.llm, config: {} })
  assert.match(result.answer, /结论/)
  assert.equal(result.citations.length, 1)
  assert.equal(result.citations[0].title, 'Obsidian 入门')
})

test('answerQuestion handles empty question and empty notes', async () => {
  assert.equal((await answerQuestion({ question: '', notes })).answer, '请输入一个问题。')
  const empty = await answerQuestion({ question: 'q', notes: [] })
  assert.match(empty.answer, /没有找到相关/)
})
