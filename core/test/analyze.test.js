import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseJson, normalizeClassify, normalizeSummary, summarize, buildSummarizePrompt } from '../lib/analyze.js'

test('parseJson handles fences, trailing commas and prose', () => {
  assert.deepEqual(parseJson('\u0060\u0060\u0060json\n{"a":1,}\n\u0060\u0060\u0060'), { a: 1 })
  assert.deepEqual(parseJson('prefix {"b":"x","c":[1,2]} suffix'), { b: 'x', c: [1, 2] })
  assert.equal(parseJson('not json at all'), null)
})

test('normalizeClassify', () => {
  const result = normalizeClassify({ isCourse: true, subject: '机器学习', title: '标题', keywords: ['a', 'b'], confidence: 0.9 }, 'fallback')
  assert.equal(result.isCourse, true)
  assert.equal(result.subject, '机器学习')
  assert.deepEqual(result.keywords, ['a', 'b'])
  assert.equal(normalizeClassify(null, 'x'), null)
  assert.equal(normalizeClassify({ isCourse: 'false', subject: '娱乐' }, 'x').isCourse, false)
})

test('normalizeSummary', () => {
  const result = normalizeSummary({
    summary: '摘要',
    keyPoints: [{ title: '主题', points: ['要点'] }],
    discussion: ['讨论'],
    mnemonSummary: '记忆摘要',
  }, '标题')
  assert.equal(result.summary, '摘要')
  assert.equal(result.keyPoints[0].title, '主题')
  assert.equal(result.mnemonSummary, '记忆摘要')
  const fallback = normalizeSummary(null, '标题')
  assert.equal(fallback.summary, '标题')
  assert.deepEqual(fallback.keyPoints, [])
})

test('buildSummarizePrompt requires denser key points for long videos', () => {
  const long = buildSummarizePrompt({
    title: '长视频',
    subject: '测试',
    content: { transcript: '一段讲解。' },
    longTranscript: true,
  })
  assert.match(long, /8~15 个主题/)
  assert.match(long, /覆盖全片/)

  const short = buildSummarizePrompt({
    title: '短视频',
    subject: '测试',
    content: { transcript: '一段讲解。' },
    longTranscript: false,
  })
  assert.match(short, /3~12 个主题/)
  assert.doesNotMatch(short, /8~15 个主题/)
})

test('summarize keeps timed transcript beyond 14k up to the material cap', async () => {
  const seenPrompts = []
  const ctx = {
    llm: {
      stream: (args) => {
        seenPrompts.push(JSON.stringify(args))
        return JSON.stringify({ summary: '一句真正的摘要', keyPoints: [{ title: '主题', points: ['要点'] }] })
      },
    },
  }
  const timed = '[00:00] 开头 ' + '中'.repeat(15000) + ' [20:00] 尾部标记'
  await summarize(ctx, {}, {
    title: '长视频',
    transcript: '纯文本开头。',
    content: { transcript: '纯文本开头。', timedTranscript: timed },
  })
  assert.equal(seenPrompts.length, 1)
  assert.match(seenPrompts[0], /尾部标记/)
})

test('summarize digests the timed transcript over the cap and drops the raw text', async () => {
  const prompts = []
  const ctx = {
    llm: {
      stream: (args) => {
        const prompt = args.messages
          .map((message) => (message.content || []).map((part) => part.text || '').join(''))
          .join('\n')
        prompts.push(prompt)
        if (prompt.includes('压缩成高密度的知识要点')) return '分段摘要 [00:00] 开头'
        if (prompt.includes('合并成一份不重复')) return '合并摘要 [00:00] 尾部标记'
        return JSON.stringify({ summary: '一句真正的摘要', keyPoints: [{ title: '主题', points: ['要点'] }] })
      },
    },
  }
  const longTimed = '[00:00] 开头 ' + '内容'.repeat(15000) + ' [45:00] 尾部标记'
  await summarize(ctx, {}, {
    title: '超长视频',
    transcript: '纯文本开头。',
    content: { transcript: '纯文本开头。', timedTranscript: longTimed },
  })
  assert.ok(prompts.length > 2)
  assert.ok(prompts.slice(0, -1).some((prompt) => prompt.includes('尾部标记')))
  const finalPrompt = prompts[prompts.length - 1]
  assert.match(finalPrompt, /合并摘要/)
  assert.ok(!finalPrompt.includes('内容'.repeat(100)))
})

test('summarize 拒绝只有标题的回复并重试要求 keyPoints', async () => {
  const replies = [
    JSON.stringify({ summary: '标题' }),
    JSON.stringify({ summary: '一句真正的摘要', keyPoints: [{ title: '主题', points: ['要点'] }] }),
  ]
  let calls = 0
  const ctx = { llm: { stream: () => replies[Math.min(calls++, replies.length - 1)] } }
  const result = await summarize(ctx, {}, {
    title: '标题',
    transcript: '这是视频讲解的第一段内容。这里是第二段内容。',
    content: { transcript: '这是视频讲解的第一段内容。这里是第二段内容。' },
  })
  assert.equal(calls, 2)
  assert.equal(result.summary, '一句真正的摘要')
  assert.equal(result.keyPoints[0].title, '主题')
})

test('summarize 两轮都失败时用字幕要点兜底而不是标题', async () => {
  const reply = JSON.stringify({ summary: '标题' })
  const ctx = { llm: { stream: () => reply } }
  const result = await summarize(ctx, {}, {
    title: '标题',
    transcript: '这是视频讲解的第一段内容。这里是第二段内容，包含具体结论。',
    content: { transcript: '这是视频讲解的第一段内容。这里是第二段内容，包含具体结论。' },
  })
  assert.notEqual(result.summary, '标题')
  assert.ok(result.keyPoints.length > 0)
  assert.equal(result.keyPoints[0].title, '内容要点')
})
