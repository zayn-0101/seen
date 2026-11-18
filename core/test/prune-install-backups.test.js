import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listInstallBackups, pruneInstallBackups } from '../../scripts/prune-install-backups.mjs'

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'seen-prune-install-'))
}

function backup(backupDir, name, bytes, mtime) {
  const dir = join(backupDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'payload.bin'), Buffer.alloc(bytes, 1))
  utimesSync(dir, mtime, mtime)
  return dir
}

test('默认只预览，不删除任何安装备份', () => {
  const root = sandbox()
  const backupDir = join(root, 'install-backups')
  mkdirSync(backupDir)
  const names = ['Seen.app.a', 'Seen.app.b', 'Seen.app.c', 'Seen.app.d']
  names.forEach((name, index) => backup(backupDir, name, 1024, new Date(2026, 0, index + 1)))

  const result = pruneInstallBackups({ backupDir, keep: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.apply, false)
  assert.deepEqual(result.kept, ['Seen.app.d', 'Seen.app.c'])
  assert.deepEqual(result.removed, ['Seen.app.b', 'Seen.app.a'])
  assert.ok(result.reclaimBytes > 0)
  assert.deepEqual(readdirSync(backupDir).sort(), names)
})

test('--apply --keep 2 只保留最新两份', () => {
  const root = sandbox()
  const backupDir = join(root, 'install-backups')
  mkdirSync(backupDir)
  const names = ['Seen.app.a', 'Seen.app.b', 'Seen.app.c', 'Seen.app.d']
  names.forEach((name, index) => backup(backupDir, name, 512, new Date(2026, 0, index + 1)))

  const result = pruneInstallBackups({ backupDir, keep: 2, apply: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.kept, ['Seen.app.d', 'Seen.app.c'])
  assert.deepEqual(result.removed, ['Seen.app.b', 'Seen.app.a'])
  assert.deepEqual(readdirSync(backupDir).sort(), ['Seen.app.c', 'Seen.app.d'])
})

test('符号链接备份和目录外的真实路径不会被删除', () => {
  const root = sandbox()
  const backupDir = join(root, 'install-backups')
  const outside = join(root, 'outside')
  mkdirSync(backupDir)
  mkdirSync(outside)
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  backup(backupDir, 'Seen.app.a', 128, new Date(2026, 0, 1))
  backup(backupDir, 'Seen.app.b', 128, new Date(2026, 0, 2))
  symlinkSync(outside, join(backupDir, 'Seen.app.link'))

  const listing = listInstallBackups(backupDir)
  assert.deepEqual(listing.entries.map((entry) => entry.name).sort(), ['Seen.app.a', 'Seen.app.b'])

  const result = pruneInstallBackups({ backupDir, keep: 1, apply: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.removed, ['Seen.app.a'])
  assert.equal(existsSync(join(outside, 'keep.txt')), true)
  assert.equal(existsSync(join(backupDir, 'Seen.app.link')), true)
})

test('备份目录本身是符号链接时拒绝清理', () => {
  const root = sandbox()
  const backupDir = join(root, 'install-backups')
  mkdirSync(backupDir)
  backup(backupDir, 'Seen.app.a', 128, new Date(2026, 0, 1))
  const link = join(root, 'install-backups-link')
  symlinkSync(backupDir, link)

  const result = pruneInstallBackups({ backupDir: link, keep: 1 })
  assert.equal(result.ok, false)
  assert.match(result.error, /符号链接/)
  assert.equal(existsSync(join(backupDir, 'Seen.app.a')), true)
})

test('--keep 0 或负数直接拒绝', () => {
  const root = sandbox()
  const backupDir = join(root, 'install-backups')
  mkdirSync(backupDir)
  for (const keep of [0, -1, '0', 'abc', 1.5]) {
    const result = pruneInstallBackups({ backupDir, keep })
    assert.equal(result.ok, false)
    assert.match(result.error, /正整数/)
  }
})
