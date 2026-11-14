/* global EventSource */
const $ = (id) => document.getElementById(id)
const state = {
  snapshot: null,
  history: [],
  current: null,
  summary: null,
  events: [],
  lastPollAt: 0,
  lastForegroundKey: '',
  processingStarted: 0,
  stageLabel: '',
  eventSource: null,
}

const ICONS = {
  foreground: '观察前台',
  stable: '发现新视频',
  detected: '开始处理',
  fetching: '抓取内容',
  content: '内容已抓取',
  classified: '分类完成',
  transcript: '字幕就绪',
  progress: '处理进度',
  summarizing: '生成总结',
  summarized: '总结完成',
  saved: '已保存笔记',
  skipped: '已跳过',
  error: '处理失败',
  status: '轮询状态',
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = String(text)
  return node
}

function formatClock(ts) {
  if (!ts) return '尚未轮询'
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function formatDate(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch { return '' }
}

function extractBvid(url) {
  const match = String(url || '').match(/(BV[0-9A-Za-z]{10})/)
  return match ? match[1] : ''
}

function extractDouyinId(url) {
  const match = String(url || '').match(/(?:[?&](?:modal_id|aweme_id)=|\/video\/)(\d{10,})/)
  return match ? match[1] : ''
}

function extractYoutubeId(url) {
  const match = String(url || '').match(/(?:[?&]v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return match ? match[1] : ''
}

function platformLabel(source) {
  if (source === 'douyin') return '抖音精选'
  if (source === 'bilibili') return 'B站'
  if (source === 'youtube') return 'YouTube'
  return ''
}

function setPill(node, text, tone, title) {
  const clickable = node.classList.contains('pill-button') ? ' pill-button' : ''
  node.textContent = text
  node.className = 'pill ' + (tone || 'neutral') + clickable
  if (title) node.title = title
}

function showToast(message, stay = false) {
  const toast = $('toast')
  toast.textContent = String(message || '')
  toast.classList.add('show')
  clearTimeout(showToast.timer)
  if (!stay) showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200)
}

function renderConnection(connected) {
  $('connectionDot').className = 'sidebar-dot ' + (connected ? 'online' : 'offline')
  $('connectionLabel').textContent = connected ? '本地服务已连接' : '服务连接中断'
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
  return data
}

function renderToggle() {
  const status = state.snapshot?.status || {}
  const button = $('toggle')
  const label = $('toggleLabel')
  const readonly = Boolean(status.readOnly)
  button.disabled = readonly
  button.setAttribute('aria-pressed', status.polling ? 'true' : 'false')
  label.textContent = readonly ? '只读' : status.polling ? '轮询中' : '已暂停'
  button.title = readonly ? '另一个实例正在占用' : status.polling ? '点击暂停轮询' : '点击开始轮询'
  $('readonlyPill').classList.toggle('hidden', !readonly)
  const pollState = $('pollState')
  pollState.textContent = readonly ? '只读' : status.polling ? '轮询中' : '已停止'
  pollState.className = 'state ' + (readonly ? 'stopped' : status.polling ? 'running' : 'stopped')
  const interval = Math.round((status.pollIntervalMs || 15000) / 1000)
  if (document.activeElement !== $('interval')) $('interval').value = String(interval)
  $('intervalHint').textContent = '每 ' + interval + ' 秒观察一次前台浏览器'
}

function renderForeground(fg) {
  const box = $('foreground')
  box.replaceChildren()
  state.current = fg || null
  state.lastPollAt = fg?.at || state.lastPollAt || Date.now()
  $('lastPoll').textContent = formatClock(state.lastPollAt)

  if (!fg || (!fg.app && !fg.title)) {
    box.className = 'foreground empty'
    box.append(el('div', 'empty-icon', '◌'))
    const copy = el('div')
    copy.append(el('strong', '', '等待浏览器'), el('p', '', '在 Chrome 打开一个 B站 / 抖音精选 / YouTube 视频页，保持前台约 30 秒。'))
    box.append(copy)
    return
  }

  box.className = 'foreground'
  const icon = el('div', 'empty-icon', fg.isBrowser ? '◉' : '◌')
  const body = el('div')
  const title = fg.title || '（无窗口标题）'
  body.append(el('strong', 'fg-title', title))
  const path = [fg.app || '未知应用', fg.isBrowser ? '浏览器' : '非浏览器', fg.source || 'none'].join(' · ')
  body.append(el('p', '', path))

  const meta = el('div', 'fg-meta')
  const bvid = extractBvid(fg.url)
  const douyinId = extractDouyinId(fg.url)
  const youtubeId = extractYoutubeId(fg.url)
  if (bvid) meta.append(el('span', 'chip accent', bvid))
  else if (douyinId) meta.append(el('span', 'chip accent', '抖音 ' + douyinId))
  else if (youtubeId) meta.append(el('span', 'chip accent', 'YouTube ' + youtubeId))
  if (fg.url) {
    try {
      const host = new URL(fg.url).hostname
      meta.append(el('span', 'chip', host.replace(/^www\./, '')))
    } catch { /* 忽略 */ }
  }
  if (fg.error) meta.append(el('span', 'chip warn', fg.error))
  else if (fg.permission === 'denied' || fg.permission === 'timeout') meta.append(el('span', 'chip warn', '权限：' + fg.permission))
  if (meta.childNodes.length) body.append(meta)
  box.append(icon, body)
}

function statBox(value, label) {
  const box = el('div', 'stat')
  box.append(el('div', 'n', value), el('div', 'l', label))
  return box
}

function renderSummary(data, stageText) {
  if (!data) return
  state.summary = data
  const body = $('summaryBody')
  body.className = 'summary-body'
  body.replaceChildren()

  const title = data.title || '（未命名视频）'
  const source = data.source || data.platform || (data.contentSource === 'whisper' ? 'douyin' : 'bilibili')
  const sourceName = platformLabel(source)
  body.append(el('h3', 'summary-title', title))
  const subjectLine = [data.subject, sourceName].filter(Boolean).join(' · ')
  if (subjectLine) body.append(el('div', 'summary-subject', subjectLine))

  if (data.summary) body.append(el('blockquote', 'summary-quote', data.summary))

  if (Array.isArray(data.keyPoints) && data.keyPoints.length) {
    const section = el('div', 'summary-section')
    section.append(el('h3', '', '核心知识点'))
    for (const point of data.keyPoints) {
      const group = el('div', 'point-group')
      if (point.title) group.append(el('strong', '', point.title))
      if (Array.isArray(point.points) && point.points.length) {
        const ul = el('ul')
        for (const item of point.points) ul.append(el('li', '', item))
        group.append(ul)
      }
      section.append(group)
    }
    body.append(section)
  }

  if (Array.isArray(data.discussion) && data.discussion.length) {
    const section = el('div', 'summary-section')
    section.append(el('h3', '', source === 'douyin' || source === 'youtube' ? '讨论焦点（基于主题）' : '弹幕与评论焦点'))
    const ul = el('ul')
    for (const item of data.discussion) ul.append(el('li', '', item))
    section.append(ul)
    body.append(section)
  }

  if (Array.isArray(data.chapters) && data.chapters.length) {
    const section = el('div', 'summary-section')
    section.append(el('h3', '', '章节'))
    const wrap = el('div', 'chapters')
    for (const chapter of data.chapters.slice(0, 12)) {
      const seconds = Number(chapter.from) || 0
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
      const ss = String(Math.floor(seconds % 60)).padStart(2, '0')
      wrap.append(el('span', '', mm + ':' + ss + ' ' + (chapter.content || '')))
    }
    section.append(wrap)
    body.append(section)
  }

  const stats = data.fetchStats || null
  if (stats) {
    const douyin = source === 'douyin'
    const youtube = source === 'youtube'
    const grid = el('div', 'stats')
    const transcriptLabel = data.contentSource === 'ai-subtitle'
      ? 'AI 字幕'
      : data.contentSource === 'up-subtitle'
        ? 'UP 主字幕'
        : data.contentSource === 'youtube-subtitle'
          ? 'YouTube 字幕'
          : data.contentSource === 'auto-subtitle'
            ? '自动字幕'
            : data.contentSource === 'whisper' || douyin
              ? '音频转写'
              : '字幕'
    grid.append(statBox(String(stats.transcript || 0) + ' 字', transcriptLabel))
    if (douyin) {
      grid.append(statBox(String(stats.totalComments || '—'), '全站评论（暂未抓取）'))
      grid.append(statBox(String(stats.totalDanmaku || '—'), '全站弹幕（暂未抓取）'))
    } else if (youtube) {
      grid.append(statBox(String((data.chapters || []).length), '章节'))
      grid.append(statBox('暂未抓取', '评论（无弹幕）'))
    } else {
      grid.append(statBox(String(stats.comments || 0) + ' / ' + (stats.totalComments || '—'), '评论（抓取 / 全站）'))
      grid.append(statBox(String(stats.danmaku || 0) + ' / ' + (stats.totalDanmaku || '—'), '弹幕（抓取 / 全站）'))
    }
    grid.append(statBox(data.contentQuality === 'full' ? '完整' : '有限', '内容依据'))
    body.append(grid)
  }

  if (data.notePath) {
    const link = el('a', 'note-link', '在 Obsidian 中打开 ↗')
    link.href = obsidianUrl(data.notePath)
    link.target = '_blank'
    link.rel = 'noreferrer'
    body.append(link)
  }

  state.stageLabel = stageText || '已生成'
  state.processingStarted = 0
  $('summaryStage').textContent = state.stageLabel
  $('summaryStage').className = 'stage done'
}

function obsidianUrl(notePath) {
  const vaultPath = state.snapshot?.status?.vaultPath || ''
  const vault = (vaultPath || 'Obsidian Vault').split('/').filter(Boolean).pop() || 'Obsidian Vault'
  const file = String(notePath || '').replace(/\.md$/i, '')
  return 'obsidian://open?vault=' + encodeURIComponent(vault) + '&file=' + encodeURIComponent(file)
}

/** 按搜索词与学科筛选知识库；关键词里含学科与摘要，方便找回旧笔记。 */
function filterHistory(rows) {
  const query = String($('historySearch')?.value || '').trim().toLowerCase()
  const subject = String($('historySubject')?.value || '')
  return rows.filter((row) => {
    if (subject && row.subject !== subject) return false
    if (!query) return true
    const haystack = [row.title, row.subject, row.summary, ...(row.keywords || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}

/** 学科下拉只列出实际存在的学科，保持当前选中项。 */
function renderSubjectOptions(rows) {
  const select = $('historySubject')
  if (!select) return
  const current = select.value
  const subjects = [...new Set(rows.map((row) => row.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  select.replaceChildren()
  const all = document.createElement('option')
  all.value = ''
  all.textContent = '全部学科'
  select.appendChild(all)
  for (const name of subjects) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    select.appendChild(option)
  }
  select.value = subjects.includes(current) ? current : ''
}

function renderHistory(history) {
  const box = $('history')
  const all = Array.isArray(history) ? history : state.history || []
  if (Array.isArray(history)) {
    state.history = history
    renderSubjectOptions(history)
  }
  box.replaceChildren()
  const rows = filterHistory(all)
  const filtering = rows.length !== all.length
  $('historyCount').textContent = filtering ? rows.length + ' / ' + all.length + ' 个视频' : all.length + ' 个视频'
  if (!all.length) {
    box.className = 'history-grid empty'
    box.append(el('p', 'empty-line', '还没有笔记。打开 B站 / 抖音精选 / YouTube 课程视频，或在上方粘贴链接。'))
    return
  }
  if (!rows.length) {
    box.className = 'history-grid empty'
    box.append(el('p', 'empty-line', '没有匹配的笔记，换个关键词或学科试试。'))
    return
  }
  box.className = 'history-grid'
  // 有筛选条件时多显示一些，方便一次看全匹配结果
  const limit = filtering ? 60 : 12
  for (const row of rows.slice(0, limit)) {
    const button = el('button', 'history-item')
    button.type = 'button'
    button.append(el('div', 'h-subject', [row.subject || '未分类', platformLabel(row.source)].filter(Boolean).join(' · ')))
    button.append(el('div', 'h-title', row.title || '（未命名视频）'))
    if (row.summary) button.append(el('div', 'h-summary', row.summary))
    button.addEventListener('click', () => {
      renderSummary({
        title: row.title,
        subject: row.subject,
        source: row.source,
        summary: row.summary,
        keyPoints: [],
        discussion: [],
        fetchStats: null,
        notePath: row.notePath,
        contentQuality: 'history',
      }, '历史笔记')
    })
    box.append(button)
  }
}

function renderEvents(events) {
  const list = $('events')
  list.replaceChildren()
  const rows = (Array.isArray(events) ? events : []).slice(-14).reverse()
  for (const event of rows) {
    if (!event || !ICONS[event.type]) continue
    if (event.type === 'foreground') continue
    const li = el('li', event.type === 'error' ? 'err' : event.type === 'saved' || event.type === 'summarized' ? 'hot' : '')
    li.append(el('span', 'dot'))
    li.append(el('span', 't', formatClock(event.at)))
    let text = ICONS[event.type]
    if (event.type === 'saved' && event.data?.title) text = '已保存：' + event.data.title
    else if (event.type === 'error' && event.data?.message) text = '失败：' + event.data.message
    else if (event.type === 'status' && event.data) text = event.data.polling ? '轮询已启动' : '轮询已停止'
    else if (event.type === 'transcript' && event.data) text = '字幕就绪：' + (event.data.length || 0) + ' 字'
    else if (event.type === 'progress' && event.data?.message) text = event.data.message
    li.append(el('span', '', text))
    list.append(li)
  }
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return minutes + ':' + seconds
}

function updateStageClock() {
  const stage = $('summaryStage')
  if (!stage) return
  if (!state.processingStarted) {
    stage.textContent = state.stageLabel || '等待新视频'
    return
  }
  stage.textContent = (state.stageLabel || '处理中') + ' · ' + formatElapsed(Date.now() - state.processingStarted)
}

function stopStageClock() {
  state.processingStarted = 0
}

function renderFailures(failures) {
  const card = $('failuresCard')
  const list = $('failures')
  if (!card || !list) return
  const rows = Array.isArray(failures) ? failures : []
  card.hidden = rows.length === 0
  if (rows.length === 0) {
    list.innerHTML = ''
    return
  }
  const count = $('failuresCount')
  if (count) count.textContent = rows.length + ' 条待处理'
  list.innerHTML = ''
  for (const row of rows) {
    const item = el('li', 'failure-item')
    const head = el('div', 'failure-head')
    head.appendChild(el('strong', '', row.meta?.title || row.key))
    const metaText = [
      row.meta?.source || '',
      row.count > 1 ? '失败 ' + row.count + ' 次' : '',
      formatClock(row.at),
    ].filter(Boolean).join(' · ')
    head.appendChild(el('span', 'failure-meta', metaText))
    item.appendChild(head)
    item.appendChild(el('p', 'failure-error', row.lastError || '未知错误'))
    const actions = el('div', 'failure-actions')
    if (row.meta?.url || row.meta?.title) {
      const retry = el('button', 'button text-button', '重试')
      retry.type = 'button'
      retry.addEventListener('click', () => retryFailure(row.key, retry))
      actions.appendChild(retry)
    }
    if (row.meta?.url) {
      const link = el('a', 'button text-button', '打开原视频')
      link.href = row.meta.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      actions.appendChild(link)
    }
    item.appendChild(actions)
    list.appendChild(item)
  }
}

async function retryFailure(key, button) {
  const label = button ? button.textContent : ''
  if (button) {
    button.disabled = true
    button.textContent = '重试中…'
  }
  try {
    const data = await api('/api/retry', { method: 'POST', body: JSON.stringify({ key }) })
    renderSnapshot(data)
    showToast(data.result?.ok ? '重试完成' : '仍然失败：' + String(data.result?.message || '').slice(0, 80))
  } catch (error) {
    showToast('重试失败：' + (error?.message || error))
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = label || '重试'
    }
  }
}

function renderSnapshot(snap) {
  state.snapshot = snap
  stopStageClock()
  state.events = Array.isArray(snap.events) ? snap.events.slice() : state.events
  renderToggle()
  const llm = snap.llm || {}
  const llmConfigured = llm.configured !== false
  const llmModel = String(llm.model || '').slice(0, 28)
  const llmLabel = !llmConfigured ? '未配置模型' : (llm.ok ? llmModel || 'LLM 就绪' : 'LLM 不可用')
  setPill($('llmPill'), llmLabel, llm.ok ? 'ok' : 'bad', (llm.detail || '') + (llm.source ? ' · 来源：' + llm.source : ''))
  const vaultPath = snap.status?.vaultPath ? String(snap.status.vaultPath) : ''
  $('footerPath').textContent = vaultPath.replace(/^\/(Users|home)\/[^/]+/, '~')
  renderHistory(snap.history || [])
  renderFailures(snap.status?.failures || [])
  renderEvents(state.events)
  if (snap.status?.lastForeground) renderForeground({ ...snap.status.lastForeground, isBrowser: snap.status.lastForeground.isBrowser !== false })
  const saved = [...state.events].reverse().find((event) => event.type === 'saved')
  if (saved?.data) renderSummary(saved.data, '已生成')
  else if (snap.history?.length) {
    const latest = snap.history[0]
    renderSummary({
      title: latest.title,
      subject: latest.subject,
      source: latest.source,
      summary: latest.summary,
      keyPoints: [],
      discussion: [],
      fetchStats: null,
      notePath: latest.notePath,
      contentQuality: 'history',
    }, '历史笔记')
  } else {
    state.stageLabel = '等待新视频'
    state.processingStarted = 0
    const stage = $('summaryStage')
    stage.textContent = state.stageLabel
    stage.className = 'stage idle'
  }
  if (snap.status?.readOnly) {
    showToast('另一个 Seen 实例正在运行并持有状态锁；请停掉那个实例后重启本服务。', true)
  }
}

function stageForEvent(event) {
  const stage = $('summaryStage')
  if (event.type === 'progress' && event.data?.message) {
    if (!state.processingStarted) state.processingStarted = Date.now()
    state.stageLabel = event.data.message
    stage.className = 'stage working'
    updateStageClock()
    return
  }
  const map = {
    stable: ['已发现新视频', 'working'],
    detected: ['开始处理', 'working'],
    fetching: ['抓取内容', 'working'],
    content: ['内容已抓取', 'working'],
    classified: ['分类完成', 'working'],
    transcript: ['字幕就绪', 'working'],
    summarizing: ['生成总结', 'working'],
    summarized: ['总结完成', 'done'],
    saved: ['已保存', 'done'],
    skipped: ['已跳过', 'idle'],
    error: ['处理失败', 'error'],
  }
  const item = map[event.type]
  if (!item) return
  const terminal = ['saved', 'skipped', 'error'].includes(event.type)
  if (terminal) stopStageClock()
  else if (!state.processingStarted) state.processingStarted = Date.now()
  state.stageLabel = item[0]
  stage.className = 'stage ' + item[1]
  updateStageClock()
}

function handleEvent(event) {
  if (!event || !event.type) return
  state.events.push(event)
  if (state.events.length > 100) state.events.shift()
  if (event.type === 'foreground') renderForeground(event.data)
  if (event.type === 'status') {
    if (state.snapshot) state.snapshot.status = { ...state.snapshot.status, polling: Boolean(event.data?.polling), pollIntervalMs: event.data?.pollIntervalMs, readOnly: event.data?.readOnly }
    renderToggle()
  }
  if (event.type === 'saved' && event.data) renderSummary(event.data, '已生成')
  if (event.type === 'summarized' && event.data && !state.summary) renderSummary({ ...event.data, chapters: [], fetchStats: null }, '总结完成')
  if (event.type === 'progress' && event.data?.stage === 'install') {
    const message = String(event.data.message || '')
    if (/安装完成|下载完成/.test(message)) setTimeout(check, 500)
    else if (/安装失败|下载失败/.test(message)) showToast(message, true)
  }
  if (event.type === 'snapshot') {
    renderSnapshot(event.data)
    return
  }
  stageForEvent(event)
  renderEvents(state.events.slice(-20))
}

function connect() {
  if (state.eventSource) state.eventSource.close()
  const source = new EventSource('/api/events')
  state.eventSource = source
  source.onopen = () => renderConnection(true)
  source.onmessage = (message) => {
    try { handleEvent(JSON.parse(message.data)) } catch { /* 忽略 */ }
  }
  source.onerror = () => {
    renderConnection(false)
    source.close()
    setTimeout(connect, 3000)
  }
}

async function load() {
  try {
    const snap = await api('/api/status')
    renderConnection(true)
    renderSnapshot(snap)
  } catch (error) {
    renderConnection(false)
    showToast('无法连接本地服务：' + error.message, true)
  }
}

async function setStarted(started) {
  const button = $('toggle')
  button.disabled = true
  try {
    const snap = await api('/api/config', { method: 'POST', body: JSON.stringify({ started }) })
    renderSnapshot(snap)
    showToast(started ? '轮询已启动' : '轮询已暂停')
  } catch (error) {
    showToast(error.message)
  } finally {
    renderToggle()
  }
}

async function saveInterval() {
  const seconds = Number($('interval').value)
  if (!Number.isFinite(seconds) || seconds < 2 || seconds > 600) {
    showToast('轮询间隔需在 2 到 600 秒之间')
    return
  }
  try {
    const snap = await api('/api/config', { method: 'POST', body: JSON.stringify({ pollIntervalMs: Math.round(seconds * 1000) }) })
    renderSnapshot(snap)
    showToast('轮询间隔已保存：' + seconds + ' 秒')
  } catch (error) {
    showToast(error.message)
  }
}

async function scan(force) {
  const url = $('manualUrl').value.trim()
  if (!url) { showToast('先粘贴视频链接或 BV 号'); return }
  const button = force ? $('scanForce') : $('scan')
  button.disabled = true
  $('summaryStage').textContent = '处理中'
  $('summaryStage').className = 'stage working'
  try {
    const data = await api('/api/scan', { method: 'POST', body: JSON.stringify({ url, force }) })
    if (data.result?.message) showToast(data.result.message)
    if (data.history) renderHistory(data.history)
  } catch (error) {
    showToast(error.message)
    $('summaryStage').textContent = '处理失败'
    $('summaryStage').className = 'stage error'
  } finally {
    button.disabled = false
  }
}

function renderCheckPanel(data) {
  const panel = $('checkPanel')
  const list = $('checkList')
  list.replaceChildren()
  for (const item of data.checks || []) {
    const row = el('li', item.ok ? 'ok' : 'bad')
    row.append(el('span', 'check-label', (item.ok ? '✓ ' : '✕ ') + (item.label || item.id)))
    if (item.detail) row.append(el('span', 'check-detail', item.detail))
    if (!item.ok && item.id === 'whisper-cli') {
      const install = el('button', 'button text-button', '安装 whisper-cli')
      install.type = 'button'
      install.title = '执行 brew install whisper.cpp（需要本机已装 Homebrew）'
      install.addEventListener('click', () => installWhisperCli(install))
      row.append(install)
    }
    if (!item.ok && item.id === 'whisper-model') renderModelPicker(row)
    list.append(row)
  }
  panel.hidden = false
}

async function renderModelPicker(row) {
  try {
    const data = await api('/api/whisper-models')
    const box = el('div', 'model-picker')
    for (const model of data.models || []) {
      const card = el('div', 'model-option' + (model.recommended ? ' recommended' : ''))
      const head = el('div', 'model-head')
      head.append(el('strong', '', model.label))
      if (model.recommended) head.append(el('span', 'chip accent', '推荐'))
      head.append(el('span', 'model-size', String(model.sizeMb) + ' MB'))
      card.append(head)
      if (model.note) card.append(el('p', 'model-note', model.note))
      const button = el('button', 'button text-button', '下载')
      button.type = 'button'
      button.addEventListener('click', () => installWhisperModel(button, model))
      card.append(button)
      box.append(card)
    }
    row.append(box)
  } catch { /* 取不到列表时保持纯文本提示 */ }
}

async function installWhisperModel(button, model) {
  button.disabled = true
  button.textContent = '下载中…'
  try {
    const data = await api('/api/install/whisper-model', { method: 'POST', body: JSON.stringify({ model: model.id }) })
    showToast(data.message || '已开始下载', true)
  } catch (error) {
    showToast(error.message)
    button.disabled = false
    button.textContent = '下载'
  }
}

async function installWhisperCli(button) {
  button.disabled = true
  button.textContent = '安装中…'
  try {
    const data = await api('/api/install/whisper-cli', { method: 'POST', body: '{}' })
    showToast(data.message || '已开始安装', true)
  } catch (error) {
    showToast(error.message)
    button.disabled = false
    button.textContent = '安装 whisper-cli'
  }
}

async function check() {
  showToast('正在检查…', true)
  try {
    const data = await api('/api/check', { method: 'POST', body: '{}' })
    renderCheckPanel(data)
    const failed = (data.checks || []).filter((item) => !item.ok)
    showToast(failed.length === 0 ? '一切正常' : '有 ' + failed.length + ' 项需要处理')
  } catch (error) {
    showToast(error.message)
  }
}

$('toggle').addEventListener('click', () => {
  const polling = Boolean(state.snapshot?.status?.polling)
  setStarted(!polling)
})
$('saveInterval').addEventListener('click', saveInterval)
$('interval').addEventListener('keydown', (event) => { if (event.key === 'Enter') saveInterval() })
$('scan').addEventListener('click', () => scan(false))
$('historySearch').addEventListener('input', () => renderHistory())
$('historySubject').addEventListener('change', () => renderHistory())
$('scanForce').addEventListener('click', () => scan(true))
$('manualUrl').addEventListener('keydown', (event) => { if (event.key === 'Enter') scan(false) })
$('check').addEventListener('click', check)
$('checkClose').addEventListener('click', () => { $('checkPanel').hidden = true })

setInterval(updateStageClock, 1000)
load()
connect()
handleSettingsHash()

// ---------------- 模型设置 ----------------
const settingsState = { loaded: false, providers: [], groups: [] }

function renderProviderOptions() {
  const select = $('providerSelect')
  select.replaceChildren()
  const grouped = {}
  for (const provider of settingsState.providers) {
    const key = provider.group || '其它'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(provider)
  }
  for (const name of settingsState.groups) {
    const list = grouped[name] || []
    if (!list.length) continue
    const group = document.createElement('optgroup')
    group.label = name
    for (const provider of list) {
      const option = document.createElement('option')
      option.value = provider.id
      option.textContent = provider.name
      group.append(option)
    }
    select.append(group)
  }
}

function setModelOptions(models, selected) {
  const select = $('modelSelect')
  select.replaceChildren()
  const list = []
  for (const item of Array.isArray(models) ? models : []) {
    const text = String(item || '').trim()
    if (text && !list.includes(text)) list.push(text)
  }
  if (selected && !list.includes(selected)) list.unshift(selected)
  if (!list.length) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '（点「获取模型列表」或手动输入）'
    select.append(option)
  }
  for (const text of list) {
    const option = document.createElement('option')
    option.value = text
    option.textContent = text
    select.append(option)
  }
  if (selected) select.value = selected
}

function applyPreset(id) {
  const provider = settingsState.providers.find((item) => item.id === id)
  if (!provider) return
  const baseURL = $('baseUrlInput')
  baseURL.value = provider.baseURL || ''
  baseURL.readOnly = id !== 'custom'
  setModelOptions(provider.models || [], '')
  $('customModel').value = ''
  $('settingsResult').textContent = provider.note || ''

  const isLocal = provider.group === '本地'
  const keyInput = $('apiKeyInput')
  keyInput.disabled = isLocal
  keyInput.placeholder = isLocal ? '本地服务通常不需要 API Key' : '粘贴 API Key'
  if (isLocal) keyInput.value = ''
}

function currentForm() {
  const keyInput = $('apiKeyInput')
  return {
    provider: $('providerSelect').value,
    baseURL: $('baseUrlInput').value.trim(),
    model: ($('modelSelect').value || $('customModel').value || '').trim(),
    apiKey: keyInput.disabled ? '' : keyInput.value.trim(),
  }
}

async function openSettings() {
  try {
    const data = await api('/api/llm')
    settingsState.providers = data.providers || []
    settingsState.groups = data.groups || []
    renderProviderOptions()

    $('settingsStatus').textContent = data.source === 'none'
      ? '尚未配置模型，处理视频前请先设置'
      : '当前：' + (data.provider || '') + ' / ' + (data.model || '') + '（来源：' + data.source + '）'

    if (data.saved) {
      $('providerSelect').value = data.saved.provider || 'custom'
      applyPreset(data.saved.provider || 'custom')
      $('baseUrlInput').value = data.saved.baseURL || ''
      setModelOptions([data.saved.model], data.saved.model)
      $('apiKeyInput').value = ''
      if (!$('apiKeyInput').disabled) {
        $('apiKeyInput').placeholder = data.saved.maskedKey ? '已保存 ' + data.saved.maskedKey + '（留空不修改）' : '粘贴 API Key'
      }
    } else if (data.source === 'magpie' && data.provider === 'magpie') {
      $('providerSelect').value = 'magpie'
      applyPreset('magpie')
      if (data.baseURL) $('baseUrlInput').value = data.baseURL
      const magpieModels = (data.health && Array.isArray(data.health.models)) ? data.health.models : []
      setModelOptions(magpieModels, data.model || '')
    } else {
      $('providerSelect').value = 'deepseek'
      applyPreset('deepseek')
    }

    const mnemon = $('mnemonToggle')
    mnemon.disabled = !data.mnemonAvailable
    mnemon.checked = Boolean(data.mnemonAvailable && data.enableMnemon)
    $('mnemonHint').textContent = data.mnemonAvailable ? '检测到本机 mnemon' : '未检测到 mnemon CLI，此开关不可用'

    $('settingsDialog').showModal()
  } catch (error) {
    showToast('读取设置失败：' + error.message)
  }
}

async function fetchModelList() {
  const form = currentForm()
  $('settingsResult').textContent = '正在获取模型列表…'
  try {
    const query = new URLSearchParams({ provider: form.provider, baseURL: form.baseURL })
    if (form.apiKey) query.set('apiKey', form.apiKey)
    const data = await api('/api/llm/models?' + query.toString())
    if (!data.ok) {
      $('settingsResult').textContent = '获取失败：' + (data.detail || '未知错误')
      return
    }
    setModelOptions(data.models, form.model)
    $('settingsResult').textContent = '获取到 ' + data.models.length + ' 个模型'
  } catch (error) {
    $('settingsResult').textContent = '获取失败：' + error.message
  }
}

async function testCurrent() {
  const form = currentForm()
  if (!form.baseURL || !form.model) {
    $('settingsResult').textContent = '先选择供应商并确定模型'
    return
  }
  $('settingsResult').textContent = '测试中…'
  try {
    const data = await api('/api/llm/test', { method: 'POST', body: JSON.stringify(form) })
    $('settingsResult').textContent = data.ok
      ? '✓ 连接正常（' + data.latency + ' ms）'
      : '✗ ' + (data.detail || '连接失败')
  } catch (error) {
    $('settingsResult').textContent = '✗ ' + error.message
  }
}

async function saveSettings(event) {
  if (event) event.preventDefault()
  const form = currentForm()
  if (!form.baseURL || !form.model) {
    $('settingsResult').textContent = '请先确定 baseURL 和模型'
    return
  }
  $('settingsResult').textContent = '保存并测试…'
  try {
    const payload = { ...form, enableMnemon: $('mnemonToggle').checked }
    const data = await api('/api/llm', { method: 'POST', body: JSON.stringify(payload) })
    $('settingsResult').textContent = (data.ok ? '已保存 ✓（' + data.test.latency + ' ms）' : '已保存，但测试未通过：' + data.test.detail) + (data.mnemonNote ? '　' + data.mnemonNote : '')
    showToast(data.ok ? '模型已保存：' + data.saved.model : '模型已保存，但暂时连不上')
    await load()
  } catch (error) {
    $('settingsResult').textContent = '保存失败：' + error.message
  }
}

function closeSettingsDialog() {
  $('settingsDialog').close()
  if (location.hash === '#settings') {
    history.replaceState(null, '', location.pathname + location.search)
  }
}

function handleSettingsHash() {
  if (location.hash === '#settings') openSettings()
}

function updateNavigation() {
  const section = location.hash === '#knowledge' ? '#knowledge' : '#workspace'
  for (const link of document.querySelectorAll('.sidebar-nav a[href]')) {
    if (link.getAttribute('href') === section) link.setAttribute('aria-current', 'location')
    else link.removeAttribute('aria-current')
  }
}

$('llmPill').addEventListener('click', openSettings)
$('navSettings').addEventListener('click', openSettings)
$('closeSettings').addEventListener('click', closeSettingsDialog)
$('settingsDialog').addEventListener('close', () => {
  if (location.hash === '#settings') {
    history.replaceState(null, '', location.pathname + location.search)
  }
})
window.addEventListener('hashchange', handleSettingsHash)
window.addEventListener('hashchange', updateNavigation)
updateNavigation()
$('settingsForm').addEventListener('submit', saveSettings)
$('providerSelect').addEventListener('change', (event) => applyPreset(event.target.value))
$('fetchModels').addEventListener('click', fetchModelList)
$('testLlm').addEventListener('click', testCurrent)
