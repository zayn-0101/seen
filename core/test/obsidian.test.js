import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureVaultDirs, writeVideoNote, writeTranscriptNote, updateSubjectManual, updateOverview, readFrontmatterBvid, readVaultText, updateNoteTags,
} from '../lib/obsidian.js'
import { renderTranscriptNote } from '../lib/transcript-note.js'

async function setup() {
  const vault = mkdtempSync(join(tmpdir(), 'seen-vault-'))
  await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
  return vault
}

test('writeVideoNote handles same/different bvid', async () => {
  const vault = await setup()
  try {
    const base = {
      vaultPath: vault,
      noteRoot: '视频笔记',
      subject: '机器学习',
      title: '梯度下降详解',
      bvid: 'BV1GJ411x7h7',
      content: '---\ntitle: "梯度下降详解"\nbvid: "BV1GJ411x7h7"\n---\n\nbody',
    }
    const first = await writeVideoNote(base)
    assert.equal(first.skipped, false)
    assert.equal(first.relPath, '视频笔记/笔记/机器学习/梯度下降详解.md')
    assert.equal(await readFrontmatterBvid(first.absPath), 'BV1GJ411x7h7')
    const second = await writeVideoNote(base)
    assert.equal(second.skipped, true)
    const other = await writeVideoNote({ ...base, bvid: 'BV1aaaaaaaaa', content: '---\nbvid: "BV1aaaaaaaaa"\n---\n' })
    assert.notEqual(other.relPath, first.relPath)
    assert.ok(other.relPath.includes('(BV1aaaaaaaaa)'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('强制重生成只更新同一视频的同名副本，保留其他视频和手写内容', async () => {
  const vault = await setup()
  try {
    const common = { vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '同名视频', source: 'bilibili' }
    const a = await writeVideoNote({ ...common, bvid: 'BV1aaaaaaaaa', content: '---\nbvid: "BV1aaaaaaaaa"\n---\n视频 A' })
    const b = await writeVideoNote({ ...common, bvid: 'BV1bbbbbbbbb', content: '---\nbvid: "BV1bbbbbbbbb"\n---\n视频 B\n\n## 我的补充\n<!-- MANUAL:START -->\n手写内容\n<!-- MANUAL:END -->\n' })
    const refreshed = await writeVideoNote({ ...common, bvid: 'BV1bbbbbbbbb', force: true, content: '---\nbvid: "BV1bbbbbbbbb"\n---\n更新的视频 B\n\n## 我的补充\n<!-- MANUAL:START -->\n<!-- MANUAL:END -->\n' })
    assert.equal(refreshed.relPath, b.relPath)
    assert.match(readFileSync(a.absPath, 'utf8'), /视频 A/)
    assert.match(readFileSync(b.absPath, 'utf8'), /更新的视频 B/)
    assert.match(readFileSync(b.absPath, 'utf8'), /手写内容/)
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('不同分 P、其他平台视频或身份不明的同名文件不会被强制覆盖', async () => {
  const vault = await setup()
  try {
    const common = { vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '同名视频' }
    const p1 = await writeVideoNote({ ...common, source: 'bilibili', bvid: 'BV1aaaaaaaaa', page: 1, content: '---\nbvid: "BV1aaaaaaaaa"\nurl: "https://www.bilibili.com/video/BV1aaaaaaaaa"\n---\n第一集' })
    const p2 = await writeVideoNote({ ...common, source: 'bilibili', bvid: 'BV1aaaaaaaaa', page: 2, force: true, content: '---\nbvid: "BV1aaaaaaaaa"\nurl: "https://www.bilibili.com/video/BV1aaaaaaaaa?p=2"\n---\n第二集' })
    assert.notEqual(p2.relPath, p1.relPath)
    assert.match(readFileSync(p1.absPath, 'utf8'), /第一集/)

    const yt = await writeVideoNote({ ...common, source: 'youtube', videoId: 'ExampleId01', force: true, content: '---\nsource: "youtube"\nvideoId: "ExampleId01"\n---\nYouTube 内容' })
    assert.notEqual(yt.relPath, p1.relPath)
    const ytAgain = await writeVideoNote({ ...common, source: 'youtube', videoId: 'ExampleId01', force: true, content: '---\nsource: "youtube"\nvideoId: "ExampleId01"\n---\nYouTube 更新' })
    assert.equal(ytAgain.relPath, yt.relPath)
    assert.match(readFileSync(yt.absPath, 'utf8'), /YouTube 更新/)

    const manual = await writeVideoNote({ ...common, title: '手写文件', content: '用户原文' })
    const unknown = await writeVideoNote({ ...common, title: '手写文件', source: 'youtube', videoId: 'ExampleId02', force: true, content: '---\nsource: "youtube"\nvideoId: "ExampleId02"\n---\n新视频' })
    assert.notEqual(manual.relPath, unknown.relPath)
    assert.equal(readFileSync(manual.absPath, 'utf8'), '用户原文')
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('previousNotePath 不能在没有目标身份时覆盖无身份同名笔记', async () => {
  const vault = await setup()
  try {
    const common = { vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '手写文件' }
    const manual = await writeVideoNote({ ...common, content: '用户原始手写内容' })
    const unknown = await writeVideoNote({
      ...common,
      previousNotePath: manual.relPath,
      force: true,
      content: '新的未知身份内容',
    })
    assert.notEqual(unknown.relPath, manual.relPath)
    assert.equal(readFileSync(manual.absPath, 'utf8'), '用户原始手写内容')
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('subject manual preserves user content', async () => {
  const vault = await setup()
  try {
    const first = await updateSubjectManual({
      vaultPath: vault,
      noteRoot: '视频笔记',
      subject: '机器学习',
      videos: [{ title: 'A', notePath: '视频笔记/机器学习/A', summary: 'a', createdAt: Date.now() }],
    })
    const original = readFileSync(first.absPath, 'utf8') + '\nUSER CONTENT\n'
    writeFileSync(first.absPath, original, 'utf8')
    await updateSubjectManual({
      vaultPath: vault,
      noteRoot: '视频笔记',
      subject: '机器学习',
      videos: [
        { title: 'A', notePath: '视频笔记/机器学习/A', summary: 'a', createdAt: Date.now() },
        { title: 'B', notePath: '视频笔记/机器学习/B', summary: 'b', createdAt: Date.now() },
      ],
    })
    const updated = readFileSync(first.absPath, 'utf8')
    assert.ok(updated.includes('USER CONTENT'))
    assert.ok(updated.includes('[[视频笔记/机器学习/B|B]]'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('overview is created', async () => {
  const vault = await setup()
  try {
    const out = await updateOverview({ vaultPath: vault, noteRoot: '视频笔记', subjects: ['机器学习'] })
    assert.ok(readFileSync(out.absPath, 'utf8').includes('机器学习'))
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})

test('笔记相对路径不能通过 .. 访问 vault 外部', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'seen-path-'))
  const vault = join(parent, 'vault')
  const outside = join(parent, 'outside.md')
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记' })
    writeFileSync(outside, '---\ntags: ["原文"]\n---\n不能改写', 'utf8')
    await assert.rejects(async () => readVaultText({ vaultPath: vault, relPath: '../outside.md' }), /路径/)
    await assert.rejects(async () => updateNoteTags({ vaultPath: vault, notePath: '../outside.md', tags: ['修改'] }), /路径/)
    assert.match(readFileSync(outside, 'utf8'), /不能改写/)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('不同笔记的同名字幕及归属不明的旧存档不会被覆盖', async () => {
  const vault = await setup()
  try {
    const common = { vaultPath: vault, noteRoot: '视频笔记', noteName: '同名视频' }
    const ownerA = '视频笔记/笔记/学科甲/同名视频.md'
    const ownerB = '视频笔记/笔记/学科乙/同名视频.md'
    const archive = (owner, transcript) => renderTranscriptNote({ title: '同名视频', notePath: owner, transcript })
    const first = await writeTranscriptNote({ ...common, content: archive(ownerA, '甲的原文') })
    const second = await writeTranscriptNote({ ...common, content: archive(ownerB, '乙的原文') })
    assert.notEqual(first.relPath, second.relPath)
    const updated = await writeTranscriptNote({ ...common, content: archive(ownerB, '乙的更新') })
    assert.equal(updated.relPath, second.relPath)
    assert.match(readFileSync(first.absPath, 'utf8'), /甲的原文/)
    assert.match(readFileSync(second.absPath, 'utf8'), /乙的更新/)

    const legacy = await writeTranscriptNote({ ...common, noteName: '旧存档', content: '旧存档没有所属路径' })
    const fresh = await writeTranscriptNote({ ...common, noteName: '旧存档', content: archive(ownerA, '新的原文') })
    assert.notEqual(legacy.relPath, fresh.relPath)
    assert.equal(readFileSync(legacy.absPath, 'utf8'), '旧存档没有所属路径')
  } finally {
    rmSync(vault, { recursive: true, force: true })
  }
})
