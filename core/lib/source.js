/**
 * 视频来源识别。
 *
 * 当前支持：
 *  - bilibili：BV 号 / bilibili.com / b23.tv
 *  - douyin：抖音精选 modal_id / /video/<id>，以及标题后缀「 - 抖音」
 *  - youtube：watch?v= / youtu.be / shorts / embed / live，以及标题后缀「 - YouTube」
 */

const DOUYIN_ID_RE = /(?:[?&](?:modal_id|aweme_id)=|\/video\/)(\d{10,})/i
// YouTube 视频 ID 固定 11 位；短链、短裤、嵌入、直播页都在这里取。
const YOUTUBE_ID_RE = /(?:[?&]v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/
const YOUTUBE_TITLE_RE = /(^|\s)-\s*YouTube\s*$/i

/**
 * 判断文本里是否出现某个域名（允许子域、允许缺 scheme）。
 * 用逐字符判断而不是正则，避免短域名（youtu.be / b23.tv）在 "https://" 之后匹配不到。
 */
function hasHost(text, host) {
  const source = String(text ?? '').toLowerCase()
  const needle = String(host ?? '').toLowerCase()
  if (!source || !needle) return false
  let index = source.indexOf(needle)
  while (index !== -1) {
    const before = index === 0 ? '' : source[index - 1]
    const after = source[index + needle.length]
    const beforeOk = before === '' || before === '/' || before === '.'
    const afterOk = after === undefined || !/[a-z0-9.-]/.test(after)
    if (beforeOk && afterOk) return true
    index = source.indexOf(needle, index + 1)
  }
  return false
}

export function extractDouyinId(value) {
  const text = String(value ?? '')
  const match = text.match(DOUYIN_ID_RE)
  return match ? match[1] : ''
}

export function isDouyinUrl(value) {
  return hasHost(value, 'douyin.com') || hasHost(value, 'iesdouyin.com')
}

export function isBilibiliUrl(value) {
  return hasHost(value, 'bilibili.com') || hasHost(value, 'b23.tv')
}

export function isYoutubeUrl(value) {
  return hasHost(value, 'youtube.com')
    || hasHost(value, 'youtu.be')
    || hasHost(value, 'youtube-nocookie.com')
}

/** 从 YouTube 链接或裸视频 ID 中提取 11 位 ID；识别不到返回空字符串。 */
export function extractYoutubeId(value) {
  const text = String(value ?? '')
  const match = text.match(YOUTUBE_ID_RE)
  if (match) return match[1]
  const bare = text.trim()
  return /^[A-Za-z0-9_-]{11}$/.test(bare) ? bare : ''
}

/** 根据 URL / 浏览器标题判断来源；无法识别返回 null。 */
export function detectSource({ url = '', title = '' } = {}) {
  const text = String(url ?? '')
  const rawTitle = String(title ?? '')
  if (isBilibiliUrl(text) || /BV[0-9A-Za-z]{10}/.test(text)) return 'bilibili'
  if (isDouyinUrl(text) || /(^|\s)-\s*抖音\s*$/.test(rawTitle)) return 'douyin'
  if (isYoutubeUrl(text) || YOUTUBE_TITLE_RE.test(rawTitle)) return 'youtube'
  return null
}

export function sourceLabel(source) {
  if (source === 'douyin') return '抖音精选'
  if (source === 'bilibili') return 'B站'
  if (source === 'youtube') return 'YouTube'
  return '视频'
}

export function sourceDisplayName(source) {
  if (source === 'douyin') return '抖音'
  if (source === 'bilibili') return 'B站'
  if (source === 'youtube') return 'YouTube'
  return '视频'
}
