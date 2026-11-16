/**
 * seen-core · 问笔记库
 *
 * 先用全文搜索找相关笔记，再把正文片段交给模型回答；回答要求带 [[路径|标题]] 引用。
 * 不做向量检索：笔记库规模不大，文件名 + 正文关键词足够，且完全本地可控。
 */

import { callLlm } from './analyze.js'

const MAX_NOTE_CHARS = 5000
const MAX_NOTES = 5

function clip(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return value.slice(0, max) + '\n……（正文过长，已截断）'
}

/**
 * 构造问答提示词。notes: [{ title, notePath, body }]
 */
export function buildAskPrompt({ question, notes = [] } = {}) {
  const q = String(question ?? '').trim()
  const list = Array.isArray(notes) ? notes.filter((note) => note && note.title && note.body !== undefined) : []
  const context = list
    .map((note, index) => `[${index + 1}] ${note.title}\n路径：${note.notePath}\n${clip(note.body, MAX_NOTE_CHARS)}`)
    .join('\n\n')
  return `请只根据下面这些笔记回答用户的问题。

规则：
1. 先给结论，再展开依据；不要编造笔记里没有的事实。
2. 每个关键结论后面用 [[笔记路径|笔记标题]] 标注来源，路径必须来自下面的笔记。
3. 如果笔记不足以回答，直接说「笔记库里没有足够的信息」，并指出还缺什么。
4. 用中文，控制在 600 字以内。

用户的笔记：
${context || '（没有找到相关笔记）'}

用户的问题：${q}`
}

/**
 * 从回答里提取 [[路径|标题]] 引用，映射回检索结果。
 * 返回 [{ title, notePath }]，按出现顺序去重。
 */
export function extractCitations(answer, notes = []) {
  const list = Array.isArray(notes) ? notes : []
  const byPath = new Map()
  const byTitle = new Map()
  for (const note of list) {
    const path = String(note?.notePath ?? '').trim().replace(/\.md$/i, '')
    const title = String(note?.title ?? '').trim()
    if (path) byPath.set(path, note)
    if (title) byTitle.set(title, note)
  }
  const seen = new Set()
  const result = []
  const text = String(answer ?? '')
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const rawPath = String(match[1] ?? '').trim().replace(/\.md$/i, '')
    const rawTitle = String(match[2] ?? '').trim()
    const note = byPath.get(rawPath) || byTitle.get(rawTitle) || byPath.get(rawPath.replace(/^视频笔记\//, ''))
    if (!note) continue
    const key = note.notePath || note.title
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ title: note.title, notePath: note.notePath })
  }
  return result
}

/**
 * 根据检索结果回答用户问题。
 * @param {{ question: string, notes: Array<{title:string,notePath:string,body:string}>, llm: any, config?: any, maxTokens?: number }} input
 */
export async function answerQuestion({ question, notes = [], llm, config = {}, maxTokens = 1800 } = {}) {
  const q = String(question ?? '').trim()
  if (!q) return { answer: '请输入一个问题。', citations: [] }
  const usable = (Array.isArray(notes) ? notes : []).filter((note) => note && note.title && note.body !== undefined).slice(0, MAX_NOTES)
  if (usable.length === 0) {
    return { answer: '笔记库里没有找到相关的笔记。可以换个关键词，或先整理几篇相关视频。', citations: [] }
  }
  const text = await callLlm({ llm }, config, {
    system: '你是笔记库问答助手，只根据给定笔记回答，引用必须来自笔记路径。',
    messages: [{ role: 'user', content: [{ type: 'text', text: buildAskPrompt({ question: q, notes: usable }) }] }],
    maxTokens,
  })
  const answer = String(text ?? '').trim()
  return { answer: answer || '模型没有返回内容，请稍后再试。', citations: extractCitations(answer, usable) }
}
