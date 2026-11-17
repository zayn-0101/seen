/**
 * seen-core · Obsidian 版
 *
 * 实时检测 B 站网页课程视频 → 学科分类 → 抓取简介/字幕/弹幕/评论 →
 * LLM 知识总结 → Obsidian 笔记/学习手册/总览 + dsh-mnemon insight。
 *
 * 基于 linner1224/dsh-video-coursemap 2.0.0（MIT）的架构 fork，
 * 新增 macOS 前台窗口检测、Obsidian 输出与 mnemon 集成。
 */

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  resolveConfig,
} from './config.js'
import {
  loadState, saveState, seenKey, isSeen, markSeen, pruneSeen,
  resolveSubjectName, recordFailure, shouldSkipFailure, clearFailure, listFailures,
} from './state.js'
import { observeForeground, isBrowserName } from './foreground.js'
import { probeDarwinPermission } from './foreground-darwin.js'
import { fetchContent, fetchComments, cleanBiliTitle, extractBvid, extractPage } from './bilibili.js'
import { classify, segmentTranscript, summarize, resolveModel } from './analyze.js'
import { getBilibiliCookieHeader } from './session.js'
import { fetchTranscript } from './transcript.js'
import { findYtDlp } from './ytdlp.js'
import { detectSource, extractDouyinId, extractYoutubeId, isDouyinJingxuanUrl, sourceLabel } from './source.js'
import { fetchDouyinContent, findChrome, findFfmpeg } from './douyin.js'
import { findWhisperCli, findWhisperModel } from './whisper.js'
import { fetchYoutubeContent, probeYoutube, youtubeWatchUrl } from './youtube.js'
import { renderVideoNote } from './render.js'
import { findRelatedVideos } from './concept.js'
import { buildTagVocabulary, mergeTags, mergeTagInVideos, rememberTags } from './tags.js'
import { rebuildKnowledgePages as rebuildPages } from './rebuild.js'
import { answerQuestion } from './ask.js'
import { searchVault } from './vault-search.js'
import { scoreNoteQuality } from './note-content.js'
import { normalizeNoteLayout } from './paths.js'
import { resolveVaultPath, ensureVaultDirs, writeVideoNote, writeTranscriptNote, readTranscriptNote, readVaultText, updateNoteReview, updateNoteTags, updateSubjectManual, updateOverview, openInObsidian, setVaultGuard, toPosix } from './obsidian.js'
import { parseTranscriptNote, renderTranscriptNote } from './transcript-note.js'
import { collectReviews, initialReview, nextReview, normalizeRating } from './review-schedule.js'
import { VAULT_HINT, createVaultGuard, probeVaultAccess } from './vault-access.js'
import { findMnemon, rememberVideo } from './mnemon.js'

export const name = 'seen-core'

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
    concepts: Array.isArray(v.concepts) ? v.concepts : [],
    terms: Array.isArray(v.terms) ? v.terms : [],
    template: v.template && typeof v.template === 'object' ? v.template : {},
    question: v.question || '',
    answer: v.answer || '',
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

  // vault 访问守卫：服务启动时已经探过权限，这里沿用结果；没有结果时先按可用处理。
  const vaultGuard = createVaultGuard({ initial: config.vaultAccess || null })
  setVaultGuard(vaultGuard)

  ensureDir(config.stateDir)
  if (!vaultGuard.isBlocked()) {
    ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir }).catch((error) => {
      if (error && error.vaultBlocked) return
      console.error('[seen-core] 准备笔记目录失败：', error)
    })
  }

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

  vaultGuard.onChange((status) => emit('vault', status))

  function save() {
    try { saveState(statePath, state) } catch (error) { logger.log('state.save.error msg=' + (error?.message || error)) }
  }

  async function processTitle(input) {
    if (running) return { ok: false, message: '已有任务正在处理，请稍后再试' }
    running = true
    let key = ''
    let activeKey = ''
    let rawTitle = ''
    let source = ''
    let inputBvid = null
    let inputVideoId = null
    try {
      rawTitle = cleanTitle(input?.title || '')
      // 重刷只重做整理与笔记，不重新抓内容/转写（缓存都还在）
      const refresh = Boolean(input?.refresh)
      source = detectSource({ url: input?.url, title: input?.title || rawTitle }) || (input?.bvid ? 'bilibili' : '')
      if (!source) {
        return { ok: false, code: 'unsupported-source', message: '无法识别视频来源：只支持 B站、抖音精选和 YouTube 视频链接' }
      }
      if (source === 'douyin' && !refresh && !isDouyinJingxuanUrl(input?.url || '')) {
        return { ok: false, code: 'douyin-not-jingxuan', message: '只处理抖音精选视频：请从精选页复制带 modal_id 的链接；普通 /video/ 视频不处理' }
      }
      const bvidFromUrl = source === 'bilibili' ? (extractBvid(input?.url || '') || null) : null
      inputBvid = input?.bvid || bvidFromUrl
      inputVideoId = input?.videoId
        || (source === 'douyin' ? extractDouyinId(input?.url || '') : '')
        || (source === 'youtube' ? extractYoutubeId(input?.url || '') : '')
      const inputPage = source === 'bilibili' ? extractPage(input?.url || '') : 1
      key = seenKey({ bvid: inputBvid, videoId: inputVideoId, source, title: rawTitle, page: inputPage })
      activeKey = key

      if (!refresh && !input?.force && isSeen(state, key)) {
        return { ok: true, skipped: true, message: '已处理过该视频，保持静默' }
      }
      if (!refresh && !input?.force && shouldSkipFailure(state, key)) {
        return { ok: true, skipped: true, message: '该视频最近失败次数过多，已冷却；可稍后手动重试' }
      }
      if (!rawTitle && !input?.url && !input?.bvid && !input?.videoId) {
        return { ok: false, message: '缺少视频标题或 URL' }
      }
      emit('detected', { title: rawTitle, url: input?.url || '', bvid: inputBvid || null, videoId: inputVideoId || null, source, force: Boolean(input?.force) })

      let cookieHeader = null
      if (source === 'bilibili') {
        try { cookieHeader = await getBilibiliCookieHeader({ config, url: input?.url || '' }) } catch { cookieHeader = null }
      }
      let content = null
      if (config.fetchContent) {
        if (source === 'douyin') {
          emit('fetching', { source, title: rawTitle, message: '解析抖音精选页面，下载音频并转写' })
          content = await fetchDouyinContent({
            url: input?.url || (inputVideoId ? 'https://www.douyin.com/video/' + inputVideoId : ''),
            title: rawTitle,
            config,
            force: Boolean(input?.force),
            onProgress: (progress) => emit('progress', { source, ...progress }),
          })
          logger.log('douyin content title=' + JSON.stringify(content?.title || rawTitle) + ' videoId=' + (content?.videoId || 'none') + ' transcript=' + (content?.fetchStats?.transcript || 0) + ' comments=' + (content?.fetchStats?.totalComments || 0))
          emit('content', { source, videoId: content?.videoId || null, title: content?.title || rawTitle, fetchStats: content?.fetchStats || null, chapters: [] })
          if (content?.videoId) {
            const videoKey = seenKey({ videoId: content.videoId, source: 'douyin', title: content.title || rawTitle })
            if (!input?.force && videoKey !== key && isSeen(state, videoKey)) {
              return { ok: true, skipped: true, message: '该抖音视频已处理过，保持静默' }
            }
            activeKey = videoKey
          }
        } else if (source === 'youtube') {
          emit('fetching', { source, title: rawTitle, message: '解析 YouTube 视频，获取字幕或本地转写' })
          content = await fetchYoutubeContent({
            url: input?.url || (inputVideoId ? youtubeWatchUrl(inputVideoId) : ''),
            title: rawTitle,
            config,
            force: Boolean(input?.force),
            onProgress: (progress) => emit('progress', { source, ...progress }),
          })
          logger.log('youtube content title=' + JSON.stringify(content?.title || rawTitle) + ' videoId=' + (content?.videoId || 'none') + ' source=' + (content?.transcriptSource || 'none') + ' transcript=' + (content?.fetchStats?.transcript || 0))
          emit('content', { source, videoId: content?.videoId || null, title: content?.title || rawTitle, fetchStats: content?.fetchStats || null, chapters: content?.chapters || [] })
          if (content?.videoId) {
            const videoKey = seenKey({ videoId: content.videoId, source: 'youtube', title: content.title || rawTitle })
            if (!input?.force && videoKey !== key && isSeen(state, videoKey)) {
              return { ok: true, skipped: true, message: '该 YouTube 视频已处理过，保持静默' }
            }
            activeKey = videoKey
          }
        } else {
          emit('fetching', { source, title: rawTitle, message: '抓取 B 站视频信息、字幕、弹幕与评论' })
          content = await fetchContent({
            ref: input?.url || input?.bvid || rawTitle,
            title: rawTitle,
            cookieHeader,
            commentLimit: config.commentLimit,
          })
          logger.log('bili content title=' + JSON.stringify(rawTitle) + ' matched=' + Boolean(content?.matched) + ' bvid=' + (content?.bvid || 'none') + ' danmaku=' + (content?.fetchStats?.danmaku || 0) + ' comments=' + (content?.fetchStats?.comments || 0) + ' transcript=' + (content?.fetchStats?.transcript || 0))
          emit('content', { source, bvid: content?.bvid || null, title: content?.title || rawTitle, fetchStats: content?.fetchStats || null, chapters: content?.chapters || [] })
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
            const bvidKey = seenKey({ bvid: content.bvid, title: content.title || rawTitle, page: content.page || inputPage })
            if (!input?.force && bvidKey !== key && isSeen(state, bvidKey)) {
              return { ok: true, skipped: true, message: '该视频（bvid）已处理过，保持静默' }
            }
            activeKey = bvidKey
          }
        }
      }

      const fallbackTitle = rawTitle || inputBvid || inputVideoId || '未命名视频'
      const title = (content?.matched && content.title && !/^https?:\/\//i.test(content.title)) ? content.title : (source === 'bilibili' ? cleanBiliTitle(fallbackTitle) : cleanTitle(fallbackTitle))
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
        markSeen(state, activeKey, { at: Date.now(), title, source, bvid: content?.bvid || inputBvid || null, videoId: content?.videoId || inputVideoId || null, page: content?.page || inputPage || 1, cid: content?.cid || null, isCourse: false })
        state.lastTitle = title
        state.stats.skipped += 1
        pruneSeen(state)
        save()
        emit('skipped', { reason: 'non-course', title })
        return { ok: true, skipped: true, message: '非知识内容，已静默忽略' }
      }

      const subject = resolveSubjectName(cls.subject, existing)
      const keywords = Array.isArray(cls.keywords) ? cls.keywords.map(String).filter(Boolean).slice(0, 10) : []
      // 重整理时可以直接用已存档的字幕，不必重新转写
      let transcript = input?.transcript || content?.transcript || ''
      let timedTranscript = input?.timedTranscript || content?.timedTranscript || ''
      let transcriptSource = input?.transcriptSource || content?.transcriptSource || (transcript ? 'up-subtitle' : '')
      if (!transcript && config.fetchTranscript && content?.bvid) {
        try {
          const tr = await fetchTranscript({
            bvid: content.bvid,
            cid: content.cid,
            page: content.page || inputPage,
            url: content.url || input?.url,
            title: content.title || title,
            author: content.owner || '',
            duration: Number(content.duration) || 0,
            config,
            cookieHeader,
            force: Boolean(input?.force),
            playerInfo: { subtitles: content.subtitleEntries || [] },
            onProgress: (progress) => emit('progress', { source, ...progress }),
          })
          if (tr?.text) {
            transcript = tr.text
            timedTranscript = tr.timed || ''
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
        content.timedTranscript = timedTranscript
        if (content.fetchStats) content.fetchStats.transcript = transcript.length
      }
      emit('transcript', { source: transcriptSource || 'none', length: transcript.length })
      const contentForSummary = content
        ? { ...content, transcript, transcriptSource, timedTranscript }
        : (transcript ? { transcript, transcriptSource } : null)
      const finalTitle = cls.title || title
      emit('summarizing', { title: finalTitle, subject, transcriptLength: transcript.length })
      const summary = await summarize(ctx, config, {
        title: finalTitle, subject, keywords, content: contentForSummary, transcript, transcriptSource,
        // 历史主题词表：让同一主题在不同视频里沿用同一种写法，避免标签漂移
        vocabulary: buildTagVocabulary(state),
      })
      const contentQuality = transcript ? 'full' : 'metadata-only'
      // 元数据版没有字幕支撑，概念与数字容易被模型编出来，不写进笔记与状态
      const noteConcepts = contentQuality === 'full' ? summary.concepts : []
      const noteNumbers = contentQuality === 'full' ? summary.numbers : []
      const noteContentType = summary.contentType || 'other'
      const noteTemplate = contentQuality === 'full' ? summary.template : {}
      const noteQuotes = contentQuality === 'full' ? summary.quotes : []
      const noteTerms = contentQuality === 'full' ? summary.terms : []
      const noteResources = contentQuality === 'full' ? summary.resources : []
      const noteQuality = scoreNoteQuality({
        contentQuality,
        transcriptSource,
        transcriptLength: transcript.length,
        keyPointCount: summary.keyPoints.length,
        conceptCount: noteConcepts.length,
      })
      emit('summarized', { title: finalTitle, subject, source, summary: summary.summary, keyPoints: summary.keyPoints, discussion: summary.discussion, contentQuality })
      const createdAt = Date.now()
      let noteChapters = Array.isArray(content?.chapters) ? content.chapters : []
      if (noteChapters.length === 0 && content?.timedTranscript) {
        const segments = await segmentTranscript(ctx, config, {
          title: finalTitle,
          timedTranscript: content.timedTranscript,
          duration: Number(content?.duration) || 0,
        })
        if (segments.length > 0) noteChapters = segments
      }
      const historyVideos = Object.entries(state.subjects || {}).flatMap(([subjectName, entry]) =>
        (Array.isArray(entry?.videos) ? entry.videos : []).map((item) => ({ ...item, subject: subjectName })))
      const relatedNotes = findRelatedVideos(
        { title: finalTitle, bvid: content?.bvid || inputBvid || '', videoId: content?.videoId || inputVideoId || '', url: content?.url || input?.url || '', concepts: noteConcepts, keywords },
        historyVideos,
        { limit: 5 },
      )
      // 重刷时保留原有复习进度，新笔记从今天开始排期
      const noteBvid = content?.bvid || inputBvid || ''
      const noteVideoId = content?.videoId || inputVideoId || ''
      const notePage = content?.page || inputPage || 1
      const previousRecord = historyVideos.find((item) =>
        (noteBvid && item.bvid === noteBvid && (Number(item.page) || 1) === notePage) ||
        (noteVideoId && item.videoId === noteVideoId) ||
        (!noteBvid && !noteVideoId && item.title === finalTitle))
      const noteReview = previousRecord?.review && previousRecord.review.due ? previousRecord.review : initialReview(createdAt)
      // 四层标签：学科 → 主题 → 类型 → 概念，统一由 tags.js 组装
      const noteTags = mergeTags({
        subject,
        themes: summary.tags?.themes,
        types: summary.tags?.types,
        concepts: noteConcepts,
      })

      const note = renderVideoNote({
        title: finalTitle,
        subject,
        source,
        platform: source,
        bvid: content?.bvid || inputBvid || '',
        videoId: content?.videoId || inputVideoId || '',
        url: content?.url || input?.url || '',
        author: content?.owner || content?.author || '',
        createdAt,
        summary: summary.summary,
        question: summary.question,
        answer: summary.answer,
        keyPoints: summary.keyPoints,
        concepts: noteConcepts,
        numbers: noteNumbers,
        discussion: summary.discussion,
        duration: Number(content?.duration) || 0,
        contentType: noteContentType,
        template: noteTemplate,
        quotes: noteQuotes,
        terms: noteTerms,
        resources: noteResources,
        quality: noteQuality,
        review: noteReview,
        transcriptLength: transcript.length,
        relatedNotes,
        fetchStats: content?.fetchStats || null,
        tags: noteTags,
        chapters: noteChapters,
        contentSource: transcriptSource || 'metadata',
        contentQuality,
        noteRoot: config.noteRoot,
        layout: config.noteLayout,
      })

      const writeResult = await writeVideoNote({
        vaultPath,
        noteRoot: config.noteRoot,
        layout: config.noteLayout,
        subject,
        title: finalTitle,
        bvid: content?.bvid || inputBvid || '',
        content: note,
        force: refresh || Boolean(input?.force),
      })

      // 字幕原文单独存档，之后「用已存字幕重新整理」不依赖缓存是否过期
      let transcriptPath = ''
      if (transcript) {
        const noteName = basename(writeResult.relPath, '.md')
        const archive = renderTranscriptNote({
          title: finalTitle,
          subject,
          source,
          url: content?.url || input?.url || '',
          bvid: content?.bvid || inputBvid || '',
          videoId: content?.videoId || inputVideoId || '',
          author: content?.owner || content?.author || '',
          createdAt,
          transcript,
          timedTranscript,
          notePath: writeResult.relPath,
        })
        const saved = await writeTranscriptNote({ vaultPath, noteRoot: config.noteRoot, noteName, content: archive })
        transcriptPath = saved.relPath
      }

      const isNewSubject = !state.subjects[subject]
      if (isNewSubject) state.subjects[subject] = { createdAt, updatedAt: createdAt, videos: [] }
      if (!Array.isArray(state.subjects[subject].videos)) state.subjects[subject].videos = []
      const videoRecord = {
        title: finalTitle,
        source,
        bvid: content?.bvid || inputBvid || '',
        videoId: content?.videoId || inputVideoId || '',
        page: notePage,
        cid: content?.cid || null,
        url: content?.url || input?.url || '',
        author: content?.owner || content?.author || '',
        notePath: writeResult.relPath,
        transcriptPath,
        keywords,
        summary: summary.summary.slice(0, 120),
        question: summary.question || '',
        answer: summary.answer || '',
        concepts: noteConcepts.map((item) => item.name),
        conceptDetails: noteConcepts.map((item) => ({ name: item.name, brief: item.brief || '', aliases: Array.isArray(item.aliases) ? item.aliases : [] })),
        terms: summary.terms || [],
        template: summary.template || {},
        tags: noteTags,
        contentType: noteContentType,
        quality: noteQuality,
        review: noteReview,
        createdAt,
      }
      const videos = state.subjects[subject].videos
      // 多 P 视频同一个 bvid 会有多条记录，必须带上分 P 号一起比较。
      const videoPage = Number(videoRecord.page) || 1
      const existed = videos.findIndex((v) =>
        (videoRecord.bvid && v.bvid === videoRecord.bvid && (Number(v.page) || 1) === videoPage) ||
        (videoRecord.videoId && v.videoId === videoRecord.videoId) ||
        (!videoRecord.bvid && !videoRecord.videoId && v.title === videoRecord.title)
      )
      if (existed >= 0) videos[existed] = { ...videos[existed], ...videoRecord }
      else videos.push(videoRecord)
      state.subjects[subject].updatedAt = createdAt

      await updateSubjectManual({ vaultPath, noteRoot: config.noteRoot, subject, videos: summarizeVideosForManual(state, subject), layout: config.noteLayout })
      await updateOverview({ vaultPath, noteRoot: config.noteRoot, subjects: Object.keys(state.subjects), videos: getHistory(), layout: config.noteLayout })
      if (config.openInObsidian) {
        const opened = await openInObsidian({ vaultPath, notePath: writeResult.relPath })
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
          videoId: content?.videoId || inputVideoId || '',
          url: content?.url || input?.url || '',
          keywords,
          tags: noteTags,
          platformLabel: sourceLabel(source),
        })
        state.stats.lastMnemon = { ok: Boolean(m?.ok), at: Date.now(), error: m?.error || '' }
        if (!m?.ok) logger.log('mnemon.error title=' + JSON.stringify(finalTitle) + ' msg=' + (m?.error || 'unknown'))
      }

      markSeen(state, activeKey, {
        at: Date.now(),
        title: finalTitle,
        source,
        bvid: content?.bvid || inputBvid || null,
        videoId: content?.videoId || inputVideoId || null,
        page: content?.page || inputPage || 1,
        cid: content?.cid || null,
        subject,
        notePath: writeResult.relPath,
        isCourse: true,
      })
      state.lastTitle = finalTitle
      state.lastRunAt = Date.now()
      state.stats.processed += 1
      // 词表只累计主题词，供下一篇提示词复用
      rememberTags(state, noteTags)
      clearFailure(state, activeKey)
      pruneSeen(state)
      save()

      logger.log('note.saved subject=' + JSON.stringify(subject) + ' title=' + JSON.stringify(finalTitle) + ' path=' + writeResult.relPath + ' skipped=' + writeResult.skipped)
      emit('saved', {
        title: finalTitle,
        subject,
        source,
        platform: source,
        notePath: writeResult.relPath,
        bvid: content?.bvid || inputBvid || '',
        videoId: content?.videoId || inputVideoId || '',
        author: content?.owner || content?.author || '',
        url: content?.url || input?.url || '',
        summary: summary.summary,
        keyPoints: summary.keyPoints,
        discussion: summary.discussion,
        contentSource: transcriptSource || 'metadata',
        contentQuality,
        fetchStats: content?.fetchStats || null,
        chapters: content?.chapters || [],
      })
      console.log('[seen-core] ' + (isNewSubject ? '新学科' : '更新学科') + '「' + subject + '」 ← ' + finalTitle)
      return { ok: true, message: '已生成「' + subject + '」笔记：' + writeResult.relPath, subject, notePath: writeResult.relPath }
    } catch (error) {
      const msg = String(error?.message || error)
      if (error && error.vaultBlocked) {
        logger.log('vault.blocked code=' + (error.code || '') + ' msg=' + msg)
        emit('vault-blocked', { code: error.code || 'timeout', detail: error.detail || msg, hint: VAULT_HINT })
        return { ok: false, message: '笔记没有写入：' + VAULT_HINT }
      }
      if (activeKey || key) {
        recordFailure(state, activeKey || key, msg, {
          title: rawTitle,
          url: input?.url || '',
          source,
          bvid: inputBvid || null,
          videoId: inputVideoId || null,
        })
        state.stats.failed += 1
        save()
      }
      logger.log('process.error key=' + JSON.stringify(key) + ' msg=' + msg)
      emit('error', { message: msg })
      console.error('[seen-core] 处理失败（不影响后续轮询）：', error)
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
    const source = detectSource({ url: rawUrl, title: rawTitle })
    if (!source) return
    if (source === 'douyin' && !isDouyinJingxuanUrl(rawUrl)) {
      logger.logOnce('douyin-skip|' + rawUrl, 'foreground.skip source=douyin reason=not-jingxuan app=' + JSON.stringify(fg.app) + ' url=' + JSON.stringify(rawUrl))
      pending = null
      return
    }
    const bvid = source === 'bilibili' ? (extractBvid(rawUrl) || null) : null
    const videoId = source === 'douyin'
      ? (extractDouyinId(rawUrl) || null)
      : source === 'youtube' ? (extractYoutubeId(rawUrl) || null) : null
    if (source === 'bilibili') {
      const onBilibili = /(^|\.)bilibili\.com\b|(^|\.)b23\.tv\b/i.test(rawUrl)
      const biliTitle = /哔哩哔哩|bilibili/i.test(rawTitle)
      // B 站首页/搜索页/分类页等非视频页面静默忽略。
      if (!bvid) {
        if (onBilibili) return
        if (!biliTitle) return
      }
    } else if ((source === 'douyin' || source === 'youtube') && !videoId) {
      // 抖音首页、YouTube 主页/搜索页/频道页都没有视频 ID，静默忽略。
      return
    }
    // 多 P 视频的前台 URL 带 ?p=n，去重键也要带分 P 号，否则看完 P1 后 P2 会被当成已看过
    const page = source === 'bilibili' ? extractPage(rawUrl) : 1
    const key = seenKey({ bvid, videoId, source, title, page })
    if (isSeen(state, key)) { pending = null; return }
    logger.logOnce('obs|' + key, 'foreground.browser app=' + JSON.stringify(fg.app) + ' title=' + JSON.stringify(title) + ' source=' + source + ' id=' + (bvid || videoId || 'none'))
    if (!pending || pending.key !== key) pending = { key, title, url: fg?.url || '', bvid, videoId, source, count: 1 }
    else pending.count += 1
    if (pending.count >= config.stablePolls) {
      const p = pending
      pending = null
      emit('stable', { title: p.title, url: p.url, bvid: p.bvid, videoId: p.videoId, source: p.source })
      await processTitle({ title: p.title, url: p.url, bvid: p.bvid, videoId: p.videoId, source: p.source })
    }
  }

  async function buildStatus() {
    let mnemonReady = false
    try { mnemonReady = Boolean(await findMnemon(config)) } catch { mnemonReady = false }
    const subjects = Object.entries(state.subjects).map(([subject, d]) => ({ subject, videos: d.videos?.length ?? 0 }))
    const lastError = state.lastForeground?.error || ''
    const message = [
      '拾影 状态：',
      '- 轮询：' + (readOnly ? '只读（另一个实例持有锁）' : started ? '运行中' : '已停止'),
      '- 轮询间隔：' + config.pollIntervalMs + 'ms',
      '- 启用：' + config.enabled,
      '- 笔记库权限：' + (vaultGuard.status().ok ? '正常' : vaultGuard.status().code + '（' + VAULT_HINT + '）'),
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
      vault: vaultGuard.status(),
      noteRoot: config.noteRoot,
      lastTitle: state.lastTitle,
      lastRunAt: state.lastRunAt,
      lastError,
      mnemonReady,
      subjects,
      failures: listFailures(state, 10),
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
      noteLayout: config.noteLayout,
      stateDir: config.stateDir,
      provider: config.provider,
      model: config.model,
      fetchTranscript: config.fetchTranscript,
      useBrowserCookies: config.useBrowserCookies,
      commentLimit: config.commentLimit,
      editorPass: Boolean(config.editorPass),
    }
  }

  function getHistory() {
    const rows = []
    for (const [subject, data] of Object.entries(state.subjects)) {
      for (const video of data.videos || []) {
        rows.push({
          subject,
          title: video.title,
          source: video.source || 'bilibili',
          bvid: video.bvid || '',
          videoId: video.videoId || '',
          url: video.url || '',
          author: video.author || '',
          notePath: video.notePath || '',
          transcriptPath: video.transcriptPath || '',
          summary: video.summary || '',
          question: video.question || '',
          answer: video.answer || '',
          keywords: video.keywords || [],
          concepts: Array.isArray(video.concepts) ? video.concepts : [],
          conceptDetails: Array.isArray(video.conceptDetails) ? video.conceptDetails : [],
          terms: Array.isArray(video.terms) ? video.terms : [],
          template: video.template && typeof video.template === 'object' ? video.template : {},
          tags: Array.isArray(video.tags) ? video.tags : [],
          contentType: video.contentType || '',
          quality: Number(video.quality) || 0,
          review: video.review && typeof video.review === 'object' ? video.review : null,
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

  function setNoteLayout(layout) {
    const next = normalizeNoteLayout(layout)
    if (next === config.noteLayout) {
      return { ok: true, message: '目录布局没有变化', noteLayout: next }
    }
    const previous = config.noteLayout
    config.noteLayout = next
    logger.log('note.layout=' + previous + '->' + next)
    emit('status', { polling: started, pollIntervalMs: config.pollIntervalMs, readOnly })
    const message = next === 'structured'
      ? '已切到结构化布局。旧笔记还在原目录，先运行 node scripts/migrate-vault.mjs --apply 迁移'
      : '已切回按学科平铺的布局。结构化目录里的旧笔记不会被自动移回'
    return { ok: true, message, noteLayout: next }
  }

  function setEditorPass(value) {
    const next = Boolean(value)
    if (next === Boolean(config.editorPass)) {
      return { ok: true, message: '润色没有变化', editorPass: next }
    }
    config.editorPass = next
    logger.log('editor.pass=' + next)
    return { ok: true, message: next ? '已开启发布前润色' : '已关闭发布前润色', editorPass: next }
  }

  async function scan(input) {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    let waited = 0
    while (running && waited < 90000) { await new Promise((r) => setTimeout(r, 500)); waited += 500 }
    return await processTitle(input)
  }

  /** 重试一条失败记录：先清掉失败计数，再用保存的链接重新处理。 */
  async function retryFailure(key) {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    const failures = state.failures && typeof state.failures === 'object' ? state.failures : {}
    const record = failures[key]
    if (!record || typeof record !== 'object') return { ok: false, message: '这条失败记录已经不存在了' }
    const meta = record.meta && typeof record.meta === 'object' ? record.meta : {}
    const input = {}
    if (meta.url) input.url = meta.url
    if (meta.title) input.title = meta.title
    if (meta.source) input.source = meta.source
    if (!input.url && !input.title) {
      return { ok: false, message: '这条记录是旧版本产生的，没有保存视频链接，请手动粘贴链接重试' }
    }
    clearFailure(state, key)
    save()
    return await processTitle(input)
  }

  /** 用已缓存的内容重刷历史笔记（不重新抓取/转写）。 */
  async function refreshHistory({ limit = 0, onProgress = null } = {}) {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    const rows = []
    for (const [subject, data] of Object.entries(state.subjects || {})) {
      for (const video of data?.videos || []) {
        if (!video?.title && !video?.url && !video?.bvid && !video?.videoId) continue
        rows.push({ subject, video })
      }
    }
    rows.sort((a, b) => (b.video.createdAt || 0) - (a.video.createdAt || 0))
    const targets = limit > 0 ? rows.slice(0, limit) : rows
    let done = 0
    let failed = 0
    for (const { video } of targets) {
      const input = { title: video.title || '', url: video.url || '', source: video.source || '', bvid: video.bvid || '', videoId: video.videoId || '', refresh: true }
      let result = null
      try {
        result = await processTitle(input)
      } catch (error) {
        result = { ok: false, message: error?.message || String(error) }
      }
      done += 1
      if (!result?.ok) failed += 1
      const progress = { done, total: targets.length, title: video.title || '', ok: Boolean(result?.ok) }
      emit('refresh', progress)
      if (typeof onProgress === 'function') onProgress(progress)
      logger.log('refresh.note=' + done + '/' + targets.length + ' ok=' + Boolean(result?.ok) + ' title=' + JSON.stringify(video.title || ''))
    }
    return { ok: true, total: targets.length, done, failed }
  }

  /** 用笔记旁的字幕存档重新整理一篇历史笔记（不重新转写）。 */
  async function resummarizeNote({ notePath } = {}) {
    if (readOnly) return { ok: false, message: '另一个实例持有 instance.lock，当前为只读模式' }
    const targetPath = toPosix(String(notePath || '').trim())
    if (!targetPath) return { ok: false, message: '缺少笔记路径' }
    let found = null
    for (const [subject, data] of Object.entries(state.subjects || {})) {
      for (const video of data?.videos || []) {
        if (toPosix(video?.notePath || '') === targetPath) { found = { subject, video }; break }
      }
      if (found) break
    }
    if (!found) return { ok: false, message: '没有找到这条历史笔记' }
    const noteName = basename(found.video.notePath || found.video.title || '未命名视频', '.md')
    let markdown = null
    try {
      markdown = await readTranscriptNote({ vaultPath, noteRoot: config.noteRoot, noteName })
    } catch (error) {
      return { ok: false, message: '读取字幕存档失败：' + String(error?.message || error) }
    }
    if (!markdown) return { ok: false, message: '这篇笔记还没有字幕存档，先重刷一次生成存档后再试' }
    const parsed = parseTranscriptNote(markdown)
    if (!parsed.text && !parsed.timed) return { ok: false, message: '字幕存档是空的' }
    logger.log('resummarize.note=' + JSON.stringify(found.video.title || '') + ' chars=' + (parsed.text || parsed.timed).length)
    return await processTitle({
      title: found.video.title || '',
      url: found.video.url || '',
      source: found.video.source || '',
      bvid: found.video.bvid || '',
      videoId: found.video.videoId || '',
      transcript: parsed.text || parsed.timed,
      timedTranscript: parsed.timed,
      transcriptSource: 'archive',
      refresh: true,
    })
  }

  /** 今日复习队列与学习统计（只读）。 */
  function getReviews() {
    return collectReviews(getHistory(), { limit: 20 })
  }

  /** 记录一次复习反馈：更新 state、frontmatter，并按 SM-2 排下一次。 */
  async function recordReview({ notePath, rating } = {}) {
    const relPath = String(notePath || '').trim()
    if (!relPath) return { ok: false, message: '缺少 notePath' }
    const normalized = normalizeRating(rating)
    if (!normalized) return { ok: false, message: '复习反馈只能是 again / hard / easy' }
    let found = null
    for (const [, data] of Object.entries(state.subjects || {})) {
      const video = (Array.isArray(data?.videos) ? data.videos : []).find((item) => item.notePath === relPath)
      if (video) { found = video; break }
    }
    if (!found) return { ok: false, message: '找不到这篇笔记：' + relPath }
    const now = Date.now()
    const current = found.review && found.review.due ? found.review : initialReview(now)
    const review = nextReview(current, normalized, now)
    let noteResult
    try {
      noteResult = await updateNoteReview({ vaultPath, notePath: relPath, review })
    } catch (error) {
      noteResult = { ok: false, error: error?.message || '更新笔记里的复习状态失败' }
    }
    if (!noteResult.ok) return { ok: false, message: noteResult.error || '更新笔记里的复习状态失败', review }
    found.review = review
    try { saveState(statePath, state) } catch (error) { logger.log('state.save.error msg=' + (error?.message || error)) }
    logger.log('review.record title=' + JSON.stringify(found.title) + ' rating=' + normalized + ' due=' + review.due)
    emit('review', { title: found.title, rating: normalized, review })
    return { ok: true, message: normalized === 'easy' ? '记住了，下次 ' + review.due + ' 再见' : normalized === 'hard' ? '有点模糊，' + review.due + ' 再复习一次' : '没关系，明天再来', review }
  }

  /** 问笔记库：搜索相关笔记，读正文交给模型回答并返回引用。 */
  async function askLibrary({ question } = {}) {
    const q = String(question || '').trim()
    if (!q) return { ok: false, message: '请输入一个问题' }
    const vault = vaultGuard.status()
    if (vault.ok === false) return { ok: false, message: VAULT_HINT, blocked: true }
    const hits = await searchVault({ vaultPath, noteRoot: config.noteRoot, query: q, limit: 8 })
    const wanted = new Set(['视频笔记', '概念页', '主题综述'])
    const notes = []
    for (const hit of hits) {
      if (notes.length >= 5) break
      if (!wanted.has(hit.kind)) continue
      const relPath = toPosix(join(config.noteRoot, hit.relPath))
      const file = await readVaultText({ vaultPath, relPath })
      if (!file.ok) continue
      notes.push({ title: hit.title, notePath: relPath, body: file.text })
    }
    if (notes.length === 0) {
      return { ok: true, question: q, answer: '笔记库里没有找到相关的笔记。可以换个关键词，或先整理几篇相关视频。', citations: [], sources: [] }
    }
    try {
      const result = await answerQuestion({
        question: q,
        notes,
        llm: ctx.llm,
        config: { provider: config.provider, model: config.model },
        maxTokens: 1800,
      })
      return { ok: true, question: q, ...result, sources: notes.map((note) => ({ title: note.title, notePath: note.notePath })) }
    } catch (error) {
      return { ok: false, message: '回答失败：' + (error?.message || error) }
    }
  }

  /** 把一个主题标签合并到另一个主题（同时改 state 与笔记 frontmatter）。 */
  async function renameTag({ from, to } = {}) {
    const source = String(from || '').trim()
    const target = String(to || '').trim()
    if (!source || !target) return { ok: false, message: '缺少源标签或目标标签' }
    if (source === target) return { ok: false, message: '两个标签相同' }
    if (source.startsWith('类型/') || source.startsWith('概念/') || target.startsWith('类型/') || target.startsWith('概念/')) {
      return { ok: false, message: '目前只支持合并主题标签，类型和概念请用回填脚本处理' }
    }
    const videos = getHistory()
    if (videos.some((video) => String(video.subject || '') === source)) {
      return { ok: false, message: '学科标签不能合并' }
    }
    const result = mergeTagInVideos(videos, source, target)
    if (result.changed === 0) return { ok: false, message: '没有找到这个主题标签' }
    let changed = 0
    for (const item of result.changedVideos) {
      const noteResult = await updateNoteTags({ vaultPath, notePath: item.notePath, tags: item.tags })
      if (!noteResult.ok) return { ok: false, message: noteResult.error || '更新笔记标签失败', changed }
      for (const data of Object.values(state.subjects || {})) {
        const video = (Array.isArray(data?.videos) ? data.videos : []).find((entry) => entry.notePath === item.notePath)
        if (video) { video.tags = item.tags; break }
      }
      changed += 1
    }
    if (state.tagVocabulary && typeof state.tagVocabulary === 'object') {
      const count = Number(state.tagVocabulary[source] || 0)
      if (count > 0) state.tagVocabulary[target] = (Number(state.tagVocabulary[target]) || 0) + count
      delete state.tagVocabulary[source]
    }
    try { saveState(statePath, state) } catch (error) { logger.log('state.save.error msg=' + (error?.message || error)) }
    logger.log('tags.merge from=' + JSON.stringify(source) + ' to=' + JSON.stringify(target) + ' changed=' + changed)
    try { await rebuildKnowledgePages() } catch (error) { logger.log('tags.merge.rebuild.error msg=' + (error?.message || error)) }
    return { ok: true, changed, message: '已把「' + source + '」合并到「' + target + '」，更新 ' + changed + ' 篇笔记' }
  }

  /** 全量重建知识库页面：索引、概念页、主题综述、学科手册与总览。 */
  async function rebuildKnowledgePages() {
    const vault = vaultGuard.status()
    if (vault.ok === false) return { ok: false, message: VAULT_HINT }
    await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
    const result = await rebuildPages({ vaultPath, noteRoot: config.noteRoot, state, layout: config.noteLayout, log: (line) => logger.log(line) })
    return { ok: true, ...result }
  }

  /** 最近的失败记录（面板展示用） */
  function getFailures(limit = 20) {
    return listFailures(state, limit)
  }

  async function getSnapshot() {
    return {
      status: await buildStatus(),
      config: getSafeConfig(),
      history: getHistory(),
      reviews: getReviews(),
      events: recentEvents.slice(-40),
    }
  }

  // ---- 工具：状态 ----
  ctx.effect(() => ctx.tools.register({
    name: 'course_map_status',
    description: '查看「拾影」的运行状态：是否启用、Obsidian vault、学科与视频数、最近错误、mnemon 状态。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' }, enabled: { type: 'boolean' },
          polling: { type: 'boolean' }, pollIntervalMs: { type: 'integer' }, readOnly: { type: 'boolean' },
          outputDir: { type: 'string' }, vaultPath: { type: 'string' }, noteRoot: { type: 'string' },
          vault: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, code: { type: 'string' }, detail: { type: 'string' }, hint: { type: 'string' }, blocked: { type: 'boolean' }, checkedAt: { type: 'integer' } }, required: ['ok', 'code'] },
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
  }), 'seen-core: status tool')

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
      if (readOnly) return { ok: false, message: '另一个实例正在运行（instance.lock），当前实例为只读模式' }
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
  }), 'seen-core: scan tool')

  // ---- 工具：诊断 ----
  ctx.effect(() => ctx.tools.register({
    name: 'course_map_check',
    description: '诊断拾影 的运行前提：macOS 前台窗口权限、Obsidian vault、状态目录、mnemon CLI、B站接口、LLM 模型解析。',
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
      const add = (id, label, ok, detail) => checks.push({ id, label, ok: Boolean(ok), detail: String(detail || '') })
      add('platform', '运行环境', process.platform === 'darwin' || process.platform === 'win32', process.platform + ' ' + process.arch)
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
      add('foreground', '读取浏览器窗口', fgOk, fgDetail)
      const vaultState = vaultGuard.status()
      add('vault', 'Obsidian 笔记库', vaultState.ok, vaultState.ok ? vaultPath + ' → ' + outputDir : vaultState.code + '：' + VAULT_HINT)
      let stateOk = false
      try { ensureDir(config.stateDir); stateOk = existsSync(config.stateDir) } catch { stateOk = false }
      add('state', '数据目录', stateOk, config.stateDir)
      let mnemonPath = null
      try { mnemonPath = await findMnemon(config) } catch { mnemonPath = null }
      add('mnemon', '记忆库（可选）', Boolean(mnemonPath), mnemonPath || '未找到 mnemon CLI（可配置 mnemonBin）')
      const ytdlpPath = findYtDlp(config)
      add('ytdlp', 'yt-dlp（B站字幕 / YouTube 解析）', Boolean(ytdlpPath), ytdlpPath || '未安装：首次处理视频时会自动下载到 ~/.seen/bin（也可 brew install yt-dlp）')
      const chromePath = findChrome(config)
      const ffmpegPath = findFfmpeg(config)
      const whisperPath = findWhisperCli(config)
      const whisperModel = findWhisperModel(config)
      add('douyin-chrome', '抖音解析所需的 Chrome', Boolean(chromePath), chromePath || '未找到 Chrome（抖音页面解析需要）')
      add('ffmpeg', 'ffmpeg（音频预处理）', Boolean(ffmpegPath), ffmpegPath || '未安装：首次需要时自动下载到 ~/.seen/bin（也可 brew install ffmpeg）')
      add('whisper-cli', 'whisper-cli（本地语音转写）', Boolean(whisperPath), whisperPath || '未安装：运行 brew install whisper.cpp（官方没有预编译包）')
      add('whisper-model', 'Whisper 模型（B站 / 抖音 / YouTube 无字幕）', Boolean(whisperModel), whisperModel || '未安装：在下方按推荐选择一个下载（推荐 Large v3 Turbo）')
      let biliOk = false
      let biliDetail = ''
      try {
        const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } })
        const j = await res.json()
        biliOk = res.ok && j?.code === 0
        biliDetail = 'HTTP ' + res.status + ' code=' + (j?.code ?? '?')
      } catch (e) { biliDetail = String(e?.message || e) }
      add('bilibili', 'B站接口', biliOk, biliDetail)
      let ytCheck = { ok: false, detail: '未找到 yt-dlp（可运行 brew install yt-dlp 安装）' }
      if (ytdlpPath) {
        try { ytCheck = await probeYoutube(config) } catch (e) { ytCheck = { ok: false, detail: String(e?.message || e) } }
      }
      add('youtube', 'YouTube 网络', ytCheck.ok, ytCheck.detail || '无法访问 YouTube')
      let model = null
      try { model = resolveModel(ctx, config) } catch { model = null }
      add('llm', '模型服务', Boolean(model), model ? model.provider + '/' + model.model : '无法解析模型')
      const failed = checks.filter((c) => !c.ok)
      const message = failed.length === 0
        ? '一切正常'
        : '有 ' + failed.length + ' 项需要处理：' + '\n' + failed.map((c) => '· ' + c.label + '：' + c.detail).join('\n')
      return { ok: failed.length === 0, checks, message }
    },
  }), 'seen-core: check tool')

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
  }, 'seen-core: poll timer')

  logger.log('apply pollIntervalMs=' + config.pollIntervalMs + ' autoStart=' + config.autoStart + ' vault=' + vaultPath + ' noteRoot=' + config.noteRoot + ' mnemon=' + config.enableMnemon + (readOnly ? ' readonly' : ''))
  if (!readOnly && config.autoStart) console.log('[seen-core] 已启动：每 ' + config.pollIntervalMs + 'ms 轮询前台窗口，输出 ' + outputDir)

  /** 当前 vault 访问状态。 */
  function getVaultStatus() {
    return vaultGuard.status()
  }

  /** 用一次探测结果覆盖 vault 状态（服务端探针调用）。 */
  function setVaultAccess(result) {
    return vaultGuard.apply(result)
  }

  /** 重新探测 vault 权限；成功则补齐目录。 */
  async function reprobeVault() {
    const result = await probeVaultAccess(vaultPath)
    vaultGuard.apply(result)
    if (result.ok) {
      try {
        await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
      } catch (error) {
        if (!(error && error.vaultBlocked)) console.error('[seen-core] 重试准备笔记目录失败：', error)
      }
    }
    return vaultGuard.status()
  }

  const controller = {
    start,
    stop,
    setPollInterval,
    setNoteLayout,
    setEditorPass,
    getVaultStatus,
    setVaultAccess,
    reprobeVault,
    scan,
    retryFailure,
    refreshHistory,
    resummarizeNote,
    rebuildKnowledgePages,
    getReviews,
    recordReview,
    askLibrary,
    renameTag,
    getFailures,
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
