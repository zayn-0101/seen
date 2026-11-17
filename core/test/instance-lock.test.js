import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOCK_EMPTY_STALE_MS,
  acquireInstanceLock,
  createInstanceLock,
  inspectInstanceLock,
  releaseInstanceLock,
  removeStaleInstanceLock,
} from '../lib/index.js'

function tempLock() {
  const dir = mkdtempSync(join(tmpdir(), 'seen-lock-'))
  return { dir, lock: join(dir, 'instance.lock') }
}

test('createInstanceLock 并发创建时只有一个成功且写入完整 PID', async () => {
  const { dir, lock } = tempLock()
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => createInstanceLock(lock))))
    assert.equal(results.filter((item) => item.ok).length, 1)
    assert.equal(inspectInstanceLock(lock).pid, process.pid)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('空锁刚出现时按占用处理，不误删', async () => {
  const { dir, lock } = tempLock()
  try {
    writeFileSync(lock, '')
    const result = acquireInstanceLock(lock)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'locked-by-other')
    assert.equal(inspectInstanceLock(lock).exists, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('超过阈值的空锁会被清理并重新获取', async () => {
  const { dir, lock } = tempLock()
  try {
    writeFileSync(lock, '')
    const old = new Date(Date.now() - LOCK_EMPTY_STALE_MS - 2000)
    utimesSync(lock, old, old)
    const result = acquireInstanceLock(lock)
    assert.equal(result.ok, true)
    assert.equal(inspectInstanceLock(lock).pid, process.pid)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('持有者 PID 已退出时清理陈旧锁', async () => {
  const { dir, lock } = tempLock()
  try {
    writeFileSync(lock, '99999999')
    const result = acquireInstanceLock(lock)
    assert.equal(result.ok, true)
    assert.equal(inspectInstanceLock(lock).pid, process.pid)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同进程重复获取视为已被占用，不删除自己的锁', async () => {
  const { dir, lock } = tempLock()
  try {
    assert.equal(acquireInstanceLock(lock).ok, true)
    const again = acquireInstanceLock(lock)
    assert.equal(again.ok, false)
    assert.equal(again.reason, 'locked-by-other')
    assert.equal(inspectInstanceLock(lock).pid, process.pid)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('释放自己持有的目录锁后可以重新获取', () => {
  const { dir, lock } = tempLock()
  try {
    assert.equal(acquireInstanceLock(lock).ok, true)
    assert.equal(releaseInstanceLock(lock), true)
    assert.equal(inspectInstanceLock(lock).exists, false)
    assert.equal(acquireInstanceLock(lock).ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('清理陈旧锁前核对 inode，不误删刚被替换的新锁', async () => {
  const { dir, lock } = tempLock()
  try {
    writeFileSync(lock, '11111111')
    const stale = inspectInstanceLock(lock)
    unlinkSync(lock)
    writeFileSync(lock, '22222222')
    assert.equal(removeStaleInstanceLock(lock, stale), true)
    assert.equal(readFileSync(lock, 'utf8'), '22222222')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('多个进程同时抢陈旧锁时只有一个成功', async () => {
  const { dir, lock } = tempLock()
  const moduleUrl = new URL('../lib/index.js', import.meta.url).href
  const worker = `
import { acquireInstanceLock } from ${JSON.stringify(moduleUrl)}
const result = acquireInstanceLock(process.env.SEEN_TEST_LOCK)
if (result.ok) {
  console.log('OK')
  await new Promise((resolve) => setTimeout(resolve, 1500))
} else {
  console.log('NO:' + (result.reason || result.code))
}
`
  mkdirSync(lock)
  writeFileSync(join(lock, 'owner-99999999.1.stale'), '99999999')
  const children = Array.from({ length: 8 }, () => spawn(process.execPath, ['--input-type=module', '-e', worker], {
    env: { ...process.env, SEEN_TEST_LOCK: lock },
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  try {
    const results = await Promise.all(children.map((child) => new Promise((resolve) => {
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }))
    })))
    assert.deepEqual(results.filter((item) => item.code !== 0), [], '子进程应正常退出')
    assert.equal(results.filter((item) => item.out === 'OK').length, 1, results.map((item) => item.out || item.err).join(' | '))
  } finally {
    await Promise.all(children.map((child) => child.exitCode === null ? new Promise((resolve) => child.once('close', resolve)) : Promise.resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
