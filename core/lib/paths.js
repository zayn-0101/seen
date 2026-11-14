/**
 * seen-core · 笔记目录结构
 *
 * 两种布局：
 *  - flat（默认）：<noteRoot>/<学科>/<标题>.md，学科学习手册与视频笔记同目录
 *  - structured：<noteRoot>/视频笔记/<学科>/<标题>.md，手册集中在 <noteRoot>/手册/
 *
 * 只做相对路径拼接，不访问文件系统；文件名清洗仍由 obsidian.js 负责。
 */

export const VIDEO_DIR = '视频笔记'
export const MANUAL_DIR = '手册'
export const MANUAL_SUFFIX = ' 学习手册'

export function normalizeNoteLayout(value) {
  return String(value ?? '').trim().toLowerCase() === 'structured' ? 'structured' : 'flat'
}

function cleanRoot(noteRoot) {
  const root = String(noteRoot ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
  return root || '课程知识地图'
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
