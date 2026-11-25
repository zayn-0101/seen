/**
 * seen-core · Obsidian 版
 *
 * 实时检测 B 站网页课程视频 → 学科分类 → 抓取简介/字幕/弹幕/评论 →
 * LLM 知识总结 → Obsidian 笔记/学习手册/总览 + dsh-mnemon insight。
 *
 * 基于 linner1224/dsh-video-coursemap 2.0.0（MIT）的架构 fork，
 * 新增 macOS 前台窗口检测、Obsidian 输出与 mnemon 集成。
 */

import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  resolveConfig,
} from './config.js'
import {
  defaultState, loadState, saveState, seedStateBackup, seenKey, isSeen, markSeen, pruneSeen,
  resolveSubjectName, recordFailure, shouldSkipFailure, clearFailure, listFailures,
} from './state.js'
import { observeForeground, isBrowserName } from './foreground.js'
import { probeDarwinPermission } from './foreground-darwin.js'
import { fetchContent, fetchComments, cleanBiliTitle, extractBvid, extractPage } from './bilibili.js'
import { classify, segmentTranscript, summarize, resolveModel } from './analyze.js'
import { getBilibiliCookieHeader } from './session.js'
import { fetchTranscript } from './transcript.js'
import { findYtDlp } from './ytdlp.js'
import { videoIdentity, detectSource, extractDouyinId, extractYoutubeId, isDouyinJingxuanUrl, sourceLabel } from './source.js'
import { fetchDouyinContent, findChrome, findFfmpeg } from './douyin.js'
import { findWhisperCli, findWhisperModel } from './whisper.js'
import { fetchYoutubeContent, probeYoutube, youtubeWatchUrl } from './youtube.js'
import { renderVideoNote } from './render.js'
import { findRelatedVideos } from './concept.js'
import { buildTagVocabulary, mergeTags, mergeTagInVideos, rememberTags } from './tags.js'
import { buildHistoryFromState, findDuplicateVideos, rebuildKnowledgePages as rebuildPages } from './rebuild.js'
import { answerQuestion } from './ask.js'
import { searchVault, listMarkdownFiles, listMarkdownFilesDetailed } from './vault-search.js'
import { scoreNoteQuality } from './note-content.js'
import { parseNoteMarkdown } from './note-check.js'
import { normalizeNoteLayout, normalizeNoteRoot, normalizeStateAuxPaths, transcriptNoteRelPath, AUX_DIR, BACKUP_DIR, TRANSCRIPT_DIR, VIDEO_DIR } from './paths.js'
import { resolveVaultPath, ensureVaultDirs, writeVideoNote, writeTranscriptNote, readTranscriptNote, readVaultText, readNoteIdentity, updateNoteReview, updateNoteTags, openInObsidian, setVaultGuard, drainVaultQueue, toPosix } from './obsidian.js'
import { parseTranscriptNote, renderTranscriptNote, transcriptNoteOwner } from './transcript-note.js'
import { collectReviews, initialReview, nextReview, normalizeRating } from './review-schedule.js'
import { VAULT_HINT, createVaultGuard, probeVaultAccess } from './vault-access.js'
import { findMnemon, rememberVideo } from './mnemon.js'
import { createProcessQueue } from './process-queue.js'
import { acquireInstanceLock, releaseInstanceLock } from './instance-lock.js'

export { LOCK_EMPTY_STALE_MS, inspectInstanceLock, createInstanceLock, removeStaleInstanceLock, acquireInstanceLock, releaseInstanceLock } from './instance-lock.js'

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
  const logger = makeLogger(config.stateDir)
  const statePath = join(config.stateDir, 'state.json')
  const lockPath = join(config.stateDir, 'instance.lock')
  let readOnly = false
  let readOnlyReason = ''
  const lock = acquireInstanceLock(lockPath)
  if (!lock.ok) {
    readOnly = true
    readOnlyReason = lock.reason || 'locked-by-other'
  }
  let state
  try {
    state = loadState(statePath, { strict: true })
  } catch (error) {
    logger.log('state.load.error ' + error.message)
    state = defaultState()
    readOnly = true
    readOnlyReason = 'state-unreadable'
  }
  const reasonLabels = {
    'state-unreadable': 'state.json 无法读取或格式无效',
    'lock-write-failed': '实例锁写入失败',
    'lock-stale-unlink-failed': '旧实例锁无法清理',
  }
  const readOnlyLabel = reasonLabels[readOnlyReason] || '另一个实例持有锁'
  const readOnlyMessage = readOnly ? readOnlyLabel + '，当前为只读模式' : ''
  // 先留下升级前的有效状态，再做任何归一化写盘。
  if (!readOnly) {
    try { seedStateBackup(statePath) } catch (error) {
      logger.log('state.backup.error ' + (error.code || error.message))
    }
  }
  const normalizedAuxPaths = normalizeStateAuxPaths(state, { vaultPath, noteRoot: config.noteRoot })
  if (normalizedAuxPaths > 0) {
    logger.log('state.aux-path.normalized count=' + normalizedAuxPaths)
    if (!readOnly) {
      try {
        persistState()
        logger.log('state.aux-path.saved count=' + normalizedAuxPaths)
      } catch (error) {
        logger.log('state.aux-path.save.error msg=' + (error?.message || error))
      }
    }
  }

  let pending = null
  let started = false
  let pollTimer = null
  let pollGeneration = 0
  const eventListeners = new Set()
  const recentEvents = []
  const changedSubjects = new Set()
  let openBatches = 0
  let pageUpdates = Promise.resolve()

  // 只在取得实例锁之后准备笔记目录，并让调用方能够等待初始化结束。
  // 首次启动 TCC 授权超时、之后 reprobe 成功的路径也必须补跑恢复，且与 ready 共用同一个任务。
  let recoveryPromise = null
  function schedulePendingRecovery({ ensureDirs = true } = {}) {
    if (readOnly || vaultGuard.isBlocked()) return Promise.resolve()
    if (recoveryPromise) return recoveryPromise
    recoveryPromise = (async () => {
      if (ensureDirs) await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
      await reconcilePendingState()
    })().catch((error) => {
      if (error && error.vaultBlocked) return
      console.error('[seen-core] 准备笔记目录失败：', error)
    }).finally(() => { recoveryPromise = null })
    return recoveryPromise
  }
  const ready = schedulePendingRecovery()

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

  function persistState(options) {
    const { backupError } = saveState(statePath, state, options)
    if (backupError) logger.log('state.backup.error ' + backupError)
  }

  function save(options) {
    try {
      persistState(options)
      return true
    } catch (error) {
      logger.log('state.save.error msg=' + (error?.message || error))
      return false
    }
  }

  function parseFrontmatterReview(text) {
    const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return null
    const line = match[1].match(/^review:\s*(.+)$/m)
    if (!line) return null
    try { return JSON.parse(line[1]) } catch { return null }
  }

  /** 取 Obsidian callout 的正文（不含 [!kind] 标题行）。 */
  function calloutText(text, kind) {
    const lines = String(text || '').split(/\r?\n/)
    const marker = new RegExp('^>\\s*\\[!' + kind + '\\]', 'i')
    const out = []
    let inside = false
    for (const line of lines) {
      if (!inside) {
        if (marker.test(line)) inside = true
        continue
      }
      if (/^>/.test(line)) {
        out.push(line.replace(/^>\s?/, ''))
        continue
      }
      if (!line.trim() && out.length) break
      if (line.trim()) break
    }
    return out.join('\n').trim()
  }

  /** 崩溃恢复时从已写好的笔记回填状态里缺的字段，避免索引与跨笔记关联永久缺这篇。 */
  function recoverVideoFields(text) {
    const parsed = parseNoteMarkdown(text)
    const concepts = parsed.tags
      .filter((tag) => tag.startsWith('概念/'))
      .map((tag) => tag.slice('概念/'.length).trim())
      .filter(Boolean)
    return {
      summary: calloutText(parsed.body, 'abstract'),
      question: calloutText(parsed.body, 'question'),
      answer: calloutText(parsed.body, 'success'),
      tags: parsed.tags,
      concepts,
      quality: parsed.quality || 0,
      contentType: parsed.contentType || '',
      contentQuality: parsed.contentQuality || '',
      review: parseFrontmatterReview(text),
    }
  }

  // 启动恢复：上一次进程在「笔记已写、state 未落」之间崩溃时，凭身份把记录补回状态。
  async function reconcilePendingState() {
    const pendingVideos = state.pendingVideos && typeof state.pendingVideos === 'object' ? Object.entries(state.pendingVideos) : []
    const pendingReviews = state.pendingReviews && typeof state.pendingReviews === 'object' ? Object.entries(state.pendingReviews) : []
    if (!pendingVideos.length && !pendingReviews.length) return
    let changed = false
    let restored = false
    let listing = null
    const hasIdentity = (item) => Boolean(item?.bvid || item?.videoId)
    const identityMatches = (pending, candidate) => {
      const id = videoIdentity(pending)
      return Boolean(id && candidate && videoIdentity(candidate) === id)
    }
    const listNotes = async () => {
      if (!listing) {
        const scan = await listMarkdownFilesDetailed({ vaultPath, noteRoot: config.noteRoot })
        const root = toPosix(vaultPath).replace(/\/+$/, '') + '/'
        const rootRel = normalizeNoteRoot(config.noteRoot)
        const auxDirs = new Set([AUX_DIR, TRANSCRIPT_DIR, BACKUP_DIR])
        // 恢复不能只看当前布局：用户可能刚在 structured / flat 之间切过。
        const found = scan.files.map((file) => toPosix(file).replace(root, '')).filter((rel) => {
          if (!rel.startsWith(rootRel + '/')) return false
          const rest = rel.slice(rootRel.length + 1).split('/')
          if (rest.length < 2 || auxDirs.has(rest[0])) return false
          return rest[0] === VIDEO_DIR ? rest.length >= 3 : rest.length === 2
        })
        listing = { files: found, incomplete: scan.truncated || scan.skipped > 0 }
      }
      return listing
    }

    for (const [pendingKey, pending] of pendingVideos) {
      let notePath = toPosix(pending?.notePath || '')
      let noteText = ''
      let identity = null
      if (notePath) {
        const read = await readVaultText({ vaultPath, relPath: notePath })
        if (read.ok) {
          noteText = read.text
          try { identity = await readNoteIdentity({ vaultPath, relPath: notePath }) } catch { identity = null }
        }
        // 有身份的记录必须与笔记 frontmatter 对得上，不能只看路径存在。
        if (identity && hasIdentity(pending) && !identityMatches(pending, identity)) {
          identity = null
          notePath = ''
        }
      }
      if (!notePath || !identity) {
        const matches = []
        let scanFailed = false
        const scanned = await listNotes()
        for (const rel of scanned.files) {
          let candidate = null
          try { candidate = await readNoteIdentity({ vaultPath, relPath: rel }) } catch { scanFailed = true; continue }
          if (identityMatches(pending, candidate)) matches.push(rel)
        }
        if (matches.length === 1) {
          notePath = matches[0]
          const read = await readVaultText({ vaultPath, relPath: notePath })
          if (read.ok) noteText = read.text
          try { identity = await readNoteIdentity({ vaultPath, relPath: notePath }) } catch { identity = null }
        } else if (matches.length > 1) {
          logger.log('state.pending.reconcile.ambiguous key=' + JSON.stringify(pendingKey) + ' matches=' + matches.length)
          continue
        } else if (scanFailed || scanned.incomplete) {
          logger.log('state.pending.reconcile.scan-incomplete key=' + JSON.stringify(pendingKey) + ' truncated=' + scanned.incomplete + ' failed=' + scanFailed)
          continue
        } else {
          // 笔记根本没有落盘（崩溃发生在写入前），待处理记录已无恢复价值。
          delete state.pendingVideos[pendingKey]
          changed = true
          logger.log('state.pending.video.dropped key=' + JSON.stringify(pendingKey))
          continue
        }
      }
      if (!notePath || !identity) continue
      const recovered = noteText ? recoverVideoFields(noteText) : {}
      const recoveredTags = Array.isArray(recovered.tags) ? recovered.tags.filter(Boolean) : []
      const recoveredConcepts = Array.isArray(recovered.concepts) ? recovered.concepts.filter(Boolean) : []
      // 刷新可能改了标题、学科或路径：按身份跨学科收集记录，优先用新路径那条。
      const matches = []
      for (const [bucketName, bucket] of Object.entries(state.subjects || {})) {
        if (!bucket || !Array.isArray(bucket.videos)) continue
        for (const video of bucket.videos) {
          if (video && (identityMatches(pending, video) || identityMatches(identity, video))) matches.push({ bucketName, video })
        }
      }
      const samePath = matches.filter(match => toPosix(match.video.notePath || '') === notePath)
      let chosen = samePath[0] || null
      if (!chosen && matches.length === 1) {
        const otherPath = toPosix(matches[0].video.notePath || '')
        const missing = !otherPath || (await readVaultText({ vaultPath, relPath: otherPath })).code === 'not-found'
        if (missing) chosen = matches[0]
      }
      const subject = pending.subject || chosen?.bucketName || '未分类'
      if (!state.subjects[subject] || typeof state.subjects[subject] !== 'object') state.subjects[subject] = { videos: [], updatedAt: Date.now() }
      const videos = Array.isArray(state.subjects[subject].videos) ? state.subjects[subject].videos : (state.subjects[subject].videos = [])
      let target = chosen?.video || null
      if (!target) {
        target = {
          title: pending.title || '',
          source: pending.source || identity.source || '',
          bvid: pending.bvid || identity.bvid || '',
          videoId: pending.videoId || identity.videoId || '',
          page: pending.page || identity.page || 1,
          url: pending.url || '',
          author: pending.author || '',
          notePath,
          transcriptPath: pending.transcriptPath || '',
          createdAt: pending.createdAt || Date.now(),
          summary: recovered.summary || '',
          question: recovered.question || '',
          answer: recovered.answer || '',
          tags: recoveredTags,
          concepts: recoveredConcepts,
          conceptDetails: [],
          quality: recovered.quality || 0,
          contentType: recovered.contentType || '',
          contentQuality: recovered.contentQuality || '',
          review: recovered.review || null,
        }
        videos.push(target)
      } else {
        // 同一个文件只保留一条记录，其他路径可能有各自的手写内容。
        for (const match of samePath) {
          if (match.video === target) continue
          const bucket = state.subjects[match.bucketName]
          if (!bucket || !Array.isArray(bucket.videos)) continue
          const index = bucket.videos.indexOf(match.video)
          if (index >= 0) bucket.videos.splice(index, 1)
        }
        if (chosen.bucketName !== subject) {
          const oldBucket = state.subjects[chosen.bucketName]
          if (oldBucket && Array.isArray(oldBucket.videos)) {
            const index = oldBucket.videos.indexOf(target)
            if (index >= 0) oldBucket.videos.splice(index, 1)
          }
          if (!videos.includes(target)) videos.push(target)
        }
        Object.assign(target, {
          title: pending.title || target.title || '',
          source: pending.source || identity.source || target.source || '',
          bvid: pending.bvid || identity.bvid || target.bvid || '',
          videoId: pending.videoId || identity.videoId || target.videoId || '',
          page: pending.page || identity.page || target.page || 1,
          url: pending.url || target.url || '',
          author: pending.author || target.author || '',
          notePath,
          transcriptPath: pending.transcriptPath || target.transcriptPath || '',
          summary: recovered.summary || target.summary || '',
          question: recovered.question || target.question || '',
          answer: recovered.answer || target.answer || '',
          tags: recoveredTags.length ? recoveredTags : (target.tags || []),
          concepts: recoveredConcepts.length ? recoveredConcepts : (target.concepts || []),
          quality: recovered.quality || target.quality || 0,
          contentType: recovered.contentType || target.contentType || '',
          contentQuality: recovered.contentQuality || target.contentQuality || '',
          review: recovered.review || target.review || null,
        })
        if (!target.conceptDetails) target.conceptDetails = []
        if (!target.createdAt) target.createdAt = pending.createdAt || Date.now()
      }
      restored = true
      markSeen(state, pending.activeKey || pending.key || pendingKey, {
        at: Date.now(),
        title: pending.title || '',
        source: pending.source || identity.source || '',
        bvid: pending.bvid || identity.bvid || '',
        videoId: pending.videoId || identity.videoId || '',
        notePath,
        isCourse: true,
      })
      delete state.pendingVideos[pendingKey]
      changed = true
      logger.log('state.pending.video.reconciled key=' + JSON.stringify(pendingKey) + ' note=' + JSON.stringify(notePath))
    }

    for (const [notePath, pending] of pendingReviews) {
      const read = await readVaultText({ vaultPath, relPath: notePath })
      if (!read.ok) {
        // 只有「这篇笔记确定不存在」才能丢弃恢复意图；笔记库不可访问、权限、守卫、超时都要保留。
        if (read.code === 'not-found') {
          delete state.pendingReviews[notePath]
          changed = true
        } else {
          logger.log('state.pending.review.read-failed path=' + JSON.stringify(notePath) + ' code=' + JSON.stringify(read.code || ''))
        }
        continue
      }
      const review = parseFrontmatterReview(read.text)
      const expected = pending?.review
      if (review && expected && JSON.stringify(review) === JSON.stringify(expected)) {
        for (const bucket of Object.values(state.subjects || {})) {
          const video = (bucket?.videos || []).find((item) => toPosix(item?.notePath || '') === toPosix(notePath))
          if (video) video.review = review
        }
      } else {
        // 笔记里的复习状态与待处理记录不一致：以笔记为准丢弃 pending，但要留下可追踪的日志。
        logger.log('state.pending.review.mismatch path=' + JSON.stringify(notePath))
      }
      // 笔记已经读到了：要么恢复成功，要么说明当时的写入没发生，pending 都不再需要。
      delete state.pendingReviews[notePath]
      changed = true
    }

    if (changed && !readOnly) {
      if (!save()) {
        logger.log('state.pending.reconcile.save.error')
      } else if (restored) {
        // 恢复出来的笔记要立刻回到索引、手册和概念页，否则这篇会长期缺席。
        try {
          await rebuildKnowledgePages()
        } catch (error) {
          logger.log('state.pending.reconcile.rebuild.error msg=' + (error?.message || error))
        }
      }
    }
  }

  function identifyInput(input) {
    const title = cleanTitle(input?.title || '')
    const url = input?.url || ''
    const declaredSource = ['bilibili', 'douyin', 'youtube'].includes(input?.source) ? input.source : ''
    const source = detectSource({ url, title: input?.title || title }) || declaredSource || (input?.bvid ? 'bilibili' : '')
    const bvid = input?.bvid || (source === 'bilibili' ? extractBvid(url) : null)
    const videoId = input?.videoId || (source === 'douyin' ? extractDouyinId(url) : source === 'youtube' ? extractYoutubeId(url) : '')
    const page = source === 'bilibili' ? Number(input?.page) || extractPage(url) : 1
    const key = seenKey({ bvid, videoId, source, title, page })
    return { title, source, bvid, videoId, page, key }
  }

  async function processTitle(input) {
    const { title: rawTitle, source, bvid: inputBvid, videoId: inputVideoId, page: inputPage, key } = identifyInput(input)
    let activeKey = key
    let displayTitle = ''
    let noteWritten = false
    const warnings = []
    try {
      // 重整理使用本地字幕存档时，不重新抓取平台内容，也不重新转写。
      const refresh = Boolean(input?.refresh)
      const archiveOnly = Boolean(input?.archiveOnly)
      const subjectLocked = Boolean(input?.subjectLocked)
      const prefetchedContent = input?.prefetchedContent && typeof input.prefetchedContent === 'object' ? input.prefetchedContent : null
      if (!source) {
        return { ok: false, code: 'unsupported-source', message: '无法识别视频来源：只支持 B站、抖音精选和 YouTube 视频链接' }
      }
      if (source === 'douyin' && !refresh && !isDouyinJingxuanUrl(input?.url || '')) {
        return { ok: false, code: 'douyin-not-jingxuan', message: '只处理抖音精选视频：请从精选页复制带 modal_id 的链接；普通 /video/ 视频不处理' }
      }
      if (!refresh && !input?.force && isSeen(state, key)) {
        return { ok: true, skipped: true, message: '已处理过该视频，保持静默' }
      }
      if (!refresh && !input?.force && !input?.retryKey && shouldSkipFailure(state, key)) {
        return { ok: true, skipped: true, message: '该视频最近失败次数过多，已冷却；可稍后手动重试' }
      }
      if (!rawTitle && !input?.url && !input?.bvid && !input?.videoId) {
        return { ok: false, message: '缺少视频标题或 URL' }
      }
      emit('detected', { title: rawTitle, url: input?.url || '', bvid: inputBvid || null, videoId: inputVideoId || null, source, force: Boolean(input?.force) })

      let cookieHeader = null
      if (!archiveOnly && source === 'bilibili') {
        try { cookieHeader = await getBilibiliCookieHeader({ config, url: input?.url || '' }) } catch { cookieHeader = null }
        logger.log('bili cookie=' + (cookieHeader ? 'ok' : 'none'))
      }
      let content = prefetchedContent
      if (!archiveOnly && config.fetchContent) {
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

      const noteBvid = content?.bvid || inputBvid || ''
      const noteVideoId = content?.videoId || inputVideoId || ''
      const notePage = content?.page || inputPage || 1
      const noteUrl = content?.url || input?.url || ''
      const identity = videoIdentity({ bvid: noteBvid, videoId: noteVideoId, source, page: notePage, url: noteUrl })
      const historyVideos = Object.entries(state.subjects || {}).flatMap(([subject, entry]) =>
        (Array.isArray(entry?.videos) ? entry.videos : []).filter(Boolean).map(video => ({ ...video, subject })))
      const targetPath = toPosix(input?.previousNotePath || '')
      const byPath = targetPath && historyVideos.find(video => toPosix(video.notePath || '') === targetPath)
      const pathIdentity = videoIdentity(byPath)
      if (targetPath && (!byPath || (pathIdentity && pathIdentity !== identity))) {
        return { ok: false, code: 'note-identity-mismatch', message: '历史笔记的路径或视频编号已变化，请重新打开笔记再试' }
      }
      const matches = identity ? historyVideos.filter(video => videoIdentity(video) === identity) : []
      const matchingPaths = new Set(matches.map(video => toPosix(video.notePath || '')).filter(Boolean))
      if (!byPath && matchingPaths.size > 1) {
        return { ok: false, code: 'duplicate-video', message: '同一视频已有多篇笔记。请在知识库展开「重复笔记」查看，选择一篇用存档字幕重新整理' }
      }
      const previousRecord = byPath || matches.find(video => video.notePath) || matches[0]
      const trustedPreviousNotePath = toPosix(previousRecord?.notePath || '')
      const matchesVideo = (video) => {
        if (!video) return false
        if (trustedPreviousNotePath) return toPosix(video.notePath || '') === trustedPreviousNotePath
        if (identity) return videoIdentity(video) === identity
        return !videoIdentity(video) && video.title === finalTitle
      }

      const fallbackTitle = rawTitle || inputBvid || inputVideoId || '未命名视频'
      const title = (content?.matched && content.title && !/^https?:\/\//i.test(content.title)) ? content.title : (source === 'bilibili' ? cleanBiliTitle(fallbackTitle) : cleanTitle(fallbackTitle))
      displayTitle = title
      const desc = content?.desc || ''
      const tags = content?.tags || []
      const existing = Object.keys(state.subjects)
      const cls = subjectLocked
        ? {
          isCourse: true,
          subject: input?.subject || '未分类',
          title: input?.title || rawTitle,
          keywords: Array.isArray(input?.keywords) ? input.keywords : [],
        }
        : await classify(ctx, config, { title, desc, tags, existingSubjects: existing })
      logger.log('classify title=' + JSON.stringify(title) + ' locked=' + subjectLocked + ' result=' + JSON.stringify(cls))
      if (!cls) {
        throw new Error('视频分类失败（LLM 返回无法解析或调用失败），稍后重试')
      }
      const subject = previousRecord?.subject || (subjectLocked && input?.subject) || resolveSubjectName(cls.subject, existing, { maxSubjects: config.maxSubjects })
      const isCourse = Boolean(previousRecord) || cls.isCourse !== false
      emit('classified', { isCourse, subject, title: cls.title, keywords: cls.keywords || [] })
      if (!isCourse) {
        markSeen(state, activeKey, { at: Date.now(), title, source, bvid: content?.bvid || inputBvid || null, videoId: content?.videoId || inputVideoId || null, page: content?.page || inputPage || 1, cid: content?.cid || null, isCourse: false })
        state.lastTitle = title
        state.stats.skipped += 1
        pruneSeen(state)
        const stateSaved = save()
        if (!stateSaved) warnings.push('状态保存失败：重启后可能重复判断这条视频')
        emit('skipped', { reason: 'non-course', title })
        return { ok: true, skipped: true, stateSaved, warnings, message: '非知识内容，已静默忽略' }
      }

      const keywords = Array.isArray(cls.keywords) ? cls.keywords.map(String).filter(Boolean).slice(0, 10) : []
      // 重整理时优先使用传入的存档字幕。
      let transcript = input?.transcript || content?.transcript || ''
      let timedTranscript = input?.timedTranscript || content?.timedTranscript || ''
      let transcriptSource = input?.transcriptSource || content?.transcriptSource || (transcript ? 'up-subtitle' : '')
      let transcriptDetail = ''
      let transcriptAttempts = []
      if (!archiveOnly && !transcript && config.fetchTranscript && content?.bvid) {
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
            aid: content.aid || null,
            subtitleEntries: content.subtitleEntries || [],
            onProgress: (progress) => emit('progress', { source, ...progress }),
          })
          transcriptDetail = tr?.detail || ''
          transcriptAttempts = Array.isArray(tr?.attempts) ? tr.attempts : []
          if (tr?.text) {
            transcript = tr.text
            timedTranscript = tr.timed || ''
            transcriptSource = tr.source || 'ai-subtitle'
          }
          logger.log('transcript source=' + (transcriptSource || 'none') + ' detail=' + transcriptDetail + ' length=' + transcript.length + (transcriptAttempts.length ? ' attempts=' + transcriptAttempts.join(' | ') : ''))
        } catch (error) {
          transcriptDetail = '调用异常：' + (error?.message || error)
          logger.log('transcript.error msg=' + (error?.message || error))
        }
      }
      // 重整理时内容来源标为 archive，但评分与来源说明仍使用原始字幕来源。
      const noteTranscriptOrigin = String(input?.transcriptOrigin || transcriptSource || '').trim()
      if (content) {
        content.transcript = transcript
        content.transcriptSource = transcriptSource
        content.timedTranscript = timedTranscript
        if (content.fetchStats) content.fetchStats.transcript = transcript.length
      }
      emit('transcript', { source: transcriptSource || 'none', length: transcript.length, detail: transcriptDetail })
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
        transcriptSource: noteTranscriptOrigin,
        transcriptLength: transcript.length,
        keyPointCount: summary.keyPoints.length,
        conceptCount: noteConcepts.length,
      })
      emit('summarized', { title: finalTitle, subject, source, summary: summary.summary, keyPoints: summary.keyPoints, discussion: summary.discussion, contentQuality })
      const processedAt = Date.now()
      let noteChapters = Array.isArray(content?.chapters) ? content.chapters : []
      if (noteChapters.length === 0 && content?.timedTranscript) {
        const segments = await segmentTranscript(ctx, config, {
          title: finalTitle,
          timedTranscript: content.timedTranscript,
          duration: Number(content?.duration) || 0,
        })
        if (segments.length > 0) noteChapters = segments
      }
      const relatedNotes = findRelatedVideos(
        { title: finalTitle, source, bvid: noteBvid, page: notePage, videoId: noteVideoId, url: noteUrl, concepts: noteConcepts, keywords },
        historyVideos.filter(video => !matchesVideo(video)),
        { limit: 5 },
      )
      // 重刷时保留原有复习进度，新笔记从今天开始排期。
      const previousCreatedAt = Number(previousRecord?.createdAt)
      const createdAt = Number.isFinite(previousCreatedAt) && previousCreatedAt > 0 ? previousCreatedAt : processedAt
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
        transcriptOrigin: noteTranscriptOrigin,
        contentSource: transcriptSource || 'metadata',
        contentQuality,
        noteRoot: config.noteRoot,
        layout: config.noteLayout,
      })

      // 写笔记前先把恢复意图落盘：崩溃后启动时可凭 bvid/videoId 身份找回这篇笔记，避免重复生成。
      const pendingKey = activeKey || key
      const pendingSnapshot = {
        key,
        activeKey,
        title: finalTitle,
        subject,
        source,
        bvid: noteBvid,
        videoId: noteVideoId,
        page: notePage,
        url: content?.url || input?.url || '',
        author: content?.owner || content?.author || '',
        notePath: trustedPreviousNotePath,
        transcriptPath: previousRecord?.transcriptPath || '',
        createdAt,
        at: Date.now(),
      }
      state.pendingVideos[pendingKey] = pendingSnapshot
      if (!save({ checkpoint: false })) {
        delete state.pendingVideos[pendingKey]
        return { ok: false, stateSaved: false, warnings: ['状态保存失败：未写入笔记，避免重启后出现无记录的孤儿笔记'], message: '状态保存失败，已停止写入这篇笔记' }
      }

      const writeResult = await writeVideoNote({
        vaultPath,
        noteRoot: config.noteRoot,
        layout: config.noteLayout,
        subject,
        title: finalTitle,
        bvid: noteBvid,
        page: notePage,
        videoId: noteVideoId,
        source,
        previousNotePath: trustedPreviousNotePath,
        preservePreviousPath: Boolean(trustedPreviousNotePath),
        content: note,
        force: refresh || Boolean(input?.force),
        backupDir: config.stateDir ? join(config.stateDir, '..', 'backups') : '',
      })
      noteWritten = true

      // 字幕原文单独存档，记录实际路径以区分不同学科的同名笔记。
      let transcriptPath = previousRecord?.transcriptPath || ''
      if (transcript) {
        try {
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
        } catch (error) {
          const msg = '字幕存档失败：' + String(error?.message || error)
          warnings.push(msg)
          logger.log('transcript.archive.error msg=' + msg)
        }
      }

      if (state.pendingVideos[pendingKey]) {
        state.pendingVideos[pendingKey].notePath = writeResult.relPath
        state.pendingVideos[pendingKey].transcriptPath = transcriptPath
        if (!save({ checkpoint: false })) warnings.push('状态保存失败：重启后可能重复处理这条视频')
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
      const existed = videos.findIndex(matchesVideo)
      if (existed >= 0) videos[existed] = { ...videos[existed], ...videoRecord }
      else videos.push(videoRecord)
      state.subjects[subject].updatedAt = processedAt

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
      delete state.pendingVideos[pendingKey]
      const stateSaved = save()
      if (!stateSaved) warnings.push('状态保存失败：重启后可能重复处理这条视频')
      changedSubjects.add(subject)

      logger.log('note.saved subject=' + JSON.stringify(subject) + ' title=' + JSON.stringify(finalTitle) + ' path=' + writeResult.relPath + ' skipped=' + writeResult.skipped)
      emit('saved', {
        title: finalTitle,
        subject,
        source,
        platform: source,
        notePath: writeResult.relPath,
        transcriptPath,
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
        chapters: noteChapters,
        warnings: warnings.slice(),
        stateSaved,
      })
      console.log('[seen-core] ' + (isNewSubject ? '新学科' : '更新学科') + '「' + subject + '」 ← ' + finalTitle)
      return {
        ok: true,
        message: '已生成「' + subject + '」笔记：' + writeResult.relPath + (warnings.length ? '（' + warnings.length + ' 项警告）' : ''),
        subject,
        notePath: writeResult.relPath,
        warnings: warnings.slice(),
        stateSaved,
      }
    } catch (error) {
      const msg = String(error?.message || error)
      if (error && error.vaultBlocked) {
        logger.log('vault.blocked code=' + (error.code || '') + ' msg=' + msg)
        emit('vault-blocked', { code: error.code || 'timeout', detail: error.detail || msg, hint: VAULT_HINT, title: displayTitle || rawTitle, source })
        return { ok: false, message: '笔记没有写入：' + VAULT_HINT }
      }
      let errorStateSaved = true
      if (activeKey || key) {
        if (!noteWritten && state.pendingVideos[activeKey || key]) delete state.pendingVideos[activeKey || key]
        recordFailure(state, activeKey || key, msg, {
          title: rawTitle,
          url: input?.url || '',
          source,
          bvid: inputBvid || null,
          videoId: inputVideoId || null,
        })
        state.stats.failed += 1
        if (!save()) {
          errorStateSaved = false
          warnings.push('状态保存失败：重启后失败记录可能丢失，也可能重复处理这条视频')
        }
      }
      logger.log('process.error key=' + JSON.stringify(key) + ' msg=' + msg)
      emit('error', { message: msg, title: displayTitle || rawTitle, source })
      console.error('[seen-core] 处理失败（不影响后续轮询）：', error)
      return { ok: false, code: error?.code === 'note-identity-mismatch' ? error.code : undefined, message: '处理失败：' + msg, stateSaved: errorStateSaved, warnings }
    }
  }

  // 轮询候选与显式操作按提交顺序共享处理器。
  const processQueue = createProcessQueue({
    run: async item => {
      const result = await processTitle(item)
      if (openBatches === 0 && processQueue.size() === 1) {
        const warning = await updateChangedPages()
        if (warning) result.warnings = [...(result.warnings || []), warning]
      }
      return result
    },
    keyOf: item => item?.key || identifyInput(item).key,
    maxPending: 8,
    onError: (error, item) => {
      logger.log('process.queue.error key=' + JSON.stringify(item?.key || '') + ' msg=' + (error?.message || error))
    },
  })

  async function observeOnce(generation) {
    if (!config.enabled || !started) return
    let fg
    try {
      fg = await observeForeground(config)
    } catch (error) {
      if (generation !== pollGeneration) return
      pending = null
      logger.log('foreground.error msg=' + (error?.message || error))
      return
    }
    if (generation !== pollGeneration) return
    const previous = pending
    pending = null
    state.lastForeground = { at: Date.now(), app: fg?.app || '', title: fg?.title || '', url: fg?.url || '', source: fg?.source || 'none', error: fg?.error || '' }
    if (fg?.error) logger.logOnce('fg|' + fg.source + '|' + fg.error, 'foreground.degraded app=' + JSON.stringify(fg.app || '') + ' source=' + fg.source + ' msg=' + fg.error)
    emit('foreground', { app: fg?.app || '', title: fg?.title || '', url: fg?.url || '', source: fg?.source || 'none', permission: fg?.permission || 'unknown', error: fg?.error || '', isBrowser: isBrowserName(fg?.app, config), at: Date.now() })
    if (generation !== pollGeneration || !isBrowserName(fg?.app, config)) return

    const rawTitle = fg?.title || ''
    const rawUrl = fg?.url || ''
    const title = cleanTitle(rawTitle)
    if (!title || title.length < config.titleMinLen) return
    const source = detectSource({ url: rawUrl, title: rawTitle })
    if (!source) return
    if (source === 'douyin' && !isDouyinJingxuanUrl(rawUrl)) {
      logger.logOnce('douyin-skip|' + rawUrl, 'foreground.skip source=douyin reason=not-jingxuan app=' + JSON.stringify(fg.app) + ' url=' + JSON.stringify(rawUrl))
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
    if (isSeen(state, key)) return
    logger.logOnce('obs|' + key, 'foreground.browser app=' + JSON.stringify(fg.app) + ' title=' + JSON.stringify(title) + ' source=' + source + ' id=' + (bvid || videoId || 'none'))
    const count = previous?.key === key ? previous.count + 1 : 1
    pending = { key, title, url: rawUrl, bvid, videoId, source, page, count }
    if (pending.count >= config.stablePolls) {
      const p = pending
      pending = null
      const queued = processQueue.push(p)
      if (queued.ok) {
        emit('stable', { title: p.title, url: p.url, bvid: p.bvid, videoId: p.videoId, source: p.source })
      } else if (queued.full) {
        logger.log('process.queue.full key=' + JSON.stringify(p.key) + ' size=' + queued.size)
      }
    }
  }

  async function buildStatus({ compact = false } = {}) {
    const subjects = Object.entries(state.subjects).map(([subject, data]) => ({ subject, videos: data?.videos?.length ?? 0 }))
    const status = {
      ok: true,
      enabled: config.enabled,
      polling: started,
      pollIntervalMs: config.pollIntervalMs,
      readOnly,
      readOnlyReason,
      outputDir,
      vaultPath,
      vault: vaultGuard.status(),
      noteRoot: config.noteRoot,
      lastTitle: state.lastTitle,
      lastRunAt: state.lastRunAt,
      subjects,
    }
    if (compact) return status
    let mnemonReady = false
    try { mnemonReady = Boolean(await findMnemon(config)) } catch { mnemonReady = false }
    const lastError = state.lastForeground?.error || ''
    const message = [
      '拾影 状态：',
      '- 轮询：' + (readOnly ? '只读（' + readOnlyLabel + '）' : started ? '运行中' : '已停止'),
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
      ...status,
      lastError,
      mnemonReady,
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
      readOnlyReason,
      readOnlyMessage,
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
    return buildHistoryFromState(state)
  }

  function clearPollTimer() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  }

  function schedulePoll() {
    if (!started || readOnly || !config.enabled) return
    clearPollTimer()
    const generation = ++pollGeneration
    pollTimer = setTimeout(async () => {
      pollTimer = null
      try {
        await observeOnce(generation)
      } catch (error) {
        logger.log('observe.error msg=' + (error?.message || error))
        emit('error', { message: String(error?.message || error) })
      }
      if (started && generation === pollGeneration) schedulePoll()
    }, Math.max(1000, Number(config.pollIntervalMs) || 15000))
  }

  function start() {
    if (readOnly) return { ok: false, message: readOnlyMessage }
    if (!config.enabled) return { ok: false, message: 'Agent 未启用（config.enabled=false）' }
    if (started) return { ok: true, message: '轮询已在运行' }
    started = true
    logger.log('polling.started interval=' + config.pollIntervalMs)
    emit('status', { polling: true, pollIntervalMs: config.pollIntervalMs, readOnly })
    schedulePoll()
    return { ok: true, message: '轮询已启动' }
  }

  function stop() {
    const cleared = processQueue.clear({ automaticOnly: true })
    if (cleared > 0) logger.log('process.queue.cleared count=' + cleared)
    if (!started) return { ok: true, message: '轮询已停止' }
    started = false
    pollGeneration++
    clearPollTimer()
    pending = null
    logger.log('polling.stopped')
    emit('status', { polling: false, pollIntervalMs: config.pollIntervalMs, readOnly })
    return { ok: true, message: '轮询已停止' }
  }

  function setPollInterval(ms) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
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
    if (readOnly) return { ok: false, message: readOnlyMessage }
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
    if (readOnly) return { ok: false, message: readOnlyMessage }
    const next = Boolean(value)
    if (next === Boolean(config.editorPass)) {
      return { ok: true, message: '润色没有变化', editorPass: next }
    }
    config.editorPass = next
    logger.log('editor.pass=' + next)
    return { ok: true, message: next ? '已开启发布前润色' : '已关闭发布前润色', editorPass: next }
  }

  async function scan(input) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
    return processQueue.submit(input)
  }

  async function batchPageUpdates(task) {
    openBatches++
    let result
    try {
      result = await task()
      return result
    } finally {
      openBatches--
      if (openBatches === 0) {
        const warning = await updateChangedPages()
        if (warning && result) result.warnings = [...(result.warnings || []), warning]
      }
    }
  }

  async function scanBatch(inputs) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
    return batchPageUpdates(async () => {
      const results = []
      for (const input of inputs) {
        const result = await scan(input)
        results.push({ ...result, url: input.url })
        emit('scan-batch-progress', { done: results.length, total: inputs.length })
      }
      const failed = results.filter(item => !item.ok)
      return {
        ok: true,
        total: inputs.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        failures: failed,
        warnings: results.flatMap(result => result.warnings || []),
      }
    })
  }

  /** 重试一条失败记录：用保存的链接重新处理，成功后清理失败记录。 */
  async function retryFailure(key) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
    const failures = state.failures && typeof state.failures === 'object' ? state.failures : {}
    const record = failures[key]
    if (!record || typeof record !== 'object') return { ok: false, message: '这条失败记录已经不存在了' }
    const meta = record.meta && typeof record.meta === 'object' ? record.meta : {}
    const input = {}
    if (meta.url) input.url = meta.url
    if (meta.title) input.title = meta.title
    if (meta.source) input.source = meta.source
    if (meta.bvid) input.bvid = meta.bvid
    if (meta.videoId) input.videoId = meta.videoId
    if (meta.page) input.page = meta.page
    if (!input.url && !input.title) {
      return { ok: false, message: '这条记录是旧版本产生的，没有保存视频链接，请手动粘贴链接重试' }
    }
    const result = await processQueue.submit({ ...input, retryKey: key })
    if (!result.ok || result.stateSaved === false || !state.failures[key]) return result
    // 已处理过、非知识视频或识别到了更准确的 ID 时，也要结清原失败记录。
    clearFailure(state, key)
    if (!save()) {
      const warnings = Array.isArray(result.warnings) ? result.warnings.slice() : []
      warnings.push('状态保存失败：重启后可能重复处理这条视频')
      return { ...result, stateSaved: false, warnings }
    }
    return result
  }

  /** 重刷历史笔记，内容缓存失效时可能重新抓取或转写。 */
  async function refreshHistory({ limit = 0, onProgress = null } = {}) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
    return batchPageUpdates(async () => {
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
      const warnings = []
      let allStateSaved = true
      for (const { video } of targets) {
        const input = { title: video.title || '', url: video.url || '', source: video.source || '', bvid: video.bvid || '', videoId: video.videoId || '', page: video.page, refresh: true, previousNotePath: video.notePath || '' }
        let result = null
        try {
          result = await processQueue.submit(input)
        } catch (error) {
          result = { ok: false, message: error?.message || String(error) }
        }
        if (result?.code === 'queue-full') {
          return { ...result, total: targets.length, done, failed, remaining: targets.length - done, stateSaved: allStateSaved, warnings }
        }
        done += 1
        if (!result?.ok) failed += 1
        if (result?.stateSaved === false) {
          allStateSaved = false
          for (const warning of result.warnings || ['状态保存失败：重启后可能重复处理视频']) {
            warnings.push((video.title || '未命名视频') + '：' + warning)
          }
        }
        if (!result?.ok && result?.message) warnings.push((video.title || '未命名视频') + '：' + result.message)
        const progress = { done, total: targets.length, title: video.title || '', ok: Boolean(result?.ok), warnings: result?.warnings || [] }
        emit('refresh', progress)
        if (typeof onProgress === 'function') onProgress(progress)
        logger.log('refresh.note=' + done + '/' + targets.length + ' ok=' + Boolean(result?.ok) + ' title=' + JSON.stringify(video.title || ''))
      }
      return { ok: true, total: targets.length, done, failed, stateSaved: allStateSaved, warnings }
    })
  }

  /** 用字幕存档重新整理一篇历史笔记；只读存档，不重新抓取或转写。 */
  async function resummarizeNote({ notePath } = {}) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
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
    let archiveOwner = ''
    try {
      if (found.video.transcriptPath) {
        const archived = await readVaultText({ vaultPath, relPath: found.video.transcriptPath })
        if (archived.ok) {
          markdown = archived.text
          archiveOwner = toPosix(transcriptNoteOwner(markdown))
          if (archiveOwner && archiveOwner !== targetPath) markdown = null
        }
      }
      if (!markdown) {
        markdown = await readTranscriptNote({ vaultPath, noteRoot: config.noteRoot, noteName, owner: targetPath, allowUnowned: true })
        if (markdown) archiveOwner = toPosix(transcriptNoteOwner(markdown))
      }
    } catch (error) {
      return { ok: false, message: '读取字幕存档失败：' + String(error?.message || error) }
    }
    if (!markdown) {
      const legacy = await readVaultText({ vaultPath, relPath: transcriptNoteRelPath({ noteRoot: config.noteRoot, noteName }) })
      if (legacy.ok) {
        const legacyOwner = toPosix(transcriptNoteOwner(legacy.text))
        if (legacyOwner && legacyOwner !== targetPath) {
          return { ok: false, message: '字幕存档属于另一篇笔记，已停止重整理，请先检查同名字幕存档' }
        }
      }
      return { ok: false, message: '这篇笔记还没有字幕存档，先重刷一次生成存档后再试' }
    }
    if (archiveOwner && archiveOwner !== targetPath) {
      return { ok: false, message: '字幕存档属于另一篇笔记，已停止重整理，请先检查同名字幕存档' }
    }
    if (!archiveOwner) {
      const sameName = getHistory().filter((video) => basename(video.notePath || video.title || '', '.md') === noteName)
      if (sameName.length > 1) return { ok: false, message: '同名字幕存档没有所属笔记信息，已停止重整理，请先检查存档' }
    }
    const parsed = parseTranscriptNote(markdown)
    if (!parsed.text && !parsed.timed) return { ok: false, message: '字幕存档是空的' }
    let noteMeta = null
    try {
      const noteText = await readVaultText({ vaultPath, relPath: targetPath })
      if (noteText.ok) noteMeta = parseNoteMarkdown(noteText.text)
    } catch { /* 缺元数据时退回 state 记录 */ }
    const archiveTitle = noteMeta?.title || found.video.title || ''
    const archiveUrl = found.video.url || noteMeta?.url || ''
    const archiveSource = found.video.source || noteMeta?.source || ''
    const archiveBvid = found.video.bvid || noteMeta?.meta?.bvid || ''
    const archiveVideoId = found.video.videoId || noteMeta?.meta?.videoId || ''
    const archivePage = Number(found.video.page) || Number(noteMeta?.meta?.page) || (archiveSource === 'bilibili' ? extractPage(noteMeta?.url || '') : 1)
    const archiveTranscript = parsed.text || parsed.timed
    const archiveOrigin = String(noteMeta?.meta?.transcriptOrigin || noteMeta?.meta?.contentSource || '').trim()
    const prefetchedContent = {
      title: archiveTitle,
      url: archiveUrl,
      source: archiveSource,
      bvid: archiveBvid,
      videoId: archiveVideoId,
      page: archivePage,
      owner: noteMeta?.meta?.author || found.video.author || '',
      duration: Number(noteMeta?.duration) || 0,
      chapters: [],
      // 存档里已经有字幕正文，来源统计不应再显示 0 字。
      fetchStats: { transcript: archiveTranscript.length },
    }
    logger.log('resummarize.note=' + JSON.stringify(archiveTitle) + ' chars=' + archiveTranscript.length + ' origin=' + (archiveOrigin || 'unknown') + ' archiveOnly=true')
    return processQueue.submit({
      title: archiveTitle,
      url: archiveUrl,
      source: archiveSource,
      bvid: archiveBvid,
      videoId: archiveVideoId,
      page: archivePage,
      subject: found.subject,
      subjectLocked: true,
      transcript: archiveTranscript,
      timedTranscript: parsed.timed,
      transcriptSource: 'archive',
      transcriptOrigin: archiveOrigin,
      refresh: true,
      archiveOnly: true,
      previousNotePath: targetPath,
      prefetchedContent,
    })
  }

  /** 今日复习队列与学习统计（只读）。 */
  function getReviews(history = getHistory()) {
    return collectReviews(history, { limit: 20 })
  }

  /** 记录一次复习反馈：更新 state、frontmatter，并按 SM-2 排下一次。 */
  async function recordReview({ notePath, rating } = {}) {
    if (readOnly) return { ok: false, message: readOnlyMessage }
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
    const previousReview = found.review
    const current = found.review && found.review.due ? found.review : initialReview(now)
    const review = nextReview(current, normalized, now)
    // 先落盘复习意图：笔记已改、状态未落之间崩溃时，启动恢复可据此补回 state。
    state.pendingReviews[relPath] = { review, at: now }
    if (!save({ checkpoint: false })) {
      delete state.pendingReviews[relPath]
      return { ok: false, stateSaved: false, retryable: true, message: '状态保存失败，未修改笔记；请稍后重试', review }
    }
    let noteResult
    let noteError = null
    try {
      noteResult = await updateNoteReview({ vaultPath, notePath: relPath, review })
    } catch (error) {
      // 超时/权限失败时底层写入可能已经发生，不能删 pending，留给启动对账或用户重试。
      noteError = error
      noteResult = { ok: false, error: error?.message || '更新笔记里的复习状态失败' }
    }
    if (!noteResult.ok) {
      if (noteError) {
        return {
          ok: false,
          retryable: true,
          pendingSaved: true,
          message: (noteResult.error || '更新笔记里的复习状态失败') + '；已保留恢复记录，稍后可重试',
          review,
        }
      }
      delete state.pendingReviews[relPath]
      save()
      return { ok: false, message: noteResult.error || '更新笔记里的复习状态失败', review }
    }
    found.review = review
    const warnings = []
    let stateSaved = true
    delete state.pendingReviews[relPath]
    try {
      persistState()
    } catch (error) {
      stateSaved = false
      // 内存里的进度也要回滚：否则同进程重试会在未落盘的进度上再前进一档。
      found.review = previousReview
      // 保存失败时把待处理记录放回内存，磁盘上的旧 pending 仍可用于重启恢复。
      state.pendingReviews[relPath] = { review, at: now }
      warnings.push('状态保存失败：重启后可能丢失这次复习进度')
      logger.log('state.save.error msg=' + (error?.message || error))
    }
    logger.log('review.record title=' + JSON.stringify(found.title) + ' rating=' + normalized + ' due=' + review.due)
    emit('review', { title: found.title, rating: normalized, review })
    const message = stateSaved
      ? (normalized === 'easy' ? '记住了，下次 ' + review.due + ' 再见' : normalized === 'hard' ? '有点模糊，' + review.due + ' 再复习一次' : '没关系，明天再来')
      : '复习进度已写入笔记，但状态保存失败：重启后可能丢失这次复习进度'
    return stateSaved
      ? { ok: true, stateSaved, warnings, message, review }
      : { ok: false, partial: true, stateSaved: false, retryable: true, warnings, message, review }
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
    if (readOnly) return { ok: false, message: readOnlyMessage }
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
    // 没有 notePath 的旧记录无法写回笔记，跳过而不是让它永远卡在 partial。
    const targets = result.changedVideos.filter((item) => String(item.notePath || '').trim())
    const skipped = result.changedVideos.length - targets.length
    for (const item of targets) {
      let noteResult
      try {
        noteResult = await updateNoteTags({ vaultPath, notePath: item.notePath, tags: item.tags })
      } catch (error) {
        noteResult = { ok: false, error: String(error?.message || error) }
      }
      if (!noteResult.ok) {
        if (changed > 0) {
          try { await rebuildKnowledgePages() } catch (error) { logger.log('tags.merge.rebuild.error msg=' + (error?.message || error)) }
        }
        return { ok: false, partial: changed > 0, changed, remaining: targets.length - changed, retryable: true, message: noteResult.error || '更新笔记标签失败', warnings: changed > 0 ? ['部分笔记已更新，剩余笔记未处理，可稍后重试'] : [] }
      }
      let previousTags = []
      for (const data of Object.values(state.subjects || {})) {
        const video = (Array.isArray(data?.videos) ? data.videos : []).find((entry) => entry.notePath === item.notePath)
        if (video) {
          previousTags = Array.isArray(video.tags) ? video.tags.slice() : []
          video.tags = item.tags
          break
        }
      }
      changed += 1
      try {
        persistState()
      } catch (error) {
        logger.log('state.save.error msg=' + (error?.message || error))
        // 回滚当前这篇的内存标签，保证同进程重试时还能再次改这篇笔记。
        for (const data of Object.values(state.subjects || {})) {
          const video = (Array.isArray(data?.videos) ? data.videos : []).find((entry) => entry.notePath === item.notePath)
          if (video) { video.tags = previousTags; break }
        }
        return { ok: false, partial: true, stateSaved: false, retryable: true, changed, remaining: targets.length - changed, message: '笔记已更新，但保存状态失败：' + (error?.message || error), warnings: ['状态保存失败：请稍后重试，部分笔记可能已更新'] }
      }
    }
    if (state.tagVocabulary && typeof state.tagVocabulary === 'object') {
      const count = Number(state.tagVocabulary[source] || 0)
      if (count > 0) state.tagVocabulary[target] = (Number(state.tagVocabulary[target]) || 0) + count
      delete state.tagVocabulary[source]
    }
    try {
      persistState()
    } catch (error) {
      logger.log('state.save.error msg=' + (error?.message || error))
      return { ok: false, partial: true, stateSaved: false, retryable: true, changed, remaining: 0, message: '标签已合并到笔记，但保存状态失败：' + (error?.message || error), warnings: ['状态保存失败：重启后标签索引可能不一致'] }
    }
    logger.log('tags.merge from=' + JSON.stringify(source) + ' to=' + JSON.stringify(target) + ' changed=' + changed)
    const warnings = []
    if (skipped > 0) warnings.push('有 ' + skipped + ' 条旧记录没有笔记路径，已跳过')
    try { await rebuildKnowledgePages() } catch (error) {
      logger.log('tags.merge.rebuild.error msg=' + (error?.message || error))
      warnings.push('知识库页面重建失败：' + (error?.message || error))
    }
    return { ok: true, changed, warnings, message: '已把「' + source + '」合并到「' + target + '」，更新 ' + changed + ' 篇笔记' + (warnings.length ? '（有警告）' : '') }
  }

  /** 串行写知识库页面，快照在轮到本次写入时生成。 */
  function rebuildKnowledgePages({ manualSubjects } = {}) {
    const next = pageUpdates.then(async () => {
      if (readOnly) return { ok: false, message: readOnlyMessage }
      if (vaultGuard.isBlocked()) return { ok: false, message: VAULT_HINT }
      await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
      const result = await rebuildPages({
        vaultPath, noteRoot: config.noteRoot, state, layout: config.noteLayout, manualSubjects,
        log: line => logger.log(line),
      })
      return { ok: true, ...result }
    })
    pageUpdates = next.catch(() => {})
    return next
  }

  async function updateChangedPages() {
    if (!changedSubjects.size) return ''
    const manualSubjects = [...changedSubjects]
    changedSubjects.clear()
    try {
      const result = await rebuildKnowledgePages({ manualSubjects })
      if (result.ok) return ''
      throw new Error(result.message)
    } catch (error) {
      for (const subject of manualSubjects) changedSubjects.add(subject)
      const warning = '笔记已保存，知识库页面更新失败：' + (error?.message || error)
      logger.log('rebuild.pages.error ' + warning)
      emit('pages-warning', { message: warning })
      return warning
    }
  }

  /** 最近的失败记录（面板展示用） */
  function getFailures(limit = 20) {
    return listFailures(state, limit)
  }

  async function getSnapshot() {
    const status = await buildStatus()
    const history = getHistory()
    return {
      status,
      config: getSafeConfig(),
      history,
      duplicateVideos: findDuplicateVideos(history),
      reviews: getReviews(history),
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
      if (readOnly) return { ok: false, message: readOnlyMessage }
      let title = typeof args?.title === 'string' ? args.title.trim() : ''
      let url = typeof args?.url === 'string' ? args.url.trim() : ''
      if (!title && !url) {
        const fg = await observeForeground(config)
        if (!fg || !isBrowserName(fg.app, config)) return { ok: false, message: '前台不是浏览器/视频客户端（' + (fg?.app || '未知') + '）：' + (fg?.title || '') }
        title = cleanTitle(fg.title)
        url = fg.url || ''
      }
      return scan({ title, url, force: Boolean(args?.force) })
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
      logger.log('readonly reason=' + readOnlyReason)
      emit('status', { polling: false, pollIntervalMs: config.pollIntervalMs, readOnly: true, readOnlyReason })
    } else if (config.autoStart) {
      start()
    }
    return () => {
      stop()
      if (lock.ok) releaseInstanceLock(lockPath)
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
    const drained = await drainVaultQueue({ timeoutMs: 2000 })
    if (!drained.ok) {
      const status = vaultGuard.status()
      return {
        ...status,
        ok: false,
        blocked: true,
        code: 'vault-queue-stuck',
        detail: '上一次 vault 操作仍未结束，已保持只读；请重启应用后再试',
        hint: VAULT_HINT,
      }
    }
    const result = await probeVaultAccess(vaultPath)
    vaultGuard.apply(result)
    if (result.ok && !readOnly) {
      try {
        await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
        await schedulePendingRecovery({ ensureDirs: false })
        await updateChangedPages()
      } catch (error) {
        if (!(error && error.vaultBlocked)) console.error('[seen-core] 重试准备笔记目录失败：', error)
      }
    }
    return vaultGuard.status()
  }

  const controller = {
    ready,
    start,
    stop,
    setPollInterval,
    setNoteLayout,
    setEditorPass,
    setMnemonEnabled(value) {
      config.enableMnemon = Boolean(value)
    },
    setModel({ provider, model }) {
      config.provider = provider
      config.model = model
    },
    getVaultStatus,
    setVaultAccess,
    reprobeVault,
    scan,
    scanBatch,
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
