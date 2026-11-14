#!/usr/bin/env node
/**
 * 下载本地 Whisper 模型到 ~/.seen/models。
 * 服务运行时也会在首次需要时自动下载，这个脚本用于提前装好（例如离线准备环境）。
 *
 * 用法：
 *   node scripts/install-whisper-model.mjs
 *   node scripts/install-whisper-model.mjs --model base
 *   node scripts/install-whisper-model.mjs --force
 */
import { existsSync } from 'node:fs'
import {
  installWhisperModel,
  whisperModelPath,
  whisperModelUrls,
} from '../core/lib/whisper.js'

const modelIndex = process.argv.indexOf('--model')
const model = modelIndex !== -1 ? process.argv[modelIndex + 1] : 'large-v3-turbo'
const force = process.argv.includes('--force')
const allowed = new Set(['base', 'small', 'medium', 'large-v3-turbo'])
if (!allowed.has(model)) {
  console.error('不支持的模型：' + model + '（可选 base / small / medium / large-v3-turbo）')
  process.exit(1)
}

const target = whisperModelPath(model)
if (existsSync(target) && !force) {
  console.log('模型已存在：' + target)
  console.log('如需重新下载，加 --force。')
  process.exit(0)
}

console.log('安装位置：' + whisperModelPath(model))
console.log('下载源（按顺序尝试）：')
for (const url of whisperModelUrls(model)) console.log('  ' + url)

const result = await installWhisperModel({
  model,
  force,
  onProgress: (p) => {
    if (p.percent === null || p.percent === undefined) return
    process.stdout.write('\r  ' + p.percent + '%  ' + Math.round(p.received / 1024 / 1024) + ' / ' + Math.round(p.total / 1024 / 1024) + ' MB')
  },
})

if (!result.ok) {
  console.error('\n下载失败：' + (result.error || '未知原因'))
  console.error('也可以设置 HF_ENDPOINT=https://hf-mirror.com 后重试。')
  process.exit(1)
}

console.log('\n完成：' + result.path)
