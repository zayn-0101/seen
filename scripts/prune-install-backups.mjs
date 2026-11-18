#!/usr/bin/env node
/**
 * 清理 ~/.seen/install-backups/Seen.app.* 安装备份（默认只预览，不删除）。
 *
 *   node scripts/prune-install-backups.mjs                 # 预览：保留最新 2 份
 *   node scripts/prune-install-backups.mjs --keep 3        # 预览：保留最新 3 份
 *   node scripts/prune-install-backups.mjs --apply --keep 3
 *   node scripts/prune-install-backups.mjs --json --keep 3
 *
 * 只处理备份目录下名为 Seen.app.* 的普通目录；符号链接、普通文件、
 * 目录外的路径一律跳过。--keep 必须是正整数，0 或负数直接拒绝。
 */

import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseKeep } from './prune-build-backups.mjs'

const DEFAULT_BACKUP_DIR = process.env.SEEN_INSTALL_BACKUP_DIR || join(homedir(), '.seen', 'install-backups')
const PREFIX = 'Seen.app.'

function entrySize(absPath) {
  const stat = lstatSync(absPath)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const name of readdirSync(absPath)) total += entrySize(join(absPath, name))
  return total
}

/** 列出备份目录里可清理的安装备份，按创建时间从新到旧。 */
export function listInstallBackups(backupDir) {
  const rootStat = lstatSync(backupDir)
  if (rootStat.isSymbolicLink()) throw new Error('备份目录不能是符号链接：' + backupDir)
  const root = realpathSync(backupDir)
  const entries = []
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.name.startsWith(PREFIX)) continue
    const absPath = join(root, dirent.name)
    const stat = lstatSync(absPath)
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue
    const real = realpathSync(absPath)
    if (dirname(real) !== root) continue
    entries.push({
      name: dirent.name,
      path: absPath,
      realPath: real,
      bytes: entrySize(absPath),
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      modifiedAt: stat.mtimeMs,
    })
  }
  entries.sort((a, b) => (b.createdAt - a.createdAt) || (b.modifiedAt - a.modifiedAt) || a.name.localeCompare(b.name))
  return { root, entries }
}

/** 计算清理计划；apply=true 时才真正删除。 */
export function pruneInstallBackups({ backupDir = DEFAULT_BACKUP_DIR, keep = 2, apply = false } = {}) {
  const limit = parseKeep(keep)
  if (!limit) return { ok: false, error: '--keep 必须是正整数（例如 --keep 2）' }
  if (!existsSync(backupDir)) {
    return { ok: true, backupDir, keep: limit, apply, kept: [], removed: [], failed: [], reclaimBytes: 0, note: '备份目录不存在，无需清理' }
  }
  let listed
  try {
    listed = listInstallBackups(backupDir)
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
  const { root, entries } = listed
  const kept = entries.slice(0, limit)
  const targets = entries.slice(limit)
  const removed = []
  const failed = []
  let reclaimBytes = 0
  for (const entry of targets) {
    if (!apply) {
      removed.push(entry.name)
      reclaimBytes += entry.bytes
      continue
    }
    try {
      // 删除前重新核对真实路径，避免检查后被替换成指向别处的链接。
      const real = realpathSync(entry.path)
      if (dirname(real) !== root) throw new Error('路径已不在备份目录内')
      rmSync(entry.path, { recursive: true, force: false })
      removed.push(entry.name)
      reclaimBytes += entry.bytes
    } catch (error) {
      failed.push({ name: entry.name, error: String(error?.message || error) })
    }
  }
  return {
    ok: failed.length === 0,
    backupDir: root,
    keep: limit,
    apply,
    kept: kept.map((entry) => entry.name),
    removed,
    failed,
    reclaimBytes,
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function parseArgs(argv) {
  const options = { keep: 2, apply: false, json: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') options.apply = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--keep') {
      options.keep = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--keep=')) options.keep = arg.slice('--keep='.length)
    else return { error: '未知参数：' + arg }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.error) {
    console.error(options.error)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log('用法：node scripts/prune-install-backups.mjs [--keep N] [--apply] [--json]')
    console.log('默认只预览；--apply 才会删除，保留最新 N 份（默认 2）。')
    return
  }
  const result = pruneInstallBackups(options)
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (!result.ok && result.error) {
    console.error(result.error)
  } else {
    console.log((result.apply ? '清理' : '预览') + '安装备份：' + result.backupDir)
    if (result.note) console.log(result.note)
    console.log('保留最新 ' + result.keep + ' 份：' + (result.kept.length ? result.kept.join(', ') : '（无）'))
    console.log((result.apply ? '已删除 ' : '将删除 ') + result.removed.length + ' 份，可释放 ' + formatBytes(result.reclaimBytes))
    for (const name of result.removed) console.log('  - ' + name)
    for (const item of result.failed) console.error('  × ' + item.name + '：' + item.error)
    if (!result.apply && result.removed.length) console.log('确认无误后加 --apply 执行删除。')
  }
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
