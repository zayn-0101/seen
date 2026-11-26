/**
 * seen-core · 日期归一
 *
 * 纯函数，不访问文件系统。平台返回的发布时间格式不统一：
 * B 站是 Unix 秒，YouTube 是 YYYYMMDD，抖音是 createTime，旧数据还可能是 ISO 字符串。
 * 统一成笔记使用的 YYYY-MM-DD。
 */

function pad(value) {
  return String(value).padStart(2, '0')
}

function fromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return String(date.getFullYear()).padStart(4, '0') + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function fromParts(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return ''
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return ''
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return ''
  return String(y).padStart(4, '0') + '-' + pad(m) + '-' + pad(d)
}

/**
 * 把平台发布时间归一成 YYYY-MM-DD；无法识别时返回空字符串。
 * 支持 Date、Unix 秒/毫秒、YYYYMMDD、ISO 字符串。
 */
export function normalizePublishedAt(value) {
  if (value === undefined || value === null || value === '') return ''
  if (value instanceof Date) return fromDate(value)
  const text = String(value).trim()
  if (!text || /^0+$/.test(text)) return ''

  if (/^\d{8}$/.test(text)) {
    return fromParts(text.slice(0, 4), text.slice(4, 6), text.slice(6, 8))
  }
  if (/^\d{10}$/.test(text)) return fromDate(new Date(Number(text) * 1000))
  if (/^\d{13}$/.test(text)) return fromDate(new Date(Number(text)))
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return fromParts(text.slice(0, 4), text.slice(5, 7), text.slice(8, 10))
  }
  return fromDate(new Date(text))
}
