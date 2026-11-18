import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listBuildBackups, pruneBuildBackups } from '../../scripts/prune-build-backups.mjs'

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'seen-prune-'))
}

function backup(buildDir, name, bytes, mtime) {
  const dir = join(buildDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'payload.bin'), Buffer.alloc(bytes, 1))
  utimesSync(dir, mtime, mtime)
  return dir
}

test('默认只预览，不删除任何备份', () => {
  const root = sandbox()
  const build = join(root, 'build')
  mkdirSync(build)
  const names = ['previous-app.a', 'previous-app.b', 'previous-app.c', 'previous-app.d']
  names.forEach((name, index) => backup(build, name, 1024, new Date(2026, 0, index + 1)))

  const result = pruneBuildBackups({ buildDir: build, keep: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.apply, false)
  assert.deepEqual(result.kept, ['previous-app.d', 'previous-app.c'])
  assert.deepEqual(result.removed, ['previous-app.b', 'previous-app.a'])
  assert.ok(result.reclaimBytes > 0)
  assert.deepEqual(readdirSync(build).sort(), names)
})

test('--apply --keep 2 只保留最新两份', () => {
  const root = sandbox()
  const build = join(root, 'build')
  mkdirSync(build)
  const names = ['previous-app.a', 'previous-app.b', 'previous-app.c', 'previous-app.d']
  names.forEach((name, index) => backup(build, name, 512, new Date(2026, 0, index + 1)))

  const result = pruneBuildBackups({ buildDir: build, keep: 2, apply: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.kept, ['previous-app.d', 'previous-app.c'])
  assert.deepEqual(result.removed, ['previous-app.b', 'previous-app.a'])
  assert.deepEqual(readdirSync(build).sort(), ['previous-app.c', 'previous-app.d'])
})

test('符号链接备份和目录外的真实路径不会被删除', () => {
  const root = sandbox()
  const build = join(root, 'build')
  const outside = join(root, 'outside')
  mkdirSync(build)
  mkdirSync(outside)
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  backup(build, 'previous-app.a', 128, new Date(2026, 0, 1))
  backup(build, 'previous-app.b', 128, new Date(2026, 0, 2))
  symlinkSync(outside, join(build, 'previous-app.link'))

  const listing = listBuildBackups(build)
  assert.deepEqual(listing.entries.map((entry) => entry.name).sort(), ['previous-app.a', 'previous-app.b'])

  const result = pruneBuildBackups({ buildDir: build, keep: 1, apply: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.removed, ['previous-app.a'])
  assert.equal(existsSync(join(outside, 'keep.txt')), true)
  assert.equal(existsSync(join(build, 'previous-app.link')), true)
})

test('build 目录本身是符号链接时拒绝清理', () => {
  const root = sandbox()
  const build = join(root, 'build')
  mkdirSync(build)
  backup(build, 'previous-app.a', 128, new Date(2026, 0, 1))
  const link = join(root, 'build-link')
  symlinkSync(build, link)

  const result = pruneBuildBackups({ buildDir: link, keep: 1 })
  assert.equal(result.ok, false)
  assert.match(result.error, /符号链接/)
  assert.equal(existsSync(join(build, 'previous-app.a')), true)
})

test('--keep 0 或负数直接拒绝', () => {
  const root = sandbox()
  const build = join(root, 'build')
  mkdirSync(build)
  for (const keep of [0, -1, '0', 'abc', 1.5]) {
    const result = pruneBuildBackups({ buildDir: build, keep })
    assert.equal(result.ok, false)
    assert.match(result.error, /正整数/)
  }
})
