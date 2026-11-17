import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runVaultTask, setVaultGuard, setVaultTimeout } from '../lib/obsidian.js'
import {
  VAULT_HINT,
  VaultBlockedError,
  createVaultGuard,
  createVaultQueue,
  probeVaultAccess,
  withVaultTimeout,
} from '../lib/vault-access.js'

test('probeVaultAccess reports ok for an existing directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-probe-'))
  try {
    const result = await probeVaultAccess(dir)
    assert.equal(result.ok, true)
    assert.equal(result.code, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('probeVaultAccess reports missing for a nonexistent path', async () => {
  const result = await probeVaultAccess('/tmp/seen-definitely-not-here-' + Date.now())
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing')
})

test('guard blocks access and exposes the hint', () => {
  const guard = createVaultGuard({ initial: { ok: false, code: 'denied' } })
  const status = guard.status()
  assert.equal(status.ok, false)
  assert.equal(status.blocked, true)
  assert.equal(status.hint, VAULT_HINT)
  assert.throws(() => guard.ensure(), (error) => error instanceof VaultBlockedError && error.code === 'denied')
  guard.apply({ ok: true })
  assert.equal(guard.isBlocked(), false)
  assert.doesNotThrow(() => guard.ensure())
})

test('guard notifies subscribers on state changes', () => {
  const guard = createVaultGuard()
  const seen = []
  const off = guard.onChange((status) => seen.push(status.code))
  guard.noteBlocked('timeout', '太慢了')
  assert.deepEqual(seen, ['timeout'])
  guard.noteOk()
  assert.deepEqual(seen, ['timeout', 'ok'])
  off()
  guard.noteBlocked('error', '')
  assert.equal(seen.length, 2)
})

test('withVaultTimeout trips the breaker when the task hangs', async () => {
  const guard = createVaultGuard()
  const pending = new Promise(() => {})
  await assert.rejects(
    withVaultTimeout(pending, 30, guard),
    (error) => error instanceof VaultBlockedError && error.code === 'timeout',
  )
  assert.equal(guard.status().code, 'timeout')
})

test('createVaultQueue runs tasks one at a time', async () => {
  const queue = createVaultQueue()
  const order = []
  const first = queue.run(async () => {
    order.push('first-start')
    await new Promise((resolve) => setTimeout(resolve, 20))
    order.push('first-end')
    return 1
  })
  const second = queue.run(async () => {
    order.push('second-start')
    return 2
  })
  assert.equal(await first, 1)
  assert.equal(await second, 2)
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start'])
})

test('vault 熔断后已经排队的操作不会继续执行', async () => {
  const guard = createVaultGuard()
  setVaultGuard(guard)
  setVaultTimeout(20)
  let secondStarted = false
  try {
    const first = runVaultTask(() => new Promise(resolve => setTimeout(resolve, 60)))
    const second = runVaultTask(() => { secondStarted = true })
    const results = await Promise.allSettled([first, second])
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[1].status, 'rejected')
    assert.equal(secondStarted, false)
    assert.equal(guard.status().code, 'timeout')
  } finally {
    await new Promise(resolve => setTimeout(resolve, 65))
    setVaultGuard(null)
    setVaultTimeout(10000)
  }
})
