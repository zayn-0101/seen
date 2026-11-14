#!/usr/bin/env node
/**
 * 把 Obsidian 笔记库从扁平结构迁移到「视频笔记 / 手册」结构。
 *
 * 扁平：  <noteRoot>/<学科>/<标题>.md、<noteRoot>/<学科>/<学科> 学习手册.md
 * 结构化：<noteRoot>/视频笔记/<学科>/<标题>.md、<noteRoot>/手册/<学科>.md
 *
 * 默认只打印计划（dry-run）；加 --apply 才会真正移动文件，并在动之前把
 * 整个笔记根目录复制到 <noteRoot>/_备份/迁移-<时间戳>/。
 *
 * 用法：
 *   node scripts/migrate-vault.mjs            # 查看会移动哪些文件
 *   node scripts/migrate-vault.mjs --apply    # 执行迁移（自动备份）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfig } from '../core/lib/config.js'
import { resolveVaultPath, toPosix } from '../core/lib/obsidian.js'
import { MANUAL_DIR, MANUAL_SUFFIX, VIDEO_DIR } from '../core/lib/paths.js'

const apply = process.argv.includes('--apply')

function readConfig() {
  const stateDir = process.env.SEEN_STATE_DIR || undefined
  const vaultPath = process.env.SEEN_VAULT || undefined
  return resolveConfig({ noteLayout: 'flat', ...(vaultPath ? { vaultPath } : {}), ...(stateDir ? { stateDir } : {}) })
}

function listMarkdown(dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...listMarkdown(full))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) result.push(full)
  }
  return result
}

function backupRoot(noteRootAbs) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = join(noteRootAbs, '_备份', '迁移-' + stamp)
  mkdirSync(target, { recursive: true })
  for (const file of listMarkdown(noteRootAbs)) {
    if (toPosix(file).includes('/_备份/')) continue
    const rel = toPosix(file).slice(toPosix(noteRootAbs).length + 1)
    const dest = join(target, ...rel.split('/'))
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(file, dest)
  }
  return target
}

function main() {
  const config = readConfig()
  const vaultPath = resolveVaultPath(config)
  if (!vaultPath) {
    console.error('没有找到 Obsidian vault，可用 SEEN_VAULT 指定。')
    process.exit(1)
  }
  const noteRoot = String(config.noteRoot || '课程知识地图')
  const noteRootAbs = resolve(vaultPath, noteRoot)
  if (!existsSync(noteRootAbs)) {
    console.log('笔记根目录不存在：' + noteRootAbs)
    process.exit(0)
  }

  const skipDirs = new Set([VIDEO_DIR, MANUAL_DIR, '_备份', '每周回顾'])
  const moves = []
  for (const entry of readdirSync(noteRootAbs, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || skipDirs.has(entry.name)) continue
    const subject = entry.name
    const subjectDir = join(noteRootAbs, subject)
    for (const file of listMarkdown(subjectDir)) {
      const name = file.slice(subjectDir.length + 1)
      const isManual = name === subject + MANUAL_SUFFIX + '.md'
      const dest = isManual
        ? join(noteRootAbs, MANUAL_DIR, subject + '.md')
        : join(noteRootAbs, VIDEO_DIR, subject, name)
      moves.push({ from: file, to: dest, isManual })
    }
  }

  console.log('vault：' + vaultPath)
  console.log('笔记根目录：' + noteRootAbs)
  console.log('待迁移文件：' + moves.length + ' 个')
  for (const move of moves.slice(0, 30)) {
    console.log('  ' + toPosix(move.from).slice(toPosix(noteRootAbs).length + 1) + ' → ' + toPosix(move.to).slice(toPosix(noteRootAbs).length + 1))
  }
  if (moves.length > 30) console.log('  …… 其余 ' + (moves.length - 30) + ' 个')
  if (moves.length === 0) {
    console.log('已经是结构化布局，无需迁移。')
    return
  }
  if (!apply) {
    console.log('')
    console.log('以上是预演。确认无误后加 --apply 执行（会先备份到 ' + noteRoot + '/_备份/）。')
    return
  }

  const backup = backupRoot(noteRootAbs)
  console.log('已备份到：' + backup)
  for (const move of moves) {
    mkdirSync(join(move.to, '..'), { recursive: true })
    renameSync(move.from, move.to)
  }

  // 重写笔记内的旧双链：<noteRoot>/<学科>/<学科> 学习手册 → <noteRoot>/手册/<学科>
  let rewritten = 0
  for (const file of listMarkdown(noteRootAbs)) {
    if (toPosix(file).includes('/_备份/')) continue
    const text = readFileSync(file, 'utf8')
    let next = text
    for (const move of moves) {
      if (!move.isManual) continue
      const subject = move.to.slice(move.to.lastIndexOf('/') + 1).replace(/\.md$/i, '')
      const oldTarget = noteRoot + '/' + subject + '/' + subject + MANUAL_SUFFIX
      const newTarget = noteRoot + '/' + MANUAL_DIR + '/' + subject
      next = next.split(oldTarget).join(newTarget)
    }
    if (next !== text) {
      writeFileSync(file, next, 'utf8')
      rewritten += 1
    }
  }
  console.log('重写链接的笔记：' + rewritten + ' 个')
  console.log('迁移完成。把配置里的 noteLayout 改成 structured 后，新笔记会写入新结构。')
}

main()
