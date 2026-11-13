/**
 * LLM 适配器：OpenAI 兼容接口 + 供应商预设 + 本机 Magpie 自动探测。
 *
 * 配置优先级：用户保存的设置（~/.seen/llm.json）→ 环境变量 → 自动探测 Magpie → 未配置。
 * 环境变量：SEEN_LLM_BASE_URL / SEEN_LLM_API_KEY / SEEN_LLM_MODEL / SEEN_LLM_PROVIDER
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MAGPIE_BASE_URL = 'http://127.0.0.1:3425/v1'
export const MAGPIE_MODEL = 'auto/deepseek-v4.1-flash'
const CONFIG_PATH = join(homedir(), '.seen', 'llm.json')

/** 供应商预设。models 只是兜底，界面会优先调用 /models 拉取真实列表。 */
export const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', group: '国内', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen', name: '阿里通义千问', group: '国内', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'] },
  { id: 'kimi', name: '月之暗面 Kimi', group: '国内', baseURL: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { id: 'zhipu', name: '智谱 GLM', group: '国内', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'] },
  { id: 'doubao', name: '字节豆包', group: '国内', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: [], note: '模型名填你的接入点 ID（ep- 开头）' },
  { id: 'wenxin', name: '百度文心', group: '国内', baseURL: 'https://qianfan.baidubce.com/v2', models: ['ernie-4.0-8k', 'ernie-3.5-8k'] },
  { id: 'hunyuan', name: '腾讯混元', group: '国内', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-turbos-latest', 'hunyuan-lite'] },
  { id: 'spark', name: '讯飞星火', group: '国内', baseURL: 'https://spark-api-open.xf-yun.com/v1', models: ['generalv3.5', '4.0Ultra'] },
  { id: 'minimax', name: 'MiniMax', group: '国内', baseURL: 'https://api.minimax.chat/v1', models: ['abab6.5s-chat'] },
  { id: 'stepfun', name: '阶跃星辰', group: '国内', baseURL: 'https://api.stepfun.com/v1', models: ['step-1-8k', 'step-2-16k'] },
  { id: 'siliconflow', name: '硅基流动', group: '国内', baseURL: 'https://api.siliconflow.cn/v1', models: [] },

  { id: 'openai', name: 'OpenAI', group: '国际', baseURL: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  { id: 'gemini', name: 'Google Gemini', group: '国际', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
  { id: 'openrouter', name: 'OpenRouter', group: '国际', baseURL: 'https://openrouter.ai/api/v1', models: [] },
  { id: 'xai', name: 'xAI Grok', group: '国际', baseURL: 'https://api.x.ai/v1', models: ['grok-2-latest'] },
  { id: 'groq', name: 'Groq', group: '国际', baseURL: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
  { id: 'mistral', name: 'Mistral', group: '国际', baseURL: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest'] },
  { id: 'together', name: 'Together AI', group: '国际', baseURL: 'https://api.together.xyz/v1', models: [] },
  { id: 'fireworks', name: 'Fireworks', group: '国际', baseURL: 'https://api.fireworks.ai/inference/v1', models: [] },

  { id: 'magpie', name: '本机 Magpie', group: '本地', baseURL: MAGPIE_BASE_URL, models: [MAGPIE_MODEL], note: '自动检测本机是否在运行' },
  { id: 'ollama', name: 'Ollama', group: '本地', baseURL: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b'] },
  { id: 'lmstudio', name: 'LM Studio', group: '本地', baseURL: 'http://127.0.0.1:1234/v1', models: [] },
  { id: 'vllm', name: '其它本地服务', group: '本地', baseURL: 'http://127.0.0.1:8000/v1', models: [] },

  { id: 'custom', name: '自定义', group: '自定义', baseURL: '', models: [], note: '手动填写 baseURL 与模型 ID' },
]

export const PROVIDER_GROUPS = ['国内', '国际', '本地', '自定义']

export function findProvider(id) {
  return PROVIDERS.find((item) => item.id === id) || null
}

/** API Key 脱敏：sk-abcd...wxyz → sk-a***xyz */
export function maskKey(key) {
  const text = String(key || '')
  if (!text) return ''
  if (text.length <= 8) return '***'
  return text.slice(0, 4) + '***' + text.slice(-4)
}

function readConfigFile() {
  try {
    if (!existsSync(CONFIG_PATH)) return null
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function normalizeBaseURL(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

/** 保存配置到 ~/.seen/llm.json（权限 0600）。 */
export function saveLlmConfig({ provider, baseURL, apiKey, model } = {}) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  const data = {
    provider: String(provider || 'custom'),
    baseURL: normalizeBaseURL(baseURL),
    apiKey: String(apiKey || ''),
    model: String(model || '').trim(),
    savedAt: new Date().toISOString(),
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(CONFIG_PATH, 0o600) } catch { /* 忽略 */ }
  return data
}

export function readSavedConfig() {
  return readConfigFile()
}

function envConfig() {
  const baseURL = normalizeBaseURL(process.env.SEEN_LLM_BASE_URL)
  const apiKey = String(process.env.SEEN_LLM_API_KEY || '')
  const model = String(process.env.SEEN_LLM_MODEL || '').trim()
  const provider = String(process.env.SEEN_LLM_PROVIDER || 'env').trim()
  if (!baseURL && !apiKey && !model) return null
  return { baseURL, apiKey, model, provider, source: 'env' }
}

/** 探测本机 Magpie 网关。 */
export async function detectMagpie(timeoutMs = 1500) {
  try {
    const res = await fetch(MAGPIE_BASE_URL + '/models', {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, detail: 'HTTP ' + res.status }
    const data = await res.json().catch(() => null)
    const models = Array.isArray(data?.data) ? data.data.map((item) => item && item.id).filter(Boolean) : []
    return { ok: true, baseURL: MAGPIE_BASE_URL, models }
  } catch (error) {
    return { ok: false, detail: String((error && error.message) || error) }
  }
}

/**
 * 解析当前生效的 LLM 配置。
 * 顺序：保存的设置 → 环境变量 → 本机 Magpie → 未配置。
 */
export async function resolveLlmConfig({ detect = detectMagpie } = {}) {
  const saved = readConfigFile()
  if (saved && saved.baseURL) {
    return {
      source: 'settings',
      config: {
        provider: saved.provider || 'custom',
        baseURL: normalizeBaseURL(saved.baseURL),
        apiKey: String(saved.apiKey || ''),
        model: String(saved.model || '').trim(),
      },
    }
  }

  const fromEnv = envConfig()
  if (fromEnv && fromEnv.baseURL) {
    return { source: 'env', config: { provider: fromEnv.provider, baseURL: fromEnv.baseURL, apiKey: fromEnv.apiKey, model: fromEnv.model } }
  }

  const magpie = await detect()
  if (magpie.ok) {
    const model = magpie.models.includes(MAGPIE_MODEL) ? MAGPIE_MODEL : (magpie.models[0] || MAGPIE_MODEL)
    return {
      source: 'magpie',
      config: { provider: 'magpie', baseURL: MAGPIE_BASE_URL, apiKey: '', model },
    }
  }

  return {
    source: 'none',
    config: { provider: 'none', baseURL: '', apiKey: '', model: '' },
  }
}

/** 拉取供应商模型列表。 */
export async function fetchModels({ baseURL, apiKey, timeoutMs = 8000 } = {}) {
  const url = normalizeBaseURL(baseURL)
  if (!url) return { ok: false, detail: '缺少 baseURL', models: [] }
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey
    const res = await fetch(url + '/models', { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, detail: 'HTTP ' + res.status + (detail ? '：' + detail.slice(0, 200) : ''), models: [] }
    }
    const data = await res.json().catch(() => null)
    const models = Array.isArray(data?.data)
      ? data.data.map((item) => (typeof item === 'string' ? item : item && item.id)).filter(Boolean)
      : []
    return { ok: true, models, detail: models.length + ' 个模型' }
  } catch (error) {
    return { ok: false, detail: String((error && error.message) || error), models: [] }
  }
}

/** 用最小请求测试配置是否可用。 */
export async function testLlmConfig({ baseURL, apiKey, model, timeoutMs = 20000 } = {}) {
  const url = normalizeBaseURL(baseURL)
  if (!url) return { ok: false, detail: '缺少 baseURL' }
  if (!model) return { ok: false, detail: '缺少模型 ID' }
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey
  const started = Date.now()
  try {
    const res = await fetch(url + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latency = Date.now() - started
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, latency, detail: 'HTTP ' + res.status + (detail ? '：' + detail.slice(0, 300) : '') }
    }
    return { ok: true, latency, detail: '连接正常' }
  } catch (error) {
    return { ok: false, latency: Date.now() - started, detail: String((error && error.message) || error) }
  }
}

/** 同步读取配置（兼容旧调用）；不做网络探测，Magpie 仅作为兜底默认值。 */
export function loadLlmConfig() {
  const saved = readConfigFile()
  if (saved && saved.baseURL) {
    return {
      provider: saved.provider || 'custom',
      baseURL: normalizeBaseURL(saved.baseURL),
      apiKey: String(saved.apiKey || ''),
      model: String(saved.model || '').trim(),
    }
  }
  const fromEnv = envConfig()
  if (fromEnv) {
    return {
      provider: fromEnv.provider,
      baseURL: fromEnv.baseURL || MAGPIE_BASE_URL,
      apiKey: fromEnv.apiKey,
      model: fromEnv.model || MAGPIE_MODEL,
    }
  }
  return { provider: 'magpie', baseURL: MAGPIE_BASE_URL, apiKey: '', model: MAGPIE_MODEL }
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
    const content = textFromContent(message && message.content)
    if (content) out.push({ role, content })
  }
  return out
}

/**
 * 创建 OpenAI-compatible LLM 客户端。
 * stream() 返回异步迭代器：{ type: 'text-delta', text }。
 */
export function createLlmClient(config = loadLlmConfig()) {
  let current = {
    baseURL: normalizeBaseURL(config.baseURL) || MAGPIE_BASE_URL,
    apiKey: String(config.apiKey || ''),
    model: String(config.model || ''),
    provider: String(config.provider || 'custom'),
  }

  function currentBaseURL() {
    return normalizeBaseURL(current.baseURL) || MAGPIE_BASE_URL
  }

  function headers() {
    const h = { 'Content-Type': 'application/json' }
    if (current.apiKey) h.Authorization = 'Bearer ' + current.apiKey
    return h
  }

  async function health() {
    if (!currentBaseURL()) return { ok: false, detail: '尚未配置模型' }
    try {
      const res = await fetch(currentBaseURL() + '/models', { headers: headers(), signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { ok: false, detail: 'HTTP ' + res.status }
      const data = await res.json().catch(() => null)
      const ids = Array.isArray(data?.data) ? data.data.map((item) => item && item.id).filter(Boolean) : []
      return { ok: true, detail: '已连接 ' + currentBaseURL(), models: ids.slice(0, 30) }
    } catch (error) {
      return { ok: false, detail: String((error && error.message) || error) }
    }
  }

  async function* stream(request = {}) {
    const model = request.model || current.model
    if (!model) throw new Error('尚未配置模型，请先在面板里选择供应商并填好 API Key')
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
      const res = await fetch(currentBaseURL() + '/chat/completions', {
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
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => null)
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
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
            const delta = data && data.choices && data.choices[0] && data.choices[0].delta
            const text = delta && typeof delta.content === 'string' ? delta.content : ''
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
    get id() { return current.provider },
    get baseURL() { return currentBaseURL() },
    get model() { return current.model },
    listProviders: () => [{ id: current.provider, models: [{ id: current.model }] }],
    updateConfig(next = {}) {
      current = {
        baseURL: normalizeBaseURL(next.baseURL !== undefined ? next.baseURL : current.baseURL) || MAGPIE_BASE_URL,
        apiKey: next.apiKey !== undefined ? String(next.apiKey || '') : current.apiKey,
        model: next.model !== undefined ? String(next.model || '') : current.model,
        provider: next.provider !== undefined ? String(next.provider || 'custom') : current.provider,
      }
      return { ...current }
    },
    stream,
    health,
  }
}
