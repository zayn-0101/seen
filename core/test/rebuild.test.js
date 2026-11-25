import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync, appendFileSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHistoryFromState, rebuildKnowledgePages } from '../lib/rebuild.js'

function makeState(now) {
  return {
    subjects: {
      知识管理: {
        videos: [
          {
            title: '第一篇',
            notePath: '视频笔记/笔记/知识管理/第一篇.md',
            summary: '第一篇文章',
            tags: ['知识管理', '笔记工具', '类型/教程'],
            concepts: ['双向链接', '卡片笔记'],
            conceptDetails: [{ name: '双向链接', brief: '两条笔记互相指向' }],
            terms: [{ name: '双向链接', brief: '两条笔记互相指向' }],
            template: { comparisons: [{ item: 'Obsidian', verdict: '更灵活', basis: '插件生态' }], doubts: ['长期维护成本'] },
            createdAt: now - 3600000,
          },
          {
            title: '第二篇',
            notePath: '视频笔记/笔记/知识管理/第二篇.md',
            summary: '第二篇文章',
            tags: ['知识管理', '笔记工具'],
            concepts: ['双向链接'],
            createdAt: now - 7200000,
          },
        ],
      },
      科技评论: {
        videos: [
          {
            title: '第三篇',
            notePath: '视频笔记/笔记/科技评论/第三篇.md',
            summary: '第三篇文章',
            tags: ['科技评论', '笔记工具'],
            concepts: ['双向链接'],
            createdAt: now - 10800000,
          },
        ],
      },
    },
  }
}

test('buildHistoryFromState flattens subjects and keeps concept details', () => {
  const rows = buildHistoryFromState(makeState(Date.now()))
  assert.equal(rows.length, 3)
  assert.equal(rows[0].subject, '知识管理')
  assert.deepEqual(rows[0].conceptDetails, [{ name: '双向链接', brief: '两条笔记互相指向' }])
})

test('rebuildKnowledgePages writes indexes, concept/topic pages, manuals and overview', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-rebuild-'))
  try {
    const result = await rebuildKnowledgePages({
      vaultPath: vault,
      noteRoot: '视频笔记',
      state: makeState(Date.now()),
      layout: 'structured',
    })
    assert.deepEqual(result, { videos: 3, concepts: 1, topics: 1, subjects: 2 })
    const concept = readFileSync(join(vault, '视频笔记', '资料', '概念', '双向链接.md'), 'utf8')
    assert.match(concept, /## 概念释义/)
    assert.match(concept, /第一篇/)
    assert.ok(existsSync(join(vault, '视频笔记', '资料', '主题', '笔记工具.md')))
    const manual = readFileSync(join(vault, '视频笔记', '资料', '手册', '知识管理.md'), 'utf8')
    assert.match(manual, /## 学习路径/)
    assert.match(manual, /## 术语表/)
    assert.match(manual, /## 常见对比/)
    assert.match(manual, /## 待解问题/)
    const overview = readFileSync(join(vault, '视频笔记', '总览.md'), 'utf8')
    assert.match(overview, /## 最近更新/)
    assert.match(overview, /## 知识库概况/)
    assert.ok(existsSync(join(vault, '视频笔记', '视频索引.md')))
    assert.ok(existsSync(join(vault, '视频笔记', '概念索引.md')))
    assert.ok(existsSync(join(vault, '视频笔记', '标签索引.md')))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('概念和主题退出建页范围时只更新自动区，重新达标后恢复收录', async t => {
  const vaultPath = mkdtempSync(join(tmpdir(), 'seen-old-pages-'))
  t.after(() => rmSync(vaultPath, { recursive: true, force: true }))
  const state = makeState(Date.now())
  const config = { vaultPath, noteRoot: '视频笔记', layout: 'structured' }
  await rebuildKnowledgePages({ ...config, state })
  const dir = join(vaultPath, '视频笔记', '资料')
  const concept = join(dir, '概念', '双向链接.md')
  const topic = join(dir, '主题', '笔记工具.md')
  const handWritten = join(dir, '概念', '自行写的笔记.md')
  const manual = '\n手写思考和外部链接\n'
  for (const path of [concept, topic]) appendFileSync(path, manual)
  writeFileSync(handWritten, '自写内容，不参与自动收录。')

  await rebuildKnowledgePages({ ...config, state: { subjects: {} } })
  for (const path of [concept, topic]) {
    const text = readFileSync(path, 'utf8')
    assert.match(text, /不在知识库的自动收录范围/)
    assert.ok(text.endsWith(manual))
    assert.doesNotMatch(text, /\[\[.*第一篇/)
  }
  assert.equal(readFileSync(handWritten, 'utf8'), '自写内容，不参与自动收录。')

  await rebuildKnowledgePages({ ...config, state })
  for (const path of [concept, topic]) {
    const text = readFileSync(path, 'utf8')
    assert.match(text, /\[\[.*第一篇/)
    assert.ok(text.endsWith(manual))
  }
})

test('用户重命名概念页后不把改名文件标成退出收录', async t => {
  const vaultPath = mkdtempSync(join(tmpdir(), 'seen-renamed-pages-'))
  t.after(() => rmSync(vaultPath, { recursive: true, force: true }))
  const state = makeState(Date.now())
  const config = { vaultPath, noteRoot: '视频笔记', layout: 'structured' }
  await rebuildKnowledgePages({ ...config, state })
  const dir = join(vaultPath, '视频笔记', '资料', '概念')
  const source = join(dir, '双向链接.md')
  const renamed = join(dir, '双向链接（我的）.md')
  renameSync(source, renamed)
  await rebuildKnowledgePages({ ...config, state })
  const text = readFileSync(renamed, 'utf8')
  assert.match(text, /\[\[.*第一篇/)
  assert.doesNotMatch(text, /不在知识库的自动收录范围/)
})
