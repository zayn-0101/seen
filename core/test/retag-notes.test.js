import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../../scripts/retag-notes.mjs', import.meta.url))

test('重打标签保留原文，模型或索引失败会报错，再次运行补齐索引', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'seen-retag-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const vault = join(dir, 'vault')
  const state = join(dir, 'state')
  const root = join(vault, '笔记')
  const notePath = '笔记/示例.md'
  const note = join(vault, notePath)
  const stateFile = join(state, 'state.json')
  const preload = join(dir, 'isolate.cjs')
  await Promise.all([mkdir(root, { recursive: true }), mkdir(state)])
  const original = '\uFEFF---\r\ntitle: 示例\r\ntags:\r\n  - 旧标签\r\n  - 概念/双向链接\r\n---\r\n保留手写正文\r\n'
  await writeFile(note, original)
  const initialState = JSON.stringify({ subjects: { 示例: { videos: [{ notePath, title: '示例', tags: ['旧标签', '概念/双向链接'] }] } } })
  await writeFile(stateFile, initialState)
  await writeFile(preload, `
require('node:os').homedir = () => process.env.SEEN_TEST_DIR
require('node:module').syncBuiltinESMExports()
globalThis.fetch = async () => Response.json({ choices: [{message: {content: process.env.SEEN_TEST_REPLY}}] })
`)
  const reply = JSON.stringify({ themes: ['知识管理'], types: ['教程'] })
  const run = (args, response = reply) => spawnSync(process.execPath, ['--require', preload, entry, ...args], {
    encoding: 'utf8', timeout: 8000,
    env: { ...process.env, SEEN_VAULT: vault, SEEN_NOTE_ROOT: '笔记', SEEN_STATE_DIR: state, SEEN_TEST_DIR: dir,
      SEEN_LLM_BASE_URL: 'http://127.0.0.1:1/v1', SEEN_LLM_MODEL: 'test', SEEN_LLM_API_KEY: '', SEEN_TEST_REPLY: response },
  })

  assert.equal(run(['--apply', '--limit', '错误']).status, 2)
  assert.equal(run([]).status, 0)
  assert.equal(run(['--apply'], '{}').status, 1)
  assert.equal(await readFile(note, 'utf8'), original)
  assert.equal(await readFile(stateFile, 'utf8'), initialState)
  await assert.rejects(readdir(join(dir, 'backups')), { code: 'ENOENT' })

  const conceptIndex = join(root, '概念索引.md')
  await mkdir(conceptIndex)
  const incomplete = run(['--apply'])
  assert.equal(incomplete.status, 1)
  assert.doesNotMatch(incomplete.stdout, /索引已重建/)
  const tags = ['示例', '知识管理', '类型/教程', '概念/双向链接']
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')).subjects.示例.videos[0].tags, tags)
  assert.equal(await readFile(note, 'utf8'), original.replace('tags:\r\n  - 旧标签\r\n  - 概念/双向链接', 'tags: ' + JSON.stringify(tags)))
  const [backup] = await readdir(join(dir, 'backups'))
  assert.equal(await readFile(join(dir, 'backups', backup, '示例.md'), 'utf8'), original)

  await rename(conceptIndex, join(dir, '旧测试目录'))
  const retried = run(['--apply'])
  assert.equal(retried.status, 0, retried.stderr)
  assert.match(retried.stdout, /索引已重建/)
  assert.match(await readFile(conceptIndex, 'utf8'), /双向链接/)
  assert.match(await readFile(join(root, '标签索引.md'), 'utf8'), /知识管理/)
  assert.deepEqual(await readdir(join(dir, 'backups')), [backup])
})
