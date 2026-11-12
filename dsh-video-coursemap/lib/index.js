/**
 * dsh-video-coursemap · Obsidian 版
 *
 * 实时检测 B 站网页课程视频 → 学科分类 → 抓取简介/字幕/弹幕/评论 →
 * LLM 知识总结 → Obsidian 笔记/学习手册/课程总览 + dsh-mnemon insight。
 *
 * 基于 linner1224/dsh-video-coursemap 2.0.0（MIT）的架构 fork，
 * 新增 macOS 前台窗口检测、Obsidian 输出与 mnemon 集成。
 */

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  resolveConfig,
} from './config.js'
import {
  loadState, saveState, seenKey, isSeen, markSeen, pruneSeen,
  resolveSubjectName, recordFailure, shouldSkipFailure, clearFailure,
} from './state.js'
import { observeForeground, isBrowserName } from './foreground.js'
import { probeDarwinPermission } from './foreground-darwin.js'
import { fetchContent, fetchComments, cleanBiliTitle, extractBvid } from './bilibili.js'
import { classify, summarize, resolveModel } from './analyze.js'
import { getBilibiliCookieHeader } from './session.js'
import { fetchTranscript } from './transcript.js'
import { findYtDlp } from './ytdlp.js'
import { renderVideoNote } from './render.js'
import { resolveVaultPath, ensureVaultDirs, writeVideoNote, updateSubjectManual, updateOverview, openInObsidian, toPosix } from './obsidian.js'
import { findMnemon, rememberVideo } from './mnemon.js'

export const name = 'dsh-video-coursemap'
export const inject = ['llm', 'tools']

const TITLE_SUFFIXES = [
  ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox',
  ' - Chromium', ' - Opera', ' - Brave', ' - Internet Explorer',
  ' - 谷歌浏览器', ' - 微软 Edge', ' - 火狐浏览器', ' - 360极速浏览器',
  '_哔哩哔哩_bilibili', '_哔哩哔哩', ' - 哔哩哔哩', ' - bilibili', '-bilibili', ' - Bilibili',
  ' - YouTube', ' - 优酷', ' - 爱奇艺', ' - 腾讯视频', ' - 芒果TV', ' - 抖音', ' - 快手', ' - 夸克', ' - Quark',
]

export function cleanTitle(raw) {
  let t = String(raw || '').trim()
  let changed = true
  while (changed) {
    changed = false
    for (const suf of TITLE_SUFFIXES) {
      if (t.endsWith(suf)) { t = t.slice(0, -suf.length).trim(); changed = true }
    }
  }
  return t
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }) }

function makeLogger(stateDir) {
  const logPath = join(stateDir, 'poll.log')
  let lastKey = ''
  return {
    log(msg) {
      try {
        if (existsSync(logPath) && statSync(logPath).size > 2 * 1024 * 1024) renameSync(logPath, logPath + '.1')
        appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8')
      } catch { /* 日志失败不影响主流程 */ }
    },
    logOnce(key, msg) {
      if (key === lastKey) return
      lastKey = key
      this.log(msg)
    },
    path: logPath,
  }
}

function summarizeVideosForManual(state, subject) {
  return (state.subjects[subject]?.videos ?? []).map((v) => ({
    title: v.title,
    bvid: v.bvid || '',
    notePath: v.notePath,
    summary: v.summary || '',
    createdAt: v.createdAt || Date.now(),
  }))
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)

  let vaultPath
  try {
    vaultPath = resolveVaultPath(config)
  } catch (error) {
    vaultPath = join(homedir(), 'Documents', 'Obsidian Vault')
  }

  ensureDir(config.stateDir)
  ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })

  const logger = makeLogger(config.stateDir)
  const statePath = join(config.stateDir, 'state.json')
  const state = loadState(statePath)

  let running = false
  let pending = null
  let started = false
  let pollTimer = null
  let readOnly = false
  const eventListeners = new Set()
  const recentEvents = []
  const lockPath = join(config.stateDir, 'instance.lock')
  try {
    if (existsSync(lockPath)) {
      const lockPid = Number(readFileSync(lockPath, 'utf8').trim())
      if (Number.isInteger(lockPid) && lockPid > 0 && lockPid !== process.pid) {
        try { process.kill(lockPid, 0); readOnly = true } catch (error) { if (error?.code !== 'ESRCH') readOnly = true }
      }
    }
    if (!readOnly) writeFileSync(lockPath, String(process.pid), 'utf8')
  } catch { /* 锁失败不阻塞启动 */ }

  const outputDir = join(vaultPath, config.noteRoot)

  function emit(type, data) {
    const event = { type, data: data === undefined ? null : data, at: Date.now() }
    recentEvents.push(event)
    if (recentEvents.length > 100) recentEvents.shift()
    for (const listener of eventListeners) {
      try { listener(event) } catch { /* 单个订阅失败不影响轮询 */ }
    }
  }

  function onEvent(listener) {
    if (typeof listener !== 'function') return () => {}
    eventListeners.add(listener)
    return () => eventListeners.delete(listener)
  }

  function save() {
    try { saveState(statePath, state) } catch (error) { logger.log('state.save.error msg=' + (error?.message || error)) }
  }

  async function processTitle(input) {
    if (running) return { ok: false, message: '已有任务正在处理，请稍后再试' }
    running = true
    let key = ''
    let activeKey = ''
    try {
      const rawTitle = cleanTitle(input?.title || '')
      const bvidFromUrl = extractBvid(input?.url || '') || null
      const inputBvid = input?.bvid || bvidFromUrl
      key = seenKey({ bvid: inputBvid, title: rawTitle })
      activeKey = key

      if (!input?.force && isSeen(state, key)) {
        return { ok: true, skipped: true, message: '已处理过该视频，保持静默' }
      }
      if (!input?.force && shouldSkipFailure(state, key)) {
        return { ok: true, skipped: true, message: '该视频最近失败次数过多，已冷却；可稍后手动重试' }
      }
      if (!rawTitle && !input?.url && !input?.bvid) {
        return { ok: false, message: '缺少视频标题或 URL' }
      }
      emit('detected', { title: rawTitle, url: input?.url || '', bvid: inputBvid || null, force: Boolean(input?.force) })

      let cookieHeader = null
      try { cookieHeader = await getBilibiliCookieHeader({ config, url: input?.url || '' }) } catch { cookieHeader = null }
      let content = null
      if (config.fetchContent) {
        emit('fetching', { title: rawTitle, message: '抓取 B 站视频信息、字幕、弹幕与评论' })
        content = await fetchContent({
          ref: input?.url || input?.bvid || rawTitle,
          title: rawTitle,
          cookieHeader,
          commentLimit: config.commentLimit,
        })
        logger.log('bili content title=' + JSON.stringify(rawTitle) + ' matched=' + Boolean(content?.matched) + ' bvid=' + (content?.bvid || 'none') + ' danmaku=' + (content?.fetchStats?.danmaku || 0) + ' comments=' + (content?.fetchStats?.comments || 0) + ' transcript=' + (content?.fetchStats?.transcript || 0))
        emit('content', { bvid: content?.bvid || null, title: content?.title || rawTitle, fetchStats: content?.fetchStats || null, chapters: content?.chapters || [] })
        if (!cookieHeader && content?.url) {
          try {
            cookieHeader = await getBilibiliCookieHeader({ config, url: content.url })
            if (cookieHeader && content?.aid) {
              const moreComments = await fetchComments(content.aid, { limit: config.commentLimit, cookieHeader }).catch(() => [])
              if (moreComments.length > content.comments.length) {
                content.comments = moreComments
                content.fetchStats.comments = moreComments.length
              }
            }
          } catch { /* 降级 */ }
        }
        if (content?.bvid) {
          const bvidKey = seenKey({ bvid: content.bvid, title: content.title || rawTitle })
          if (!input?.force && bvidKey !== key && isSeen(state, bvidKey)) {
            return { ok: true, skipped: true, message: '该视频（bvid）已处理过，保持静默' }
          }
          activeKey = bvidKey
        }
      }

      const title = (content?.matched && content.title && !/^https?:\/\//i.test(content.title)) ? content.title : cleanBiliTitle(rawTitle || inputBvid || '未命名视频')
      const desc = content?.desc || ''
      const tags = content?.tags || []
      const existing = Object.keys(state.subjects)
      const cls = await classify(ctx, config, { title, desc, tags, existingSubjects: existing })
      logger.log('classify title=' + JSON.stringify(title) + ' result=' + JSON.stringify(cls))
      if (cls) emit('classified', { isCourse: cls.isCourse, subject: cls.subject, title: cls.title, keywords: cls.keywords || [] })

      if (!cls) {
        throw new Error('视频分类失败（LLM 返回无法解析或调用失败），稍后重试')
      }
      if (cls.isCourse === false) {
        markSeen(state, activeKey, { at: Date.now(), title, bvid: content?.bvid || inputBvid || null, isCourse: false })
        state.lastTitle = title
        state.stats.skipped += 1
        pruneSeen(state)
        save()
        emit('skipped', { reason: 'non-course', title })
        return { ok: true, skipped: true, message: '非知识内容，已静默忽略' }
      }

      const subject = resolveSubjectName(cls.subject, existing)
      const keywords = Array.isArray(cls.keywords) ? cls.keywords.map(String).filter(Boolean).slice(0, 10) : []
      let transcript = content?.transcript || ''
      let transcriptSource = content?.transcriptSource || (transcript ? 'up-subtitle' : '')
      if (!transcript && config.fetchTranscript && content?.bvid) {
        try {
          const tr = await fetchTranscript({
            bvid: content.bvid,
            cid: content.cid,
            url: content.url || input?.url,
            config,
            cookieHeader,
            playerInfo: { subtitles: content.subtitleEntries || [] },
          })
          if (tr?.text) {
            transcript = tr.text
            transcriptSource = tr.source || 'ai-subtitle'
            logger.log('transcript source=' + transcriptSource + ' detail=' + tr.detail + ' length=' + transcript.length)
          }
        } catch (error) {
          logger.log('transcript.error msg=' + (error?.message || error))
        }
      }
      if (content) {
        content.transcript = transcript
        content.transcriptSource = transcriptSource
        if (content.fetchStats) content.fetchStats.transcript = transcript.length
      }
      emit('transcript', { source: transcriptSource || 'none', length: transcript.length })
      const contentForSummary = content
        ? { ...content, transcript, transcriptSource }
        : (transcript ? { transcript, transcriptSource } : null)
      const finalTitle = cls.title || title
      emit('summarizing', { title: finalTitle, subject, transcriptLength: transcript.length })
      const summary = await summarize(ctx, config, { title: finalTitle, subject, keywords, content: contentForSummary, transcript, transcriptSource })
      const contentQuality = transcript ? 'full' : 'metadata-only'
      emit('summarized', { title: finalTitle, subject, summary: summary.summary, keyPoints: summary.keyPoints, discussion: summary.discussion, contentQuality })
      const createdAt = Date.now()

      const note = renderVideoNote({
        title: finalTitle,
        subject,
        bvid: content?.bvid || inputBvid || '',
        url: content?.url || input?.url || '',
        author: content?.owner || '',
        createdAt,
        summary: summary.summary,
        keyPoints: summary.keyPoints,
        discussion: summary.discussion,
        fetchStats: content?.fetchStats || null,
        tags: ['视频课程', subject, ...keywords].filter(Boolean),
        chapters: content?.chapters || [],
        contentSource: transcriptSource || 'metadata',
        contentQuality,
        noteRoot: config.noteRoot,
      })

      const writeResult = writeVideoNote({
        vaultPath,
        noteRoot: config.noteRoot,
        subject,
        title: finalTitle,
        bvid: content?.bvid || inputBvid || '',
        content: note,
        force: Boolean(input?.force),
      })

      const isNewSubject = !state.subjects[subject]
      if (isNewSubject) state.subjects[subject] = { createdAt, updatedAt: createdAt, videos: [] }
      if (!Array.isArray(state.subjects[subject].videos)) state.subjects[subject].videos = []
      const videoRecord = {
        title: finalTitle,
        bvid: content?.bvid || inputBvid || '',
        notePath: writeResult.relPath,
        keywords,
        summary: summary.summary.slice(0, 120),
        createdAt,
      }
      const videos = state.subjects[subject].videos
      const existed = videos.findIndex((v) => (videoRecord.bvid && v.bvid === videoRecord.bvid) || (!videoRecord.bvid && v.title === videoRecord.title))
      if (existed >= 0) videos[existed] = { ...videos[existed], ...videoRecord }
      else videos.push(videoRecord)
      state.subjects[subject].updatedAt = createdAt

      updateSubjectManual({ vaultPath, noteRoot: config.noteRoot, subject, videos: summarizeVideosForManual(state, subject) })
      updateOverview({ vaultPath, noteRoot: config.noteRoot, subjects: Object.keys(state.subjects) })
      if (config.openInObsidian) {
        const opened = openInObsidian({ vaultPath, notePath: writeResult.relPath })
        if (!opened.ok) logger.log('obsidian.open.error msg=' + (opened.error || 'unknown'))
      }

      if (config.enableMnemon) {
        const m = await rememberVideo({
          config,
          title: finalTitle,
          subject,
          summary: summary.summary,
          keyPoints: summary.keyPoints,
          notePath: writeResult.relPath,
          bvid: content?.bvid || inputBvid || '',
          url: content?.url || input?.url || '',
          keywords,
        })
        state.stats.lastMnemon = { ok: Boolean(m?.ok), at: Date.now(), error: m?.error || '' }
        if (!m?.ok) logger.log('mnemon.error title=' + JSON.stringify(finalTitle) + ' msg=' + (m?.error || 'unknown'))
      }

      markSeen(state, activeKey, {
        at: Date.now(),
        title: finalTitle,
        bvid: content?.bvid || inputBvid || null,
        subject,
        notePath: writeResult.relPath,
        isCourse: true,
      })
      state.lastTitle = finalTitle
      state.lastRunAt = Date.now()
      state.stats.processed += 1
      clearFailure(state, activeKey)
      pruneSeen(state)
      save()

      logger.log('note.saved subject=' + JSON.stringify(subject) + ' title=' + JSON.stringify(finalTitle) + ' path=' + writeResult.relPath + ' skipped=' + writeResult.skipped)
      emit('saved', {
        title: finalTitle,
        subject,
        notePath: writeResult.relPath,
        bvid: content?.bvid || inputBvid || '',
        url: content?.url || input?.url || '',
        summary: summary.summary,
        keyPoints: summary.keyPoints,
        discussion: summary.discussion,
        contentSource: transcriptSource || 'metadata',
        contentQuality,
        fetchStats: content?.fetchStats || null,
        chapters: content?.chapters || [],
      })
      console.log('[dsh-video-coursemap] ' + (isNewSubject ? '新学科' : '更新学科') + '「' + subject + '」 ← ' + finalTitle)
      return { ok: true, message: '已生成「' + subject + '」笔记：' + writeResult.relPath, subject, notePath: writeResult.relPath }
    } catch (error) {
      const msg = String(error?.message || error)
      if (activeKey || key) {
        recordFailure(state, activeKey || key, msg)
        state.stats.failed += 1
        save()
      }
      logger.log('process.error key=' + JSON.stringify(key) + ' msg=' + msg)
      emit('error', { message: msg })
      console.error('[dsh-video-coursemap] 处理失败（不影响后续轮询）：', error)
      return { ok: false, message: '处理失败：' + msg }
    } finally {
      running = false
    }
  }

  async function observeOnce() {
    if (!config.enabled || !started) return
    let fg
    try {
      fg = await observeForeground(config)
    } catch (error) {
      logger.log('foreground.error msg=' + (error?.message || error))
      return
    }
    state.lastForeground = { at: Date.now(), app: fg?.app || '', title: fg?.title || '', url: fg?.url || '', source: fg?.source || 'none', error: fg?.error || '' }
    if (fg?.error) logger.logOnce('fg|' + fg.source + '|' + fg.error, 'foreground.degraded app=' + JSON.stringify(fg.app || '') + ' source=' + fg.source + ' msg=' + fg.error)
    emit('foreground', { app: fg?.app || '', title: fg?.title || '', url: fg?.url || '', source: fg?.source || 'none', permission: fg?.permission || 'unknown', error: fg?.error || '', isBrowser: isBrowserName(fg?.app, config), at: Date.now() })
    if (!isBrowserName(fg?.app, config)) return

    const rawTitle = fg?.title || ''
    const rawUrl = fg?.url || ''
    const title = cleanTitle(rawTitle)
    if (!title || title.length < config.titleMinLen) return
    const bvid = extractBvid(rawUrl) || null
    const onBilibili = /(^|\.)bilibili\.com\b|(^|\.)b23\.tv\b/i.test(rawUrl)
    const biliTitle = /哔哩哔哩|bilibili/i.test(rawTitle)
    // 自动检测只处理 B 站视频；非 B 站网页（YouTube/普通网页）静默忽略。
    if (!bvid) {
      if (onBilibili) return // B 站首页/搜索页/分类页等非视频页面
      if (!biliTitle) return // 非 B 站网页
    }
    const key = seenKey({ bvid, title })
    if (isSeen(state, key)) { pending = null; return }
    logger.logOnce('obs|' + key, 'foreground.browser app=' + JSON.stringify(fg.app) + ' title=' + JSON.stringify(title) + ' bvid=' + (bvid || 'none'))
    if (!pending || pending.key !== key) pending = { key, title, url: fg?.url || '', bvid, count: 1 }
    else pending.count += 1
    if (pending.count >= config.stablePolls) {
      const p = pending
      pending = null
      emit('stable', { title: p.title, url: p.url, bvid: p.bvid })
      await processTitle({ title: p.title, url: p.url, bvid: p.bvid })
    }
  }

  async function buildStatus() {
    let mnemonReady = false
    try { mnemonReady = Boolean(await findMnemon(config)) } catch { mnemonReady = false }
    const subjects = Object.entries(state.subjects).map(([subject, d]) => ({ subject, videos: d.videos?.length ?? 0 }))
    const lastError = state.lastForeground?.error || ''
    const message = [
      '视频课程知识地图 Agent 状态：',
      '- 轮询：' + (readOnly ? '只读（另一个实例持有锁）' : started ? '运行中' : '已停止'),
      '- 轮询间隔：' + config.pollIntervalMs + 'ms',
      '- 启用：' + config.enabled,
      '- Obsidian：' + outputDir,
      '- 学科数：' + subjects.length,
      ...subjects.map((s) => '  · ' + s.subject + '（' + s.videos + ' 个视频）'),
      '- 最近观察：' + (state.lastTitle || '（无）'),
      '- 前台检测：' + (state.lastForeground ? (state.lastForeground.app || '未知') + ' / ' + (state.lastForeground.error || '正常') : '（尚未运行）'),
      '- mnemon：' + (mnemonReady ? '可用' : '未找到 CLI'),
    ].join('\n')
    return {
      ok: true,
      enabled: config.enabled,
      polling: started,
      pollIntervalMs: config.pollIntervalMs,
      readOnly,
      outputDir,
      vaultPath,
      noteRoot: config.noteRoot,
      lastTitle: state.lastTitle,
      lastRunAt: state.lastRunAt,
      lastError,
      mnemonReady,
      subjects,
      message,
    }
  }

  function getSafeConfig() {
    return {
      pollIntervalMs: config.pollIntervalMs,
      enabled: config.enabled,
      polling: started,
      readOnly,
      vaultPath,
      noteRoot: config.noteRoot,
      stateDir: config.stateDir,
      provider: config.provider,
      model: config.model,
      fetchTranscript: config.fetchTranscript,
      useBrowserCookies: config.useBrowserCookies,
      commentLimit: config.commentLimit,
    }
  }

  function getHistory() {
    const rows = []
    for (const [subject, data] of Object.entries(state.subjects)) {
      for (const video of data.videos || []) {
        rows.push({
          subject,
          title: video.title,
          bvid: video.bvid || '',
          notePath: video.notePath || '',
          summary: video.summary || '',
          keywords: video.keywords || [],
          createdAt: video.createdAt || 0,
        })
      }
    }
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return rows
  }

  function clearPollTimer() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  }

  function schedulePoll() {
    if (!started || readOnly || !config.enabled) return
    clearPollTimer()
    pollTimer = setTimeout(async () => {
      pollTimer = null
      try {
        await observeOnce()
      } catch (error) {
        logger.log('observe.error msg=' + (error?.message || error))
        emit('error', { message: String(error?.message || error) })
      }
      if (started) schedulePoll()
    }, Math.max(1000, Number(config.pollIntervalMs) || 15000))
  }

  function start() {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    if (!config.enabled) return { ok: false, message: 'Agent 未启用（config.enabled=false）' }
    if (started) return { ok: true, message: '轮询已在运行' }
    started = true
    logger.log('polling.started interval=' + config.pollIntervalMs)
    emit('status', { polling: true, pollIntervalMs: config.pollIntervalMs, readOnly })
    schedulePoll()
    return { ok: true, message: '轮询已启动' }
  }

  function stop() {
    if (!started) return { ok: true, message: '轮询已停止' }
    started = false
    clearPollTimer()
    pending = null
    logger.log('polling.stopped')
    emit('status', { polling: false, pollIntervalMs: config.pollIntervalMs, readOnly })
    return { ok: true, message: '轮询已停止' }
  }

  function setPollInterval(ms) {
    const value = Math.floor(Number(ms))
    if (!Number.isFinite(value) || value < 2000 || value > 600000) {
      return { ok: false, message: '轮询间隔需在 2 秒到 10 分钟之间' }
    }
    config.pollIntervalMs = value
    if (started) schedulePoll()
    logger.log('polling.interval=' + value)
    emit('status', { polling: started, pollIntervalMs: value, readOnly })
    return { ok: true, message: '轮询间隔已更新', pollIntervalMs: value }
  }

  async function scan(input) {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    let waited = 0
    while (running && waited < 90000) { await new Promise((r) => setTimeout(r, 500)); waited += 500 }
    return await processTitle(input)
  }

  async function getSnapshot() {
    return {
      status: await buildStatus(),
      config: getSafeConfig(),
      history: getHistory(),
      events: recentEvents.slice(-40),
    }
  }

  // ---- 工具：状态 ----
  ctx.effect(() => ctx.tools.register({
    name: 'course_map_status',
    description: '查看「视频课程知识地图 Agent」的运行状态：是否启用、Obsidian vault、学科与视频数、最近错误、mnemon 状态。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' }, enabled: { type: 'boolean' },
          polling: { type: 'boolean' }, pollIntervalMs: { type: 'integer' }, readOnly: { type: 'boolean' },
          outputDir: { type: 'string' }, vaultPath: { type: 'string' }, noteRoot: { type: 'string' },
          lastTitle: { type: 'string' }, lastRunAt: { type: 'integer' },
          lastError: { type: 'string' }, mnemonReady: { type: 'boolean' },
          subjects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { subject: { type: 'string' }, videos: { type: 'integer' } }, required: ['subject', 'videos'] } },
          message: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_a, v) => [{ type: 'text', text: v.message ?? '' }],
    },
    async execute() {
      return await buildStatus()
    },
  }), 'dsh-video-coursemap: status tool')

  // ---- 工具：手动扫描 ----
  ctx.effect(() => ctx.tools.register({
    name: 'course_map_scan',
    description: '立即执行一次视频检测与知识地图生成（绕过轮询间隔）；可传 title 或 url 直接指定视频，force 可重新生成已处理视频。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '可选：视频标题（跳过前台窗口读取）' },
        url: { type: 'string', description: '可选：B站视频 URL 或 BV 号（优先使用，可直接命中 bvid）' },
        force: { type: 'boolean', description: '可选：强制重新生成已处理视频（覆盖前备份旧笔记）' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean' }, message: { type: 'string' }, subject: { type: 'string' }, notePath: { type: 'string' } },
        required: ['ok'],
      },
      render: (_a, v) => [{ type: 'text', text: v.message ?? '' }],
    },
    async execute(args) {
      if (!config.enabled) return { ok: false, message: 'Agent 未启用（config.enabled=false）' }
      if (readOnly) return { ok: false, message: '另一个 DSH 实例正在运行本插件（instance.lock），当前实例为只读模式' }
      let title = typeof args?.title === 'string' ? args.title.trim() : ''
      let url = typeof args?.url === 'string' ? args.url.trim() : ''
      if (!title && !url) {
        const fg = await observeForeground(config)
        if (!fg || !isBrowserName(fg.app, config)) return { ok: false, message: '前台不是浏览器/视频客户端（' + (fg?.app || '未知') + '）：' + (fg?.title || '') }
        title = cleanTitle(fg.title)
        url = fg.url || ''
      }
      let waited = 0
      while (running && waited < 90000) { await new Promise((r) => setTimeout(r, 500)); waited += 500 }
      return await processTitle({ title, url, force: Boolean(args?.force) })
    },
  }), 'dsh-video-coursemap: scan tool')

  // ---- 工具：诊断 ----
  ctx.effect(() => ctx.tools.register({
    name: 'course_map_check',
    description: '诊断视频课程知识地图 Agent 的运行前提：macOS 前台窗口权限、Obsidian vault、状态目录、mnemon CLI、B站接口、LLM 模型解析。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          checks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['id', 'ok', 'detail'] } },
          message: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_a, v) => [{ type: 'text', text: v.message ?? '' }],
    },
    async execute() {
      const checks = []
      const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail || '') })
      add('platform', process.platform === 'darwin' || process.platform === 'win32', process.platform + ' ' + process.arch)
      let fg = null
      try { fg = await observeForeground(config) } catch (e) { fg = { error: String(e?.message || e) } }
      let fgOk = Boolean(fg && (fg.title || fg.url) && !fg.error)
      let fgDetail = fg ? ('app=' + (fg.app || '?') + ' source=' + (fg.source || '?') + ' title=' + (fg.title || '') + (fg.error ? ' error=' + fg.error : '')) : '无法读取'
      if (process.platform === 'darwin') {
        try {
          const perm = await probeDarwinPermission()
          if (perm.ok) {
            fgOk = true
            fgDetail = perm.detail + '；当前前台=' + (fg?.app || '?') + '（非浏览器时插件会静默）'
          } else {
            fgOk = false
            fgDetail = perm.detail
          }
        } catch (e) {
          fgOk = false
          fgDetail = '权限探测失败：' + String(e?.message || e)
        }
      }
      add('foreground', fgOk, fgDetail)
      let vaultOk = false
      try { vaultOk = existsSync(vaultPath) && existsSync(outputDir) } catch { vaultOk = false }
      add('vault', vaultOk, vaultPath + ' → ' + outputDir)
      let stateOk = false
      try { ensureDir(config.stateDir); stateOk = existsSync(config.stateDir) } catch { stateOk = false }
      add('state', stateOk, config.stateDir)
      let mnemonPath = null
      try { mnemonPath = await findMnemon(config) } catch { mnemonPath = null }
      add('mnemon', Boolean(mnemonPath), mnemonPath || '未找到 mnemon CLI（可配置 mnemonBin）')
      const ytdlpPath = findYtDlp(config)
      add('ytdlp', Boolean(ytdlpPath), ytdlpPath || '未找到 yt-dlp（AI 字幕/转写需要）')
      let biliOk = false
      let biliDetail = ''
      try {
        const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } })
        const j = await res.json()
        biliOk = res.ok && j?.code === 0
        biliDetail = 'HTTP ' + res.status + ' code=' + (j?.code ?? '?')
      } catch (e) { biliDetail = String(e?.message || e) }
      add('bilibili', biliOk, biliDetail)
      let model = null
      try { model = resolveModel(ctx, config) } catch { model = null }
      add('llm', Boolean(model), model ? model.provider + '/' + model.model : '无法解析模型')
      const failed = checks.filter((c) => !c.ok)
      const message = ['视频课程知识地图诊断：', ...checks.map((c) => (c.ok ? '✅ ' : '❌ ') + c.id + '：' + c.detail), '', failed.length === 0 ? '全部通过，可以开始使用。' : '有 ' + failed.length + ' 项未通过，请按 README 的排障说明处理。'].join('\n')
      return { ok: failed.length === 0, checks, message }
    },
  }), 'dsh-video-coursemap: check tool')

  // ---- 轮询定时器 ----
  ctx.effect(() => {
    if (readOnly) {
      logger.log('readonly mode: another instance holds ' + lockPath)
      emit('status', { polling: false, pollIntervalMs: config.pollIntervalMs, readOnly: true })
      return () => {}
    }
    if (config.autoStart) start()
    return () => {
      stop()
      try {
        if (readFileSync(lockPath, 'utf8').trim() === String(process.pid)) unlinkSync(lockPath)
      } catch { /* 忽略 */ }
    }
  }, 'dsh-video-coursemap: poll timer')

  logger.log('apply pollIntervalMs=' + config.pollIntervalMs + ' autoStart=' + config.autoStart + ' vault=' + vaultPath + ' noteRoot=' + config.noteRoot + ' mnemon=' + config.enableMnemon + (readOnly ? ' readonly' : ''))
  if (!readOnly && config.autoStart) console.log('[dsh-video-coursemap] 已启动：每 ' + config.pollIntervalMs + 'ms 轮询前台窗口，输出 ' + outputDir)

  const controller = {
    start,
    stop,
    setPollInterval,
    scan,
    getStatus: buildStatus,
    getSnapshot,
    getHistory,
    getConfig: getSafeConfig,
    getEvents: () => recentEvents.slice(-40),
    getLastForeground: () => state.lastForeground ? { ...state.lastForeground, isBrowser: isBrowserName(state.lastForeground.app, config) } : null,
    onEvent,
    isReadOnly: () => readOnly,
    isStarted: () => started,
  }
  if (config.exposeController) return controller
}
