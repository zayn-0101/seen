/**
 * 系统通知文案。
 *
 * 设计约定：通知标题只放视频标题，让一眼看到的是“哪条视频”；
 * 「拾影 · 平台 · 阶段」放在副标题，平台不再单独占一行。
 */

function clip(text, max) {
  const value = String(text === null || text === undefined ? '' : text).trim()
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export function platformLabel(source) {
  if (source === 'douyin') return '抖音精选'
  if (source === 'youtube') return 'YouTube'
  if (source === 'bilibili') return 'B站'
  return ''
}

export function notificationSubtitle(stage, source) {
  return ['拾影', platformLabel(source), stage].filter(Boolean).join(' · ')
}

/**
 * 通知标题只保留视频标题本身：去掉 B站/YouTube/抖音的站点后缀和话题标签，
 * 避免标题被截断在「#话题」中间。
 */
export function cleanNotificationTitle(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s*[-_|]\s*(?:哔哩哔哩|bilibili|YouTube|抖音精选|抖音)(?:\s*[-_|]\s*bilibili)?\s*$/i, '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,，。;；:：-]+|[\s·,，。;；:：-]+$/g, '')
    .trim()
}

function notificationTitle(data) {
  return clip(cleanNotificationTitle(data?.title), 64) || '新视频'
}

export function buildStartedNotification(data = {}) {
  const author = clip(data.author, 24)
  return {
    title: notificationTitle(data),
    subtitle: notificationSubtitle('开始整理', data.source),
    body: author ? '作者：' + author : '正在识别视频内容，稍后开始整理',
  }
}

export function buildTranscribingNotification(data = {}) {
  const minutes = Number(data.estimateMinutes) || 0
  return {
    title: notificationTitle(data),
    subtitle: notificationSubtitle('本地转写中', data.source),
    body: minutes > 0 ? '没有可用字幕，预计约 ' + minutes + ' 分钟' : '没有可用字幕，正在转写音频',
  }
}

export function buildSavedNotification(data = {}) {
  const subject = clip(data.subject, 20)
  return {
    title: notificationTitle(data),
    subtitle: notificationSubtitle('笔记已生成', data.source),
    body: subject ? '已归入「' + subject + '」，笔记已写入 Obsidian' : '笔记已写入 Obsidian',
  }
}

export function buildFailedNotification(data = {}) {
  return {
    title: notificationTitle(data),
    subtitle: notificationSubtitle('处理失败', data.source),
    body: clip(data.message || data.error || '未知错误', 160),
  }
}
