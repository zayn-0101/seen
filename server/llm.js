/**
 * 独立运行时的 LLM 适配器。
 *
 * 默认连接本机 Magpie 网关（http://127.0.0.1:3425/v1），这是 DSH 使用的同一模型入口，
 * 但不依赖 DSH 进程，只要求 Magpie 菜单栏应用在运行。
 *
 * 也可通过 ~/.myminer/llm.json 或环境变量接入任意 OpenAI-compatible 服务：
 *   MYMINER_LLM_BASE_URL / MYMINER_LLM_API_KEY / MYMINER_LLM_MODEL
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1'
const DEFAULT_MODEL = 'auto/deepseek-v4.1-flash'

function readJson(file) {
  try {
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 读取独立运行时的 LLM 配置；环境变量优先于 ~/.myminer/llm.json。 */
export function loadLlmConfig() {
  const file = readJson(join(homedir(), '.myminer', 'llm.json'))
  return {
    baseURL: String(process.env.MYMINER_LLM_BASE_URL || file.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: process.env.MYMINER_LLM_API_KEY || file.apiKey || '',
    model: String(process.env.MYMINER_LLM_MODEL || file.model || DEFAULT_MODEL),
    provider: String(process.env.MYMINER_LLM_PROVIDER || file.provider || 'magpie'),
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toOpenAiMessages(system, messages) {
  const out = []
  if (system) out.push({ role: 'system', content: String(system) })
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message && typeof message.role === 'string' ? message.role : 'user'
    const content = textFromContent(message?.content)
    if (content) out.push({ role, content })
  }
  return out
}

/**
 * 创建 OpenAI-compatible LLM 客户端。
 * stream() 的返回结构与 DSH 的 ctx.llm 兼容：异步迭代 { type: 'text-delta', text }。
 */
export function createLlmClient(config = loadLlmConfig()) {
  const baseURL = String(config.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const apiKey = String(config.apiKey || '')
  const defaultModel = String(config.model || DEFAULT_MODEL)
  const provider = String(config.provider || 'magpie')

  function headers() {
    const h = { 'Content-Type': 'application/json' }
    if (apiKey) h.Authorization = 'Bearer ' + apiKey
    return h
  }

  async function health() {
    try {
      const res = await fetch(baseURL + '/models', { headers: headers(), signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { ok: false, detail: 'HTTP ' + res.status }
      const data = await res.json().catch(() => null)
      const ids = Array.isArray(data?.data) ? data.data.map((item) => item?.id).filter(Boolean) : []
      return { ok: true, detail: '已连接 ' + baseURL, models: ids.slice(0, 30) }
    } catch (error) {
      return { ok: false, detail: String(error?.message || error) }
    }
  }

  async function* stream(request = {}) {
    const model = request.model || defaultModel
    const body = {
      model,
      messages: toOpenAiMessages(request.system, request.messages),
      max_tokens: Number(request.maxTokens || 4096),
      stream: true,
    }
    const ac = new AbortController()
    const onAbort = () => ac.abort()
    if (request.signal) {
      if (request.signal.aborted) ac.abort()
      else request.signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => ac.abort(new Error('LLM 请求超时')), 180000)
    try {
      const res = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error('LLM HTTP ' + res.status + (detail ? '：' + detail.slice(0, 300) : ''))
      }
      const contentType = String(res.headers.get('content-type') || '')
      // 少数兼容服务忽略 stream=true，直接返回 JSON。
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => null)
        const text = data?.choices?.[0]?.message?.content
        if (typeof text === 'string' && text) yield { type: 'text-delta', text }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n\n')
        while (index !== -1) {
          const event = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let data
            try { data = JSON.parse(payload) } catch { continue }
            const delta = data?.choices?.[0]?.delta
            const text = typeof delta?.content === 'string' ? delta.content : ''
            if (text) yield { type: 'text-delta', text }
          }
          index = buffer.indexOf('\n\n')
        }
      }
    } finally {
      clearTimeout(timer)
      if (request.signal) request.signal.removeEventListener('abort', onAbort)
    }
  }

  return {
    id: provider,
    baseURL,
    model: defaultModel,
    listProviders: () => [{ id: provider, models: [{ id: defaultModel }] }],
    stream,
    health,
  }
}
