#!/usr/bin/env node
/**
 * 回滚 DSH Desktop profile 中的 dsh-video-coursemap 依赖到最近一次备份。
 */
import { existsSync, copyFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, '..')
const profileDir = join(homedir(), '.dsh', 'profiles', 'desktop')
const pkgPath = join(profileDir, 'package.json')
const lockPath = join(profileDir, 'pnpm-lock.yaml')
const backupRoot = join(workspace, 'docs', 'backup')

if (!existsSync(backupRoot)) { console.error('没有备份目录：' + backupRoot); process.exit(1) }
const dirs = readdirSync(backupRoot).filter((d) => existsSync(join(backupRoot, d, 'package.json'))).sort()
if (dirs.length === 0) { console.error('没有可用备份'); process.exit(1) }
const latest = dirs[dirs.length - 1]
copyFileSync(join(backupRoot, latest, 'package.json'), pkgPath)
if (existsSync(join(backupRoot, latest, 'pnpm-lock.yaml'))) copyFileSync(join(backupRoot, latest, 'pnpm-lock.yaml'), lockPath)
console.log('已恢复备份：' + latest)

const pnpm = process.env.PNPM_BIN || 'pnpm'
const result = spawnSync(pnpm, ['install'], { cwd: profileDir, stdio: 'inherit', env: process.env })
if (result.error || result.status !== 0) process.exit(result.status || 1)
console.log('回滚完成，请重新打开 DSH Desktop。')
