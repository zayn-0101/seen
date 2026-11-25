/**
 * seen-core · 串行处理队列
 *
 * 前台轮询不能因为一条视频正在转写就停摆：识别到第二条视频时先排队，
 * 等前一条处理完再按顺序处理。队列只保留待处理项，运行中的任务不重复入队。
 */

/**
 * @param {object} options
 * @param {(item: any) => Promise<any>} options.run 实际处理函数
 * @param {(item: any) => string} [options.keyOf] 去重键；空字符串表示不去重
 * @param {(error: any, item: any) => void} [options.onError] 单个任务失败时的回调
 * @param {number} [options.maxPending] 最多等待多少条，避免异常页面把内存堆满
 */
export function createProcessQueue({ run, keyOf = () => '', onError = () => {}, maxPending = 8 } = {}) {
  if (typeof run !== 'function') throw new Error('process queue 需要 run 函数')
  const limit = Math.max(1, Math.floor(Number(maxPending) || 8))
  const pending = []
  const idleWaiters = []
  let active = null
  let draining = false

  function keyFor(item) {
    try {
      return String(keyOf(item) || '')
    } catch {
      return ''
    }
  }

  function push(item) {
    const key = keyFor(item)
    if (key && (active?.key === key || pending.some(entry => entry.key === key))) {
      return { ok: false, duplicate: true, key, size: size() }
    }
    if (pending.length >= limit) return { ok: false, full: true, key, size: size() }
    pending.push({ item, key })
    void drain()
    return { ok: true, key, size: size() }
  }

  function submit(item) {
    if (pending.length >= limit) {
      return Promise.resolve({ ok: false, code: 'queue-full', message: '等待整理的视频已满，请稍后再试' })
    }
    return new Promise((resolve, reject) => {
      pending.push({ item, key: keyFor(item), resolve, reject })
      void drain()
    })
  }

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (pending.length) {
        active = pending.shift()
        // 先让调用方收到入队结果并发布发现事件，再开始处理。
        await Promise.resolve()
        try {
          const result = await run(active.item)
          active.resolve?.(result)
        } catch (error) {
          active.reject?.(error)
          try { onError(error, active.item) } catch { /* 日志回调失败时继续处理 */ }
        } finally {
          active = null
        }
      }
    } finally {
      draining = false
      for (const resolve of idleWaiters.splice(0)) resolve()
    }
  }

  function clear({ automaticOnly = false } = {}) {
    let cleared = 0
    for (let i = pending.length - 1; i >= 0; i--) {
      const entry = pending[i]
      if (automaticOnly && entry.resolve) continue
      pending.splice(i, 1)
      entry.resolve?.({ ok: false, code: 'cancelled', message: '整理任务已取消' })
      cleared++
    }
    return cleared
  }

  function size() {
    return pending.length + (active ? 1 : 0)
  }

  function whenIdle() {
    return draining ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve()
  }

  return { push, submit, clear, size, whenIdle }
}
