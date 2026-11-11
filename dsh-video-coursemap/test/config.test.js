import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULTS, resolveConfig, detectObsidianVault, defaultStateDir, sanitizeFilename, normalizeSubjectName,
} from '../lib/config.js'

test('resolveConfig merges defaults and validates', () => {
  const config = resolveConfig({})
  assert.equal(config.pollIntervalMs, 15000)
  assert.equal(config.stablePolls, 2)
  assert.equal(config.noteRoot, '课程知识地图')
  assert.ok(config.stateDir.endsWith('dsh-video-coursemap-obsidian'))
  assert.equal(typeof config.vaultPath, 'string')
  assert.equal(resolveConfig({ pollIntervalMs: 5000 }).pollIntervalMs, 5000)
  assert.throws(() => resolveConfig({ unknownKey: 1 }), /未知配置项/)
  assert.throws(() => resolveConfig({ pollIntervalMs: 0 }), /正数/)
  assert.throws(() => resolveConfig({ enabled: 'yes' }), /布尔值/)
  assert.throws(() => resolveConfig({ provider: '' }), /非空字符串/)
})

test('detectObsidianVault reads obsidian.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'myminer-home-'))
  try {
    const vault = join(home, 'MyVault')
    mkdirSync(vault, { recursive: true })
    const dir = join(home, 'Library', 'Application Support', 'obsidian')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'obsidian.json'), JSON.stringify({
      last_open: 'abc',
      vaults: { abc: { path: vault, open: true } },
    }))
    assert.equal(detectObsidianVault(home), vault)
    assert.equal(detectObsidianVault(join(home, 'nope')), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('defaultStateDir and filename helpers', () => {
  const home = '/tmp/example-home'
  assert.equal(defaultStateDir(home), join(home, '.dsh', 'state', 'dsh-video-coursemap-obsidian'))
  assert.equal(sanitizeFilename('a/b:c*?"<>|d'), 'abcd')
  assert.equal(sanitizeFilename('   '), '未命名')
  assert.equal(sanitizeFilename('标题', 2), '标题')
  assert.equal(normalizeSubjectName('  机器  学习 '), '机器 学习')
  assert.equal(normalizeSubjectName(''), '未分类')
  assert.deepEqual(Object.keys(DEFAULTS).includes('enableMnemon'), true)
})
