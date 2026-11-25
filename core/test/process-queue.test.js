import test from 'node:test'
import assert from 'node:assert/strict'
import { createProcessQueue } from '../lib/process-queue.js'

function gate() {
  let open
  const promise = new Promise((resolve) => { open = resolve })
  return { promise, open }
}

test('process queue 串行执行，保持入队顺序', async () => {
  const seen = []
  const queue = createProcessQueue({
    run: async (item) => {
      seen.push(item)
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
  })
  queue.push('a')
  queue.push('b')
  queue.push('c')
  await queue.whenIdle()
  assert.deepEqual(seen, ['a', 'b', 'c'])
})

test('process queue 对排队中和运行中的 key 去重', async () => {
  const blocker = gate()
  const seen = []
  const queue = createProcessQueue({
    keyOf: (item) => item.key,
    run: async (item) => {
      seen.push(item.key)
      await blocker.promise
    },
  })
  queue.push({ key: 'a' })
  const duplicateActive = queue.push({ key: 'a' })
  assert.equal(duplicateActive.ok, false)
  assert.equal(duplicateActive.duplicate, true)
  queue.push({ key: 'b' })
  const duplicatePending = queue.push({ key: 'b' })
  assert.equal(duplicatePending.duplicate, true)
  blocker.open()
  await queue.whenIdle()
  assert.deepEqual(seen, ['a', 'b'])
})

test('process queue 单个任务失败不阻断后续任务', async () => {
  const errors = []
  const seen = []
  const queue = createProcessQueue({
    run: async (item) => {
      seen.push(item)
      if (item === 'bad') throw new Error('boom')
    },
    onError: (error, item) => errors.push(item + ':' + error.message),
  })
  queue.push('bad')
  queue.push('good')
  await queue.whenIdle()
  assert.deepEqual(seen, ['bad', 'good'])
  assert.deepEqual(errors, ['bad:boom'])
})

test('process queue clear 只清空等待项并返回数量', async () => {
  const blocker = gate()
  const seen = []
  const queue = createProcessQueue({
    run: async (item) => {
      seen.push(item)
      await blocker.promise
    },
  })
  queue.push('active')
  queue.push('waiting-1')
  queue.push('waiting-2')
  assert.equal(queue.size(), 3)
  assert.equal(queue.clear(), 2)
  assert.equal(queue.size(), 1)
  blocker.open()
  await queue.whenIdle()
  assert.deepEqual(seen, ['active'])
})

test('process queue 达到上限时拒绝新任务', async () => {
  const blocker = gate()
  const queue = createProcessQueue({
    maxPending: 1,
    run: async () => { await blocker.promise },
  })
  queue.push('active')
  const queued = queue.push('waiting')
  assert.equal(queued.ok, true)
  const full = queue.push('overflow')
  assert.equal(full.ok, false)
  assert.equal(full.full, true)
  blocker.open()
  await queue.whenIdle()
})

test('process queue whenIdle 等待全部任务结束', async () => {
  let finished = 0
  const queue = createProcessQueue({
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      finished += 1
    },
  })
  queue.push(1)
  queue.push(2)
  await queue.whenIdle()
  assert.equal(finished, 2)
})

test('轮询与手动操作按提交顺序执行，停止轮询保留手动请求', async () => {
  const blocker = gate()
  const seen = []
  const queue = createProcessQueue({
    keyOf: item => item,
    maxPending: 2,
    run: async item => {
      seen.push(item)
      await blocker.promise
      return { ok: true, item }
    },
  })
  queue.push('active')
  const manual = queue.submit('manual')
  queue.push('auto')
  assert.equal((await queue.submit('overflow')).code, 'queue-full')
  assert.equal(queue.clear({ automaticOnly: true }), 1)
  assert.equal(queue.push('manual').duplicate, true)
  blocker.open()
  assert.deepEqual(await manual, { ok: true, item: 'manual' })
  await queue.whenIdle()
  assert.deepEqual(seen, ['active', 'manual'])
})

test('显式请求可重复提交，取消和处理异常均会通知等待者', async () => {
  const blocker = gate()
  const queue = createProcessQueue({
    keyOf: item => item,
    run: async item => {
      if (item === 'error') throw new Error('示例错误')
      await blocker.promise
      return item
    },
  })
  const first = queue.submit('a')
  const same = queue.submit('a')
  assert.equal(queue.clear(), 1)
  assert.equal((await same).code, 'cancelled')
  const error = queue.submit('error')
  const last = queue.submit('last')
  blocker.open()
  assert.equal(await first, 'a')
  await assert.rejects(error, /示例错误/)
  assert.equal(await last, 'last')
})
