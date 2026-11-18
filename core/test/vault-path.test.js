import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  safeCopyFile, safeCopyToExternal, safeLstat, safeReadFile, safeReaddir, safeStat, safeUnlink, safeWriteFile,
} from '../lib/vault-path.js'
import { ensureVaultDirs, readTranscriptNote, writeTranscriptNote, writeVideoNote } from '../lib/obsidian.js'
import { listMarkdownFiles } from '../lib/vault-search.js'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'seen-vault-path-'))
  const vault = join(base, 'vault')
  mkdirSync(vault)
  return { base, vault, outside: join(base, 'outside') }
}

test('读取目录符号链接指向 vault 外部时拒绝', async () => {
  const { base, vault, outside } = setup()
  try {
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.md'), 'SECRET')
    mkdirSync(join(vault, '视频笔记'))
    symlinkSync(outside, join(vault, '视频笔记', '笔记'), 'dir')
    await assert.rejects(() => safeReadFile({ vaultPath: vault, relPath: '视频笔记/笔记/secret.md' }), { code: 'vault-path-escape' })
    await assert.rejects(() => safeReaddir({ vaultPath: vault, relPath: '视频笔记/笔记' }), { code: 'vault-path-escape' })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('文件符号链接指向 vault 外部时读取拒绝、写入拒绝', async () => {
  const { base, vault, outside } = setup()
  try {
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.md'), 'SECRET')
    mkdirSync(join(vault, '视频笔记'))
    symlinkSync(join(outside, 'secret.md'), join(vault, '视频笔记', 'link.md'))
    await assert.rejects(() => safeReadFile({ vaultPath: vault, relPath: '视频笔记/link.md' }), { code: 'vault-path-escape' })
    await assert.rejects(() => safeWriteFile({ vaultPath: vault, relPath: '视频笔记/link.md', content: 'X' }), { code: 'vault-path-escape' })
    await assert.rejects(() => safeUnlink({ vaultPath: vault, relPath: '视频笔记/link.md' }), { code: 'vault-path-escape' })
    assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), 'SECRET')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('writeVideoNote 不会跟随学科目录符号链接写到 vault 外', async () => {
  const { base, vault, outside } = setup()
  try {
    mkdirSync(outside)
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    mkdirSync(join(vault, '视频笔记', '笔记'), { recursive: true })
    rmSync(join(vault, '视频笔记', '笔记', '示例'), { recursive: true, force: true })
    symlinkSync(outside, join(vault, '视频笔记', '笔记', '示例'), 'dir')
    await assert.rejects(() => writeVideoNote({ vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '逃逸测试', content: '---\nbvid: "BV1xxxxxxxxx"\n---\n内容' }), { code: 'vault-path-escape' })
    assert.equal(existsSync(join(outside, '逃逸测试.md')), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('vault 根和内部目录符号链接正常工作', async () => {
  const { base, vault } = setup()
  try {
    const rootLink = join(base, 'vault-link')
    symlinkSync(vault, rootLink, 'dir')
    await safeWriteFile({ vaultPath: rootLink, relPath: 'a/b.md', content: 'ok' })
    assert.equal(readFileSync(join(vault, 'a', 'b.md'), 'utf8'), 'ok')
    assert.equal(await safeReadFile({ vaultPath: rootLink, relPath: 'a/b.md' }), 'ok')

    mkdirSync(join(vault, 'real'))
    symlinkSync(join(vault, 'real'), join(vault, 'alias'), 'dir')
    await safeWriteFile({ vaultPath: vault, relPath: 'alias/c.md', content: 'internal' })
    assert.equal(readFileSync(join(vault, 'real', 'c.md'), 'utf8'), 'internal')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('失效符号链接返回明确错误', async () => {
  const { base, vault } = setup()
  try {
    symlinkSync(join(base, 'missing-target'), join(vault, 'broken.md'))
    await assert.rejects(() => safeReadFile({ vaultPath: vault, relPath: 'broken.md' }), { code: 'vault-path-broken-symlink' })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('safeCopyFile 目标父目录符号链接外指时拒绝', async () => {
  const { base, vault, outside } = setup()
  try {
    writeFileSync(join(vault, 'src.md'), 'SRC')
    mkdirSync(outside)
    symlinkSync(outside, join(vault, 'copy'), 'dir')
    await assert.rejects(() => safeCopyFile({ vaultPath: vault, fromRelPath: 'src.md', toRelPath: 'copy/dst.md' }), { code: 'vault-path-escape' })
    assert.equal(readdirSync(outside).length, 0)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('backupDir 为空时强制重生成备份留在 vault 内', async () => {
  const { base, vault } = setup()
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    const common = { vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '备份测试', source: 'bilibili', bvid: 'BV1backup001' }
    await writeVideoNote({ ...common, content: '---\nbvid: "BV1backup001"\n---\n旧' })
    await writeVideoNote({ ...common, force: true, content: '---\nbvid: "BV1backup001"\n---\n新' })
    const files = readdirSync(join(vault, '视频笔记', '笔记', '示例'))
    assert.ok(files.some((name) => name.startsWith('备份测试.md.bak-')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('backupDir 位于 vault 外时可写入并校验目录存在', async () => {
  const { base, vault, outside } = setup()
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    const backupDir = join(outside, 'backups')
    const common = { vaultPath: vault, noteRoot: '视频笔记', subject: '示例', title: '外部备份', source: 'bilibili', bvid: 'BV1backup002', backupDir }
    await writeVideoNote({ ...common, content: '---\nbvid: "BV1backup002"\n---\n旧' })
    await writeVideoNote({ ...common, force: true, content: '---\nbvid: "BV1backup002"\n---\n新' })
    const files = readdirSync(backupDir)
    assert.ok(files.some((name) => name.startsWith('外部备份.md.bak-')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('绝对路径一律拒绝且不会在 vault 内创建重定向文件', async () => {
  const { base, vault } = setup()
  try {
    await assert.rejects(() => safeReadFile({ vaultPath: vault, relPath: '/etc/passwd' }), { code: 'vault-path-invalid' })
    await assert.rejects(() => safeWriteFile({ vaultPath: vault, relPath: '/tmp/abs.md', content: 'X' }), { code: 'vault-path-invalid' })
    await assert.rejects(() => safeReaddir({ vaultPath: vault, relPath: '/tmp' }), { code: 'vault-path-invalid' })
    assert.equal(existsSync(join(vault, 'tmp')), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('外部备份目标为符号链接或失效符号链接时拒绝写入', async () => {
  const { base, vault, outside } = setup()
  try {
    writeFileSync(join(vault, 'src.md'), 'SRC')
    mkdirSync(join(outside, 'backups'), { recursive: true })
    writeFileSync(join(outside, 'target.md'), 'ORIGINAL')
    symlinkSync(join(outside, 'target.md'), join(outside, 'backups', 'link.md'))
    await assert.rejects(() => safeCopyToExternal({ vaultPath: vault, relPath: 'src.md', root: join(outside, 'backups'), destRelPath: 'link.md' }), { code: 'vault-path-symlink' })
    symlinkSync(join(outside, 'missing.md'), join(outside, 'backups', 'broken.md'))
    await assert.rejects(() => safeCopyToExternal({ vaultPath: vault, relPath: 'src.md', root: join(outside, 'backups'), destRelPath: 'broken.md' }), { code: 'vault-path-symlink' })
    assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), 'ORIGINAL')
    await safeCopyToExternal({ vaultPath: vault, relPath: 'src.md', root: join(outside, 'backups'), destRelPath: 'plain.md' })
    assert.equal(readFileSync(join(outside, 'backups', 'plain.md'), 'utf8'), 'SRC')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('safeLstat 不存在的路径不会创建父目录', async () => {
  const { base, vault } = setup()
  try {
    await assert.rejects(() => safeLstat({ vaultPath: vault, relPath: 'no/such/file.md' }), { code: 'ENOENT' })
    assert.equal(existsSync(join(vault, 'no')), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('listMarkdownFiles 只返回 noteRoot 内的文件', async () => {
  const { base, vault } = setup()
  try {
    mkdirSync(join(vault, '视频笔记', '笔记', '学科'), { recursive: true })
    writeFileSync(join(vault, '视频笔记', '笔记', '学科', 'a.md'), '# A')
    mkdirSync(join(vault, '资料'), { recursive: true })
    writeFileSync(join(vault, '资料', 'outside.md'), '# OUT')
    const files = await listMarkdownFiles({ vaultPath: vault, noteRoot: '视频笔记' })
    assert.deepEqual(files.map((file) => file.slice(vault.length + 1)), ['视频笔记/笔记/学科/a.md'])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('readTranscriptNote 按 owner 返回 base 或副本，无主存档需显式允许', async () => {
  const { base, vault } = setup()
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    const noteRoot = '视频笔记'
    const noteName = '归属测试'
    await writeTranscriptNote({ vaultPath: vault, noteRoot, noteName, content: '---\nnotePath: "视频笔记/笔记/示例/归属测试.md"\n---\n字幕 A' })
    await writeTranscriptNote({ vaultPath: vault, noteRoot, noteName, content: '---\nnotePath: "视频笔记/笔记/示例/归属测试 (BV1ccccccccc).md"\n---\n字幕 B' })
    assert.match(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName, owner: '视频笔记/笔记/示例/归属测试.md' }), /字幕 A/)
    assert.match(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName, owner: '视频笔记/笔记/示例/归属测试 (BV1ccccccccc).md' }), /字幕 B/)
    assert.equal(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName }), null)
    assert.match(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName, allowUnowned: true }), /字幕 A/)
    const legacyName = '无主存档'
    await writeTranscriptNote({ vaultPath: vault, noteRoot, noteName: legacyName, content: '---\nsource: "bilibili"\n---\n旧存档' })
    assert.equal(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName: legacyName }), null)
    assert.match(await readTranscriptNote({ vaultPath: vault, noteRoot, noteName: legacyName, allowUnowned: true }), /旧存档/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('readTranscriptNote 会找到同一笔记的 (字幕-hash) 副本', async () => {
  const { base, vault } = setup()
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    const noteRoot = '视频笔记'
    const noteName = '同名视频'
    await writeTranscriptNote({ vaultPath: vault, noteRoot, noteName, content: '---\nnotePath: "视频笔记/笔记/示例/同名视频.md"\nsource: "bilibili"\n---\n字幕 A' })
    await writeTranscriptNote({ vaultPath: vault, noteRoot, noteName, content: '---\nnotePath: "视频笔记/笔记/示例/同名视频 (BV1bbbbbbbbb).md"\nsource: "bilibili"\n---\n字幕 B' })
    const hit = await readTranscriptNote({ vaultPath: vault, noteRoot, noteName, owner: '视频笔记/笔记/示例/同名视频 (BV1bbbbbbbbb).md' })
    assert.match(hit, /字幕 B/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('vault 路径中的中间符号链接指向外部时拒绝创建', async () => {
  const base = mkdtempSync(join(tmpdir(), 'seen-vault-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'seen-vault-outside-'))
  try {
    symlinkSync(outside, join(base, 'link'))
    await assert.rejects(
      ensureVaultDirs({ vaultPath: join(base, 'link', 'vault'), noteRoot: '视频笔记', stateDir: null }),
      /符号链接指向了外部/,
    )
    assert.equal(existsSync(join(outside, 'vault')), false)
  } finally {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('旧 字幕/ 目录的存档仍可只读读取', async () => {
  const { base, vault } = setup()
  try {
    await ensureVaultDirs({ vaultPath: vault, noteRoot: '视频笔记', stateDir: null })
    const legacyDir = join(vault, '视频笔记', '字幕')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, '旧视频.md'), '---\nnotePath: "视频笔记/笔记/示例/旧视频.md"\n---\n旧字幕内容')
    const hit = await readTranscriptNote({ vaultPath: vault, noteRoot: '视频笔记', noteName: '旧视频', owner: '视频笔记/笔记/示例/旧视频.md' })
    assert.match(hit, /旧字幕内容/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
