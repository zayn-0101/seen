/**
 * seen-core · vault 访问守卫
 *
 * 背景：Obsidian vault 通常在 ~/Documents（macOS TCC 保护的「文稿文件夹」）。
 * 没有授权时，同步文件访问会永久挂起在内核 open，把 Node 主线程彻底堵死。
 * 因此：
 *  - 探针放进子进程执行，超时直接 SIGKILL，主线程永远不等；
 *  - 所有 vault I/O 走异步 + 超时 + 串行队列，被挂起也只影响一个 promise；
 *  - 一旦探测或运行超时，熔断成 blocked，后续 vault 操作直接跳过并提示用户授权。
 */

import { spawn } from 'node:child_process'

/** 权限缺失时给用户的固定提示（面板和日志共用）。 */
export const VAULT_HINT =
  '没有「文稿文件夹」权限：打开 系统设置 → 隐私与安全性 → 文件与文件夹，给 Seen 打开「文稿文件夹」，再点「重试」。'

/** vault 操作超时：超过就认为文件系统被挂起，熔断。 */
export const VAULT_IO_TIMEOUT_MS = 10000

/** 子进程探测脚本：能读目录就以 0 退出；不存在退出 2；其它权限问题退出 3。 */
const PROBE_SCRIPT = [
  "const fs = require('fs')",
  'try { fs.readdirSync(process.argv[1]); process.exit(0) } catch (error) {',
  "  process.exit(error && error.code === 'ENOENT' ? 2 : 3)",
  '}',
].join('\n')

/** vault 不可访问时抛出；调用方据此降级而不是当成普通错误。 */
export class VaultBlockedError extends Error {
  constructor(code = 'timeout', detail = '') {
    super('vault 不可访问（' + code + '）' + (detail ? '：' + detail : ''))
    this.name = 'VaultBlockedError'
    this.code = code
    this.detail = detail
    this.vaultBlocked = true
  }
}

/**
 * 在子进程里探测 vault 是否可读。
 * @param {string} vaultPath
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, code: 'ok'|'missing'|'denied'|'timeout'|'error', detail: string, checkedAt: number }>}
 */
export function probeVaultAccess(vaultPath, options = {}) {
  const target = String(vaultPath || '').trim()
  // 首次访问时 tccd 可能要现拉授权状态（用户刚打开过系统设置），2.5 秒会误报；给足 8 秒仍然有界
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000
  const checkedAt = Date.now()
  if (!target) {
    return Promise.resolve({ ok: false, code: 'missing', detail: '没有配置 vault 路径', checkedAt })
  }
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ checkedAt: Date.now(), ...result })
    }
    let child = null
    try {
      child = spawn(process.execPath, ['-e', PROBE_SCRIPT, target], { stdio: 'ignore' })
    } catch (error) {
      finish({ ok: false, code: 'error', detail: String(error?.message || error) })
      return
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 子进程已退出 */ }
      finish({
        ok: false,
        code: 'timeout',
        detail: '读取 vault 超时（' + timeoutMs + 'ms），通常是没有授予「文稿文件夹」权限',
      })
    }, timeoutMs)
    child.on('error', (error) => finish({ ok: false, code: 'error', detail: String(error?.message || error) }))
    child.on('exit', (code) => {
      if (settled) return
      if (code === 0) return finish({ ok: true, code: 'ok', detail: '' })
      if (code === 2) return finish({ ok: false, code: 'missing', detail: '目录不存在：' + target })
      finish({ ok: false, code: 'denied', detail: '没有读取权限：' + target })
    })
  })
}

/**
 * vault 访问守卫：保存可用状态，blocked 时让所有 vault 操作快速失败。
 * @param {{ initial?: { ok?: boolean, code?: string, detail?: string, checkedAt?: number } }} [options]
 */
export function createVaultGuard(options = {}) {
  const initial = options.initial && typeof options.initial === 'object' ? options.initial : null
  const normalize = (result) => {
    const ok = Boolean(result && result.ok)
    return {
      ok,
      code: ok ? 'ok' : String(result?.code || 'unknown'),
      detail: ok ? '' : String(result?.detail || ''),
      checkedAt: Number(result?.checkedAt) || Date.now(),
      hint: ok ? '' : VAULT_HINT,
    }
  }
  let state = initial
    ? normalize(initial)
    : { ok: true, code: 'ok', detail: '', checkedAt: 0, hint: '' }
  const listeners = new Set()

  function status() {
    return { ...state, blocked: !state.ok }
  }

  function notify() {
    const snapshot = status()
    for (const listener of listeners) {
      try { listener(snapshot) } catch { /* 单个订阅失败不影响其它订阅 */ }
    }
  }

  return {
    status,
    isBlocked() { return !state.ok },
    /** blocked 时抛错，让写笔记流程快速失败而不是发起挂起的 I/O。 */
    ensure() {
      if (!state.ok) throw new VaultBlockedError(state.code, state.detail)
    },
    /** 记录一次成功访问，自动解除熔断。 */
    noteOk() {
      if (state.ok) return state
      state = { ok: true, code: 'ok', detail: '', checkedAt: Date.now(), hint: '' }
      notify()
      return status()
    },
    /** 记录一次失败并熔断。 */
    noteBlocked(code = 'error', detail = '') {
      if (!state.ok && state.code === code) return status()
      state = { ok: false, code: String(code || 'error'), detail: String(detail || ''), checkedAt: Date.now(), hint: VAULT_HINT }
      notify()
      return status()
    },
    /** 用一次探测结果覆盖状态。 */
    apply(result) {
      state = normalize(result)
      notify()
      return status()
    },
    reset() {
      state = { ok: true, code: 'ok', detail: '', checkedAt: 0, hint: '' }
      notify()
      return status()
    },
    onChange(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * 给 vault 操作加超时；超时视为文件系统被挂起，熔断并抛 VaultBlockedError。
 * @param {Promise<unknown>} promise
 * @param {number} [timeoutMs]
 * @param {{ noteBlocked?: (code: string, detail: string) => unknown } | null} [guard]
 */
export function withVaultTimeout(promise, timeoutMs = VAULT_IO_TIMEOUT_MS, guard = null) {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new VaultBlockedError('timeout', 'vault 操作超时（' + timeoutMs + 'ms）')
      try { guard?.noteBlocked?.('timeout', error.detail) } catch { /* 守卫失败不影响抛错 */ }
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 串行队列：同一时刻只允许一个 vault 操作，避免挂起请求堆满线程池。 */
export function createVaultQueue() {
  let tail = Promise.resolve()
  return {
    run(task) {
      const next = tail.then(task, task)
      tail = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}
