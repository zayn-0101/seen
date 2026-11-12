#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.myminer.video.plist')
const domain = 'gui/' + String(process.getuid?.() ?? '')
spawnSync('launchctl', ['bootout', domain, plistPath], { encoding: 'utf8' })
spawnSync('launchctl', ['unload', '-w', plistPath], { encoding: 'utf8' })
if (existsSync(plistPath)) rmSync(plistPath, { force: true })
console.log('已卸载 myminer LaunchAgent。')
