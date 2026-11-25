#!/usr/bin/env node
/**
 * 去掉历史笔记里的封面。
 *
 * 用法：
 *   node scripts/strip-cover.mjs           预演，列出将被改动的笔记
 *   node scripts/strip-cover.mjs --apply   备份后改写
 *
 * format 3 起视频笔记不再抓封面（视频的内容比封面重要），这个脚本清理已写出的旧笔记。
 * 只处理 frontmatter 里 type: video-note 的笔记，不碰索引、手册与回顾。
 */
import { withInstanceLock } from '../core/lib/instance-lock.js'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { DEFAULTS, resolveConfig } from '../core/lib/config.js'
import { stripCover } from '../core/lib/note-clean.js'
import { resolveVaultPath } from '../core/lib/obsidian.js'
import { listMarkdownFiles } from '../core/lib/vault-search.js'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')

const config = resolveConfig({
  ...(process.env.SEEN_VAULT ? { vaultPath: process.env.SEEN_VAULT } : {}),
  ...(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {}),
  ...(process.env.SEEN_NOTE_ROOT ? { noteRoot: process.env.SEEN_NOTE_ROOT } : {}),
  noteLayout: process.env.SEEN_NOTE_LAYOUT || DEFAULTS.noteLayout,
})

function stamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-')
}

async function stripCovers() {
  const vaultPath = resolveVaultPath(config)
  const noteRoot = config.noteRoot || DEFAULTS.noteRoot
  const rootDir = join(vaultPath, noteRoot)

  const files = await listMarkdownFiles({ vaultPath, noteRoot })
  const targets = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!/^type:\s*"?video-note"?\s*$/m.test(text)) continue
    const result = stripCover(text)
    if (result.changed) targets.push({ file, markdown: result.markdown })
  }

  console.log('笔记库：' + rootDir)
  console.log('扫描 ' + files.length + ' 个 markdown 文件，' + targets.length + ' 篇带封面需要清理')
  for (const target of targets) console.log('  - ' + relative(rootDir, target.file))

  if (targets.length === 0) return
  if (!apply) {
    console.log('\n这是预演。确认无误后运行：node scripts/strip-cover.mjs --apply')
    return
  }

  const backupRoot = join(config.stateDir, '..', 'backups', '去封面-' + stamp())
  for (const target of targets) {
    const rel = relative(rootDir, target.file)
    const backupPath = join(backupRoot, rel)
    mkdirSync(dirname(backupPath), { recursive: true })
    copyFileSync(target.file, backupPath)
    writeFileSync(target.file, target.markdown, 'utf8')
  }
  console.log('\n已清理 ' + targets.length + ' 篇，原文件备份在：' + backupRoot)
}

try {
  await (apply ? withInstanceLock(config.stateDir, stripCovers) : stripCovers())
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
