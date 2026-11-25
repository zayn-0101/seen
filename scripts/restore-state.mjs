#!/usr/bin/env node
import { join } from 'node:path'

import { resolveConfig } from '../core/lib/config.js'
import { withInstanceLock } from '../core/lib/instance-lock.js'
import { listStateBackups, restoreStateBackup } from '../core/lib/state.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const from = args.indexOf('--from')
const slot = from < 0 ? 'latest' : args[from + 1]
const allowed = new Set(['--apply', '--from', ...(from < 0 ? [] : [slot])])
if (!['latest', 'previous'].includes(slot) || args.some(arg => !allowed.has(arg))) {
  console.error('用法：node scripts/restore-state.mjs [--from latest|previous] [--apply]')
  process.exit(2)
}

const { stateDir } = resolveConfig(process.env.SEEN_STATE_DIR ? { stateDir: process.env.SEEN_STATE_DIR } : {})
const statePath = join(stateDir, 'state.json')
try {
  if (apply) {
    const result = await withInstanceLock(stateDir, () => restoreStateBackup(statePath, slot))
    console.log('已从备份恢复：' + result.path)
    if (result.preservedPath) console.log('恢复前的原文件已保留：' + result.preservedPath)
  } else {
    const backups = listStateBackups(statePath)
    for (const backup of backups) {
      const detail = backup.valid ? '可恢复（' + new Date(backup.updatedAt).toLocaleString('zh-CN') + '）'
        : backup.missing ? '还没有备份' : '无法读取或格式无效'
      console.log(backup.slot + ' · ' + detail + ' · ' + backup.path)
    }
    if (backups.some(backup => backup.valid && backup.slot === slot)) {
      console.log('预览完成。退出 Seen 后可加 --apply 恢复 ' + slot)
    } else {
      console.error('所选备份不可用，可检查另一份或使用自己的状态备份')
      process.exitCode = 1
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
