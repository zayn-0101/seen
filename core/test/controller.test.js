import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { writeTranscriptNote, writeVideoNote } from '../lib/obsidian.js'
import { renderTranscriptNote } from '../lib/transcript-note.js'

function fakeCtx(tools) {
  return {
    get: () => undefined,
    effect: (fn) => fn(),
    tools: { register: (def) => { tools.set(def.name, def); return () => {} } },
    llm: {
      listProviders: () => [{ id: 'fake', models: [{ id: 'fake-model' }] }],
      stream: async function* () { yield { type: 'text-delta', text: '{}' } },
    },
  }
}

test('standalone controller exposes start/stop/interval/scan', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  const tools = new Map()
  try {
    const api = apply(fakeCtx(tools), {
      vaultPath: vault,
      stateDir: state,
      autoStart: false,
      exposeController: true,
      provider: 'fake',
      model: 'fake-model',
      enableMnemon: false,
      pollIntervalMs: 5000,
    })
    await api.ready
    assert.equal(typeof api.start, 'function')
    assert.equal(typeof api.scan, 'function')
    assert.equal((await api.getStatus()).polling, false)
    assert.equal(api.start().ok, true)
    assert.equal((await api.getStatus()).polling, true)
    assert.equal(api.setPollInterval(9000).ok, true)
    assert.equal(api.getConfig().pollIntervalMs, 9000)
    assert.equal(api.stop().ok, true)
    assert.equal((await api.getStatus()).polling, false)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('另一个实例持有锁时进入只读状态并说明原因', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    writeFileSync(join(state, 'instance.lock'), String(process.ppid))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const status = await api.getStatus()
    assert.equal(status.readOnly, true)
    assert.equal(status.readOnlyReason, 'locked-by-other')
    assert.match(status.message, /只读（另一个实例持有锁）/)
    assert.equal(api.getConfig().readOnlyReason, 'locked-by-other')
    const result = await api.scan({ title: '测试视频' })
    assert.equal(result.ok, false)
    assert.match(result.message, /只读模式/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('状态保存失败时仍返回笔记并带警告', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    mkdirSync(join(state, 'state.json'))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const response = system.includes('分类助手')
        ? { isCourse: true, subject: '示例', title: '测试视频', keywords: [] }
        : { summary: '示例摘要', keyPoints: [] }
      yield { type: 'text-delta', text: JSON.stringify(response) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.scan({ title: '测试视频', url: 'https://www.youtube.com/watch?v=ExampleId01' })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.stateSaved, false)
    assert.ok(result.warnings.some((item) => item.includes('状态保存失败')))
    assert.match(result.message, /1 项警告/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('重刷历史视频保留最初的创建时间与复习进度', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const originalCreated = Date.UTC(2025, 0, 15)
    const originalReview = { due: '2026-01-01', interval: 7, ease: 2.5, reps: 3 }
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '测试视频', source: 'youtube', videoId: 'ExampleId01', content: '---\nsource: "youtube"\nvideoId: "ExampleId01"\n---\n原笔记' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [{
      title: '测试视频', source: 'youtube', videoId: 'ExampleId01', url: 'https://www.youtube.com/watch?v=ExampleId01',
      notePath: note.relPath, createdAt: originalCreated, review: originalReview,
    }] } } }))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const result = system.includes('分类助手')
        ? { isCourse: true, subject: '示例', title: '测试视频', keywords: ['测试'] }
        : { summary: '一条示例摘要', keyPoints: [] }
      yield { type: 'text-delta', text: JSON.stringify(result) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.refreshHistory({ limit: 1 })
    assert.equal(result.failed, 0)
    const [video] = api.getHistory()
    assert.equal(video.createdAt, originalCreated)
    assert.deepEqual(video.review, originalReview)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('字幕存档属于另一篇同名笔记时拒绝重整理', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const notePath = '视频笔记/笔记/学科甲/同名.md'
    await writeTranscriptNote({ vaultPath: vault, noteRoot: '视频笔记', noteName: '同名', content: renderTranscriptNote({
      title: '同名', transcript: '另一篇视频的字幕', notePath: '视频笔记/笔记/学科乙/同名.md',
    }) })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科甲: { videos: [{
      title: '同名', source: 'youtube', videoId: 'ExampleId01', url: 'https://www.youtube.com/watch?v=ExampleId01', notePath,
    }] } } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath })
    assert.equal(result.ok, false)
    assert.match(result.message, /字幕存档属于另一篇笔记/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('旧字幕缺少所属路径且存在同名笔记时拒绝猜测归属', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const notePath = '视频笔记/笔记/学科甲/同名.md'
    await writeTranscriptNote({ vaultPath: vault, noteRoot: '视频笔记', noteName: '同名', content: '---\ntype: "transcript"\n---\n\n## 纯文本\n\n未知归属的旧字幕' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: {
      学科甲: { videos: [{ title: '同名', notePath }] },
      学科乙: { videos: [{ title: '同名', notePath: '视频笔记/笔记/学科乙/同名.md' }] },
    } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath })
    assert.equal(result.ok, false)
    assert.match(result.message, /没有所属笔记信息/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('重整理优先使用状态中记录的同名字幕副本', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '学科乙', title: '同名视频', source: 'youtube', videoId: 'ExampleId01', content: '---\nsource: "youtube"\nvideoId: "ExampleId01"\n---\n原笔记' })
    const archive = (notePath, transcript) => renderTranscriptNote({ title: '同名视频', notePath, transcript })
    const common = { vaultPath: vault, noteRoot: '视频笔记', noteName: '同名视频' }
    await writeTranscriptNote({ ...common, content: archive('视频笔记/笔记/学科甲/同名视频.md', '甲的字幕') })
    const second = await writeTranscriptNote({ ...common, content: archive(note.relPath, '乙的字幕') })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科乙: { videos: [{
      title: '同名视频', source: 'youtube', videoId: 'ExampleId01', url: 'https://www.youtube.com/watch?v=ExampleId01',
      notePath: note.relPath, transcriptPath: second.relPath, createdAt: Date.now(),
    }] } } }))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const response = system.includes('分类助手')
        ? { isCourse: true, subject: '学科乙', title: '同名视频', keywords: [] }
        : { summary: '示例摘要', keyPoints: [] }
      yield { type: 'text-delta', text: JSON.stringify(response) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath: note.relPath })
    assert.equal(result.ok, true, result.message)
    assert.equal(api.getHistory()[0].transcriptPath, second.relPath)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('重整理时从原笔记补齐状态缺失的来源元数据', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '学科甲', title: '旧视频', source: 'youtube', videoId: 'ExampleId01',
      content: `---
title: "旧视频"
subject: "学科甲"
source: "youtube"
url: "https://www.youtube.com/watch?v=ExampleId01"
videoId: "ExampleId01"
type: "video"
---

## 视频信息

## 核心知识点

## 来源统计
`,
    })
    await writeTranscriptNote({
      vaultPath: vault, noteRoot: '视频笔记', noteName: '旧视频',
      content: renderTranscriptNote({ title: '旧视频', notePath: note.relPath, transcript: '这是旧视频的字幕存档，用来验证重整理时能够从原笔记补齐来源元数据。' }),
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科甲: { videos: [{
      title: '旧视频', notePath: note.relPath,
    }] } } }))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const response = system.includes('分类助手')
        ? { isCourse: true, subject: '学科甲', title: '旧视频', keywords: [] }
        : { summary: '示例摘要', keyPoints: [] }
      yield { type: 'text-delta', text: JSON.stringify(response) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath: note.relPath })
    assert.equal(result.ok, true, result.message)
    assert.equal(api.getHistory()[0].source, 'youtube')
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('重整理 B 站多 P 旧笔记时按原 URL 的 p 参数匹配，不生成重复副本', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '学科甲', title: '多P视频 - P2 第二集', bvid: 'BV1aaaaaaaaa', page: 2,
      content: `---
title: "多P视频 - P2 第二集"
subject: "学科甲"
source: "bilibili"
bvid: "BV1aaaaaaaaa"
url: "https://www.bilibili.com/video/BV1aaaaaaaaa?p=2"
type: "video"
---

## 视频信息

## 核心知识点

## 来源统计
`,
    })
    await writeTranscriptNote({
      vaultPath: vault, noteRoot: '视频笔记', noteName: '多P视频 - P2 第二集',
      content: renderTranscriptNote({ title: '多P视频 - P2 第二集', notePath: note.relPath, transcript: '这是多 P 视频第二集的字幕存档，用来验证重整理不会生成重复副本。' }),
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科甲: { videos: [{
      title: '多P视频 - P2 第二集', notePath: note.relPath,
    }] } } }))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const response = system.includes('分类助手')
        ? { isCourse: true, subject: '学科甲', title: '多P视频 - P2 第二集', keywords: [] }
        : { summary: '示例摘要', keyPoints: [] }
      yield { type: 'text-delta', text: JSON.stringify(response) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath: note.relPath })
    assert.equal(result.ok, true, result.message)
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('标签合并中途失败时，已写入的笔记与状态仍保持一致', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '存在的笔记', bvid: 'BV1aaaaaaaaa', content: '---\nbvid: "BV1aaaaaaaaa"\ntags: ["示例","旧主题"]\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [
      { title: '存在的笔记', notePath: note.relPath, tags: ['示例', '旧主题'], createdAt: 2 },
      { title: '缺失的笔记', notePath: '视频笔记/笔记/示例/不存在.md', tags: ['示例', '旧主题'], createdAt: 1 },
    ] } } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const result = await api.renameTag({ from: '旧主题', to: '新主题' })
    assert.equal(result.ok, false)
    assert.equal(result.changed, 1)
    const saved = JSON.parse(readFileSync(join(state, 'state.json'), 'utf8'))
    assert.deepEqual(saved.subjects.示例.videos[0].tags, ['示例', '新主题'])
    assert.deepEqual(saved.subjects.示例.videos[1].tags, ['示例', '旧主题'])
    assert.match(readFileSync(note.absPath, 'utf8'), /新主题/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})
