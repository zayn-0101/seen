import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('状态保存失败时在写笔记前中止并带警告', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
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
    mkdirSync(join(state, 'state.json'))
    const result = await api.scan({ title: '测试视频', url: 'https://www.youtube.com/watch?v=ExampleId01' })
    assert.equal(result.ok, false, result.message)
    assert.equal(result.stateSaved, false)
    assert.ok(result.warnings.some((item) => item.includes('状态保存失败')))
    assert.equal(existsSync(join(vault, '视频笔记', '笔记')), false)
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

test('重整理保留原始字幕来源，不因 archive 掉分', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '学科甲', title: '人工字幕视频', source: 'bilibili', bvid: 'BV1Archive01',
      content: `---
title: "人工字幕视频"
subject: "学科甲"
source: "bilibili"
bvid: "BV1Archive01"
url: "https://www.bilibili.com/video/BV1Archive01"
contentSource: "up-subtitle"
type: "video"
---

## 视频信息

## 核心知识点

## 来源统计
`,
    })
    await writeTranscriptNote({
      vaultPath: vault, noteRoot: '视频笔记', noteName: '人工字幕视频',
      content: renderTranscriptNote({ title: '人工字幕视频', notePath: note.relPath, transcript: '这是 UP 主提供的字幕存档，用于验证重整理不会因为来源变成 archive 而丢掉人工字幕的评分。' }),
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科甲: { videos: [{
      title: '人工字幕视频', source: 'bilibili', bvid: 'BV1Archive01', url: 'https://www.bilibili.com/video/BV1Archive01', notePath: note.relPath,
    }] } } }))
    const ctx = fakeCtx(new Map())
    ctx.llm.stream = async function* ({ system }) {
      const response = system.includes('分类助手')
        ? { isCourse: true, subject: '学科甲', title: '人工字幕视频', keywords: [] }
        : {
            summary: '示例摘要',
            keyPoints: Array.from({ length: 6 }, (_, index) => ({ title: '主题' + index, points: ['要点'] })),
            concepts: Array.from({ length: 4 }, (_, index) => ({ name: '概念' + index, brief: '说明' })),
          }
      yield { type: 'text-delta', text: JSON.stringify(response) }
    }
    const api = apply(ctx, {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false, fetchContent: false, fetchTranscript: false,
    })
    await api.ready
    const result = await api.resummarizeNote({ notePath: note.relPath })
    assert.equal(result.ok, true, result.message)
    const saved = readFileSync(join(vault, note.relPath), 'utf8')
    assert.ok(saved.includes('contentSource: "archive"'))
    assert.ok(saved.includes('transcriptOrigin: "up-subtitle"'))
    assert.ok(saved.includes('quality: 5'))
    assert.ok(saved.includes('内容来源：本地字幕存档'))
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

test('启动时按视频身份恢复已写笔记的待处理记录', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '崩溃恢复', bvid: 'BV1ddddddddd', content: '---\nbvid: "BV1ddddddddd"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1ddddddddd:p1': {
          key: 'bilibili:BV1ddddddddd:p1',
          activeKey: 'bilibili:BV1ddddddddd:p1',
          title: '崩溃恢复', subject: '示例', source: 'bilibili', bvid: 'BV1ddddddddd', page: 1,
          url: 'https://www.bilibili.com/video/BV1ddddddddd', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
    const saved = JSON.parse(readFileSync(join(state, 'state.json'), 'utf8'))
    assert.deepEqual(saved.pendingVideos, {})
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('启动恢复时从笔记回填摘要、标签、概念与复习进度', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const review = { due: '2026-12-02', interval: 3, ease: 2.5, reps: 1 }
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '字段恢复', bvid: 'BV1fields0001',
      content: '---\ntitle: "字段恢复"\nbvid: "BV1fields0001"\nsource: "bilibili"\ntags: ["示例","类型/教程","概念/恢复概念"]\nquality: 4\ncontentType: "tutorial"\ncontentQuality: "full"\nreview: ' + JSON.stringify(review) + '\n---\n\n# 字段恢复\n\n> [!abstract] 一句话总结\n> 恢复后的摘要\n\n> [!question] 这期想回答\n> 视频到底讲了什么？\n\n> [!success] 给出的答案\n> 讲清楚了恢复逻辑。\n\n## 视频信息\n',
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1fields0001:p1': {
          key: 'bilibili:BV1fields0001:p1', activeKey: 'bilibili:BV1fields0001:p1',
          title: '字段恢复', subject: '示例', source: 'bilibili', bvid: 'BV1fields0001', page: 1,
          url: 'https://www.bilibili.com/video/BV1fields0001', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
    assert.equal(history[0].summary, '恢复后的摘要')
    assert.equal(history[0].question, '视频到底讲了什么？')
    assert.equal(history[0].answer, '讲清楚了恢复逻辑。')
    assert.deepEqual(history[0].concepts, ['恢复概念'])
    assert.equal(history[0].quality, 4)
    assert.deepEqual(history[0].review, review)
    const index = readFileSync(join(vault, '视频笔记', '视频索引.md'), 'utf8')
    assert.match(index, /字段恢复/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('flat 布局也能按身份恢复待处理记录', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '扁平恢复',
      layout: 'flat', bvid: 'BV1flat000001', content: '---\nbvid: "BV1flat000001"\n---\n正文',
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1flat000001:p1': {
          key: 'bilibili:BV1flat000001:p1', activeKey: 'bilibili:BV1flat000001:p1',
          title: '扁平恢复', subject: '示例', source: 'bilibili', bvid: 'BV1flat000001', page: 1,
          url: 'https://www.bilibili.com/video/BV1flat000001', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      noteLayout: 'flat', provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
    assert.equal(JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')).pendingVideos['bilibili:BV1flat000001:p1'], undefined)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('noteRoot 带 ./ 前缀时也能恢复待处理记录', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '根路径恢复', bvid: 'BV1root000001', content: '---\nbvid: "BV1root000001"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1root000001:p1': {
          key: 'bilibili:BV1root000001:p1', activeKey: 'bilibili:BV1root000001:p1',
          title: '根路径恢复', subject: '示例', source: 'bilibili', bvid: 'BV1root000001', page: 1,
          url: 'https://www.bilibili.com/video/BV1root000001', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, noteRoot: './视频笔记', stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    assert.equal(api.getHistory().length, 1)
    assert.equal(api.getHistory()[0].notePath, note.relPath)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('切换布局后仍能恢复另一种布局写入的笔记', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '布局切换恢复', bvid: 'BV1layout0001', content: '---\nbvid: "BV1layout0001"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1layout0001:p1': {
          key: 'bilibili:BV1layout0001:p1', activeKey: 'bilibili:BV1layout0001:p1',
          title: '布局切换恢复', subject: '示例', source: 'bilibili', bvid: 'BV1layout0001', page: 1,
          url: 'https://www.bilibili.com/video/BV1layout0001', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true, noteLayout: 'flat',
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    assert.equal(api.getHistory().length, 1)
    assert.equal(api.getHistory()[0].notePath, note.relPath)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('待处理记录指向别的笔记时按 bvid 找回正确笔记', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const target = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '目标视频', bvid: 'BV1right00001', content: '---\nbvid: "BV1right00001"\n---\n目标' })
    const other = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '别的视频', bvid: 'BV1other00001', content: '---\nbvid: "BV1other00001"\n---\n别的' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1right00001:p1': {
          key: 'bilibili:BV1right00001:p1', activeKey: 'bilibili:BV1right00001:p1',
          title: '目标视频', subject: '示例', source: 'bilibili', bvid: 'BV1right00001', page: 1,
          url: 'https://www.bilibili.com/video/BV1right00001', author: '', notePath: other.relPath, transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, target.relPath)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('启动时恢复已写入笔记的复习进度', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const review = { due: '2026-12-01', interval: 3, ease: 2.5, reps: 1 }
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '复习恢复', bvid: 'BV1eeeeeeeee', content: '---\nbvid: "BV1eeeeeeeee"\nreview: ' + JSON.stringify(review) + '\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: { 示例: { videos: [{ title: '复习恢复', notePath: note.relPath, tags: [] }] } },
      pendingReviews: { [note.relPath]: { review, at: 1 } },
    }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    assert.deepEqual(api.getHistory()[0].review, review)
    const saved = JSON.parse(readFileSync(join(state, 'state.json'), 'utf8'))
    assert.deepEqual(saved.pendingReviews, {})
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
    assert.equal(result.partial, true)
    assert.equal(result.changed, 1)
    assert.equal(result.remaining, 1)
    assert.equal(result.retryable, true)
    const saved = JSON.parse(readFileSync(join(state, 'state.json'), 'utf8'))
    assert.deepEqual(saved.subjects.示例.videos[0].tags, ['示例', '新主题'])
    assert.deepEqual(saved.subjects.示例.videos[1].tags, ['示例', '旧主题'])
    assert.match(readFileSync(note.absPath, 'utf8'), /新主题/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})


test('复习进度首次落盘失败时不修改笔记', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '复习失败', bvid: 'BV1fffffffff', content: '---\nbvid: "BV1fffffffff"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [{ title: '复习失败', notePath: note.relPath }] } } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    rmSync(join(state, 'state.json'))
    mkdirSync(join(state, 'state.json'))
    const result = await api.recordReview({ notePath: note.relPath, rating: 'easy' })
    assert.equal(result.ok, false)
    assert.equal(result.partial, undefined)
    assert.equal(result.stateSaved, false)
    assert.equal(result.retryable, true)
    assert.match(result.message, /状态保存失败/)
    assert.doesNotMatch(readFileSync(note.absPath, 'utf8'), /^review:/m)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('复习进度末次保存失败后重试不会跳级', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '复习重试', bvid: 'BV1ggggggggg', content: '---\nbvid: "BV1ggggggggg"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [{ title: '复习重试', notePath: note.relPath }] } } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    const before = readFileSync(join(state, 'state.json'), 'utf8')
    const firstRun = api.recordReview({ notePath: note.relPath, rating: 'easy' })
    // 首次 pending 已同步落盘，随后把 state.json 换成目录，让末次保存失败。
    rmSync(join(state, 'state.json'))
    mkdirSync(join(state, 'state.json'))
    const first = await firstRun
    assert.equal(first.ok, false)
    assert.equal(first.partial, true)
    assert.match(readFileSync(note.absPath, 'utf8'), /^review:/m)
    rmSync(join(state, 'state.json'), { recursive: true, force: true })
    writeFileSync(join(state, 'state.json'), before)
    const second = await api.recordReview({ notePath: note.relPath, rating: 'easy' })
    assert.equal(second.ok, true, second.message)
    assert.equal(second.review.interval, 1)
    assert.equal(JSON.parse(readFileSync(note.absPath, 'utf8').match(/^review: (.*)$/m)[1]).interval, 1)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('笔记写入抛错时保留复习待处理记录', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '复习写入异常', bvid: 'BV1throw0001', content: '---\nbvid: "BV1throw0001"\n---\n正文' })
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [{ title: '复习写入异常', notePath: note.relPath }] } } }))
    const api = apply(fakeCtx(new Map()), {
      vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
      provider: 'fake', model: 'fake-model', enableMnemon: false,
    })
    await api.ready
    // 把笔记换成目录，让 updateNoteReview 在读取时抛错，模拟超时/权限失败。
    rmSync(note.absPath)
    mkdirSync(note.absPath)
    const result = await api.recordReview({ notePath: note.relPath, rating: 'easy' })
    assert.equal(result.ok, false)
    assert.equal(result.pendingSaved, true)
    const saved = JSON.parse(readFileSync(join(state, 'state.json'), 'utf8'))
    assert.ok(saved.pendingReviews[note.relPath])
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('重整理时状态指向别的笔记同名存档，改用属于本篇的副本', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-controller-state-'))
  try {
    const note = await writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '学科乙', title: '同名视频', source: 'youtube', videoId: 'ExampleId01', content: '---\nsource: "youtube"\nvideoId: "ExampleId01"\n---\n原笔记' })
    const archive = (notePath, transcript) => renderTranscriptNote({ title: '同名视频', notePath, transcript })
    const common = { vaultPath: vault, noteRoot: '视频笔记', noteName: '同名视频' }
    const first = await writeTranscriptNote({ ...common, content: archive('视频笔记/笔记/学科甲/同名视频.md', '甲的字幕') })
    const second = await writeTranscriptNote({ ...common, content: archive(note.relPath, '乙的字幕') })
    assert.notEqual(second.relPath, first.relPath)
    writeFileSync(join(state, 'state.json'), JSON.stringify({ subjects: { 学科乙: { videos: [{
      title: '同名视频', source: 'youtube', videoId: 'ExampleId01', url: 'https://www.youtube.com/watch?v=ExampleId01',
      notePath: note.relPath, transcriptPath: first.relPath, createdAt: Date.now(),
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

test('繁忙时接受失败重试，排队期间保留记录，停止轮询后仍会实际执行', { timeout: 4000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'seen-queued-retry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const vault = join(root, 'vault')
  const stateDir = join(root, 'state')
  mkdirSync(vault)
  mkdirSync(stateDir)
  const key = 'youtube:ExampleId02'
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ failures: {
    [key]: { count: 3, at: Date.now(), meta: { source: 'youtube', videoId: 'ExampleId02', title: '示例二' } },
  } }))
  let begin, resume
  const entered = new Promise(resolve => { begin = resolve })
  const firstCanFinish = new Promise(resolve => { resume = resolve })
  t.after(resume)
  let calls = 0
  const tools = new Map()
  const ctx = fakeCtx(tools)
  ctx.llm.stream = async function* () {
    if (++calls === 1) { begin(); await firstCanFinish }
    yield { type: 'text-delta', text: '{"isCourse":false,"confidence":1}' }
  }
  const api = apply(ctx, { vaultPath: vault, stateDir, exposeController: true, autoStart: false,
    fetchContent: false, fetchTranscript: false, openInObsidian: false, enableMnemon: false })
  await api.ready
  api.start()
  const scan = tools.get('course_map_scan').execute({ title: '示例一', url: 'https://youtu.be/ExampleId01' })
  await entered
  const retry = api.retryFailure(key)
  assert.equal(api.getFailures()[0]?.count, 3)
  api.stop()
  resume()
  assert.equal((await scan).ok, true)
  const result = await retry
  assert.equal(result.ok, true)
  assert.match(result.message, /非知识内容/)
  assert.equal(calls, 2)
  assert.deepEqual(api.getFailures(), [])
  assert.deepEqual(JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')).failures, {})
})

test('强制重生成沿用原学科和路径，保留手写补充、复习和字幕存档', async t => {
  const root = mkdtempSync(join(tmpdir(), 'seen-regenerate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const vaultPath = join(root, 'vault')
  let classification = { subject: '物理学', title: '偏振的原始标题' }
  const ctx = fakeCtx(new Map())
  ctx.llm.stream = async function* ({ system }) {
    const reply = system.includes('分类助手')
      ? { isCourse: true, ...classification }
      : { summary: '摘要 · ' + classification.title, keyPoints: ['知识点'] }
    yield { type: 'text-delta', text: JSON.stringify(reply) }
  }
  const api = apply(ctx, { vaultPath, stateDir: join(root, 'state'), autoStart: false, exposeController: true,
    fetchContent: false, fetchTranscript: false, openInObsidian: false, enableMnemon: false })
  const input = { title: '偏振的原始标题', url: 'https://youtu.be/ExampleId08' }
  await api.ready
  const first = await api.scan({ ...input, transcript: '本地原声字幕存档。' })
  assert.equal(first.ok, true, first.message)
  const note = join(vaultPath, first.notePath)
  writeFileSync(note, readFileSync(note, 'utf8').replace('<!-- MANUAL:END -->', '自写实验记录\n<!-- MANUAL:END -->'))
  assert.equal((await api.recordReview({ notePath: first.notePath, rating: 'easy' })).ok, true)
  const before = api.getHistory()[0]
  assert.ok(before.transcriptPath)

  const classifications = []
  api.onEvent(event => {
    if (event.type === 'classified') classifications.push(event.data.subject)
  })
  classification = { subject: '实验方法', title: '新标题：偏振实验' }
  const result = await api.scan({ ...input, force: true })
  assert.equal(result.ok, true, result.message)
  assert.equal(result.subject, '物理学')
  assert.deepEqual(classifications, ['物理学'])
  assert.equal(result.notePath, first.notePath)
  const [after, duplicate] = api.getHistory()
  assert.equal(duplicate, undefined)
  assert.equal(after.createdAt, before.createdAt)
  assert.deepEqual(after.review, before.review)
  assert.equal(after.transcriptPath, before.transcriptPath)
  assert.match(readFileSync(note, 'utf8'), /自写实验记录/)
  assert.match(readFileSync(note, 'utf8'), /新标题：偏振实验/)
})

test('批量视频与历史重刷每批各重建一次索引，只更新受影响的学科手册', async t => {
  const root = mkdtempSync(join(tmpdir(), 'seen-batched-pages-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = join(root, 'state')
  const vaultPath = join(root, 'vault')
  mkdirSync(stateDir)
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ subjects: { 其他学科: { videos: [] } } }))
  const ctx = fakeCtx(new Map())
  let title = ''
  ctx.llm.stream = async function* ({ system }) {
    const response = system.includes('分类助手')
      ? { isCourse: true, subject: '课程示例', title: '视频 ' + ++title }
      : { summary: '学习摘要' }
    yield { type: 'text-delta', text: JSON.stringify(response) }
  }
  const api = apply(ctx, { vaultPath, stateDir, autoStart: false, exposeController: true, fetchContent: false,
    fetchTranscript: false, openInObsidian: false, enableMnemon: false })
  await api.ready
  const result = await api.scanBatch([
    { title: '示例课程一', url: 'https://youtu.be/ExampleId01' },
    { title: '示例课程二', url: 'https://youtu.be/ExampleId02' },
  ])
  assert.equal(result.succeeded, 2)
  const log = () => readFileSync(join(stateDir, 'poll.log'), 'utf8').match(/rebuild\.pages .* manuals=\d+/g)
  assert.deepEqual(log(), ['rebuild.pages videos=2 concepts=0 topics=0 manuals=1'])
  assert.match(readFileSync(join(vaultPath, '视频笔记', '视频索引.md'), 'utf8'), /视频 1[\s\S]*视频 2|视频 2[\s\S]*视频 1/)
  const refreshed = await api.refreshHistory()
  assert.equal(refreshed.failed, 0, JSON.stringify(refreshed.warnings))
  assert.equal(refreshed.done, 2)
  assert.equal(log().length, 2)
  assert.equal(api.getHistory().length, 2)
})
