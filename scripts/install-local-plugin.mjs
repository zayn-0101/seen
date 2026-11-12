#!/usr/bin/env node
/**
 * 把本地 Seen Core（包名仍为 dsh-video-coursemap）安装到 DSH Desktop profile。
 * 会先备份 profile 的 package.json 与 pnpm-lock.yaml，再执行 pnpm install。
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(here, '..')
const pluginDir = join(workspace, 'core')
const profileDir = join(homedir(), '.dsh', 'profiles', 'desktop')
const pkgPath = join(profileDir, 'package.json')
const lockPath = join(profileDir, 'pnpm-lock.yaml')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join(workspace, 'docs', 'backup', stamp)

if (!existsSync(pluginDir)) {
  console.error('找不到插件目录：' + pluginDir)
  process.exit(1)
}
if (!existsSync(pkgPath)) {
  console.error('找不到 DSH profile：' + profileDir)
  process.exit(1)
}

mkdirSync(backupDir, { recursive: true })
copyFileSync(pkgPath, join(backupDir, 'package.json'))
if (existsSync(lockPath)) copyFileSync(lockPath, join(backupDir, 'pnpm-lock.yaml'))
console.log('已备份 profile 配置到：' + backupDir)

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dependencies = pkg.dependencies || {}
const previous = pkg.dependencies['dsh-video-coursemap'] || ''
pkg.dependencies['dsh-video-coursemap'] = 'file:' + pluginDir
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('dsh-video-coursemap: ' + previous + ' → file:' + pluginDir)

const pnpm = process.env.PNPM_BIN || 'pnpm'
const result = spawnSync(pnpm, ['install'], { cwd: profileDir, stdio: 'inherit', env: process.env })
if (result.error || result.status !== 0) {
  console.error('pnpm install 失败，正在恢复备份……')
  copyFileSync(join(backupDir, 'package.json'), pkgPath)
  if (existsSync(join(backupDir, 'pnpm-lock.yaml'))) copyFileSync(join(backupDir, 'pnpm-lock.yaml'), lockPath)
  process.exit(result.status || 1)
}

const installedDir = join(profileDir, 'node_modules', 'dsh-video-coursemap')
const installedPkg = join(installedDir, 'package.json')
if (existsSync(installedPkg)) {
  // pnpm 对 file: 依赖可能沿用安装时快照；这里把工作区源码同步到已安装副本，保证重启后加载最新代码。
  for (const entry of readdirSync(join(pluginDir, 'lib'), { withFileTypes: true })) {
    if (entry.isFile()) copyFileSync(join(pluginDir, 'lib', entry.name), join(installedDir, 'lib', entry.name))
  }
  for (const file of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    const source = join(pluginDir, file)
    if (existsSync(source)) copyFileSync(source, join(installedDir, file))
  }
  const v = JSON.parse(readFileSync(installedPkg, 'utf8')).version
  console.log('安装完成，已安装版本：' + v)
} else {
  console.log('pnpm install 完成，但未在 node_modules 找到 dsh-video-coursemap，请检查 pnpm 输出。')
}
console.log('请退出并重新打开 DSH Desktop 使插件生效。')
