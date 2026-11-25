/**
 * seen-core · 知识库页面重建
 *
 * 把 state 里的历史记录重新渲染成索引、概念页、主题综述、学科手册与总览。
 * 服务、引擎与 scripts/maintain-vault.mjs 共用这一份实现。
 */

import {
  updateOverview,
  markInactiveKnowledgePages,
  updateSubjectManual,
  writeConceptIndexNote,
  writeConceptPage,
  writeIndexNote,
  writeTagIndexNote,
  writeTopicPage,
} from './obsidian.js'
import { buildConceptIndexMarkdown, buildIndexMarkdown, buildTagIndexMarkdown } from './index-note.js'
import { buildConceptIndex } from './concept.js'
import { buildTagIndex } from './tags.js'
import { detectSource, videoIdentity } from './source.js'
import { buildConceptPageMarkdown, buildTopicPageMarkdown, collectConceptPages, collectTopicPages } from './topic-pages.js'

/** 把 state.subjects 摊平成 history 行；字段与 engine.getHistory() 保持一致。 */
export function buildHistoryFromState(state) {
  const rows = []
  for (const [subject, data] of Object.entries(state?.subjects || {})) {
    if (!Array.isArray(data?.videos)) continue
    for (const video of data.videos) {
      if (!video || typeof video !== 'object') continue
      rows.push({
        subject,
        title: video.title,
        source: video.source || detectSource({ url: video.url }) || (video.bvid ? 'bilibili' : ''),
        page: Number(video.page) || undefined,
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

/** 历史重复项仅列出同一平台身份下的不同文件。 */
export function findDuplicateVideos(history) {
  const groups = new Map()
  for (const row of history) {
    const identity = videoIdentity(row)
    const notePath = String(row.notePath || '').trim().replaceAll('\\', '/').replace(/^\.\//, '')
    if (!identity || !notePath) continue
    if (!groups.has(identity)) groups.set(identity, new Map())
    groups.get(identity).set(notePath, { subject: row.subject, title: row.title, notePath })
  }
  return [...groups].filter(([, notes]) => notes.size > 1)
    .map(([identity, notes]) => ({ identity, notes: [...notes.values()] }))
}

/** 学科手册需要的精简字段。 */
export function videosForManual(state, subject) {
  const videos = state?.subjects?.[subject]?.videos
  if (!Array.isArray(videos)) return []
  return videos.filter(video => video && typeof video === 'object').map((video) => ({
    title: video.title,
    bvid: video.bvid || '',
    notePath: video.notePath,
    summary: video.summary || '',
    concepts: Array.isArray(video.concepts) ? video.concepts : [],
    terms: Array.isArray(video.terms) ? video.terms : [],
    template: video.template && typeof video.template === 'object' ? video.template : {},
    question: video.question || '',
    answer: video.answer || '',
    createdAt: video.createdAt || Date.now(),
  }))
}

/** 按同一份历史快照写入三份索引，供全量重建与重打标签共用。 */
export async function writeKnowledgeIndexes({ vaultPath, noteRoot, history }) {
  await writeIndexNote({ vaultPath, noteRoot, markdown: buildIndexMarkdown(history, { noteRoot }) })
  await writeConceptIndexNote({ vaultPath, noteRoot, markdown: buildConceptIndexMarkdown(buildConceptIndex(history), { noteRoot }) })
  await writeTagIndexNote({ vaultPath, noteRoot, markdown: buildTagIndexMarkdown(buildTagIndex(history), { noteRoot }) })
}

/**
 * 重建全部知识库页面。
 * @returns {Promise<{videos:number, concepts:number, topics:number, subjects:number}>}
 */
export async function rebuildKnowledgePages({ vaultPath, noteRoot, state, layout, manualSubjects, log = () => {} } = {}) {
  const history = buildHistoryFromState(state)
  const subjects = Object.keys(state?.subjects || {})
  const selected = manualSubjects && new Set(manualSubjects)
  const manuals = subjects.filter(subject => !selected || selected.has(subject))
    .map(subject => ({ subject, videos: videosForManual(state, subject) }))
  const conceptPages = collectConceptPages(history)
  const topicPages = collectTopicPages(history)
  await writeKnowledgeIndexes({ vaultPath, noteRoot, history })
  for (const page of conceptPages) {
    await writeConceptPage({ vaultPath, noteRoot, name: page.name, markdown: buildConceptPageMarkdown({ ...page, noteRoot }) })
  }
  const conceptPageNames = new Set(conceptPages.map((page) => page.name))
  for (const page of topicPages) {
    // 只链接真实存在的概念页，避免主题页里出现断链
    const concepts = page.concepts.filter((item) => conceptPageNames.has(item.name))
    await writeTopicPage({ vaultPath, noteRoot, name: page.name, markdown: buildTopicPageMarkdown({ ...page, concepts, noteRoot }) })
  }
  await markInactiveKnowledgePages({ vaultPath, noteRoot, concepts: conceptPages, topics: topicPages })
  for (const { subject, videos } of manuals) {
    await updateSubjectManual({ vaultPath, noteRoot, subject, videos, layout })
  }
  await updateOverview({ vaultPath, noteRoot, subjects, videos: history, layout })
  log('rebuild.pages videos=' + history.length + ' concepts=' + conceptPages.length + ' topics=' + topicPages.length + ' manuals=' + manuals.length)
  return { videos: history.length, concepts: conceptPages.length, topics: topicPages.length, subjects: subjects.length }
}
