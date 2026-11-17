import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), '../../server/index.js')
const fixtureKey = 'fixture-key-do-not-use'

async function startFixture({ video = true, locked = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seen-server-test-'))
  const vault = join(root, 'vault')
  const stateDir = join(root, 'state')
  await Promise.all([mkdir(vault), mkdir(stateDir), mkdir(join(root, '.seen'))])

  const modelRequests = []
  const modelServer = createServer((req, res) => {
    modelRequests.push({ path: req.url, authorization: req.headers.authorization || '' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fixture-model' }], choices: [{ message: { content: 'ok' } }] }))
  })
  modelServer.listen(0, '127.0.0.1')
  await once(modelServer, 'listening')
  const modelBase = 'http://127.0.0.1:' + modelServer.address().port
  await writeFile(join(root, '.seen', 'llm.json'), JSON.stringify({
    provider: 'fixture', baseURL: modelBase + '/v1', model: 'fixture-model', apiKey: fixtureKey,
  }))
  if (video) {
    await writeFile(join(stateDir, 'state.json'), JSON.stringify({ subjects: { 示例: { videos: [{
      title: '示例视频', subject: '示例', source: 'bilibili', notePath: '视频笔记/笔记/示例/示例视频.md', createdAt: Date.now(),
    }] } } }))
  }
  if (locked) await writeFile(join(stateDir, 'instance.lock'), String(process.pid))

  // 子进程的 home 指向临时测试目录，避免读取或改写用户配置。
  const preload = join(root, 'isolate.cjs')
  await writeFile(preload, `
const os = require('node:os')
const http = require('node:http')
const { syncBuiltinESMExports } = require('node:module')
os.homedir = () => process.env.SEEN_TEST_ROOT
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
      SEEN_DISABLE_UPDATE_CHECK: '1', SEEN_DISABLE_NOTIFY: '1', SEEN_DISABLE_MNEMON: '1',
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
