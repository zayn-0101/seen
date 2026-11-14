#!/usr/bin/env node
/**
 * Seen（拾影）本地服务：轮询 B站/抖音精选/YouTube、生成总结并写入 Obsidian。
 *
 * 前端：http://127.0.0.1:4780
 * 后端：复用 Seen Core 的轮询与总结模块；LLM 默认连接本机 Magpie 网关。
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, extname, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { apply } from '../core/lib/index.js'
import { resolveConfig } from '../core/lib/config.js'
import { createNotifier } from '../core/lib/notify.js'
import { buildWeeklyReview } from '../core/lib/review.js'
import { writeWeeklyReview, writeIndexNote } from '../core/lib/obsidian.js'
import { buildIndexMarkdown } from '../core/lib/index-note.js'
import { findMnemon } from '../core/lib/mnemon.js'
import { WHISPER_MODELS, findWhisperModel, installWhisperCli, installWhisperModel } from '../core/lib/whisper.js'
import {
  PROVIDERS,
  PROVIDER_GROUPS,
  createLlmClient,
  detectMagpie,
  fetchModels,
  maskKey,
  readSavedConfig,
  resolveLlmConfig,
  saveLlmConfig,
  testLlmConfig,
} from './llm.js'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..', 'web')
const uiDir = join(homedir(), '.seen')
const uiPath = join(uiDir, 'ui.json')
const PORT = Number(process.env.SEEN_PORT || 4780)
const HOST = process.env.SEEN_HOST || '127.0.0.1'
const OPEN_BROWSER = !process.argv.includes('--no-open') && process.env.SEEN_NO_OPEN !== '1'

function log(...args) {
  console.log('[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ']', ...args)
}

async function readJson(file, fallback) {
  try {
    const text = await readFile(file, 'utf8')
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : fallback
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

const ui = {
  pollIntervalMs: 15000,
  started: false,
  ...(await readJson(uiPath, {})),
}
if (!Number.isFinite(Number(ui.pollIntervalMs))) ui.pollIntervalMs = 15000

const resolvedLlm = await resolveLlmConfig()
let llmConfig = resolvedLlm.config
let llmSource = resolvedLlm.source
const llm = createLlmClient(llmConfig)
let llmHealth = await llm.health()
const mnemonBin = await findMnemon({})
const mnemonAvailable = Boolean(mnemonBin)

const baseConfig = resolveConfig({
  pollIntervalMs: Number(ui.pollIntervalMs) || 15000,
  autoStart: false,
  exposeController: true,
  provider: llmConfig.provider,
  model: llmConfig.model,
  enableMnemon: mnemonAvailable && process.env.SEEN_DISABLE_MNEMON !== '1' && ui.mnemonEnabled !== false,
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
})

const tools = new Map()
const disposers = []
const ctx = {
  get: () => undefined,
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  tools: {
    register: (definition) => {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  llm,
}

const engine = apply(ctx, baseConfig)
if (!engine || typeof engine.getStatus !== 'function') {
  console.error('核心入口没有返回控制器，请检查 core 版本。')
  process.exit(1)
}

const sseClients = new Set()
const recentEvents = []

function broadcast(event) {
  recentEvents.push(event)
  if (recentEvents.length > 100) recentEvents.shift()
  const payload = 'data: ' + JSON.stringify(event) + '\n\n'
  for (const client of sseClients) {
    try { client.write(payload) } catch { sseClients.delete(client) }
  }
}

const notifier = createNotifier({ enabled: process.env.SEEN_DISABLE_NOTIFY !== '1' })

// 面板「安装 whisper-cli」按钮触发的 Homebrew 安装，同一时间只允许一个。
let installingWhisperCli = false
// 面板「下载 Whisper 模型」触发的下载，同一时间只允许一个。
let installingWhisperModel = false

function platformName(source) {
  if (source === 'douyin') return '抖音'
  if (source === 'youtube') return 'YouTube'
  return 'B站'
}

function notifySaved(data = {}) {
  notifier.notify({
    title: '拾影 · 笔记已生成',
    subtitle: [data.subject, platformName(data.source)].filter(Boolean).join(' · '),
    body: data.title || '新视频',
  })
}

/** 识别到视频、开始处理时提醒一次，避免用户以为没反应。 */
function notifyStarted(data = {}) {
  const title = data.title || data.videoId || data.bvid || '新视频'
  notifier.notify({
    title: '拾影 · 开始整理',
    subtitle: platformName(data.source),
    body: String(title).slice(0, 120),
  })
}

/** 进入本地转写（最慢的一步）时提醒，并给出预计耗时。 */
function notifyTranscribing(data = {}) {
  const minutes = Number(data.estimateMinutes) || 0
  notifier.notify({
    title: '拾影 · 本地转写中',
    subtitle: String(data.title || '').slice(0, 60),
    body: minutes > 0 ? '没有可用字幕，预计约 ' + minutes + ' 分钟' : '没有可用字幕，正在转写音频',
  })
}

function notifyFailed(data = {}) {
  notifier.notify({
    title: '拾影 · 处理失败',
    body: String(data.message || '未知错误').slice(0, 160),
  })
}

engine.onEvent((event) => {
  broadcast(event)
  if (event.type === 'detected') notifyStarted(event.data)
  if (event.type === 'progress' && event.data?.stage === 'transcribe') notifyTranscribing(event.data)
  if (event.type === 'saved') {
    log('笔记已生成：' + event.data?.notePath)
    notifySaved(event.data)
    rebuildIndexNote().catch(() => {})
  }
  if (event.type === 'error') {
    log('处理失败：' + event.data?.message)
    notifyFailed(event.data)
  }
})

if (ui.started && !engine.isReadOnly()) {
  const result = engine.start()
  if (!result.ok) log('自动启动轮询失败：' + result.message)
}

async function snapshot() {
  const status = await engine.getStatus()
  const events = engine.getEvents()
  const lastForeground = [...events].reverse().find((event) => event.type === 'foreground')?.data || engine.getLastForeground() || null
  return {
    status: { ...status, lastForeground },
    config: engine.getConfig(),
    history: engine.getHistory(),
    events: engine.getEvents(),
    llm: {
      ok: llmHealth.ok,
      detail: llmHealth.detail,
      model: llm.model,
      baseURL: llm.baseURL,
      provider: llm.id,
      source: llmSource,
      configured: llmSource !== 'none',
      maskedKey: maskKey(llmConfig.apiKey),
      mnemonAvailable,
      enableMnemon: Boolean(baseConfig.enableMnemon),
    },
  }
}

function json(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

async function serveStatic(req, res, pathname) {
  const safe = pathname === '/' ? '/index.html' : pathname
  const file = normalize(join(webRoot, safe))
  if (relative(webRoot, file).startsWith('..')) { json(res, 403, { error: 'forbidden' }); return }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not file')
    const ext = extname(file)
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/vnd.microsoft.icon',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, must-revalidate' })
    res.end(await readFile(file))
  } catch {
    json(res, 404, { error: 'not found' })
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://' + HOST + ':' + PORT)
    const pathname = url.pathname

    if (pathname === '/api/status' && req.method === 'GET') {
      return json(res, 200, await snapshot())
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req)
      let message = ''
      if (body.pollIntervalMs !== undefined) {
        const result = engine.setPollInterval(body.pollIntervalMs)
        if (!result.ok) return json(res, 400, { error: result.message })
        ui.pollIntervalMs = result.pollIntervalMs
        message = result.message
      }
      if (body.started !== undefined) {
        const result = body.started ? engine.start() : engine.stop()
        if (!result.ok) return json(res, 409, { error: result.message })
        ui.started = Boolean(body.started)
        message = result.message
      }
      await writeJson(uiPath, ui)
      const data = await snapshot()
      return json(res, 200, { ok: true, message, ...data })
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await readBody(req)
      const result = await engine.scan({ title: body.title, url: body.url, force: Boolean(body.force) })
      const data = await snapshot()
      return json(res, result.ok ? 200 : 500, { ...data, result })
    }

    if (pathname === '/api/check' && req.method === 'POST') {
      const check = tools.get('course_map_check')
      if (!check) return json(res, 500, { error: 'check tool missing' })
      return json(res, 200, await check.execute({}))
    }

    // 用户点「安装 whisper-cli」后才会执行，属于显式授权；进度通过 SSE progress 事件推送。
    if (pathname === '/api/install/whisper-cli' && req.method === 'POST') {
      if (installingWhisperCli) return json(res, 409, { ok: false, error: '正在安装 whisper-cli，请稍候' })
      installingWhisperCli = true
      log('开始安装 whisper-cli：brew install whisper.cpp')
      installWhisperCli({
        onProgress: (progress) => broadcast({
          type: 'progress',
          data: { stage: 'install', message: 'whisper-cli：' + (progress.message || '') },
          at: Date.now(),
        }),
      }).then((result) => {
        log('whisper-cli 安装' + (result.ok ? '完成：' + result.path : '失败：' + result.error))
        broadcast({
          type: 'progress',
          data: {
            stage: 'install',
            message: result.ok ? 'whisper-cli 安装完成，可以重新诊断' : 'whisper-cli 安装失败：' + (result.error || '未知原因'),
          },
          at: Date.now(),
        })
        return snapshot().then((data) => broadcast({ type: 'snapshot', data, at: Date.now() }))
      }).catch((error) => {
        log('whisper-cli 安装异常：' + (error?.message || error))
      }).finally(() => {
        installingWhisperCli = false
      })
      return json(res, 202, { ok: true, message: '已开始安装 whisper-cli（brew install whisper.cpp），进度会显示在面板上' })
    }

    // 转写模型的可选清单与当前状态（面板缺模型时按推荐顺序展示）
    if (pathname === '/api/whisper-models' && req.method === 'GET') {
      return json(res, 200, {
        models: WHISPER_MODELS,
        current: findWhisperModel(baseConfig),
      })
    }

    // 用户点「下载」后才会执行，进度通过 SSE progress 事件推送。
    if (pathname === '/api/install/whisper-model' && req.method === 'POST') {
      const body = await readBody(req)
      const modelId = String(body?.model || '').trim()
      const entry = WHISPER_MODELS.find((item) => item.id === modelId)
      if (!entry) return json(res, 400, { ok: false, error: '不支持的模型：' + (modelId || '（空）') })
      if (installingWhisperModel) return json(res, 409, { ok: false, error: '已有模型正在下载，请稍候' })
      installingWhisperModel = true
      log('开始下载 Whisper 模型：' + entry.id + '（' + entry.sizeMb + 'MB）')
      installWhisperModel({
        model: entry.id,
        onProgress: (progress) => broadcast({
          type: 'progress',
          data: { stage: 'install', message: 'Whisper 模型：' + (progress.message || ''), percent: progress.percent ?? null },
          at: Date.now(),
        }),
      }).then((result) => {
        log('Whisper 模型' + (result.ok ? '下载完成：' + result.path : '下载失败：' + result.error))
        broadcast({
          type: 'progress',
          data: {
            stage: 'install',
            message: result.ok
              ? 'Whisper 模型下载完成（' + entry.label + '），可以重新诊断'
              : 'Whisper 模型下载失败：' + (result.error || '未知原因'),
          },
          at: Date.now(),
        })
        return snapshot().then((data) => broadcast({ type: 'snapshot', data, at: Date.now() }))
      }).catch((error) => {
        log('Whisper 模型下载异常：' + (error?.message || error))
      }).finally(() => {
        installingWhisperModel = false
      })
      return json(res, 202, { ok: true, message: '已开始下载 ' + entry.label + '（' + entry.sizeMb + 'MB），进度会显示在面板上' })
    }

    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      try {
        res.write('data: ' + JSON.stringify({ type: 'snapshot', data: await snapshot(), at: Date.now() }) + '\n\n')
      } catch { /* 忽略 */ }
      const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n') } catch { /* 忽略 */ }
      }, 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        sseClients.delete(res)
      })
      return
    }

    if (pathname === '/api/llm' && req.method === 'GET') {
      const saved = readSavedConfig()
      return json(res, 200, {
        provider: llm.id,
        baseURL: llm.baseURL,
        model: llm.model,
        source: llmSource,
        health: llmHealth,
        hasKey: Boolean(llmConfig.apiKey),
        maskedKey: maskKey(llmConfig.apiKey),
        saved: saved ? { provider: saved.provider, baseURL: saved.baseURL, model: saved.model, maskedKey: maskKey(saved.apiKey) } : null,
        providers: PROVIDERS,
        groups: PROVIDER_GROUPS,
        mnemonAvailable,
        enableMnemon: Boolean(baseConfig.enableMnemon),
      })
    }

    if (pathname === '/api/llm/models' && req.method === 'GET') {
      const providerId = url.searchParams.get('provider') || ''
      const preset = PROVIDERS.find((item) => item.id === providerId)
      const baseURL = url.searchParams.get('baseURL') || (preset ? preset.baseURL : '')
      const apiKey = url.searchParams.get('apiKey') || llmConfig.apiKey || ''
      return json(res, 200, await fetchModels({ baseURL, apiKey }))
    }

    if (pathname === '/api/llm/test' && req.method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, await testLlmConfig(body))
    }

    if (pathname === '/api/llm' && req.method === 'POST') {
      const body = await readBody(req)
      const previous = readSavedConfig() || {}
      const apiKey = body.apiKey ? String(body.apiKey) : String(previous.apiKey || '')
      const saved = saveLlmConfig({ provider: body.provider, baseURL: body.baseURL, apiKey, model: body.model })
      const tested = await testLlmConfig(saved)
      llmConfig = saved
      llmSource = 'settings'
      llm.updateConfig(saved)
      llmHealth = await llm.health()
      let mnemonNote = ''
      if (typeof body.enableMnemon === 'boolean' && mnemonAvailable) {
        ui.mnemonEnabled = body.enableMnemon
        await writeJson(uiPath, ui)
        mnemonNote = '记忆库开关将在下次重启服务后生效'
      }
      return json(res, 200, {
        ok: tested.ok,
        saved: { provider: saved.provider, baseURL: saved.baseURL, model: saved.model, maskedKey: maskKey(saved.apiKey) },
        test: tested,
        health: llmHealth,
        mnemonNote,
      })
    }

    if (pathname === '/api/magpie' && req.method === 'GET') {
      return json(res, 200, await detectMagpie())
    }

    if (pathname === '/api/review' && req.method === 'POST') {
      const status = await engine.getStatus()
      const review = buildWeeklyReview({ videos: engine.getHistory(), now: new Date() })
      const written = writeWeeklyReview({
        vaultPath: status.vaultPath,
        noteRoot: status.noteRoot,
        label: review.label,
        markdown: review.markdown,
      })
      return json(res, 200, { ok: true, week: review.label, count: review.count, ...written })
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' })
    return await serveStatic(req, res, pathname)
  } catch (error) {
    console.error('request error:', error)
    if (!res.headersSent) json(res, 500, { error: String(error?.message || error) })
    else res.end()
  }
})

async function rebuildIndexNote() {
  try {
    const status = await engine.getStatus()
    if (!status.vaultPath) return
    const markdown = buildIndexMarkdown(engine.getHistory(), { noteRoot: status.noteRoot })
    writeIndexNote({ vaultPath: status.vaultPath, noteRoot: status.noteRoot, markdown })
  } catch (error) {
    log('更新索引失败：' + String(error?.message || error))
  }
}

// 启动时补生成上周回顾（本周文件已存在时自动跳过）
async function ensureLastWeekReview() {
  try {
    const status = await engine.getStatus()
    if (!status.vaultPath) return
    const lastWeek = new Date(Date.now() - 7 * 86400000)
    const review = buildWeeklyReview({ videos: engine.getHistory(), now: lastWeek })
    if (review.count === 0) return
    const written = writeWeeklyReview({
      vaultPath: status.vaultPath,
      noteRoot: status.noteRoot,
      label: review.label,
      markdown: review.markdown,
    })
    log('上周回顾：' + (written.skipped ? '已存在，跳过' : written.relPath))
  } catch (error) {
    log('生成上周回顾失败：' + String(error?.message || error))
  }
}

server.listen(PORT, HOST, () => {
  const url = 'http://' + HOST + ':' + PORT
  log('Seen 独立服务已启动：' + url)
  log('模型：' + (llmSource === 'none' ? '未配置，请在面板里设置' : llm.id + ' / ' + llm.model + '（来源：' + llmSource + '）'))
  log('状态目录：' + baseConfig.stateDir)
  if (engine.isReadOnly()) log('注意：另一个 Seen 实例正在运行并持有状态锁，本服务为只读；停掉那个实例后重启本服务即可接管。')
  if (OPEN_BROWSER && process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
  ensureLastWeekReview().catch(() => {})
  rebuildIndexNote().catch(() => {})
})

function shutdown(code = 0) {
  try { engine.stop() } catch { /* 忽略 */ }
  for (const dispose of disposers) {
    try { dispose() } catch { /* 忽略 */ }
  }
  for (const client of sseClients) {
    try { client.end() } catch { /* 忽略 */ }
  }
  server.close(() => process.exit(code))
  setTimeout(() => process.exit(code), 1000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
