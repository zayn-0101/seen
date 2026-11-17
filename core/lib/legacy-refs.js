/**
 * seen-core · 旧笔记路径引用重写
 *
 * 迁移脚本用它把笔记正文里的旧目录名、旧文件名换成当前结构。
 * 「没有前导斜杠」的写法也要处理：[[视频笔记/<学科>/…]]、行首 视频笔记/…
 *
 * 当前结构：<noteRoot>/笔记/<学科>/…，辅助资料统一在 <noteRoot>/资料/ 下。
 * 只做字符串处理，不访问文件系统。
 */
import { AUX_DIR, BACKUP_DIR, MANUAL_DIR, REVIEW_DIR, VIDEO_DIR } from './paths.js'

/** 历史上用过的根目录名（改过一次名）。 */
export const LEGACY_ROOTS = ['课程知识地图']
/** 上一版结构里放笔记的子目录名，现在叫 VIDEO_DIR。 */
export const LEGACY_VIDEO_DIR = '视频笔记'
/** 旧回顾目录名。 */
export const LEGACY_REVIEW_DIR = '每周回顾'
/** 旧总览文件名。 */
export const LEGACY_OVERVIEW = '课程总览.md'
/** 旧索引文件名。 */
export const LEGACY_INDEX = '索引.md'
/** 当前总览文件名。 */
export const OVERVIEW = '总览.md'
/** 当前索引文件名。 */
export const INDEX = '视频索引.md'
/** 概念索引文件名，和视频索引一样放在根下。 */
export const CONCEPT_INDEX = '概念索引'

function stripMd(name) {
  return String(name).replace(/\.md$/, '')
}

/** 根目录下已经存在的目录与文件，遇到就说明不该再插一层「笔记」。 */
const KEEP_AFTER_ROOT = [VIDEO_DIR, AUX_DIR, MANUAL_DIR, REVIEW_DIR, BACKUP_DIR, stripMd(OVERVIEW), stripMd(INDEX), CONCEPT_INDEX]

/** 把「带前导斜杠」与「行首 / 双链开头」两种写法都替换掉。 */
function swapRef(text, from, to) {
  let out = text.split('/' + from).join('/' + to)
  const heads = ['[', '(']
  for (const head of heads) out = out.split(head + from).join(head + to)
  return out
}

/** 把旧的根级辅助目录引用搬到 <noteRoot>/资料/<目录>/。 */
function moveAuxRefs(text, noteRoot, dir) {
  let out = text.split(noteRoot + '/' + dir + '/').join(noteRoot + '/' + AUX_DIR + '/' + dir + '/')
  out = out.split('[[' + dir + '/').join('[[' + AUX_DIR + '/' + dir + '/')
  return out
}

/**
 * 旧的视频子目录名：<root>/旧子目录/… 或裸 旧子目录/… 都要变成
 * <root>/笔记/…。已经是新结构（后面跟 笔记、资料、手册、回顾、_备份 或
 * 根下的索引文件）的不动。
 */
function rewriteVideoDir(text, noteRoot) {
  const token = LEGACY_VIDEO_DIR + '/'
  const prefix = noteRoot + '/'
  let out = ''
  // 先收拾「根名 + 旧子目录」连写的情况，否则两段都会被当成裸子目录
  let rest = text.split(prefix + token).join(prefix + VIDEO_DIR + '/')
  let at = rest.indexOf(token)
  while (at !== -1) {
    const after = rest.slice(at + token.length)
    const head = after.split(/[/|\]\s#]/)[0]
    const isKeep = KEEP_AFTER_ROOT.includes(head) || KEEP_AFTER_ROOT.includes(stripMd(head))
    const before = rest.slice(0, at)
    if (isKeep) {
      out += before + token
    } else if (before.endsWith(prefix)) {
      out += before + VIDEO_DIR + '/'
    } else {
      out += before + prefix + VIDEO_DIR + '/'
    }
    rest = after
    at = rest.indexOf(token)
  }
  return out + rest
}

/**
 * 把一段 Markdown 里的旧路径引用换成当前结构。
 * @param {string} text 笔记正文
 * @param {{ noteRoot?: string }} [options] 当前根目录名
 * @returns {string}
 */
export function rewriteLegacyRefs(text, options = {}) {
  const noteRoot = String(options.noteRoot || '视频笔记')
  let out = String(text ?? '')

  // 1) 根目录改名（行首、双链、绝对路径都覆盖）
  for (const legacy of LEGACY_ROOTS) out = out.split(legacy).join(noteRoot)

  // 2) 根下的旧文件名与旧目录名
  out = swapRef(out, stripMd(LEGACY_OVERVIEW), stripMd(OVERVIEW))
  out = swapRef(out, stripMd(LEGACY_INDEX), stripMd(INDEX))
  out = out.split('/' + LEGACY_REVIEW_DIR).join('/' + AUX_DIR + '/' + REVIEW_DIR)
  out = out.split('[[' + LEGACY_REVIEW_DIR).join('[[' + AUX_DIR + '/' + REVIEW_DIR)

  // 3) 旧的根级辅助目录：手册/概念/主题/字幕 -> 资料/<目录>
  for (const dir of [MANUAL_DIR, '概念', '主题', '字幕']) out = moveAuxRefs(out, noteRoot, dir)

  // 4) 旧的视频子目录
  return rewriteVideoDir(out, noteRoot)
}
