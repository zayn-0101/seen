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
import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { createNotifier } from '../core/lib/notify.js'
import { buildWeeklyReview } from '../core/lib/review.js'
import { writeWeeklyReview } from '../core/lib/obsidian.js'
import { VAULT_HINT, probeVaultAccess } from '../core/lib/vault-access.js'
import { buildConceptIndex } from '../core/lib/concept.js'
import { buildTagIndex } from '../core/lib/tags.js'
import { searchVaultDetailed } from '../core/lib/vault-search.js'
import { findMnemon } from '../core/lib/mnemon.js'
import { WHISPER_MODELS, findWhisperModel, installWhisperCli, installWhisperModel } from '../core/lib/whisper.js'
import { compareVersions } from '../core/lib/version.js'
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
// 临时实例（SEEN_STATE_DIR）把 ui.json 也放进去，避免跑测试时改到真实配置
const uiDir = process.env.SEEN_STATE_DIR ? process.env.SEEN_STATE_DIR : join(homedir(), '.seen')
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

/**
 * 解析启动时的模型配置。刚开机时 Magpie 网关可能还没起来，
 * 探测失败就过一会儿再试，避免服务因为「暂时没有模型」直接退出。
 */
async function resolveStartupLlm({ attempts = 4, delayMs = 1500 } = {}) {
  let resolved = await resolveLlmConfig()
  for (let i = 0; resolved.source === 'none' && i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    resolved = await resolveLlmConfig()
  }
  return resolved
}

const ui = {
  pollIntervalMs: 15000,
  started: false,
  ...(await readJson(uiPath, {})),
}
if (!Number.isFinite(Number(ui.pollIntervalMs))) ui.pollIntervalMs = 15000

const resolvedLlm = await resolveStartupLlm()
let llmConfig = resolvedLlm.config
let llmSource = resolvedLlm.source
if (!llmConfig.model) {
  llmSource = 'none'
  console.warn('未检测到可用模型，服务先启动；请在面板「模型」里配置后再使用整理功能。')
}
const llm = createLlmClient(llmConfig)
let llmHealth = await llm.health()
const mnemonBin = await findMnemon({})
const mnemonAvailable = Boolean(mnemonBin)

const baseConfig = resolveConfig({
  pollIntervalMs: Number(ui.pollIntervalMs) || 15000,
  autoStart: false,
  exposeController: true,
  provider: llmConfig.model && llmConfig.provider && llmConfig.provider !== 'none' ? llmConfig.provider : null,
  model: llmConfig.model || null,
  enableMnemon: mnemonAvailable && process.env.SEEN_DISABLE_MNEMON !== '1' && ui.mnemonEnabled !== false,
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || ui.noteLayout || DEFAULTS.noteLayout,
  editorPass: Boolean(ui.editorPass),
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

// 启动先探一次 vault 权限：没有「文稿文件夹」授权时快速降级，绝不让同步 I/O 挂起整个服务。
const vaultProbe = await probeVaultAccess(baseConfig.vaultPath)
baseConfig.vaultAccess = vaultProbe
if (!vaultProbe.ok) {
  log('笔记库不可访问（' + vaultProbe.code + '）：' + VAULT_HINT)
  // 首次访问 tccd 可能还在等用户点授权弹窗，超时不等于真没权限：几秒后自己再探一次
  if (vaultProbe.code === 'timeout') {
    setTimeout(async () => {
      try {
        const status = await engine.reprobeVault()
        log('笔记库权限复查：' + (status.ok ? '正常' : status.code))
      } catch (error) {
        log('笔记库权限复查失败：' + String(error?.message || error))
      }
    }, 4000).unref()
  }
}

const engine = apply(ctx, baseConfig)
if (!engine || typeof engine.getStatus !== 'function') {
  console.error('核心入口没有返回控制器，请检查 core 版本。')
  process.exit(1)
}
await engine.ready

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

// 通知同时写入 SSE：菜单栏应用用自己的 UNUserNotificationCenter 投递，
// 独立运行服务时仍由 osascript 兜底。
function emitNotification(payload) {
  notifier.notify(payload)
  broadcast({ type: 'notification', data: payload, at: Date.now() })
}

// 面板「安装 whisper-cli」按钮触发的 Homebrew 安装，同一时间只允许一个。
let installingWhisperCli = false
// 面板「下载 Whisper 模型」触发的下载，同一时间只允许一个。
let installingWhisperModel = false
// 面板「重刷历史」一次只跑一批，避免重复触发。
let refreshingHistory = false
let resummarizing = false

function platformName(source) {
  if (source === 'douyin') return '抖音'
  if (source === 'youtube') return 'YouTube'
  return 'B站'
}

function notifySaved(data = {}) {
  emitNotification({
    title: '拾影 · 笔记已生成',
    subtitle: [data.subject, platformName(data.source)].filter(Boolean).join(' · '),
    body: data.title || '新视频',
  })
}

/** 识别到视频、开始处理时提醒一次，避免用户以为没反应。 */
function notifyStarted(data = {}) {
  const title = data.title || data.videoId || data.bvid || '新视频'
  emitNotification({
    title: '拾影 · 开始整理',
    subtitle: platformName(data.source),
    body: String(title).slice(0, 120),
  })
}

/** 进入本地转写（最慢的一步）时提醒，并给出预计耗时。 */
function notifyTranscribing(data = {}) {
  const minutes = Number(data.estimateMinutes) || 0
  emitNotification({
    title: '拾影 · 本地转写中',
    subtitle: String(data.title || '').slice(0, 60),
    body: minutes > 0 ? '没有可用字幕，预计约 ' + minutes + ' 分钟' : '没有可用字幕，正在转写音频',
  })
}

function notifyFailed(data = {}) {
  emitNotification({
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
  if (event.type === 'vault-blocked') {
    log('笔记没有写入：' + VAULT_HINT)
    notifyFailed({ message: '没有「文稿文件夹」权限，笔记未写入' })
  }
})

if (ui.started && !engine.isReadOnly()) {
  const result = engine.start()
  if (!result.ok) log('自动启动轮询失败：' + result.message)
}

// ---- 版本与更新检查（每天最多一次，可用 SEEN_DISABLE_UPDATE_CHECK=1 关闭）----
const APP_VERSION = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8')).version
const UPDATE_REPO = 'zayn-0101/seen'
const UPDATE_DISABLED = process.env.SEEN_DISABLE_UPDATE_CHECK === '1'
let updateInfo = { checkedAt: 0, latest: '', url: '', available: false }

async function checkUpdate({ force = false } = {}) {
  if (UPDATE_DISABLED) return updateInfo
  const now = Date.now()
  if (!force && updateInfo.checkedAt > 0 && now - updateInfo.checkedAt < 24 * 3600 * 1000) return updateInfo
  try {
    const res = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', {
      headers: { 'User-Agent': 'seen/' + APP_VERSION, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      updateInfo = { ...updateInfo, checkedAt: now }
      return updateInfo
    }
    const data = await res.json()
    const latest = String(data.tag_name || '').replace(/^v/i, '')
    updateInfo = {
      checkedAt: now,
      latest,
      url: String(data.html_url || ('https://github.com/' + UPDATE_REPO + '/releases')),
      available: Boolean(latest) && compareVersions(latest, APP_VERSION) > 0,
    }
  } catch {
    updateInfo = { ...updateInfo, checkedAt: now }
  }
  return updateInfo
}

async function snapshot() {
  const status = await engine.getStatus()
  const events = engine.getEvents()
  const lastForeground = [...events].reverse().find((event) => event.type === 'foreground')?.data || engine.getLastForeground() || null
  return {
    status: { ...status, lastForeground },
    config: engine.getConfig(),
    history: engine.getHistory(),
    reviews: engine.getReviews(),
    events: engine.getEvents(),
    update: updateInfo.available ? { ...updateInfo, current: APP_VERSION } : null,
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
    if (size > 1024 * 1024) throw Object.assign(new Error('请求体过大'), { statusCode: 413 })
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  let value
  try { value = JSON.parse(text) } catch {
    throw Object.assign(new Error('请求内容不是有效的 JSON'), { statusCode: 400 })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('请求内容必须是 JSON 对象'), { statusCode: 400 })
  }
  return value
}

/** 浏览器只能从当前面板的同源页面访问 API；本机原生客户端不携带 Origin。 */
function validateApiRequest(req) {
  let requestOrigin
  try {
    requestOrigin = new URL('http://' + String(req.headers.host || ''))
  } catch {
    return { status: 403, error: '无效的请求地址' }
  }
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  const boundHost = String(HOST || '').toLowerCase()
  if (boundHost && boundHost !== '0.0.0.0' && boundHost !== '::' && boundHost !== '[::]') allowedHosts.add(boundHost)
  if (!allowedHosts.has(requestOrigin.hostname.toLowerCase())) {
    return { status: 403, error: '请求地址不受信任' }
  }
  const origin = req.headers.origin
  if (origin && origin !== requestOrigin.origin) return { status: 403, error: '不允许跨站访问' }
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return { status: 403, error: '不允许跨站访问' }
  if (req.method === 'POST' && !/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] || ''))) {
    return { status: 415, error: '请求必须使用 application/json' }
  }
  return null
}

function keyForEndpoint(baseURL, supplied, current) {
  if (supplied) return String(supplied)
  const normalize = (value) => String(value || '').trim().replace(/\/+$/, '')
  const target = normalize(baseURL)
  return target && target === normalize(current?.baseURL) ? String(current?.apiKey || '') : ''
}

const READ_ONLY_POSTS = new Set(['/api/ask', '/api/check', '/api/llm/models', '/api/llm/test', '/api/vault/probe'])

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
    if (pathname.startsWith('/api/')) {
      const problem = validateApiRequest(req)
      if (problem) return json(res, problem.status, { ok: false, error: problem.error })
      if (req.method === 'POST' && engine.isReadOnly() && !READ_ONLY_POSTS.has(pathname)) {
        return json(res, 409, { ok: false, error: '另一个实例持有锁，当前为只读模式' })
      }
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      return json(res, 200, await snapshot())
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      const status = await engine.getStatus()
      if (!status.vaultPath) return json(res, 400, { error: '没有找到 Obsidian vault' })
      if (status.vault && status.vault.ok === false) {
        return json(res, 200, { query: url.searchParams.get('q') || '', results: [], blocked: true, hint: VAULT_HINT })
      }
      const query = url.searchParams.get('q') || ''
      const limit = Number(url.searchParams.get('limit')) || 20
      const found = await searchVaultDetailed({ vaultPath: status.vaultPath, noteRoot: status.noteRoot, query, limit })
      return json(res, 200, { query, ...found })
    }

    if (pathname === '/api/concepts' && req.method === 'GET') {
      const history = engine.getHistory()
      const concepts = buildConceptIndex(history).map((item) => ({
        name: item.name,
        count: item.videos.length,
        videos: item.videos,
      }))
      return json(res, 200, { concepts })
    }

    if (pathname === '/api/quality' && req.method === 'GET') {
      const history = engine.getHistory()
      const scored = history.filter((item) => Number(item.quality) > 0)
      const low = history
        .filter((item) => Number(item.quality) > 0 && Number(item.quality) <= 2)
        .map((item) => ({ title: item.title, subject: item.subject, quality: item.quality, notePath: item.notePath }))
      return json(res, 200, { total: history.length, scored: scored.length, low })
    }

    if (pathname === '/api/reviews' && req.method === 'GET') {
      return json(res, 200, engine.getReviews())
    }

    if (pathname === '/api/tags' && req.method === 'GET') {
      const history = engine.getHistory()
      const tags = buildTagIndex(history).map((item) => ({
        name: item.name,
        type: item.type,
        count: item.videos.length,
      }))
      return json(res, 200, { tags })
    }

    // 把一个主题标签合并到另一个主题（改 state 与笔记 frontmatter）。
    if (pathname === '/api/tags/merge' && req.method === 'POST') {
      const body = await readBody(req)
      const result = await engine.renameTag({ from: body.from, to: body.to })
      const data = await snapshot()
      return json(res, result.ok ? 200 : 400, { ...data, result, error: result.ok ? undefined : result.message })
    }

    // 问笔记库：检索相关笔记后让模型回答，返回答案与引用。
    if (pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody(req)
      const result = await engine.askLibrary({ question: body.question })
      return json(res, result.ok ? 200 : 400, result.ok ? result : { ...result, error: result.message })
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
      if (body.noteLayout !== undefined) {
        const result = engine.setNoteLayout(body.noteLayout)
        if (!result.ok) return json(res, 400, { error: result.message })
        ui.noteLayout = result.noteLayout
        message = result.message
      }
      if (body.started !== undefined) {
        const result = body.started ? engine.start() : engine.stop()
        if (!result.ok) return json(res, 409, { error: result.message })
        ui.started = Boolean(body.started)
        message = result.message
      }
      if (body.editorPass !== undefined) {
        const result = engine.setEditorPass(body.editorPass)
        if (!result.ok) return json(res, 400, { error: result.message })
        ui.editorPass = result.editorPass
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
      const status = result.ok ? 200
        : (result.code === 'douyin-not-jingxuan' || result.code === 'unsupported-source') ? 400
        : 500
      return json(res, status, { ...data, result, ...(result.ok ? {} : { error: result.message }) })
    }

    // 重试一条失败记录：用保存的链接重新走一遍处理流程。
    if (pathname === '/api/retry' && req.method === 'POST') {
      const body = await readBody(req)
      const key = String(body.key || '').trim()
      if (!key) return json(res, 400, { ok: false, error: '缺少 key' })
      log('重试失败任务：' + key)
      const result = await engine.retryFailure(key)
      const data = await snapshot()
      return json(res, result.ok ? 200 : 500, { ...data, result, ...(result.ok ? {} : { error: result.message }) })
    }

    // 重刷历史笔记：只重做整理与版式，内容/字幕走已有缓存。
    if (pathname === '/api/reprocess' && req.method === 'POST') {
      if (refreshingHistory) return json(res, 409, { ok: false, error: '正在重刷历史笔记，请稍候' })
      const body = await readBody(req)
      const limit = Math.max(0, Math.floor(Number(body.limit) || 0))
      refreshingHistory = true
      log('开始重刷历史笔记' + (limit ? '：前 ' + limit + ' 篇' : '：全部'))
      engine.refreshHistory({ limit })
        .then((result) => {
          log('重刷历史完成：' + result.done + '/' + result.total + '，失败 ' + result.failed)
          broadcast({ type: 'refresh-done', data: result, at: Date.now() })
        })
        .catch((error) => log('重刷历史失败：' + String(error?.message || error)))
        .finally(() => { refreshingHistory = false })
      return json(res, 202, { ok: true, message: '已开始重刷历史笔记' })
    }

    // 记录一次复习反馈：again / hard / easy，按 SM-2 排下一次。
    if (pathname === '/api/reviews' && req.method === 'POST') {
      const body = await readBody(req)
      const result = await engine.recordReview({ notePath: body.notePath, rating: body.rating })
      const data = await snapshot()
      return json(res, result.ok ? 200 : 400, { ...data, result })
    }

    // 用字幕存档重整理一篇历史笔记；缓存失效时内容抓取仍可能重新执行。
    if (pathname === '/api/resummarize' && req.method === 'POST') {
      if (resummarizing) return json(res, 409, { ok: false, error: '正在重整理笔记，请稍候' })
      const body = await readBody(req)
      const notePath = String(body.notePath || '').trim()
      if (!notePath) return json(res, 400, { ok: false, error: '缺少 notePath' })
      resummarizing = true
      log('用字幕存档重新整理：' + notePath)
      try {
        const result = await engine.resummarizeNote({ notePath })
        const data = await snapshot()
        return json(res, result.ok ? 200 : 500, { ...data, result })
      } finally {
        resummarizing = false
      }
    }

    // 用户在面板点「重试」时重新探测 vault 权限（授权后无需重启服务）。
    if (pathname === '/api/vault/probe' && req.method === 'POST') {
      const status = await engine.reprobeVault()
      log('重新探测笔记库权限：' + (status.ok ? '正常' : status.code))
      const data = await snapshot()
      return json(res, 200, { ...data, vault: status })
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

    if (pathname === '/api/llm/models' && req.method === 'POST') {
      const body = await readBody(req)
      const providerId = body.provider || ''
      const preset = PROVIDERS.find((item) => item.id === providerId)
      const baseURL = body.baseURL || (preset ? preset.baseURL : '')
      const apiKey = keyForEndpoint(baseURL, body.apiKey, llmConfig)
      return json(res, 200, await fetchModels({ baseURL, apiKey }))
    }

    if (pathname === '/api/llm/test' && req.method === 'POST') {
      const body = await readBody(req)
      return json(res, 200, await testLlmConfig({ ...body, apiKey: keyForEndpoint(body.baseURL, body.apiKey, llmConfig) }))
    }

    if (pathname === '/api/llm' && req.method === 'POST') {
      const body = await readBody(req)
      const previous = readSavedConfig() || {}
      const apiKey = keyForEndpoint(body.baseURL, body.apiKey, previous)
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
      if (status.vault && status.vault.ok === false) return json(res, 503, { error: VAULT_HINT })
      const review = buildWeeklyReview({ videos: engine.getHistory(), now: new Date() })
      if (review.count === 0) return json(res, 200, { ok: true, week: review.label, count: 0, skipped: true })
      const written = await writeWeeklyReview({
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
    const status = Number(error?.statusCode) || 500
    if (status >= 500) console.error('request error:', error)
    if (!res.headersSent) json(res, status, { error: String(error?.message || error) })
    else res.end()
  }
})

async function rebuildIndexNote() {
  try {
    if (engine.isReadOnly()) return
    const status = await engine.getStatus()
    if (!status.vaultPath) return
    if (status.vault && status.vault.ok === false) return
    const result = await engine.rebuildKnowledgePages()
    if (!result?.ok) log('更新索引失败：' + String(result?.message || '未知原因'))
  } catch (error) {
    log('更新索引失败：' + String(error?.message || error))
  }
}

// 启动时补生成上周回顾（本周文件已存在时自动跳过）
async function ensureLastWeekReview() {
  try {
    if (engine.isReadOnly()) return
    const status = await engine.getStatus()
    if (!status.vaultPath) return
    if (status.vault && status.vault.ok === false) return
    const lastWeek = new Date(Date.now() - 7 * 86400000)
    const review = buildWeeklyReview({ videos: engine.getHistory(), now: lastWeek })
    if (review.count === 0) return
    const written = await writeWeeklyReview({
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
  checkUpdate().then((info) => {
    if (!info.available) return
    log('发现新版本 v' + info.latest + '（当前 v' + APP_VERSION + '）：' + info.url)
    broadcast({ type: 'update', data: { ...info, current: APP_VERSION } })
  }).catch(() => {})
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
