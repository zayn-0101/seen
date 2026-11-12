import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureVaultDirs, writeVideoNote, updateSubjectManual, updateOverview, readFrontmatterBvid,
} from '../lib/obsidian.js'

function setup() {
  const vault = mkdtempSync(join(tmpdir(), 'seen-vault-'))
  ensureVaultDirs({ vaultPath: vault, noteRoot: '课程知识地图', stateDir: null })
  return vault
}

test('writeVideoNote handles same/different bvid', () => {
  const vault = setup()
  try {
    const base = {
      vaultPath: vault,
      noteRoot: '课程知识地图',
      subject: '机器学习',
      title: '梯度下降详解',
      bvid: 'BV1GJ411x7h7',
      content: '---\ntitle: "梯度下降详解"\nbvid: "BV1GJ411x7h7"\n---\n\nbody',
    }
    const first = writeVideoNote(base)
    assert.equal(first.skipped, false)
    assert.equal(first.relPath, '课程知识地图/机器学习/梯度下降详解.md')
    assert.equal(readFrontmatterBvid(first.absPath), 'BV1GJ411x7h7')
    const second = writeVideoNote(base)
    assert.equal(second.skipped, true)
    const other = writeVideoNote({ ...base, bvid: 'BV1aaaaaaaaa', content: '---\nbvid: "BV1aaaaaaaaa"\n---\n' })
    assert.notEqual(other.relPath, first.relPath)
    assert.ok(other.relPath.includes('(BV1aaaaaaaaa)'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('subject manual preserves user content', () => {
  const vault = setup()
  try {
    const first = updateSubjectManual({
      vaultPath: vault,
      noteRoot: '课程知识地图',
      subject: '机器学习',
      videos: [{ title: 'A', notePath: '课程知识地图/机器学习/A', summary: 'a', createdAt: Date.now() }],
    })
    const original = readFileSync(first.absPath, 'utf8') + '\nUSER CONTENT\n'
    writeFileSync(first.absPath, original, 'utf8')
    updateSubjectManual({
      vaultPath: vault,
      noteRoot: '课程知识地图',
      subject: '机器学习',
      videos: [
        { title: 'A', notePath: '课程知识地图/机器学习/A', summary: 'a', createdAt: Date.now() },
        { title: 'B', notePath: '课程知识地图/机器学习/B', summary: 'b', createdAt: Date.now() },
      ],
    })
    const updated = readFileSync(first.absPath, 'utf8')
    assert.ok(updated.includes('USER CONTENT'))
    assert.ok(updated.includes('[[课程知识地图/机器学习/B|B]]'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('overview is created', () => {
  const vault = setup()
  try {
    const out = updateOverview({ vaultPath: vault, noteRoot: '课程知识地图', subjects: ['机器学习'] })
    assert.ok(readFileSync(out.absPath, 'utf8').includes('机器学习'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})
