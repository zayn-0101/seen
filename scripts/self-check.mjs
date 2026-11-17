#!/usr/bin/env node
/**
 * 离线自检：笔记结构体检 + 模型生成回归。
 *
 * 用法：
 *   node scripts/self-check.mjs                    # 体检全库（不调模型）
 *   node scripts/self-check.mjs --llm              # 追加模型回归（默认 3 次）
 *   node scripts/self-check.mjs --llm --runs 5     # 每个用例跑 5 次
 *   node scripts/self-check.mjs --llm --cases 3    # 分段/总结各最多 3 个用例
 *   node scripts/self-check.mjs --notes 0 --llm    # 只跑模型回归
 *   node scripts/self-check.mjs --json /tmp/self-check.json
 *
 * 退出码：有错误 → 1；只有警告 → 0。
 * 模型回归用本机缓存回放（~/.seen/cache/…），不联网、不写笔记、不改状态。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'

import { segmentTranscript, summarize } from '../core/lib/analyze.js'
import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import {
  checkIndexLinks,
  checkNoteLinks,
  checkNoteShape,
  checkSegments,
  checkSummaryShape,
  parseNoteMarkdown,
  summarizeFindings,
  NOTE_FORMAT,
} from '../core/lib/note-check.js'
import { resolveVaultPath } from '../core/lib/obsidian.js'
import { AUX_DIR, MANUAL_DIR, manualNoteRelPath } from '../core/lib/paths.js'
import { loadState } from '../core/lib/state.js'
import { listMarkdownFiles } from '../core/lib/vault-search.js'
import { probeVaultAccess, VAULT_HINT } from '../core/lib/vault-access.js'

const argv = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const index = argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(argv[index + 1])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
const withLlm = argv.includes('--llm')
const runs = Math.max(1, flagValue('--runs', 3))
const maxCases = Math.max(1, flagValue('--cases', 2))
const checkNotes = flagValue('--notes', 1) !== 0
const jsonIndex = argv.indexOf('--json')
const jsonPath = jsonIndex >= 0 ? argv[jsonIndex + 1] || '' : ''

const MANUAL_INDEXES = ['视频索引.md', '概念索引.md', '标签索引.md', '总览.md']
const AUTO_START = '<!-- AUTO:START -->'
const AUTO_END = '<!-- AUTO:END -->'

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

const vaultPath = resolveVaultPath(config)
const noteRootAbs = join(String(vaultPath), String(config.noteRoot))
const stateFile = join(config.stateDir, 'state.json')

const pad = (value) => (value >= 10 ? String(value) : '0' + value)
const seconds = (value) => pad(Math.floor(value / 60)) + ':' + pad(Math.round(value % 60))

function printGroups(title, groups) {
  if (groups.length === 0) return
  console.log(title)
  for (const group of groups) {
    console.log('  · ' + group.code + ' ×' + group.count)
    for (const message of group.messages) console.log('      ' + message)
  }
}

async function main() {
  const report = { vaultPath, noteRoot: config.noteRoot, notes: null, indexes: null, state: null, llm: null }
  let errors = 0

  const probe = await probeVaultAccess(vaultPath)
  if (!probe.ok) {
    console.log('笔记库不可访问（' + probe.code + '）：' + vaultPath)
    console.log(VAULT_HINT)
    process.exitCode = 1
    return
  }

  let state = null
  try {
    state = loadState(stateFile)
  } catch (error) {
    console.log('状态文件读取失败：' + (error?.message || error))
  }
  const stateVideos = state
    ? Object.entries(state.subjects || {}).flatMap(([subject, entry]) =>
        (Array.isArray(entry?.videos) ? entry.videos : []).map((video) => ({ ...video, subject })))
    : []
  const stateByPath = new Map(stateVideos.filter((video) => video.notePath).map((video) => [String(video.notePath), video]))

  const files = await listMarkdownFiles({ vaultPath, noteRoot: config.noteRoot })
  const relOf = (abs) => String(relative(String(vaultPath), abs)).split('\\').join('/')
  const notes = []
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      console.log('读取失败：' + relOf(file) + '（' + (error?.message || error) + '）')
      continue
    }
    if (!/type:\s*"?video-note"?/.test(text.slice(0, 900))) continue
    notes.push({ relPath: relOf(file), text, parsed: parseNoteMarkdown(text) })
  }

  if (checkNotes) {
    const findings = []
    let current = 0
    for (const note of notes) {
      if (note.parsed.format >= NOTE_FORMAT) current += 1
      for (const item of checkNoteShape(note.parsed)) findings.push({ ...item, note: note.relPath })
      for (const item of checkNoteLinks(note.parsed, { exists: (rel) => existsSync(join(String(vaultPath), rel)), selfPath: note.relPath })) {
        findings.push({ ...item, note: note.relPath })
      }
    }

    // 索引页与学科手册
    const indexFindings = []
    const indexStats = []
    for (const name of MANUAL_INDEXES) {
      const full = join(noteRootAbs, name)
      if (!existsSync(full)) {
        indexStats.push({ name, links: 0, missing: true })
        continue
      }
      const markdown = readFileSync(full, 'utf8')
      const links = [...markdown.matchAll(/\[\[[^\]]+\]\]/g)].length
      indexStats.push({ name, links, missing: false })
      for (const item of checkIndexLinks(markdown, { exists: (rel) => existsSync(join(String(vaultPath), rel)) })) {
        indexFindings.push({ ...item, note: name })
      }
    }
    const manualPrefix = String(config.noteRoot) + '/' + AUX_DIR + '/' + MANUAL_DIR + '/'
    const manualPaths = new Set(
      Object.keys(state?.subjects || {}).map((subject) =>
        manualNoteRelPath({ noteRoot: config.noteRoot, subject, layout: config.noteLayout })),
    )
    const manualFiles = files.filter((file) => manualPaths.has(relOf(file)) || relOf(file).startsWith(manualPrefix))
    for (const file of manualFiles) {
      const markdown = readFileSync(file, 'utf8')
      if (!markdown.includes(AUTO_START) || !markdown.includes(AUTO_END)) {
        indexFindings.push({ code: 'manual-auto-block', level: 'error', message: '学习手册缺 AUTO 区块：' + basename(file), note: relOf(file) })
      }
    }

    // 状态一致性
    const stateFindings = []
    let missingPaths = 0
    for (const video of stateVideos) {
      if (!video.notePath) continue
      if (!existsSync(join(String(vaultPath), video.notePath))) {
        missingPaths += 1
        stateFindings.push({ code: 'state-note-missing', level: 'error', message: '状态里的笔记路径不存在：' + video.notePath })
      }
    }
    for (const note of notes) {
      const record = stateByPath.get(note.relPath)
      if (!record) continue
      const stateTags = Array.isArray(record.tags) ? record.tags.map(String) : []
      const noteTags = note.parsed.tags
      const sameSet = stateTags.length === noteTags.length && [...stateTags].sort().join('|') === [...noteTags].sort().join('|')
      if (stateTags.length && !sameSet) {
        stateFindings.push({ code: 'state-tags-drift', level: 'error', message: '状态与笔记的标签不一致：' + note.parsed.title })
      }
      if (record.subject && note.parsed.subject && record.subject !== note.parsed.subject) {
        stateFindings.push({ code: 'state-subject-drift', level: 'error', message: '状态与笔记的学科不一致：' + note.parsed.title })
      }
    }
    if (stateVideos.length && notes.length && stateVideos.filter((video) => video.notePath).length > notes.length) {
      stateFindings.push({ code: 'state-vs-vault', level: 'warn', message: '状态里的视频比笔记库里的多，可能有笔记丢失或被手动移动' })
    }

    const all = [...findings, ...indexFindings, ...stateFindings]
    const summary = summarizeFindings(all)
    errors += summary.errors.length
    report.notes = { total: notes.length, current, legacy: notes.length - current, findings: all }
    report.indexes = { stats: indexStats, findings: indexFindings }
    report.state = { videos: stateVideos.length, missingPaths, findings: stateFindings }

    console.log('笔记体检  ' + notes.length + ' 篇（当前格式 ' + current + ' / 旧格式 ' + (notes.length - current) + '）  错误 ' + summary.errors.length + '  警告 ' + summary.warnings.length)
    printGroups('  错误：', summary.errorGroups)
    printGroups('  警告：', summary.warningGroups)
    const totalLinks = indexStats.reduce((sum, item) => sum + item.links, 0)
    console.log('索引与状态  索引 ' + totalLinks + ' 条双链 / 手册 ' + manualFiles.length + ' 篇  索引问题 ' + indexFindings.length + '  状态 ' + stateVideos.length + ' 条 / 路径缺失 ' + missingPaths + '  状态问题 ' + stateFindings.length)
    printGroups('  索引错误：', summarizeFindings(indexFindings).errorGroups)
    printGroups('  状态错误：', summarizeFindings(stateFindings).errorGroups)
  }

  if (withLlm) {
    const { createLlmClient, loadLlmConfig } = await import('../server/llm.js')
    const llmConfig = loadLlmConfig()
    const ctx = { llm: createLlmClient(llmConfig) }
    const llmOptions = { provider: llmConfig.provider, model: llmConfig.model }
    const cacheRoot = join(homedir(), '.seen', 'cache')

    const cases = []
    const addCase = (kind, platform, key, build) => {
      const file = join(cacheRoot, platform, key + '.json')
      if (!existsSync(file)) {
        cases.push({ kind, key, platform, skipped: '缓存不存在，跳过' })
        return
      }
      try {
        const cached = JSON.parse(readFileSync(file, 'utf8'))
        cases.push({ kind, key, platform, ...build(cached.content || cached) })
      } catch (error) {
        cases.push({ kind, key, platform, skipped: '缓存读取失败：' + (error?.message || error) })
      }
    }
    for (const [key, platform] of [['hCSHuvDejGA', 'youtube'], ['7698199362903624995', 'douyin']]) {
      addCase('segment', platform, key, (content) => ({
        title: content.title,
        timedTranscript: content.timedTranscript || '',
        duration: Number(content.duration) || 0,
      }))
    }
    for (const [key, platform] of [['z4AbijUCoKU', 'youtube'], ['7677576284532812731', 'douyin']]) {
      addCase('summary', platform, key, (content) => ({ content }))
    }

    const picked = []
    for (const kind of ['segment', 'summary']) {
      picked.push(...cases.filter((item) => item.kind === kind).slice(0, maxCases))
    }
    report.llm = { runs, provider: llmConfig.provider, model: llmConfig.model, cases: [] }
    console.log('模型回归  ' + picked.length + ' 用例 × ' + runs + ' 次（' + llmConfig.provider + ' / ' + llmConfig.model + '）')

    for (const item of picked) {
      const label = (item.kind === 'segment' ? '分段 ' : '总结 ') + item.key
      if (item.skipped) {
        console.log('  · ' + label + '  跳过（' + item.skipped + '）')
        report.llm.cases.push({ ...item, skipped: true })
        continue
      }
      const attempts = []
      for (let index = 1; index <= runs; index += 1) {
        const startedAt = Date.now()
        try {
          if (item.kind === 'segment') {
            const segments = await segmentTranscript(ctx, llmOptions, {
              title: item.title,
              timedTranscript: item.timedTranscript,
              duration: item.duration,
            })
            const findings = checkSegments(segments, { duration: item.duration })
            attempts.push({ index, ok: findings.length === 0, ms: Date.now() - startedAt, size: segments.length, findings })
          } else {
            const summary = await summarize(ctx, llmOptions, {
              title: item.content?.title || item.key,
              subject: '',
              keywords: Array.isArray(item.content?.tags) ? item.content.tags.slice(0, 8) : [],
              content: item.content,
            })
            const findings = checkSummaryShape(summary)
            attempts.push({ index, ok: findings.length === 0, ms: Date.now() - startedAt, size: Array.isArray(summary?.keyPoints) ? summary.keyPoints.length : 0, findings })
          }
        } catch (error) {
          attempts.push({ index, ok: false, ms: Date.now() - startedAt, size: 0, findings: [{ code: 'llm-error', level: 'error', message: error?.message || String(error) }] })
        }
      }
      const passed = attempts.filter((attempt) => attempt.ok).length
      const average = Math.round(attempts.reduce((sum, attempt) => sum + attempt.ms, 0) / attempts.length)
      const sizes = attempts.map((attempt) => attempt.size).join(',')
      const okRate = passed / runs
      const failed = okRate < 2 / 3 || attempts.some((attempt) => attempt.size === 0)
      if (failed) errors += 1
      console.log('  · ' + label + '  ' + passed + '/' + runs + ' 通过' + (failed ? '  ❌' : '') + '（' + (item.kind === 'segment' ? '段数' : '知识点') + ' ' + sizes + '，平均 ' + (average / 1000).toFixed(1) + 's）')
      for (const attempt of attempts.filter((entry) => !entry.ok)) {
        for (const finding of attempt.findings.slice(0, 4)) {
          console.log('      第 ' + attempt.index + ' 次：' + finding.message)
        }
      }
      report.llm.cases.push({ kind: item.kind, key: item.key, platform: item.platform, passed, runs, failed, attempts })
    }
  }

  if (jsonPath) {
    report.errors = errors
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n')
    console.log('报告已写入：' + jsonPath)
  }

  console.log(errors === 0 ? '\n自检通过（错误 0）' : '\n自检未通过：错误 ' + errors + ' 项')
  process.exitCode = errors === 0 ? 0 : 1
}

main().catch((error) => {
  console.log('自检异常：' + (error?.stack || error))
  process.exitCode = 1
})
