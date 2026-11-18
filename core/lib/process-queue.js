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
  const queuedKeys = new Set()
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
    if (key && (queuedKeys.has(key) || active?.key === key)) {
      return { ok: false, duplicate: true, key, size: size() }
    }
    if (pending.length >= limit) {
      return { ok: false, full: true, key, size: size() }
    }
    pending.push({ item, key })
    if (key) queuedKeys.add(key)
    void drain()
    return { ok: true, key, size: size() }
  }

  async function drain() {
    if (draining) return
    draining = true
    try {
      while (pending.length > 0) {
        active = pending.shift()
        try {
          await run(active.item)
        } catch (error) {
          try { onError(error, active.item) } catch { /* 回调自身出错不能拖垮队列 */ }
        } finally {
          if (active.key) queuedKeys.delete(active.key)
          active = null
        }
      }
    } finally {
      draining = false
    }
  }

  function clear() {
    const cleared = pending.length
    pending.length = 0
    queuedKeys.clear()
    return cleared
  }

  function size() {
    return pending.length + (active ? 1 : 0)
  }

  async function whenIdle() {
    while (draining || active) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { push, clear, size, whenIdle }
}
