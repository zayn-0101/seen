/**
 * seen-core · 复习调度
 *
 * 极简 SM-2：三档反馈（again 忘了 / hard 模糊 / easy 记住了），
 * 间隔按 1 / 3 / 7 / 16 / 35 天的阶梯推进，只依赖纯函数，便于测试。
 */

export const REVIEW_RATINGS = ['again', 'hard', 'easy']
const LADDER = [1, 3, 7, 16, 35]

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 本地时区的 YYYY-MM-DD。 */
export function dateKey(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

export function normalizeRating(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return REVIEW_RATINGS.includes(text) ? text : ''
}

/** 新笔记初始化：当天到期，interval 0 表示还没复习过。 */
export function initialReview(now = Date.now()) {
  return { due: dateKey(now), interval: 0, ease: 2.5, reps: 0 }
}

function addDays(now, days) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

/**
 * 按反馈计算下一次复习。
 * - again：重置到 1 天后，ease 下调
 * - hard：保持 reps，间隔至少 3 天并按 1.5 倍延长（封顶 35）
 * - easy：reps +1，按 1/3/7/16/35 阶梯推进
 */
export function nextReview(current, rating, now = Date.now()) {
  const base = current && typeof current === 'object' ? current : {}
  const normalized = normalizeRating(rating)
  const interval = Number(base.interval) > 0 ? Number(base.interval) : 0
  const ease = Number(base.ease) > 0 ? Number(base.ease) : 2.5
  const reps = Number.isFinite(Number(base.reps)) && Number(base.reps) > 0 ? Math.floor(Number(base.reps)) : 0
  if (!normalized) return { ...initialReview(now), ...base, due: base.due || dateKey(now) }

  let nextInterval
  let nextEase
  let nextReps
  if (normalized === 'again') {
    nextInterval = 1
    nextEase = Math.max(1.3, Math.round((ease - 0.2) * 10) / 10)
    nextReps = 0
  } else if (normalized === 'hard') {
    nextInterval = interval < 3 ? 3 : Math.min(35, Math.max(3, Math.round(interval * 1.5)))
    nextEase = Math.max(1.3, Math.round((ease - 0.1) * 10) / 10)
    nextReps = reps
  } else {
    nextInterval = LADDER[Math.min(reps, LADDER.length - 1)]
    nextEase = Math.min(3, Math.round((ease + 0.1) * 10) / 10)
    nextReps = reps + 1
  }
  return { due: addDays(now, nextInterval), interval: nextInterval, ease: nextEase, reps: nextReps, lastAt: now }
}

/** 没有 review 字段的旧笔记视为今天到期。 */
export function isDue(review, now = Date.now()) {
  if (!review || typeof review !== 'object' || !review.due) return true
  return String(review.due) <= dateKey(now)
}

/** 汇总待复习列表与学习统计。 */
export function collectReviews(videos = [], { now = Date.now(), limit = 20 } = {}) {
  const rows = Array.isArray(videos) ? videos : []
  const due = rows
    .filter((row) => row && row.title && isDue(row.review, now))
    .map((row) => ({
      title: String(row.title || ''),
      subject: String(row.subject || ''),
      notePath: String(row.notePath || ''),
      quality: Number(row.quality) || 0,
      review: row.review && typeof row.review === 'object' ? row.review : initialReview(now),
    }))
    .sort((a, b) => String(a.review.due || '').localeCompare(String(b.review.due || '')) || b.quality - a.quality)
    .slice(0, Math.max(0, Math.floor(limit)))

  const reviewed = rows.filter((row) => row && row.review && Number(row.review.reps) > 0)
  const scores = rows.map((row) => Number(row && row.quality)).filter((value) => Number.isFinite(value) && value > 0)
  const averageQuality = scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : 0
  return {
    due,
    stats: {
      total: rows.length,
      reviewed: reviewed.length,
      due: rows.filter((row) => row && isDue(row.review, now)).length,
      averageQuality,
      subjects: new Set(rows.map((row) => String(row && row.subject || '').trim()).filter(Boolean)).size,
    },
  }
}
