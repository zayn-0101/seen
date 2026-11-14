/**
 * seen-core · 学科名归一化
 *
 * 学科要「粗」：细分方向由 concepts / keywords 承载，不靠新建学科表达。
 * 判定顺序：精确一致 → 包含关系 → 共享连续汉字 → 数量封顶。
 * 纯函数、零依赖，可直接被 node:test import。
 */

import { normalizeSubjectName } from './config.js'

const DEFAULT_MAX_SUBJECTS = 12

/** 比较用的紧凑形式：去掉所有空白。 */
function compact(value) {
  return normalizeSubjectName(value).replace(/\s+/g, '')
}

/** 两个名字的最长公共连续字符长度。 */
export function sharedHanziRun(a, b) {
  const left = [...compact(a)]
  const right = [...compact(b)]
  if (!left.length || !right.length) return 0
  let best = 0
  let prev = new Array(right.length + 1).fill(0)
  for (let i = 1; i <= left.length; i += 1) {
    const cur = new Array(right.length + 1).fill(0)
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

function closestSubject(name, list) {
  let best = list[0]
  let bestScore = -1
  for (const item of list) {
    const score = sharedHanziRun(item, name)
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}

/**
 * 把候选学科名对齐到已有学科列表。
 * @returns {{subject: string, merged: boolean, reason: string}}
 */
export function alignSubject(name, existingSubjects = [], options = {}) {
  const maxSubjects = Number.isFinite(options.maxSubjects) ? options.maxSubjects : DEFAULT_MAX_SUBJECTS
  const incoming = compact(name)
  const list = (Array.isArray(existingSubjects) ? existingSubjects : [])
    .map((item) => String(item ?? '').trim())
    .filter((item) => item && item !== '未分类')
    .filter((item) => compact(item) !== '未分类')

  // 学科名至少两个字，单字（如「学」）没有区分度
  if ([...incoming].length < 2 || incoming === '未分类') {
    return { subject: '未分类', merged: false, reason: 'invalid' }
  }

  // 1. 完全一致
  const exact = list.find((item) => compact(item) === incoming)
  if (exact) return { subject: exact, merged: true, reason: 'exact' }

  // 2. 包含关系（长度差不超过 2），保留更宽泛的那个
  let contained = null
  for (const item of list) {
    const target = compact(item)
    if (!(incoming.includes(target) || target.includes(incoming))) continue
    if (Math.abs([...target].length - [...incoming].length) > 2) continue
    const shorter = [...target].length <= [...incoming].length ? item : incoming
    if (!contained || [...compact(shorter)].length < [...compact(contained)].length) contained = shorter
  }
  if (contained) return { subject: contained, merged: true, reason: 'contain' }

  // 3. 共享至少两个连续字符且长度接近
  for (const item of list) {
    if (Math.abs([...compact(item)].length - [...incoming].length) > 2) continue
    if (sharedHanziRun(item, incoming) >= 2) {
      return { subject: item, merged: true, reason: 'shared-run' }
    }
  }

  // 4. 学科数量封顶：不再新增，落到最接近的已有学科
  if (list.length >= maxSubjects) {
    return { subject: closestSubject(incoming, list), merged: true, reason: 'cap' }
  }

  return { subject: incoming, merged: false, reason: 'new' }
}
