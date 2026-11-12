/**
 * 视频来源识别。
 *
 * 当前支持：
 *  - bilibili：BV 号 / bilibili.com / b23.tv
 *  - douyin：抖音精选 modal_id / /video/<id>，以及标题后缀「 - 抖音」
 */

const DOUYIN_ID_RE = /(?:[?&](?:modal_id|aweme_id)=|\/video\/)(\d{10,})/i

export function extractDouyinId(value) {
  const text = String(value ?? '')
  const match = text.match(DOUYIN_ID_RE)
  return match ? match[1] : ''
}

export function isDouyinUrl(value) {
  return /(^|\.)douyin\.com\b|(^|\.)iesdouyin\.com\b/i.test(String(value ?? ''))
}

export function isBilibiliUrl(value) {
  return /(^|\.)bilibili\.com\b|(^|\.)b23\.tv\b/i.test(String(value ?? ''))
}

/** 根据 URL / 浏览器标题判断来源；无法识别返回 null。 */
export function detectSource({ url = '', title = '' } = {}) {
  const text = String(url ?? '')
  if (isBilibiliUrl(text) || /BV[0-9A-Za-z]{10}/.test(text)) return 'bilibili'
  if (isDouyinUrl(text) || /(^|\s)-\s*抖音\s*$/.test(String(title ?? ''))) return 'douyin'
  return null
}

export function sourceLabel(source) {
  if (source === 'douyin') return '抖音精选'
  if (source === 'bilibili') return 'B站'
  return '视频'
}

export function sourceDisplayName(source) {
  if (source === 'douyin') return '抖音'
  if (source === 'bilibili') return 'B站'
  return '视频'
}
