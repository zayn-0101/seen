import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('迁移遇到符号链接目录时停止，不移动 vault 外文件', t => {
  const vault = mkdtempSync(join(tmpdir(), 'seen-migrate-symlink-'))
  const state = mkdtempSync(join(tmpdir(), 'seen-migrate-state-'))
  t.after(() => { rmSync(vault, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }) })
  const root = join(vault, '视频笔记')
  const outside = mkdtempSync(join(tmpdir(), 'seen-migrate-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(outside, '外部.md'), '# 外部文件')
  symlinkSync(outside, join(root, '手册'), 'dir')

  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'migrate-vault.mjs'), '--apply'], {
    env: { ...process.env, SEEN_VAULT: vault, SEEN_STATE_DIR: state, SEEN_NOTE_ROOT: '视频笔记' },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /符号链接/)
  assert.equal(existsSync(join(outside, '外部.md')), true)
  assert.equal(existsSync(join(root, '资料', '手册', '外部.md')), false)
})
