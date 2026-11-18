#!/usr/bin/env node
/**
 * 字幕存档只读审计。
 *
 * 用法：
 *   node scripts/audit-transcripts.mjs                 # 人读摘要
 *   node scripts/audit-transcripts.mjs --json          # JSON 输出到 stdout
 *   node scripts/audit-transcripts.mjs --json out.json # JSON 写入文件
 *
 * 只读：不修改 vault、不修改 state。发现确定性损坏（归属不一致、重复）时退出码 1。
 */
import { writeFileSync } from 'node:fs'

import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { resolveVaultPath } from '../core/lib/obsidian.js'
import { loadState } from '../core/lib/state.js'
import { auditTranscripts } from '../core/lib/transcript-audit.js'

const argv = process.argv.slice(2)
const jsonIndex = argv.indexOf('--json')

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

const vaultPath = resolveVaultPath(config)
const stateFile = config.stateDir + '/state.json'
let state = null
try {
  state = loadState(stateFile)
} catch (error) {
  console.error('状态文件读取失败：' + String(error?.message || error))
  process.exitCode = 1
}

if (state) {
  const report = await auditTranscripts({ vaultPath, noteRoot: config.noteRoot, state })
  const json = JSON.stringify(report, null, 2) + '\n'
  if (jsonIndex >= 0 && argv[jsonIndex + 1] && !argv[jsonIndex + 1].startsWith('-')) {
    writeFileSync(argv[jsonIndex + 1], json)
    console.log('已写入 ' + argv[jsonIndex + 1])
  } else if (jsonIndex >= 0) {
    process.stdout.write(json)
  } else {
    console.log('字幕审计  ' + report.summary.videos + ' 条状态 / ' + report.summary.archives + ' 份存档  错误 ' + report.summary.errors + '  警告 ' + report.summary.warnings)
    for (const issue of report.issues) {
      console.log('  [' + issue.severity + '] ' + issue.type + '  ' + issue.message)
    }
  }
  if (report.summary.errors > 0) process.exitCode = 1
}
