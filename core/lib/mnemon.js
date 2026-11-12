/**
 * dsh-video-coursemap · mnemon 集成
 *
 * 纯 ESM、零运行时依赖。
 *  - findMnemon：显式配置 → which/where → 常见安装路径
 *  - buildMnemonContent：精简 insight（≤800 字）
 *  - buildRememberArgs：按契约参数顺序生成 argv（argv[0] 为 bin）
 *  - rememberVideo：15s 超时，失败 2s 后重试一次，绝不抛错
 */

import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REMEMBER_TIMEOUT_MS = 15000
const RETRY_DELAY_MS = 2000
const MAX_CONTENT_LENGTH = 800

function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return text
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function whichSync(command) {
  try {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (result.status !== 0) return null
    const first = String(result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return first || null
  } catch {
    return null
  }
}

function commonMnemonCandidates() {
  const candidates = [
    join(homedir(), '.local', 'bin', 'mnemon'),
    join(homedir(), 'bin', 'mnemon'),
    join(homedir(), '.volta', 'bin', 'mnemon'),
    join(homedir(), '.bun', 'bin', 'mnemon'),
    '/opt/homebrew/bin/mnemon',
    '/usr/local/bin/mnemon',
    '/usr/bin/mnemon',
  ]

  const versionRoots = [
    join(homedir(), '.local', 'share', 'fnm', 'node-versions'),
    join(homedir(), '.fnm', 'node-versions'),
    join(homedir(), '.nvm', 'versions', 'node'),
  ]
  for (const root of versionRoots) {
    try {
      for (const entry of readdirSync(root)) {
        candidates.push(join(root, entry, 'installation', 'bin', 'mnemon'))
        candidates.push(join(root, entry, 'bin', 'mnemon'))
      }
    } catch {
      // 目录不存在时忽略
    }
  }

  // CLAUDE.md 记录的本机路径（fnm 全局安装）
  candidates.push(
    '~/.local/share/fnm/node-versions/v24.15.0/installation/bin/mnemon'
  )
  return candidates
}

/** 探测 mnemon CLI：配置优先，其次 which，最后常见路径。任何异常都返回 null。 */
export async function findMnemon(config = {}) {
  try {
    const explicit = config && typeof config === 'object' ? config.mnemonBin : null
    if (typeof explicit === 'string' && explicit.trim() !== '') {
      const expanded = expandHome(explicit)
      if (isFile(expanded)) return expanded
      if (!expanded.includes('/') && !expanded.includes('\\')) {
        const found = whichSync(expanded)
        if (found && isFile(found)) return found
      }
    }

    const fromWhich = whichSync('mnemon')
    if (fromWhich && isFile(fromWhich)) return fromWhich

    for (const candidate of commonMnemonCandidates()) {
      if (isFile(candidate)) return candidate
    }
    return null
  } catch {
    return null
  }
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function flattenKeyPoints(keyPoints) {
  if (!Array.isArray(keyPoints)) return []
  const result = []
  for (const item of keyPoints) {
    if (typeof item === 'string') {
      const text = oneLine(item)
      if (text) result.push(text)
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const title = oneLine(item.title ?? item.name)
    const points = Array.isArray(item.points) ? item.points.map(oneLine).filter(Boolean) : []
    if (points.length === 0) {
      if (title) result.push(title)
      continue
    }
    for (const point of points) result.push(title ? `${title}：${point}` : point)
  }
  return result
}

/** 生成 mnemon insight 内容：标题/学科/摘要/前 5 条知识点/笔记路径/B站链接，≤800 字。 */
export function buildMnemonContent({ title, subject, summary, keyPoints, notePath, bvid, videoId, url, platformLabel } = {}) {
  const safeTitle = oneLine(title) || '未命名视频'
  const safeSubject = oneLine(subject) || '未分类'
  const safeSummary = oneLine(summary)
  const points = flattenKeyPoints(keyPoints).slice(0, 5)
  const pointLines = points.map((point, index) => `${index + 1}. ${point}`)

  const note = oneLine(notePath)
  const link = oneLine(url) || (oneLine(bvid) ? `https://www.bilibili.com/video/${oneLine(bvid)}` : '')
  const platformName = oneLine(platformLabel) || (oneLine(bvid) ? 'B站' : '视频')

  const headLines = [`【视频课程】${safeTitle}`, `学科：${safeSubject}`]
  const tailLines = []
  if (note) tailLines.push(`笔记：${note}`)
  if (link) tailLines.push(`${platformName}：${link}`)

  const fixedLength =
    headLines.join('\n').length +
    '\n摘要：'.length +
    (pointLines.length ? '\n知识点：\n'.length + pointLines.join('\n').length : 0) +
    (tailLines.length ? '\n'.length + tailLines.join('\n').length : 0)
  const summaryBudget = Math.max(0, MAX_CONTENT_LENGTH - fixedLength - 2)
  let summaryText = safeSummary
  if (summaryText.length > summaryBudget) {
    summaryText = summaryBudget > 1 ? summaryText.slice(0, summaryBudget - 1) + '…' : ''
  }

  const lines = [...headLines, `摘要：${summaryText}`]
  if (pointLines.length) lines.push('知识点：', ...pointLines)
  lines.push(...tailLines)
  return lines.join('\n').slice(0, MAX_CONTENT_LENGTH)
}

/** 按契约顺序生成 mnemon remember 的完整 argv（argv[0] 为 bin）。 */
export function buildRememberArgs({ bin, content, tags, entities, store } = {}) {
  return [
    String(bin ?? ''),
    'remember',
    String(content ?? ''),
    '--cat',
    'insight',
    '--imp',
    '3',
    '--source',
    'agent',
    '--tags',
    String(tags ?? ''),
    '--entities',
    String(entities ?? ''),
    '--store',
    String(store ?? 'default'),
  ]
}

function cleanExecError(error, stdout, stderr) {
  if (error?.killed || error?.signal) {
    return `mnemon 调用超时（${REMEMBER_TIMEOUT_MS}ms）`
  }
  const detail = String(stderr ?? '').trim() || String(stdout ?? '').trim() || String(error?.message ?? error ?? '').trim()
  return detail.slice(0, 500) || 'mnemon 调用失败'
}

function runMnemon(bin, args) {
  return new Promise((resolve) => {
    try {
      execFile(
        bin,
        args,
        {
          timeout: REMEMBER_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, error: cleanExecError(error, stdout, stderr) })
            return
          }
          resolve({ ok: true })
        }
      )
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error).slice(0, 500) })
    }
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 写入一条视频 insight；失败重试一次，绝不抛错。 */
export async function rememberVideo({ config, title, subject, summary, keyPoints, notePath, bvid, videoId, url, keywords, platformLabel } = {}) {
  try {
    const safeConfig = config && typeof config === 'object' ? config : {}
    const bin = await findMnemon(safeConfig)
    if (!bin) {
      return { ok: false, error: '未找到 mnemon CLI（可用 mnemonBin 配置指定）' }
    }

    const content = buildMnemonContent({ title, subject, summary, keyPoints, notePath, bvid, videoId, url, platformLabel })
    const tags = ['视频课程', oneLine(subject), ...(Array.isArray(keywords) ? keywords.map(oneLine) : [])].filter(Boolean).slice(0, 10).join(',')
    const entities = [oneLine(title), oneLine(subject), oneLine(bvid), oneLine(videoId)].filter(Boolean).join(',')
    const args = buildRememberArgs({
      bin,
      content,
      tags,
      entities,
      store: safeConfig.mnemonStore || 'default',
    })

    let result = await runMnemon(bin, args.slice(1))
    if (!result.ok) {
      await delay(RETRY_DELAY_MS)
      result = await runMnemon(bin, args.slice(1))
    }
    return result
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 500) }
  }
}
