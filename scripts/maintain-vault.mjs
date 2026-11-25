#!/usr/bin/env node
/**
 * 全量重建知识库页面。
 *
 * 用法：
 *   node scripts/maintain-vault.mjs            重建索引、概念页、主题页、学科手册与总览
 *   node scripts/maintain-vault.mjs --dry-run  只统计将要生成的页面，不写文件
 *
 * 不重新转写、不重新调用模型；内容来自 state.json 里已有的视频记录。
 */
import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { resolveVaultPath, ensureVaultDirs } from '../core/lib/obsidian.js'
import { buildHistoryFromState, rebuildKnowledgePages } from '../core/lib/rebuild.js'
import { collectConceptPages, collectTopicPages } from '../core/lib/topic-pages.js'
import { loadState } from '../core/lib/state.js'
import { probeVaultAccess, VAULT_HINT } from '../core/lib/vault-access.js'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

const vaultPath = resolveVaultPath(config)
const state = loadState(config.stateDir + '/state.json', { strict: true })

if (dryRun) {
  const history = buildHistoryFromState(state)
  const conceptPages = collectConceptPages(history).length
  const topicPages = collectTopicPages(history).length
  console.log('预演：视频 ' + history.length + ' 篇，学科 ' + Object.keys(state.subjects || {}).length + ' 个，概念页 ' + conceptPages + ' 个，主题页 ' + topicPages + ' 个')
  console.log('去掉 --dry-run 才会写入 ' + config.noteRoot + '/')
  process.exit(0)
}

const probe = await probeVaultAccess(vaultPath)
if (!probe.ok) {
  console.error(VAULT_HINT)
  console.error('当前状态：' + probe.code + (probe.detail ? '（' + probe.detail + '）' : ''))
  process.exit(1)
}

await ensureVaultDirs({ vaultPath, noteRoot: config.noteRoot, stateDir: config.stateDir })
const result = await rebuildKnowledgePages({
  vaultPath,
  noteRoot: config.noteRoot,
  state,
  layout: config.noteLayout,
  log: (line) => console.log(line),
})
console.log('重建完成：视频 ' + result.videos + ' 篇，学科 ' + result.subjects + ' 个，概念页 ' + result.concepts + ' 个，主题页 ' + result.topics + ' 个')
