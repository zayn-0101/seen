/**
 * seen-core · 笔记目录结构
 *
 * 根目录（noteRoot）默认「视频笔记」，两种布局：
 *  - structured（默认）：<noteRoot>/笔记/<学科>/<标题>.md；
 *    手册、概念、主题、字幕、回顾统一放在 <noteRoot>/资料/ 下
 *  - flat：<noteRoot>/<学科>/<标题>.md，学科学习手册与视频笔记同目录
 *
 * 只做相对路径拼接，不访问文件系统；文件名清洗仍由 obsidian.js 负责。
 */

export const VIDEO_DIR = '笔记'
export const AUX_DIR = '资料'
export const MANUAL_DIR = '手册'
export const REVIEW_DIR = '回顾'
export const TRANSCRIPT_DIR = '字幕'
export const CONCEPT_DIR = '概念'
export const TOPIC_DIR = '主题'
export const BACKUP_DIR = '_备份'
export const MANUAL_SUFFIX = ' 学习手册'

export function normalizeNoteLayout(value) {
  return String(value ?? '').trim().toLowerCase() === 'flat' ? 'flat' : 'structured'
}

function cleanRoot(noteRoot) {
  const root = String(noteRoot ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
  return root || '视频笔记'
}

function cleanSegment(value, fallback) {
  const text = String(value ?? '').replace(/\//g, '-').trim()
  return text || fallback
}

/** 辅助资料目录：<noteRoot>/资料/<子目录>。 */
export function auxRelPath({ noteRoot, parts = [] } = {}) {
  const root = cleanRoot(noteRoot)
  return [root, AUX_DIR, ...parts.map((part) => cleanSegment(part, ''))].join('/')
}

/** 视频笔记相对路径。 */
export function videoNoteRelPath({ noteRoot, subject, noteName, layout } = {}) {
  const root = cleanRoot(noteRoot)
  const name = cleanSegment(noteName, '未命名视频')
  const dir = cleanSegment(subject, '未分类')
  return normalizeNoteLayout(layout) === 'structured'
    ? `${root}/${VIDEO_DIR}/${dir}/${name}.md`
    : `${root}/${dir}/${name}.md`
}

/** 字幕存档相对路径：<noteRoot>/资料/字幕/<笔记名>.md，不参与索引与概念。 */
export function transcriptNoteRelPath({ noteRoot, noteName } = {}) {
  const root = cleanRoot(noteRoot)
  const name = cleanSegment(noteName, '未命名视频')
  return `${root}/${AUX_DIR}/${TRANSCRIPT_DIR}/${name}.md`
}

/** 概念页相对路径：<noteRoot>/资料/概念/<概念>.md。 */
export function conceptPageRelPath({ noteRoot, name } = {}) {
  const root = cleanRoot(noteRoot)
  return `${root}/${AUX_DIR}/${CONCEPT_DIR}/${cleanSegment(name, '未命名概念')}.md`
}

/** 主题综述相对路径：<noteRoot>/资料/主题/<主题>.md。 */
export function topicPageRelPath({ noteRoot, name } = {}) {
  const root = cleanRoot(noteRoot)
  return `${root}/${AUX_DIR}/${TOPIC_DIR}/${cleanSegment(name, '未命名主题')}.md`
}

/** 学科学习手册相对路径。 */
export function manualNoteRelPath({ noteRoot, subject, layout } = {}) {
  const root = cleanRoot(noteRoot)
  const name = cleanSegment(subject, '未分类')
  return normalizeNoteLayout(layout) === 'structured'
    ? `${root}/${AUX_DIR}/${MANUAL_DIR}/${name}.md`
    : `${root}/${name}/${name}${MANUAL_SUFFIX}.md`
}

/** 学科学习手册的双链目标（去掉 .md，供 [[...]] 使用）。 */
export function manualNoteLinkTarget({ noteRoot, subject, layout } = {}) {
  return manualNoteRelPath({ noteRoot, subject, layout }).replace(/\.md$/i, '')
}

/** 每周回顾相对路径：<noteRoot>/资料/回顾/<周>.md。 */
export function weeklyReviewRelPath({ noteRoot, label } = {}) {
  const root = cleanRoot(noteRoot)
  return `${root}/${AUX_DIR}/${REVIEW_DIR}/${cleanSegment(label, '未命名回顾')}.md`
}

/**
 * 把历史状态里的辅助资料路径归一化成当前结构：
 * - 去掉 vaultPath 前缀，统一成相对 vault 根的 POSIX 路径；
 * - 旧版 <root>/字幕|手册|概念|主题|每周回顾/… 移到 <root>/资料/…。
 * 纯字符串处理，不访问文件系统。
 */
export function normalizeAuxRelPath(value, { vaultPath = '', noteRoot = '' } = {}) {
  let rel = String(value ?? '').replace(/\\/g, '/').trim()
  if (!rel) return ''
  rel = rel.replace(/^\.\//, '')
  const base = String(vaultPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (base && (rel === base || rel.startsWith(base + '/'))) {
    rel = rel === base ? '' : rel.slice(base.length + 1)
  } else {
    // 状态里可能存了带绝对路径的历史值；用根目录名把前缀截掉。
    const root = cleanRoot(noteRoot)
    for (const marker of ['/' + root + '/', '/课程知识地图/']) {
      const at = rel.indexOf(marker)
      if (at > 0) {
        rel = rel.slice(at + 1)
        break
      }
    }
  }
  rel = rel.replace(/^\/+/, '')
  if (!rel) return ''
  const root = cleanRoot(noteRoot)
  // 旧默认根「课程知识地图」没有前导斜杠时也迁移到当前根。
  if (rel.startsWith('课程知识地图/')) rel = root + rel.slice('课程知识地图'.length)
  if (rel.startsWith(root + '/')) {
    // 已经是当前根目录，继续处理下面的旧子目录迁移。
  } else if (rel.startsWith('字幕/') || rel.startsWith('手册/') || rel.startsWith('概念/') || rel.startsWith('主题/') || rel.startsWith('每周回顾/')) {
    rel = root + '/' + rel
  }
  const moves = [
    [TRANSCRIPT_DIR, TRANSCRIPT_DIR],
    [MANUAL_DIR, MANUAL_DIR],
    [CONCEPT_DIR, CONCEPT_DIR],
    [TOPIC_DIR, TOPIC_DIR],
    ['每周回顾', REVIEW_DIR],
  ]
  for (const [from, to] of moves) {
    const legacy = root + '/' + from + '/'
    const current = root + '/' + AUX_DIR + '/' + to + '/'
    if (rel.startsWith(legacy) && !rel.startsWith(current)) rel = current + rel.slice(legacy.length)
  }
  return rel
}

/** 归一化状态里所有视频的 transcriptPath，返回改动条数。 */
export function normalizeStateAuxPaths(state, { vaultPath = '', noteRoot = '' } = {}) {
  let changed = 0
  for (const entry of Object.values(state?.subjects || {})) {
    for (const video of entry?.videos || []) {
      if (!video || typeof video.transcriptPath !== 'string' || !video.transcriptPath) continue
      const next = normalizeAuxRelPath(video.transcriptPath, { vaultPath, noteRoot })
      if (next && next !== video.transcriptPath) {
        video.transcriptPath = next
        changed += 1
      }
    }
  }
  return changed
}

/**
 * 按「旧路径 → 新路径」映射改写状态里记的 notePath，返回改写条数。
 * state 结构：{ subjects: { <学科>: { videos: [{ notePath }] } } }；只认 Map/普通对象。
 */
export function remapStateNotePaths(state, pathMap) {
  const resolve =
    pathMap instanceof Map ? (key) => pathMap.get(key) : (key) => pathMap?.[key]
  let changed = 0
  for (const entry of Object.values(state?.subjects || {})) {
    for (const video of entry?.videos || []) {
      const next = resolve(video?.notePath)
      if (typeof next === 'string' && next && next !== video.notePath) {
        video.notePath = next
        changed += 1
      }
    }
  }
  return changed
}
