/**
 * seen-core · 字幕存档
 *
 * 把处理时用到的字幕/转写原文留一份在 <noteRoot>/资料/字幕/，供以后重整理使用。
 * 存档是 Markdown（type: transcript），不参与视频索引、概念索引与标签索引。
 */

function yaml(value) {
  return JSON.stringify(String(value ?? ''))
}

function stripTimestamp(line) {
  return String(line ?? '').replace(/^\[\d{1,3}:\d{2}(?::\d{2})?\]\s*/, '')
}

export function renderTranscriptNote(input = {}) {
  const title = String(input.title || '未命名视频').trim() || '未命名视频'
  const subject = String(input.subject || '').trim()
  const source = String(input.source || '').trim()
  const url = String(input.url || '').trim()
  const bvid = String(input.bvid || '').trim()
  const videoId = String(input.videoId || '').trim()
  const author = String(input.author || '').trim()
  const notePath = String(input.notePath || '').trim()
  const transcript = String(input.transcript || '').trim()
  const timed = String(input.timedTranscript || '').trim()
  const createdRaw = input.createdAt
  const created = (typeof createdRaw === 'number' || /^\d{10,13}$/.test(String(createdRaw || '').trim()))
    ? new Date(Number(createdRaw)).toISOString().slice(0, 10)
    : (String(createdRaw || '').trim() || new Date().toISOString().slice(0, 10))

  const lines = ['---']
  lines.push('title: ' + yaml(title))
  if (subject) lines.push('subject: ' + yaml(subject))
  if (source) lines.push('source: ' + yaml(source))
  if (url) lines.push('url: ' + yaml(url))
  if (bvid) lines.push('bvid: ' + yaml(bvid))
  if (videoId) lines.push('videoId: ' + yaml(videoId))
  if (author) lines.push('author: ' + yaml(author))
  lines.push('created: ' + yaml(created))
  lines.push('type: "transcript"')
  lines.push('format: 1')
  if (notePath) lines.push('notePath: ' + yaml(notePath))
  lines.push('---', '')
  lines.push('# ' + title + ' · 字幕', '')
  if (notePath) {
    const target = notePath.replace(/\.md$/i, '')
    lines.push('> 所属笔记：[[' + target + '|' + title + ']]', '')
  }
  if (timed) lines.push('## 带时间戳字幕', '', timed, '')
  if (transcript) lines.push('## 纯文本', '', transcript, '')
  if (!timed && !transcript) lines.push('（暂无字幕）', '')
  return lines.join('\n')
}

/** 读取存档对应的笔记路径，旧存档可能没有此字段。 */
export function transcriptNoteOwner(markdown) {
  const frontmatter = String(markdown ?? '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const line = frontmatter?.[1].match(/^notePath\s*:\s*(.+?)\s*$/m)
  if (!line) return ''
  let value = line[1].trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { value = JSON.parse(value) } catch { return '' }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1)
  }
  return String(value || '').trim()
}

function section(markdown, heading) {
  const text = String(markdown ?? '')
  const pattern = new RegExp('^## ' + heading + '\\s*$', 'm')
  const match = pattern.exec(text)
  if (!match) return ''
  const rest = text.slice(match.index + match[0].length).replace(/^\s*\n/, '')
  const next = rest.search(/^##\s/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}

/**
 * 从字幕存档还原纯文本与带时间戳文本。
 * @returns {{ text: string, timed: string }}
 */
export function parseTranscriptNote(markdown) {
  const source = String(markdown ?? '')
  const timed = section(source, '带时间戳字幕')
  let text = section(source, '纯文本')
  if (!text && timed) {
    text = timed
      .split(/\r?\n/)
      .map(stripTimestamp)
      .filter(Boolean)
      .join('\n')
  }
  return { text, timed }
}
