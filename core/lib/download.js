/**
 * 带镜像兜底的下载地址解析。
 *
 * GitHub 直连在国内经常很慢或干脆失败，官方地址失败后按镜像前缀重试。
 * 只负责生成候选地址，具体下载（fetch / curl / 流式写盘）由调用方实现。
 */

// 实测可代理 GitHub release 文件的两个公共镜像；也可用 SEEN_GH_MIRROR 覆盖。
const DEFAULT_GITHUB_MIRRORS = ['https://ghproxy.net/', 'https://gh-proxy.com/']

/** 读镜像前缀：SEEN_GH_MIRROR 支持逗号分隔多个，否则用内置镜像。 */
export function githubMirrors() {
  const configured = String(process.env.SEEN_GH_MIRROR || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const list = configured.length > 0 ? configured : DEFAULT_GITHUB_MIRRORS.slice()
  return list.map((item) => (item.endsWith('/') ? item : item + '/'))
}

/**
 * 生成下载候选地址：官方地址优先，GitHub release 再追加镜像。
 * 非 GitHub 地址（如 HuggingFace）原样返回，由调用方自己处理镜像。
 */
export function downloadCandidates(url) {
  const text = String(url ?? '').trim()
  if (!text) return []
  const candidates = [text]
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\//i.test(text)) {
    for (const mirror of githubMirrors()) candidates.push(mirror + text)
  }
  return candidates
}
