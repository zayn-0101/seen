#!/usr/bin/env node
// 对所有 JavaScript 入口做语法检查；node:test 只覆盖被测试导入的模块。
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots = ['server', 'core/lib', 'core/test', 'web', 'scripts']
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(path)
  }
}

for (const root of roots) walk(root)
files.sort()

let failed = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    failed += 1
    console.error('\n' + file + '\n' + (result.stderr || result.stdout))
  }
}

if (failed > 0) {
  console.error('语法检查失败：' + failed + ' 个文件')
  process.exit(1)
}
console.log('语法检查通过：' + files.length + ' 个文件')
