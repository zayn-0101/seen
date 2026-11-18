/**
 * seen-core · vault 路径安全
 *
 * vault 内路径先做词法校验，再对「最深的已存在祖先」做 realpath，
 * 确保真实路径仍在 vault 根内。写操作拒绝最终项为符号链接；
 * 读操作允许指向 vault 内部的符号链接，拒绝指向外部。
 *
 * 边界：只处理符号链接，不处理硬链接；不宣称完全隔离。
 */

import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export class VaultPathError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'VaultPathError'
    this.code = code
  }
}

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/')
}

function splitRel(relPath) {
  const raw = toPosix(relPath)
  if (/^\//.test(raw) || /^[A-Za-z]:\//.test(raw)) throw new VaultPathError('vault-path-invalid', '路径必须是 vault 内的相对路径：' + raw)
  const text = raw.replace(/\/+$/, '')
  if (!text) return []
  const parts = text.split('/')
  if (parts.some((part) => part === '..')) throw new VaultPathError('vault-path-invalid', '笔记路径不能包含 .. 路径段')
  return parts.filter((part) => part && part !== '.')
}

function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

async function lstatOrNull(file) {
  try {
    return await lstat(file)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

async function realRoot(vaultPath) {
  const root = resolve(String(vaultPath || ''))
  try {
    return await realpath(root)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new VaultPathError('vault-path-missing', 'vault 目录不存在：' + root)
    throw error
  }
}

/**
 * 解析 vault 内路径，返回可安全操作的绝对路径。
 * @param {{ vaultPath: string, relPath: string, forWrite?: boolean }} options
 */
export async function resolveVaultPath({ vaultPath, relPath, forWrite = false } = {}) {
  const parts = splitRel(relPath)
  const root = await realRoot(vaultPath)
  const lexical = resolve(root, ...parts)
  if (!isInside(root, lexical)) throw new VaultPathError('vault-path-escape', '笔记路径必须位于 vault 内')

  // 从目标向上找最深的已存在组件；所有缺失组件排成待检查的相对段。
  let probe = lexical
  let info = null
  const missing = []
  // 根存在是 realRoot 的前提；最多走到根。
  for (;;) {
    info = await lstatOrNull(probe)
    if (info) break
    if (probe === root) break
    missing.unshift(basename(probe))
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  let resolvedProbe
  try {
    resolvedProbe = await realpath(probe)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new VaultPathError('vault-path-broken-symlink', '路径包含失效的符号链接：' + toPosix(relPath))
    throw error
  }
  if (!isInside(root, resolvedProbe)) throw new VaultPathError('vault-path-escape', '路径指向 vault 外部：' + toPosix(relPath))

  let target = missing.length ? resolve(resolvedProbe, ...missing) : resolve(resolvedProbe)
  if (!isInside(root, target)) throw new VaultPathError('vault-path-escape', '路径指向 vault 外部：' + toPosix(relPath))

  if (!missing.length && info?.isSymbolicLink()) {
    let finalReal
    try {
      finalReal = await realpath(target)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultPathError('vault-path-broken-symlink', '符号链接已失效：' + toPosix(relPath))
      throw error
    }
    if (!isInside(root, finalReal)) throw new VaultPathError('vault-path-escape', '符号链接指向 vault 外部：' + toPosix(relPath))
    if (forWrite) throw new VaultPathError('vault-path-symlink', '不允许写入符号链接：' + toPosix(relPath))
    return finalReal
  }
  return target
}

/** 逐级创建 vault 内的目录，遇到符号链接先核对真实路径，禁止跨出 vault。 */
export async function ensureVaultDir({ vaultPath, relDir } = {}) {
  const root = await realRoot(vaultPath)
  let current = root
  for (const part of splitRel(relDir)) {
    const next = join(current, part)
    const info = await lstatOrNull(next)
    if (!info) {
      await mkdir(next)
      current = next
      continue
    }
    if (info.isSymbolicLink()) {
      const real = await realpath(next)
      if (!isInside(root, real)) throw new VaultPathError('vault-path-escape', '目录符号链接指向 vault 外部：' + part)
      current = real
      continue
    }
    if (!info.isDirectory()) throw new VaultPathError('vault-path-invalid', '路径不是目录：' + part)
    current = next
  }
  return current
}

/** 安全创建 vault 根（允许根自身是符号链接，也允许根不存在）。 */
export async function ensureVaultRoot(vaultPath) {
  if (!vaultPath) throw new Error('缺少 vaultPath')
  const root = resolve(String(vaultPath))
  // 逐级创建，避免 mkdir({recursive:true}) 跨过未校验的中间符号链接。
  // 根自身是符号链接时允许（vault 可放在链接目录里）；中间符号链接不得逃出它自己的父目录。
  const parsed = parse(root)
  const parts = root.slice(parsed.root.length).split(sep).filter(Boolean)
  let current = parsed.root
  for (let index = 0; index < parts.length; index += 1) {
    const next = join(current, parts[index])
    const final = index === parts.length - 1
    const info = await lstatOrNull(next)
    if (!info) {
      await mkdir(next)
      current = next
      continue
    }
    if (info.isSymbolicLink()) {
      const real = await realpath(next)
      if (!final && !isInside(await realpath(dirname(next)), real)) {
        throw new VaultPathError('vault-path-escape', 'vault 路径中的目录符号链接指向了外部：' + next)
      }
      current = next
      continue
    }
    if (!info.isDirectory()) throw new VaultPathError('vault-path-invalid', 'vault 路径不是目录：' + next)
    current = next
  }
  return realpath(root)
}

/** 安全读取 vault 内的文本文件。 */
export async function safeReadFile({ vaultPath, relPath } = {}) {
  const file = await resolveVaultPath({ vaultPath, relPath, forWrite: false })
  return readFile(file, 'utf8')
}

/** 安全写入 vault 内的文本文件（父目录逐级校验后创建）。 */
export async function safeWriteFile({ vaultPath, relPath, content } = {}) {
  const parts = splitRel(relPath)
  if (!parts.length) throw new VaultPathError('vault-path-invalid', '缺少文件路径')
  await ensureVaultDir({ vaultPath, relDir: parts.slice(0, -1).join('/') })
  const file = await resolveVaultPath({ vaultPath, relPath, forWrite: true })
  await writeFile(file, String(content ?? ''), 'utf8')
  return file
}

/** 安全读写目录（目录本身可在 vault 内是符号链接）。 */
export async function safeReaddir({ vaultPath, relPath } = {}) {
  const dir = await resolveVaultPath({ vaultPath, relPath, forWrite: false })
  return readdir(dir, { withFileTypes: true })
}

/** 安全 stat（跟随 vault 内部符号链接，外部拒绝）。 */
export async function safeStat({ vaultPath, relPath } = {}) {
  const file = await resolveVaultPath({ vaultPath, relPath, forWrite: false })
  return stat(file)
}

/** 安全 lstat（不跟随最终符号链接，但仍校验父级路径）。 */
export async function safeLstat({ vaultPath, relPath } = {}) {
  const parts = splitRel(relPath)
  if (!parts.length) throw new VaultPathError('vault-path-invalid', '缺少文件路径')
  const parent = await resolveVaultPath({ vaultPath, relPath: parts.slice(0, -1).join('/'), forWrite: false })
  const file = join(parent, parts[parts.length - 1])
  if (!isInside(await realRoot(vaultPath), file)) throw new VaultPathError('vault-path-escape', '路径指向 vault 外部：' + toPosix(relPath))
  return lstat(file)
}

/** 安全删除 vault 内文件；拒绝删除符号链接，避免歧义。 */
export async function safeUnlink({ vaultPath, relPath } = {}) {
  const file = await resolveVaultPath({ vaultPath, relPath, forWrite: true })
  return unlink(file)
}

/** 安全重命名 vault 内文件（源与目标都必须是普通路径，目标父目录安全创建）。 */
export async function safeRename({ vaultPath, fromRelPath, toRelPath } = {}) {
  const source = await resolveVaultPath({ vaultPath, relPath: fromRelPath, forWrite: true })
  const parts = splitRel(toRelPath)
  if (!parts.length) throw new VaultPathError('vault-path-invalid', '缺少目标路径')
  await ensureVaultDir({ vaultPath, relDir: parts.slice(0, -1).join('/') })
  const target = await resolveVaultPath({ vaultPath, relPath: toRelPath, forWrite: true })
  await rename(source, target)
  return target
}

/** 安全复制 vault 内文件。 */
export async function safeCopyFile({ vaultPath, fromRelPath, toRelPath } = {}) {
  const source = await resolveVaultPath({ vaultPath, relPath: fromRelPath, forWrite: false })
  const parts = splitRel(toRelPath)
  if (!parts.length) throw new VaultPathError('vault-path-invalid', '缺少目标路径')
  await ensureVaultDir({ vaultPath, relDir: parts.slice(0, -1).join('/') })
  const target = await resolveVaultPath({ vaultPath, relPath: toRelPath, forWrite: true })
  await copyFile(source, target)
  return target
}

/**
 * 解析并创建可信外部目录（备份根）中的目标路径。
 * backup root 由调用方配置，仍要求目标词法位于该根内。
 */
export async function resolveExternalPath({ root, relPath } = {}) {
  if (!root) throw new VaultPathError('vault-path-invalid', '缺少外部目录')
  const rootAbs = resolve(String(root))
  await mkdir(rootAbs, { recursive: true })
  const rootReal = await realpath(rootAbs)
  const parts = splitRel(relPath)
  const lexical = resolve(rootReal, ...parts)
  if (!isInside(rootReal, lexical)) throw new VaultPathError('vault-path-escape', '外部路径越界：' + toPosix(relPath))
  // 从目标向上找最深的已存在组件：缺失的每一段都保留，避免把目录当作目标。
  let probe = lexical
  const missing = []
  let info = null
  for (;;) {
    info = await lstatOrNull(probe)
    if (info) break
    if (probe === rootReal) break
    missing.unshift(basename(probe))
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  if (probe === lexical && info?.isSymbolicLink()) throw new VaultPathError('vault-path-symlink', '不允许写入外部符号链接：' + toPosix(relPath))
  let resolvedProbe
  try {
    resolvedProbe = await realpath(probe)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new VaultPathError('vault-path-broken-symlink', '外部路径包含失效的符号链接：' + toPosix(relPath))
    throw error
  }
  if (!isInside(rootReal, resolvedProbe)) throw new VaultPathError('vault-path-escape', '外部路径指向备份根之外：' + toPosix(relPath))
  const target = missing.length ? resolve(resolvedProbe, ...missing) : resolve(resolvedProbe)
  if (!isInside(rootReal, target)) throw new VaultPathError('vault-path-escape', '外部路径指向备份根之外：' + toPosix(relPath))
  const finalInfo = await lstatOrNull(target)
  if (finalInfo?.isSymbolicLink()) throw new VaultPathError('vault-path-symlink', '不允许写入外部符号链接：' + toPosix(relPath))
  return { root: rootReal, target }
}

/** 安全复制 vault 文件到外部备份根。 */
export async function safeCopyToExternal({ vaultPath, relPath, root, destRelPath } = {}) {
  const source = await resolveVaultPath({ vaultPath, relPath, forWrite: false })
  const { target } = await resolveExternalPath({ root, relPath: destRelPath })
  const finalInfo = await lstatOrNull(target)
  if (finalInfo?.isSymbolicLink()) throw new VaultPathError('vault-path-symlink', '不允许写入外部符号链接：' + toPosix(destRelPath))
  await copyFile(source, target)
  return target
}
