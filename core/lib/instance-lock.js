import { mkdirSync, statSync, renameSync, readFileSync, writeFileSync, unlinkSync, linkSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const LOCK_EMPTY_STALE_MS = 10 * 1000

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function inspectInstanceLock(lockPath) {
  try {
    const stat = statSync(lockPath)
    if (stat.isDirectory()) {
      const ownerName = (readdirSync(lockPath) || []).find((name) => String(name).startsWith('owner-')) || ''
      let text = ''
      if (ownerName) {
        try { text = readFileSync(join(lockPath, ownerName), 'utf8').trim() } catch { /* 目录可能刚被替换 */ }
      }
      const pid = Number(text)
      return {
        exists: true,
        kind: 'dir',
        ownerName,
        text,
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        ino: stat.ino,
        dev: stat.dev,
        mtimeMs: stat.mtimeMs,
      }
    }
    const text = readFileSync(lockPath, 'utf8').trim()
    const pid = Number(text)
    return {
      exists: true,
      kind: 'file',
      text,
      pid: Number.isInteger(pid) && pid > 0 ? pid : null,
      ino: stat.ino,
      dev: stat.dev,
      mtimeMs: stat.mtimeMs,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    return { exists: false, error }
  }
}

function createInstanceLock(lockPath) {
  const suffix = process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8)
  const tmpDir = lockPath + '.tmp.' + suffix
  const ownerName = 'owner-' + suffix
  try {
    // 目录锁：owner 文件先写完整，再把整个目录原子改名为正式锁目录。
    // 这样锁出现时一定带有 owner，不存在「空锁窗口」。
    mkdirSync(tmpDir, { recursive: false, mode: 0o700 })
    writeFileSync(join(tmpDir, ownerName), String(process.pid), { encoding: 'utf8', mode: 0o600 })
    try {
      renameSync(tmpDir, lockPath)
    } catch (error) {
      // 目标目录为空时 POSIX rename 可以替换；非空或文件则视为已占用。
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY' && error?.code !== 'EISDIR' && error?.code !== 'ENOTDIR') throw error
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
      return { ok: false, code: 'EEXIST' }
    }
    return { ok: true }
  } catch (error) {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    if (error?.code === 'EEXIST') return { ok: false, code: 'EEXIST' }
    return { ok: false, reason: 'lock-write-failed', error }
  }
}

function removeStaleInstanceLock(lockPath, expected) {
  // 新版本锁是目录：只删除目录里自己的唯一 owner 文件，再 rmdir。
  // 新锁的 owner 文件名带随机后缀，误删新锁 owner 的概率可忽略；
  // 且 rmdir 在非空目录上会失败，不会删掉刚创建的新锁目录。
  if (expected.kind === 'dir') {
    try {
      const current = statSync(lockPath)
      if (current.ino !== expected.ino || current.dev !== expected.dev) return true
      if (!expected.ownerName) {
        if (readdirSync(lockPath).length > 0) return false
        rmdirSync(lockPath)
        return true
      }
      const ownerFile = join(lockPath, expected.ownerName)
      let ownerText = ''
      try { ownerText = readFileSync(ownerFile, 'utf8').trim() } catch (error) {
        if (error?.code === 'ENOENT') return true
        return false
      }
      if (Number(ownerText) !== expected.pid) return false
      unlinkSync(ownerFile)
      if (readdirSync(lockPath).length > 0) return false
      rmdirSync(lockPath)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return true
      if (error?.code === 'ENOTEMPTY') return false
      return false
    }
  }

  // 旧版文件锁：保留硬链接 inode 快照，至少避免误删已被替换的新文件锁。
  const suffix = process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8)
  const stalePath = lockPath + '.stale.' + suffix
  try {
    linkSync(lockPath, stalePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  }
  try {
    const snapshot = statSync(stalePath)
    if (snapshot.ino !== expected.ino || snapshot.dev !== expected.dev) return true
    const current = inspectInstanceLock(lockPath)
    if (!current.exists || current.ino !== expected.ino || current.dev !== expected.dev) return true
    unlinkSync(lockPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  } finally {
    try { unlinkSync(stalePath) } catch { /* 忽略 */ }
  }
}

export { LOCK_EMPTY_STALE_MS, inspectInstanceLock, createInstanceLock, removeStaleInstanceLock, acquireInstanceLock, releaseInstanceLock }

function releaseInstanceLock(lockPath) {
  const owner = inspectInstanceLock(lockPath)
  if (!owner.exists || owner.pid !== process.pid) return false
  return removeStaleInstanceLock(lockPath, owner)
}

function acquireInstanceLock(lockPath) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const created = createInstanceLock(lockPath)
    if (created.ok) return created
    if (created.code !== 'EEXIST') return { ok: false, reason: created.reason || 'lock-write-failed' }

    const owner = inspectInstanceLock(lockPath)
    if (!owner.exists) continue
    if (owner.pid === process.pid) return { ok: false, reason: 'locked-by-other' }
    if (owner.pid !== null) {
      if (pidIsAlive(owner.pid)) return { ok: false, reason: 'locked-by-other' }
    } else if (Date.now() - owner.mtimeMs < LOCK_EMPTY_STALE_MS) {
      // 空/损坏锁刚出现，可能是另一个进程正在落盘，先按占用处理，避免误删。
      return { ok: false, reason: 'locked-by-other' }
    }

    if (!removeStaleInstanceLock(lockPath, owner)) return { ok: false, reason: 'lock-stale-unlink-failed' }
  }
  return { ok: false, reason: 'lock-write-failed' }
}

/** 在与服务相同的状态目录上独占执行写入型维护。 */
export async function withInstanceLock(stateDir, task) {
  mkdirSync(stateDir, { recursive: true })
  const lockPath = join(stateDir, 'instance.lock')
  const lock = acquireInstanceLock(lockPath)
  if (!lock.ok) {
    const message = lock.reason === 'locked-by-other'
      ? 'Seen 服务或其他维护命令正在使用此状态目录，请退出持锁的 Seen 或等待维护结束后再试'
      : '无法取得 Seen 实例锁，请检查状态目录权限'
    throw Object.assign(new Error(message), { code: lock.reason })
  }
  let timedOut = false
  try {
    return await task()
  } catch (error) {
    timedOut = Boolean(error?.vaultBlocked && error.code === 'timeout')
    throw error
  } finally {
    // 超时可能仍有底层 IO 未结束。进程退出后由下一位写入者回收旧锁。
    if (!timedOut) releaseInstanceLock(lockPath)
  }
}
