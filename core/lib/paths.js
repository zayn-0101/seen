/**
 * seen-core · 笔记目录结构
 *
 * 根目录（noteRoot）默认「视频笔记」，两种布局：
 *  - structured（默认）：<noteRoot>/笔记/<学科>/<标题>.md，手册集中在 <noteRoot>/手册/，每周回顾在 <noteRoot>/回顾/
 *  - flat：<noteRoot>/<学科>/<标题>.md，学科学习手册与视频笔记同目录
 *
 * 只做相对路径拼接，不访问文件系统；文件名清洗仍由 obsidian.js 负责。
 */

export const VIDEO_DIR = '笔记'
export const MANUAL_DIR = '手册'
export const REVIEW_DIR = '回顾'
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

/** 视频笔记相对路径。 */
export function videoNoteRelPath({ noteRoot, subject, noteName, layout } = {}) {
  const root = cleanRoot(noteRoot)
  const name = cleanSegment(noteName, '未命名视频')
  const dir = cleanSegment(subject, '未分类')
  return normalizeNoteLayout(layout) === 'structured'
    ? `${root}/${VIDEO_DIR}/${dir}/${name}.md`
    : `${root}/${dir}/${name}.md`
}

/** 学科学习手册相对路径。 */
export function manualNoteRelPath({ noteRoot, subject, layout } = {}) {
  const root = cleanRoot(noteRoot)
  const name = cleanSegment(subject, '未分类')
  return normalizeNoteLayout(layout) === 'structured'
    ? `${root}/${MANUAL_DIR}/${name}.md`
    : `${root}/${name}/${name}${MANUAL_SUFFIX}.md`
}

/** 学科学习手册的双链目标（去掉 .md，供 [[...]] 使用）。 */
export function manualNoteLinkTarget({ noteRoot, subject, layout } = {}) {
  return manualNoteRelPath({ noteRoot, subject, layout }).replace(/\.md$/i, '')
}

/**
 * 按「旧路径 → 新路径」映射改写状态里记的 notePath，返回改写条数。
 * 目录迁移后索引、概念索引与相关笔记双链都从 state 里的路径生成，不同步就会全指到旧位置。
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
