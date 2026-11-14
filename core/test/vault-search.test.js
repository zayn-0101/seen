import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchVault } from '../lib/vault-search.js'

function makeVault() {
  const vault = mkdtempSync(join(tmpdir(), 'seen-search-'))
  const root = join(vault, '课程知识地图')
  mkdirSync(join(root, '写作'), { recursive: true })
  mkdirSync(join(root, '机器学习'), { recursive: true })
  mkdirSync(join(root, '_备份'), { recursive: true })
  writeFileSync(join(root, '写作', '责任前置.md'), '# 责任前置\n\n讲的是先说结论再解释。', 'utf8')
  writeFileSync(join(root, '机器学习', '梯度下降.md'), '# 梯度下降\n\n损失函数沿梯度方向下降。', 'utf8')
  writeFileSync(join(root, '_备份', '责任前置.md'), '# 责任前置 备份', 'utf8')
  return vault
}

test('searchVault matches titles first and skips backups', () => {
  const vault = makeVault()
  const hits = searchVault({ vaultPath: vault, noteRoot: '课程知识地图', query: '责任前置' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '责任前置')
  assert.equal(hits[0].relPath, '写作/责任前置.md')
  assert.equal(hits[0].score, 3)
})

test('searchVault matches body text with snippet', () => {
  const vault = makeVault()
  const hits = searchVault({ vaultPath: vault, noteRoot: '课程知识地图', query: '梯度' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '梯度下降')
  assert.ok(hits[0].score >= 3)
  const bodyHits = searchVault({ vaultPath: vault, noteRoot: '课程知识地图', query: '损失函数' })
  assert.equal(bodyHits.length, 1)
  assert.ok(bodyHits[0].snippet.includes('损失函数'))
})

test('searchVault returns empty for blank query or missing vault', () => {
  const vault = makeVault()
  assert.deepEqual(searchVault({ vaultPath: vault, noteRoot: '课程知识地图', query: '   ' }), [])
  assert.deepEqual(searchVault({ vaultPath: '/tmp/definitely-not-here', noteRoot: 'x', query: 'a' }), [])
})

test('searchVault supports multi-term queries', () => {
  const vault = makeVault()
  const hits = searchVault({ vaultPath: vault, noteRoot: '课程知识地图', query: '梯度 损失' })
  assert.equal(hits.length, 1)
  assert.ok(hits[0].score >= 4)
})
