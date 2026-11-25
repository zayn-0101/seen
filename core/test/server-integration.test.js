import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/index.js')
const fixtureKey = 'fixture-key-do-not-use'

async function startFixture({ video = true, videoCount = 1, locked = false, release, envModel = false, damaged = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seen-server-test-'))
  const vault = join(root, 'vault')
  const stateDir = join(root, 'state')
  await Promise.all([mkdir(vault), mkdir(stateDir), mkdir(join(root, '.seen'))])

  const modelRequests = []
  const modelServer = createServer(async (req, res) => {
    if (req.url === '/releases/latest' && release) return release(req, res)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    modelRequests.push({ path: req.url, authorization: req.headers.authorization || '', model: body.model, stream: body.stream })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }], choices: [{ message: { content: 'ok' } }] }))
  })
  modelServer.listen(0, '127.0.0.1')
  await once(modelServer, 'listening')
  const modelBase = 'http://127.0.0.1:' + modelServer.address().port
  if (!envModel) await writeFile(join(root, '.seen', 'llm.json'), JSON.stringify({
    provider: 'fixture', baseURL: modelBase + '/v1', model: 'fixture-model', apiKey: fixtureKey,
  }))
  if (video) {
    const videos = Array.from({ length: videoCount }, (_, index) => {
      const title = index ? '示例视频' + index : '示例视频'
      return { title, subject: '示例', source: 'bilibili', notePath: '视频笔记/笔记/示例/' + title + '.md', createdAt: Date.now() }
    })
    await writeFile(join(stateDir, 'state.json'), JSON.stringify({ subjects: { 示例: { videos } } }))
  }
  if (damaged) {
    await writeFile(join(stateDir, 'state.json'), '{"subjects":')
    await mkdir(join(vault, '视频笔记'), { recursive: true })
    await writeFile(join(vault, '视频笔记/视频索引.md'), '已有索引示例')
  }
  if (locked) await writeFile(join(stateDir, 'instance.lock'), String(process.pid))

  // 子进程的 home 指向临时测试目录，避免读取或改写用户配置。
  const preload = join(root, 'isolate.cjs')
  await writeFile(preload, `
const os = require('node:os')
const http = require('node:http')
const { syncBuiltinESMExports } = require('node:module')
os.homedir = () => process.env.SEEN_TEST_ROOT
if (process.env.SEEN_TEST_RELEASE) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, options) => originalFetch(
    String(input) === 'https://api.github.com/repos/zayn-0101/seen/releases/latest' ? process.env.SEEN_TEST_RELEASE : input, options)
}
const createServer = http.createServer
http.createServer = function (...args) {
  const server = createServer.apply(this, args)
  server.once('listening', () => process.send?.({ port: server.address().port }))
  return server
}
syncBuiltinESMExports()
`)
  const child = fork(serverEntry, ['--no-open'], {
    execArgv: ['--require', preload],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('SEEN_'))),
      SEEN_TEST_ROOT: root,
      SEEN_PORT: '0', SEEN_HOST: '127.0.0.1', SEEN_NO_OPEN: '1',
      SEEN_STATE_DIR: stateDir, SEEN_VAULT: vault,
      ...(envModel ? { SEEN_LLM_BASE_URL: modelBase + '/v1', SEEN_LLM_MODEL: 'fixture-model', SEEN_LLM_API_KEY: fixtureKey } : {}),
      ...(release ? { SEEN_TEST_RELEASE: modelBase + '/releases/latest' } : { SEEN_DISABLE_UPDATE_CHECK: '1' }),
      SEEN_DISABLE_NOTIFY: '1', SEEN_DISABLE_MNEMON: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics += String(chunk) })
  child.stderr.on('data', chunk => { diagnostics += String(chunk) })
  let timer
  const port = await Promise.race([
    new Promise((resolvePort, reject) => {
      child.on('message', message => { if (message?.port) resolvePort(message.port) })
      child.once('exit', code => reject(new Error('测试服务提前退出：' + code + '\n' + diagnostics)))
    }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('测试服务启动超时\n' + diagnostics)), 12000) }),
  ]).finally(() => clearTimeout(timer))
  const base = 'http://127.0.0.1:' + port
  return {
    root, vault, modelBase, modelRequests, child, base,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await once(child, 'exit')
      }
      await new Promise(resolveClose => modelServer.close(resolveClose))
      await rm(root, { recursive: true, force: true })
    },
  }
}

function post(base, path, body = {}, headers = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

test('服务使用隔离数据：阻止跨站请求，模型密钥只发往匹配的服务', async t => {
  const f = await startFixture()
  t.after(() => f.stop())
  assert.equal((await fetch(f.base + '/api/status')).status, 200)
  assert.equal((await post(f.base, '/api/config', { started: true }, { Origin: 'https://external.example' })).status, 403)
  assert.equal((await fetch(f.base + '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await fetch(f.base + '/api/config', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"started":true}' })).status, 415)
  const malformed = await fetch(f.base + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"apiKey":"fixture-secret' })
  assert.equal(malformed.status, 400)
  assert.doesNotMatch(await malformed.text(), /fixture-secret/)

  f.modelRequests.length = 0
  const other = await post(f.base, '/api/llm/models', { provider: 'custom', baseURL: f.modelBase + '/other', apiKey: '' })
  assert.equal(other.status, 200)
  assert.equal(f.modelRequests.find(row => row.path === '/other/models')?.authorization, '')
  const same = await post(f.base, '/api/llm/models', { provider: 'fixture', baseURL: f.modelBase + '/v1', apiKey: '' })
  assert.equal(same.status, 200)
  assert.equal(f.modelRequests.find(row => row.path === '/v1/models')?.authorization, 'Bearer ' + fixtureKey)
  const tested = await post(f.base, '/api/llm/test', { baseURL: f.modelBase + '/v1', model: 'fixture-model', apiKey: '' })
  assert.equal((await tested.json()).ok, true)
  assert.equal(f.modelRequests.find(row => row.path === '/v1/chat/completions')?.authorization, 'Bearer ' + fixtureKey)
  await post(f.base, '/api/llm', { provider: 'custom', baseURL: f.modelBase + '/other', model: 'fixture-model', apiKey: '' })
  assert.ok(f.modelRequests.filter(row => row.path.startsWith('/other/')).every(row => row.authorization === ''))
})

test('手动周回顾等待写盘，重复请求保留已有内容', async t => {
  const f = await startFixture()
  t.after(() => f.stop())
  const first = await (await post(f.base, '/api/review')).json()
  assert.equal(first.count, 1)
  assert.equal(first.skipped, false)
  assert.match(first.relPath, /^视频笔记\/资料\/回顾\/.+\.md$/)
  const original = await readFile(first.absPath, 'utf8')
  assert.match(original, /示例视频/)
  const second = await (await post(f.base, '/api/review')).json()
  assert.equal(second.skipped, true)
  assert.equal(await readFile(first.absPath, 'utf8'), original)
})

test('空周不提前创建回顾文件，只读实例不写入笔记', async t => {
  const empty = await startFixture({ video: false })
  t.after(() => empty.stop())
  const result = await (await post(empty.base, '/api/review')).json()
  assert.equal(result.count, 0)
  assert.equal(result.skipped, true)
  assert.equal(result.relPath, undefined)

  const readonly = await startFixture({ locked: true })
  t.after(() => readonly.stop())
  const status = await (await fetch(readonly.base + '/api/status')).json()
  assert.equal(status.status.readOnly, true)
  assert.equal((await post(readonly.base, '/api/review')).status, 409)
  assert.equal((await post(readonly.base, '/api/reviews', { notePath: '视频笔记/笔记/示例/示例视频.md', rating: 'easy' })).status, 409)
  assert.equal((await post(readonly.base, '/api/reprocess')).status, 409)
  assert.equal((await post(readonly.base, '/api/config', { pollIntervalMs: 2000 })).status, 409)
  // 模型列表只读外部服务，不写本地状态，只读实例也必须可用。
  assert.equal((await post(readonly.base, '/api/llm/models', { provider: 'fixture', baseURL: readonly.modelBase + '/v1', apiKey: '' })).status, 200)
  await assert.rejects(readFile(join(readonly.vault, '视频笔记', '视频索引.md')))
})

test('更新检查接口返回当前版本，关闭时明确标记', async t => {
  const f = await startFixture()
  t.after(() => f.stop())
  const data = await (await fetch(f.base + '/api/update?force=1')).json()
  assert.equal(data.ok, true)
  assert.match(data.current, /^\d+\.\d+\.\d+$/)
  assert.equal(data.disabled, true)
  assert.equal(data.available, false)
  assert.equal(data.latest, '')
})

test('保存模型后，状态与下一次真实问答使用同一模型，同端点环境配置可以留空保存', async t => {
  const f = await startFixture({ envModel: true })
  t.after(() => f.stop())
  const dir = join(f.vault, '视频笔记/笔记/示例')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '示例视频.md'), '# 示例视频\n\n示例正文。')
  const before = await (await fetch(f.base + '/api/llm')).json()
  assert.equal(before.source, 'env')
  const saved = await post(f.base, '/api/llm', { provider: 'custom', baseURL: f.modelBase + '/v1', model: 'second-model', apiKey: '' })
  assert.equal((await saved.json()).ok, true)
  const persisted = join(f.root, '.seen/llm.json')
  assert.equal((await stat(persisted)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(persisted, 'utf8')).model, 'second-model')
  const ask = await post(f.base, '/api/ask', { question: '示例视频' })
  const result = await ask.json()
  assert.equal(result.ok, true)
  assert.ok(result.sources.length)
  const outgoing = f.modelRequests.find(row => row.stream === true)
  assert.equal(outgoing?.model, 'second-model')
  assert.equal(outgoing.authorization, 'Bearer ' + fixtureKey)
  const status = await (await fetch(f.base + '/api/status')).json()
  assert.equal(status.config.model, status.llm.model)
  assert.equal(status.config.provider, 'custom')
})

test('菜单栏状态请求省略笔记和事件，默认接口仍提供完整历史', async t => {
  const f = await startFixture({ videoCount: 250 })
  t.after(() => f.stop())
  const full = await (await fetch(f.base + '/api/status')).json()
  const compact = await (await fetch(f.base + '/api/status?view=menubar')).json()
  assert.equal(full.history.length, 250)
  const fullBytes = Buffer.byteLength(JSON.stringify(full))
  const compactBytes = Buffer.byteLength(JSON.stringify(compact))
  assert.ok(compactBytes < fullBytes / 20)
  t.diagnostic('250 篇示例笔记，完整响应 ' + fullBytes + ' 字节，菜单栏响应 ' + compactBytes + ' 字节')
  for (const key of ['history', 'reviews', 'events']) assert.equal(key in compact, false)
  assert.deepEqual(compact.status.subjects, full.status.subjects)
  assert.equal(compact.llm.configured, full.llm.configured)
})

test('更新检查失败可以立即重试，并发检查共享结果，只缓存成功响应', async t => {
  let calls = 0
  let reply = () => ({ status: 503, data: {} })
  const f = await startFixture({ release: async (_req, res) => {
    calls++
    const { status, data } = await reply()
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  } })
  t.after(() => f.stop())
  const query = (force = false) => fetch(f.base + '/api/update' + (force ? '?force=1' : ''))
  assert.equal((await query()).status, 502)
  reply = () => ({ status: 200, data: { tag_name: 'not-a-version' } })
  assert.equal((await query()).status, 502)
  let releaseResponse
  const wait = new Promise(resolve => { releaseResponse = resolve })
  reply = async () => { await wait; return { status: 200, data: { tag_name: 'v12.0.1' } } }
  const before = calls
  const requests = Promise.all([query(), query(), query()])
  t.after(() => releaseResponse())
  setTimeout(releaseResponse, 100)
  for (const res of await requests) {
    assert.equal(res.status, 200)
    assert.equal((await res.json()).latest, '12.0.1')
  }
  assert.equal(calls, before + 1)
  await query()
  assert.equal(calls, before + 1)
  reply = () => ({ status: 429, data: {} })
  assert.equal((await query(true)).status, 502)
  assert.equal((await (await query()).json()).latest, '12.0.1')
})

test('状态 JSON 损坏时服务进入只读，保留原文件和已有索引', async t => {
  const f = await startFixture({ damaged: true })
  t.after(() => f.stop())
  const status = await (await fetch(f.base + '/api/status')).json()
  assert.equal(status.status.readOnlyReason, 'state-unreadable')
  assert.equal(status.status.readOnly, true)
  const scan = await post(f.base, '/api/scan', { url: 'https://youtu.be/ExampleId01' })
  assert.equal(scan.status, 409)
  assert.match((await scan.json()).error, /state\.json/)
  assert.equal(await readFile(join(f.root, 'state/state.json'), 'utf8'), '{"subjects":')
  assert.equal(await readFile(join(f.vault, '视频笔记/视频索引.md'), 'utf8'), '已有索引示例')
})
