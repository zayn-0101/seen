import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { auditTranscripts } from '../lib/transcript-audit.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seen-transcript-audit-'))
  const vaultPath = join(root, 'vault')
  mkdirSync(join(vaultPath, '视频笔记', '资料', '字幕'), { recursive: true })
  mkdirSync(join(vaultPath, '视频笔记', '字幕'), { recursive: true })
  return { root, vaultPath, noteRoot: '视频笔记' }
}

function writeArchive(vaultPath, relPath, owner, extra = '') {
  const full = join(vaultPath, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, [
    '---',
    'title: "存档"',
    'type: "transcript"',
    'format: 1',
    ...(owner ? ['notePath: ' + JSON.stringify(owner)] : []),
    '---',
    '',
    '## 纯文本',
    '',
    '正文' + extra,
    '',
  ].join('\n'))
}

function stateWith(video) {
  return { subjects: { 物理: { videos: [video] } } }
}

test('干净的字幕存档没有审计问题', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  const transcriptPath = '视频笔记/资料/字幕/相对论.md'
  writeArchive(vaultPath, transcriptPath, notePath)
  const report = await auditTranscripts({ vaultPath, noteRoot, state: stateWith({ notePath, transcriptPath }) })
  assert.equal(report.schema, 'seen.transcript-audit')
  assert.equal(report.version, 1)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.warnings, 0)
  assert.equal(report.summary.archives, 1)
  assert.deepEqual(report.issues, [])
})

test('旧字幕路径只告警，不误报缺失', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  writeArchive(vaultPath, '视频笔记/资料/字幕/相对论.md', notePath)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath, transcriptPath: '视频笔记/字幕/相对论.md' }),
  })
  assert.equal(report.summary.errors, 0)
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-legacy' && item.severity === 'warn'))
  assert.ok(!report.issues.some((item) => item.type === 'state-transcript-missing'))
})

test('状态里的字幕存档不存在时告警', async () => {
  const { vaultPath, noteRoot } = fixture()
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath: '视频笔记/笔记/物理/相对论.md', transcriptPath: '视频笔记/资料/字幕/不存在.md' }),
  })
  assert.equal(report.summary.errors, 0)
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-missing' && item.severity === 'warn'))
})

test('状态里的字幕路径非法时不中止整次审计', async () => {
  const { vaultPath, noteRoot } = fixture()
  const noteA = '视频笔记/笔记/物理/相对论.md'
  const noteB = '视频笔记/笔记/物理/量子力学.md'
  writeArchive(vaultPath, '视频笔记/资料/字幕/量子力学.md', noteB)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: {
      subjects: {
        物理: {
          videos: [
            { notePath: noteA, transcriptPath: '视频笔记/../逃逸.md' },
            { notePath: noteB, transcriptPath: '视频笔记/资料/字幕/量子力学.md' },
          ],
        },
      },
    },
  })
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-invalid' && item.severity === 'error'))
  assert.equal(report.summary.videos, 2)
  assert.ok(report.issues.every((item) => item.type !== 'state-transcript-owner-mismatch'))
})

test('状态里的字幕路径指向字幕目录外的普通笔记时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  const otherNote = '视频笔记/笔记/物理/别的.md'
  mkdirSync(join(vaultPath, '视频笔记', '笔记', '物理'), { recursive: true })
  writeFileSync(join(vaultPath, otherNote), '---\ntitle: 别的\n---\n\n正文\n')
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath, transcriptPath: otherNote }),
  })
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-outside-archive' && item.severity === 'error'))
  assert.equal(report.summary.errors, 1)
})

test('存档没有 notePath 时告警', async () => {
  const { vaultPath, noteRoot } = fixture()
  writeArchive(vaultPath, '视频笔记/资料/字幕/旧存档.md', '')
  const report = await auditTranscripts({ vaultPath, noteRoot, state: { subjects: {} } })
  assert.ok(report.issues.some((item) => item.type === 'archive-owner-missing' && item.severity === 'warn'))
})

test('存档名与所属笔记不一致时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  const owner = '视频笔记/笔记/物理/另一篇.md'
  writeArchive(vaultPath, '视频笔记/资料/字幕/相对论.md', owner)
  const report = await auditTranscripts({ vaultPath, noteRoot, state: stateWith({ notePath: owner, transcriptPath: '视频笔记/资料/字幕/相对论.md' }) })
  assert.equal(report.summary.errors, 1)
  assert.equal(report.issues[0].type, 'archive-owner-mismatch')
})

test('同一篇笔记多份存档时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  writeArchive(vaultPath, '视频笔记/资料/字幕/相对论.md', notePath)
  writeArchive(vaultPath, '视频笔记/资料/字幕/相对论 (字幕-abcdef123456).md', notePath, '副本')
  const report = await auditTranscripts({ vaultPath, noteRoot, state: stateWith({ notePath, transcriptPath: '视频笔记/资料/字幕/相对论.md' }) })
  assert.equal(report.summary.errors, 1)
  assert.equal(report.issues[0].type, 'archive-duplicate-owner')
})

test('同名的无主存档多份时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  writeArchive(vaultPath, '视频笔记/资料/字幕/旧存档.md', '')
  writeArchive(vaultPath, '视频笔记/资料/字幕/旧存档 (字幕-abcdef123456).md', '', '副本')
  const report = await auditTranscripts({ vaultPath, noteRoot, state: { subjects: {} } })
  assert.ok(report.issues.some((item) => item.type === 'archive-duplicate-name' && item.severity === 'error'))
})

test('状态里的字幕路径指向别人的存档时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  const noteA = '视频笔记/笔记/物理/相对论.md'
  const noteB = '视频笔记/笔记/物理/另一篇.md'
  writeArchive(vaultPath, '视频笔记/资料/字幕/另一篇.md', noteB)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath: noteA, transcriptPath: '视频笔记/资料/字幕/另一篇.md' }),
  })
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-owner-mismatch' && item.severity === 'error'))
  assert.equal(report.summary.errors, 1)
})

test('旧 字幕/ 路径指向别人的存档时报错', async () => {
  const { vaultPath, noteRoot } = fixture()
  const noteA = '视频笔记/笔记/物理/相对论.md'
  const noteB = '视频笔记/笔记/物理/另一篇.md'
  writeArchive(vaultPath, '视频笔记/字幕/另一篇.md', noteB)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath: noteA, transcriptPath: '视频笔记/字幕/另一篇.md' }),
  })
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-owner-mismatch' && item.severity === 'error'))
  assert.equal(report.summary.errors, 1)
})

test('旧 字幕/ 路径属于同一篇笔记时不误报 owner 错配', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  writeArchive(vaultPath, '视频笔记/字幕/相对论.md', notePath)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath, transcriptPath: '视频笔记/字幕/相对论.md' }),
  })
  assert.ok(report.issues.some((item) => item.type === 'state-transcript-legacy' && item.severity === 'warn'))
  assert.ok(!report.issues.some((item) => item.type === 'state-transcript-owner-mismatch'))
  assert.equal(report.summary.errors, 0)
})

test('字幕目录指向 vault 内部目录时仍能审计到存档', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  const realDir = join(vaultPath, '视频笔记', '资料', '字幕-真实')
  mkdirSync(realDir, { recursive: true })
  rmSync(join(vaultPath, '视频笔记', '资料', '字幕'), { recursive: true, force: true })
  symlinkSync('字幕-真实', join(vaultPath, '视频笔记', '资料', '字幕'), 'dir')
  writeArchive(vaultPath, '视频笔记/资料/字幕-真实/相对论.md', notePath)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath, transcriptPath: '视频笔记/资料/字幕/相对论.md' }),
  })
  assert.equal(report.summary.archives, 1)
  assert.equal(report.summary.errors, 0)
})

test('字幕目录指向 vault 外部时报错而不是静默扫不到', async () => {
  const { vaultPath, noteRoot } = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'seen-audit-outside-'))
  try {
    writeArchive(outside, '相对论.md', '视频笔记/笔记/物理/相对论.md')
    rmSync(join(vaultPath, '视频笔记', '资料', '字幕'), { recursive: true, force: true })
    symlinkSync(outside, join(vaultPath, '视频笔记', '资料', '字幕'), 'dir')
    const report = await auditTranscripts({ vaultPath, noteRoot, state: { subjects: {} } })
    assert.ok(report.issues.some((item) => item.type === 'archive-dir-unreadable' && item.severity === 'error'))
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('旧 字幕/ 目录里的存档会告警，不会假装干净', async () => {
  const { vaultPath, noteRoot } = fixture()
  const notePath = '视频笔记/笔记/物理/相对论.md'
  writeArchive(vaultPath, '视频笔记/字幕/相对论.md', notePath)
  const report = await auditTranscripts({
    vaultPath,
    noteRoot,
    state: stateWith({ notePath, transcriptPath: '视频笔记/资料/字幕/相对论.md' }),
  })
  assert.ok(report.issues.some((item) => item.type === 'archive-legacy-location' && item.severity === 'warn'))
})
