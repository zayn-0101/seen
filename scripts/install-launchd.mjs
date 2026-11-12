#!/usr/bin/env node
/**
 * 安装 macOS LaunchAgent：登录后自动启动 Seen 独立服务。
 * 运行：node scripts/install-launchd.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const server = join(root, 'server', 'index.js')
const node = process.execPath
const logDir = join(homedir(), '.seen')
const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.seen.video.plist')
const label = 'com.seen.video'

mkdirSync(logDir, { recursive: true })
mkdirSync(dirname(plistPath), { recursive: true })

const plist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '  <key>Label</key><string>' + label + '</string>',
  '  <key>ProgramArguments</key>',
  '  <array>',
  '    <string>' + node + '</string>',
  '    <string>' + server + '</string>',
  '    <string>--no-open</string>',
  '  </array>',
  '  <key>WorkingDirectory</key><string>' + root + '</string>',
  '  <key>RunAtLoad</key><true/>',
  '  <key>KeepAlive</key><false/>',
  '  <key>StandardOutPath</key><string>' + join(logDir, 'server.log') + '</string>',
  '  <key>StandardErrorPath</key><string>' + join(logDir, 'server.err.log') + '</string>',
  '</dict>',
  '</plist>',
  '',
].join('\n')
writeFileSync(plistPath, plist, 'utf8')
console.log('已写入 ' + plistPath)
console.log('Node：' + node)

const uid = String(process.getuid?.() ?? '')
const domain = 'gui/' + uid
let result = spawnSync('launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8' })
if (result.status !== 0) {
  result = spawnSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf8' })
}
if (result.status !== 0) {
  console.error('launchctl 启动失败：' + String(result.stderr || result.stdout || '').trim())
  console.error('可手动执行：launchctl bootstrap ' + domain + ' ' + plistPath)
  process.exit(1)
}
console.log('Seen 已安装并启动。访问 http://127.0.0.1:4780')
console.log('卸载：node scripts/uninstall-launchd.mjs')
