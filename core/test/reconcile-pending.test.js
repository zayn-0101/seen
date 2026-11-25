import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { writeVideoNote } from '../lib/obsidian.js'

function fakeCtx() {
  return {
    get: () => undefined,
    effect: (fn) => fn(),
    tools: { register: () => () => {} },
    llm: {
      listProviders: () => [{ id: 'fake', models: [{ id: 'fake-model' }] }],
      stream: async function* () { yield { type: 'text-delta', text: '{}' } },
    },
  }
}

function controller(vault, state, extra = {}) {
  return apply(fakeCtx(), {
    vaultPath: vault, stateDir: state, autoStart: false, exposeController: true,
    provider: 'fake', model: 'fake-model', enableMnemon: false,
    ...extra,
  })
}

test('崩溃恢复合并同一路径的旧状态记录', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-reconcile-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-reconcile-state-'))
  try {
    const oldReview = { due: '2026-01-01', interval: 1, ease: 2.3, reps: 0 }
    const newReview = { due: '2026-12-02', interval: 3, ease: 2.5, reps: 1 }
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '同路径重刷', bvid: 'BV1stale0001',
      content: [
        '---',
        'title: "同路径重刷"',
        'bvid: "BV1stale0001"',
        'source: "bilibili"',
        'tags: ["示例","类型/教程","概念/同路径概念"]',
        'quality: 4',
        'contentType: "tutorial"',
        'contentQuality: "full"',
        'review: ' + JSON.stringify(newReview),
        '---',
        '',
        '# 同路径重刷',
        '',
        '> [!abstract] 一句话总结',
        '> 同路径新摘要',
        '',
        '> [!question] 这期想回答',
        '> 新问题？',
        '',
        '> [!success] 给出的答案',
        '> 新答案。',
        '',
        '## 视频信息',
      ].join('\n'),
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {
        示例: {
          createdAt: 1, updatedAt: 1,
          videos: [{
            title: '同路径重刷', source: 'bilibili', bvid: 'BV1stale0001', page: 1,
            notePath: note.relPath, summary: '旧摘要', question: '旧问题？', answer: '旧答案。',
            tags: ['旧标签'], concepts: ['旧概念'], quality: 1, review: oldReview,
          }],
        },
      },
      pendingVideos: {
        'bilibili:BV1stale0001:p1': {
          key: 'bilibili:BV1stale0001:p1', activeKey: 'bilibili:BV1stale0001:p1',
          title: '同路径重刷', subject: '示例', source: 'bilibili', bvid: 'BV1stale0001', page: 1,
          url: 'https://www.bilibili.com/video/BV1stale0001', author: '', notePath: note.relPath,
          transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = controller(vault, state)
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
    assert.equal(history[0].summary, '同路径新摘要')
    assert.equal(history[0].question, '新问题？')
    assert.equal(history[0].answer, '新答案。')
    assert.deepEqual(history[0].concepts, ['同路径概念'])
    assert.equal(history[0].quality, 4)
    assert.deepEqual(history[0].review, newReview)
    assert.deepEqual(JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')).pendingVideos, {})
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('恢复时保留同一视频仍在磁盘上的两篇笔记', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-reconcile-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-reconcile-state-'))
  try {
    const oldNote = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '旧学科', title: '旧标题', bvid: 'BV1move00001',
      content: '---\nbvid: "BV1move00001"\nsource: "bilibili"\n---\n旧正文',
    })
    const newNote = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '新学科', title: '新标题', bvid: 'BV1move00001',
      content: '---\nbvid: "BV1move00001"\nsource: "bilibili"\ntags: ["新学科","类型/教程","概念/迁移概念"]\nquality: 3\n---\n\n# 新标题\n\n> [!abstract] 一句话总结\n> 迁移后的摘要\n',
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {
        旧学科: {
          createdAt: 1, updatedAt: 1,
          videos: [{
            title: '旧标题', source: 'bilibili', bvid: 'BV1move00001', page: 1,
            notePath: oldNote.relPath, summary: '旧摘要', tags: ['旧标签'], quality: 1,
          }],
        },
      },
      pendingVideos: {
        'bilibili:BV1move00001:p1': {
          key: 'bilibili:BV1move00001:p1', activeKey: 'bilibili:BV1move00001:p1',
          title: '新标题', subject: '新学科', source: 'bilibili', bvid: 'BV1move00001', page: 1,
          url: 'https://www.bilibili.com/video/BV1move00001', author: '', notePath: newNote.relPath,
          transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = controller(vault, state)
    await api.ready
    const history = api.getHistory()
    assert.equal(history.length, 2)
    const restored = history.find(video => video.notePath === newNote.relPath)
    assert.equal(restored.title, '新标题')
    assert.equal(restored.summary, '迁移后的摘要')
    assert.equal((await api.getSnapshot()).duplicateVideos.length, 1)
    assert.equal(readFileSync(join(vault, oldNote.relPath), 'utf8').includes('旧正文'), true)
    assert.deepEqual(JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')).pendingVideos, {})
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})

test('首次权限超时后 reprobe 成功会补跑待处理恢复', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-reconcile-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-reconcile-state-'))
  try {
    const note = await writeVideoNote({
      vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '授权后恢复', bvid: 'BV1late000001',
      content: '---\nbvid: "BV1late000001"\nsource: "bilibili"\n---\n正文',
    })
    writeFileSync(join(state, 'state.json'), JSON.stringify({
      subjects: {},
      pendingVideos: {
        'bilibili:BV1late000001:p1': {
          key: 'bilibili:BV1late000001:p1', activeKey: 'bilibili:BV1late000001:p1',
          title: '授权后恢复', subject: '示例', source: 'bilibili', bvid: 'BV1late000001', page: 1,
          url: 'https://www.bilibili.com/video/BV1late000001', author: '', notePath: '', transcriptPath: '', createdAt: 1,
        },
      },
    }))
    const api = controller(vault, state, {
      vaultAccess: { ok: false, code: 'timeout', detail: '首次授权超时', checkedAt: 1 },
    })
    await api.ready
    assert.equal(api.getHistory().length, 0)
    assert.equal(Object.keys(JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')).pendingVideos).length, 1)
    const status = await api.reprobeVault()
    assert.equal(status.ok, true, status.detail)
    const history = api.getHistory()
    assert.equal(history.length, 1)
    assert.equal(history[0].notePath, note.relPath)
    assert.deepEqual(JSON.parse(readFileSync(join(state, 'state.json'), 'utf8')).pendingVideos, {})
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})
