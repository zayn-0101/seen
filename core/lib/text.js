/**
 * seen-core · 文本清洗
 *
 * 纯函数，不访问文件系统。用于标题清洗和中英文混排空格。
 */

export const TITLE_SUFFIXES = [
  ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox',
  ' - Chromium', ' - Opera', ' - Brave', ' - Internet Explorer',
  ' - 谷歌浏览器', ' - 微软 Edge', ' - 火狐浏览器', ' - 360极速浏览器',
  '_哔哩哔哩_bilibili', '_哔哩哔哩', ' - 哔哩哔哩', ' - bilibili', '-bilibili', ' - Bilibili',
  ' - YouTube', ' - 优酷', ' - 爱奇艺', ' - 腾讯视频', ' - 芒果TV', ' - 抖音', ' - 快手', ' - 夸克', ' - Quark',
]

// 只剔除明确属于栏目/促销/画质的方括号词，不碰未知的【P2】之类的分集信息。
const TITLE_BRACKET_NOISE = new Set([
  '游戏之外', '社会观察', '全网最全', '保姆级', '保姆级教学', '深度',
  '4K', '4k', '8K', '8k', '高清', '蓝光',
])

const CJK = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff'
const LATIN = 'A-Za-z0-9'
const CJK_LATIN = new RegExp('([' + CJK + '])([' + LATIN + '%])', 'g')
const LATIN_CJK = new RegExp('([' + LATIN + '%])([' + CJK + '])', 'g')

/** 在中文和拉丁字母/数字之间补空格；纯文本函数，不负责 Markdown/URL 保护。 */
export function spaceCjk(value) {
  let text = String(value ?? '')
  text = text.replace(CJK_LATIN, '$1 $2')
  text = text.replace(LATIN_CJK, '$1 $2')
  return text.replace(/[ \t]+/g, ' ').trim()
}

/**
 * 在 Markdown 正文里补中英文空格，同时保护链接目标、URL、行内代码和 HTML 注释。
 * 只处理可见文字；链接别名单独处理，不改写路径。
 */
export function spaceCjkMarkdown(value) {
  const source = String(value ?? '')
  const tokens = []
  const stash = (text) => {
    tokens.push(text)
    return '\u0000' + (tokens.length - 1) + '\u0000'
  }
  let text = source
    .replace(/<!--[\s\S]*?-->/g, stash)
    .replace(/`[^`\n]*`/g, stash)
  text = text.replace(/\[\[([^\]]+)\]\]/g, (full, inner) => {
    const pipe = inner.indexOf('|')
    if (pipe < 0) return full
    return '[[' + inner.slice(0, pipe + 1) + spaceCjk(inner.slice(pipe + 1)) + ']]'
  })
  text = text.replace(/(!?\[)([^\]]*)(\]\()([^)]+)(\))/g, (full, open, label, middle, url, close) => {
    return open + spaceCjk(label) + middle + url + close
  })
  text = text.replace(/https?:\/\/[^\s<>()]+/g, stash)
  text = spaceCjk(text)
  return text.replace(/\u0000(\d+)\u0000/g, (full, index) => tokens[Number(index)] ?? '')
}

function stripPlatformSuffixes(text) {
  let t = text
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of TITLE_SUFFIXES) {
      if (t.endsWith(suffix)) {
        t = t.slice(0, -suffix.length).trim()
        changed = true
      }
    }
  }
  return t
}

function stripHashtags(text) {
  return text
    .replace(/(^|[\s，。！？；：、,.!?;:])#[^\s#]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripBracketNoise(text) {
  return text.replace(/[【\[]([^】\]]+)[】\]]/g, (full, inner) => {
    return TITLE_BRACKET_NOISE.has(String(inner).trim()) ? '' : full
  }).replace(/\s+/g, ' ').trim()
}

function sanitizeTitleChars(text) {
  const map = { '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' }
  // 展示标题要和 Obsidian 文件名使用同一套可用字符，避免文件名与标题不一致。
  return text.replace(/[\\/:*?"<>|]/g, (ch) => map[ch] || ch).replace(/([：，。！？；、])\s+/g, '$1')
}

function cutAtPunctuation(text, maxLength) {
  const chars = [...text]
  if (chars.length <= maxLength) return text
  const head = chars.slice(0, maxLength).join('')
  const match = head.match(/^(.+[，。！？；：、,.!?;:])(?:[^，。！？；：、,.!?;:]*)$/u)
  let cut = match ? match[1] : head
  // 英文标题常在很靠前的句号后接长句；截得太短时退回最近的空格，避免只剩标题前半句。
  if (cut.length < head.length && cut.length < maxLength * 0.5) {
    const space = head.lastIndexOf(' ')
    if (space > cut.length) cut = head.slice(0, space)
  }
  return cut.replace(/[\s，。！？；：、,.!?;:]+$/u, '').trim()
}

/**
 * 生成展示标题：保留原题语义，去掉平台后缀、hashtag、明确栏目/促销/画质方括号，
 * 中英文之间补空格，并在过长时按标点截断。
 */
export function cleanDisplayTitle(raw, { maxLength = 40 } = {}) {
  const original = String(raw ?? '').trim()
  if (!original) return ''
  let text = stripPlatformSuffixes(original)
  text = stripHashtags(text)
  text = stripBracketNoise(text)
  text = spaceCjk(text)
  text = sanitizeTitleChars(text)
  text = cutAtPunctuation(text, Math.max(8, Number(maxLength) || 40))
  text = text.replace(/[\s，,。．.；;：:、]+$/u, '').trim()
  return text || original
}

/** 优先保留抓取/输入的真实标题；只有它缺失或明显无效时才用模型生成的标题。 */
export function pickOriginalTitle(inputTitle, classifiedTitle) {
  const input = String(inputTitle ?? '').trim()
  const classified = String(classifiedTitle ?? '').trim()
  if (!input || input === '未命名视频') return classified || input
  if (!classified) return input
  // 分类模型偶尔会把简介/副标题拼在标题后面；这种「原题 + 大段补充」不要覆盖真实标题。
  const compact = (value) => value.replace(/\s+/g, '')
  const grew = [...classified].length > [...input].length + 8
  if (grew && compact(classified).startsWith(compact(input))) return input
  return classified
}

