#!/usr/bin/env node
/**
 * 下载本地 Whisper 模型到 ~/.myminer/models。
 * 默认 small 模型（约 465MB），中文长视频转写用。
 *
 * 用法：
 *   node scripts/install-whisper-model.mjs
 *   node scripts/install-whisper-model.mjs --model base
 *   node scripts/install-whisper-model.mjs --force
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const model = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'small'
const force = process.argv.includes('--force')
const allowed = new Set(['base', 'small', 'medium', 'large-v3-turbo'])
if (!allowed.has(model)) {
  console.error('不支持的模型：' + model + '（可选 base / small / medium / large-v3-turbo）')
  process.exit(1)
}

const dir = join(homedir(), '.myminer', 'models')
const target = join(dir, 'ggml-' + model + '.bin')
const temp = target + '.part'
const url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-' + model + '.bin'

if (existsSync(target) && !force) {
  console.log('模型已存在：' + target + '（' + Math.round(statSync(target).size / 1024 / 1024) + ' MB）')
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
console.log('下载 ' + model + ' → ' + target)
console.log('来源：' + url)

const res = await fetch(url, { redirect: 'follow' })
if (!res.ok || !res.body) {
  console.error('下载失败：HTTP ' + res.status)
  process.exit(1)
}

const total = Number(res.headers.get('content-length')) || 0
let received = 0
let lastPrint = 0
const out = createWriteStream(temp)
const reader = res.body.getReader()

try {
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out.write(Buffer.from(value))
    received += value.length
    const now = Date.now()
    if (now - lastPrint > 1000) {
      lastPrint = now
      const percent = total ? ((received / total) * 100).toFixed(1) + '%' : Math.round(received / 1024 / 1024) + 'MB'
      process.stdout.write('\r  ' + percent + '  ' + Math.round(received / 1024 / 1024) + ' / ' + Math.round(total / 1024 / 1024) + ' MB')
    }
  }
  await new Promise((resolve, reject) => out.end((error) => error ? reject(error) : resolve()))
  renameSync(temp, target)
  console.log('\n完成：' + target)
} catch (error) {
  try { out.destroy() } catch { /* 忽略 */ }
  try { rmSync(temp, { force: true }) } catch { /* 忽略 */ }
  console.error('\n下载中断：' + String(error?.message || error))
  process.exit(1)
}
