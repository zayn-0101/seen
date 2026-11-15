/**
 * seen-core · 旧笔记清理
 *
 * format 3 起视频笔记不再抓封面：这里的纯文本函数把早期笔记里的
 * cover 字段和正文封面图删掉。不访问文件系统，由脚本负责读写与备份。
 */

/** 删掉 frontmatter 的 cover 行与正文的 `![封面…](…)` 行。 */
export function stripCover(markdown) {
  const text = String(markdown ?? '')
  if (!text) return { markdown: text, changed: false }

  let changed = false
  let inFrontmatter = false
  let separators = 0
  const kept = []

  for (const line of text.split('\n')) {
    if (/^---\s*$/.test(line)) {
      separators += 1
      if (separators === 1) inFrontmatter = true
      else if (separators === 2) inFrontmatter = false
      kept.push(line)
      continue
    }
    if (inFrontmatter && /^cover:\s*/.test(line)) {
      changed = true
      continue
    }
    if (!inFrontmatter && /^!\[封面[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      changed = true
      continue
    }
    kept.push(line)
  }

  return { markdown: changed ? kept.join('\n') : text, changed }
}
