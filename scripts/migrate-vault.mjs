#!/usr/bin/env node
/**
 * 把 Obsidian 笔记库迁移到「视频笔记 / 笔记、手册、回顾」结构。
 *
 * 目标结构（根目录 = noteRoot，默认「视频笔记」）：
 *   视频笔记/
 *   ├── 总览.md / 视频索引.md / 概念索引.md
 *   ├── 笔记/<学科>/<标题>.md
 *   ├── 手册/<学科>.md
 *   ├── 回顾/YYYY-Www.md
 *   └── _备份/
 *
 * 能处理的旧结构：
 *   1. 根目录还叫「课程知识地图」→ 整个目录改名为「视频笔记」
 *   2. 扁平：<root>/<学科>/<标题>.md、<root>/<学科>/<学科> 学习手册.md
 *   3. 上一版结构化：<root>/视频笔记/<学科>/<标题>.md
 *   4. 旧文件/目录名：课程总览.md、索引.md、每周回顾/
 *
 * 默认只打印计划（dry-run）；加 --apply 才真正移动，动之前会把整个笔记根
 * 目录复制到 <root>/_备份/迁移-<时间戳>/。
 *
 * 用法：
 *   node scripts/migrate-vault.mjs            # 查看会移动哪些文件
 *   node scripts/migrate-vault.mjs --apply    # 执行迁移（自动备份）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveConfig } from '../core/lib/config.js'
import { loadState, saveState } from '../core/lib/state.js'
import { resolveVaultPath, toPosix } from '../core/lib/obsidian.js'
import { BACKUP_DIR, MANUAL_DIR, MANUAL_SUFFIX, REVIEW_DIR, VIDEO_DIR, remapStateNotePaths } from '../core/lib/paths.js'
import { INDEX, LEGACY_INDEX, LEGACY_OVERVIEW, LEGACY_REVIEW_DIR, LEGACY_ROOTS, LEGACY_VIDEO_DIR, OVERVIEW, rewriteLegacyRefs } from '../core/lib/legacy-refs.js'

const apply = process.argv.includes('--apply')


function readConfig() {
  const stateDir = process.env.SEEN_STATE_DIR || undefined
  const vaultPath = process.env.SEEN_VAULT || undefined
  return resolveConfig({ ...(vaultPath ? { vaultPath } : {}), ...(stateDir ? { stateDir } : {}) })
}

function listMarkdown(dir) {
  const result = []
  if (!existsSync(dir)) return result
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...listMarkdown(full))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) result.push(full)
  }
  return result
}

function backupRoot(rootAbs, backupDirAbs) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = join(backupDirAbs, '迁移-' + stamp)
  mkdirSync(target, { recursive: true })
  for (const file of listMarkdown(rootAbs)) {
    if (toPosix(file).includes('/' + BACKUP_DIR + '/')) continue
    const rel = toPosix(file).slice(toPosix(rootAbs).length + 1)
    const dest = join(target, ...rel.split('/'))
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(file, dest)
  }
  return target
}

/** 同步 state.json 里记录的 notePath（索引、概念索引、相关笔记双链都靠它）。 */
function rewriteState(config, pathMap) {
  const statePath = join(config.stateDir, 'state.json')
  if (!existsSync(statePath)) return 0
  const state = loadState(statePath)
  const map = pathMap instanceof Map ? pathMap : new Map(Object.entries(pathMap))
  const changed = remapStateNotePaths(state, map)
  if (changed > 0) saveState(statePath, state)
  return changed
}

function main() {
  const config = readConfig()
  const vaultPath = resolveVaultPath(config)
  if (!vaultPath) {
    console.error('没有找到 Obsidian vault，可用 SEEN_VAULT 指定。')
    process.exit(1)
  }
  const noteRoot = String(config.noteRoot || '视频笔记').trim()
  const newRootAbs = resolve(vaultPath, noteRoot)
  let rootAbs = newRootAbs
  let rootRename = null
  if (!existsSync(newRootAbs)) {
    for (const legacy of LEGACY_ROOTS) {
      const candidate = resolve(vaultPath, legacy)
      if (existsSync(candidate)) {
        rootAbs = candidate
        rootRename = { from: candidate, to: newRootAbs }
        break
      }
    }
  }
  if (!existsSync(rootAbs)) {
    console.log('笔记根目录不存在：' + newRootAbs)
    process.exit(0)
  }

  const relToVault = (abs) => toPosix(abs).slice(toPosix(vaultPath).length + 1)
  const moves = []
  const addMove = (from, to) => {
    if (toPosix(from) === toPosix(to)) return
    moves.push({ from, to, oldRel: relToVault(from), newRel: relToVault(to) })
  }

  // 1) 上一版结构化布局：<root>/视频笔记/<学科>/ -> <root>/笔记/<学科>/
  const legacyVideoDirAbs = join(rootAbs, LEGACY_VIDEO_DIR)
  if (existsSync(legacyVideoDirAbs)) {
    const prefix = toPosix(legacyVideoDirAbs).length + 1
    for (const file of listMarkdown(legacyVideoDirAbs)) {
      const rel = toPosix(file).slice(prefix)
      addMove(file, join(rootAbs, VIDEO_DIR, ...rel.split('/')))
    }
  }

  // 2) 扁平布局的学科目录 + 根下的旧文件名
  const skipDirs = new Set([VIDEO_DIR, MANUAL_DIR, REVIEW_DIR, BACKUP_DIR, LEGACY_VIDEO_DIR, LEGACY_REVIEW_DIR])
  for (const entry of readdirSync(rootAbs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(rootAbs, entry.name)
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      const subject = entry.name
      for (const file of listMarkdown(full)) {
        const name = file.slice(toPosix(full).length + 1)
        const isManual = name === subject + MANUAL_SUFFIX + '.md'
        addMove(file, isManual ? join(rootAbs, MANUAL_DIR, subject + '.md') : join(rootAbs, VIDEO_DIR, subject, ...name.split('/')))
      }
      continue
    }
    if (entry.name === LEGACY_OVERVIEW) addMove(full, join(rootAbs, OVERVIEW))
    if (entry.name === LEGACY_INDEX) addMove(full, join(rootAbs, INDEX))
  }

  // 3) 每周回顾/ -> 回顾/
  const legacyReviewAbs = join(rootAbs, LEGACY_REVIEW_DIR)
  if (REVIEW_DIR !== LEGACY_REVIEW_DIR && existsSync(legacyReviewAbs)) {
    const prefix = toPosix(legacyReviewAbs).length + 1
    for (const file of listMarkdown(legacyReviewAbs)) {
      const rel = toPosix(file).slice(prefix)
      addMove(file, join(rootAbs, REVIEW_DIR, ...rel.split('/')))
    }
  }

  console.log('vault：' + vaultPath)
  console.log('笔记根目录：' + rootAbs + (rootRename ? '（会改名为 ' + noteRoot + '/）' : ''))
  console.log('待迁移文件：' + moves.length + ' 个')
  for (const move of moves.slice(0, 30)) {
    console.log('  ' + toPosix(move.from).slice(toPosix(rootAbs).length + 1) + ' → ' + toPosix(move.to).slice(toPosix(rootAbs).length + 1))
  }
  if (moves.length > 30) console.log('  …… 其余 ' + (moves.length - 30) + ' 个')
  if (moves.length === 0 && !rootRename) {
    console.log('已经是当前结构，无需迁移。')
    return
  }
  if (!apply) {
    console.log('')
    console.log('以上是预演。确认无误后加 --apply 执行（会先备份）。')
    return
  }

  const backup = backupRoot(rootAbs, join(rootAbs, BACKUP_DIR))
  console.log('已备份到：' + backup)
  for (const move of moves) {
    mkdirSync(join(move.to, '..'), { recursive: true })
    renameSync(move.from, move.to)
  }

  // 清理搬空的旧目录（只为 tidy，失败不影响迁移）
  for (const dir of [legacyVideoDirAbs, legacyReviewAbs]) {
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      // 目录非空或占用，保留
    }
  }

  // 4) 根目录改名
  if (rootRename) {
    renameSync(rootRename.from, rootRename.to)
    console.log('根目录改名：' + toPosix(rootRename.from).slice(toPosix(vaultPath).length + 1) + ' → ' + noteRoot + '/')
  }

  // 5) 重写笔记内的旧路径引用
  let rewritten = 0
  for (const file of listMarkdown(newRootAbs)) {
    if (toPosix(file).includes('/' + BACKUP_DIR + '/')) continue
    const text = readFileSync(file, 'utf8')
    const next = rewriteLegacyRefs(text, { noteRoot })
    if (next !== text) {
      writeFileSync(file, next, 'utf8')
      rewritten += 1
    }
  }
  console.log('重写链接的笔记：' + rewritten + ' 个')

  // 6) 同步 state 里的 notePath（根改名也要算进去）
  const pathMap = new Map()
  const oldPrefix = relToVault(rootAbs)
  for (const move of moves) {
    const mapped = move.newRel.startsWith(oldPrefix + '/')
      ? noteRoot + move.newRel.slice(oldPrefix.length)
      : move.newRel
    pathMap.set(move.oldRel, mapped)
  }
  const updatedPaths = rewriteState(config, pathMap)
  console.log('同步状态里的笔记路径：' + updatedPaths + ' 条')
  console.log('迁移完成。重启服务后新笔记会写入新结构。')
}

main()
