/**
 * seen-core · 版本比较
 *
 * 只处理应用实际会遇到的形如 0.1.1 / 1.2.3-beta 的版本号；
 * 用于「检查是否有新版本」时判断远端 tag 是否领先。
 */

/** 语义化版本比较：a > b 返回 1，相等返回 0，a < b 返回 -1。 */
export function compareVersions(a, b) {
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] > right.numbers[index] ? 1 : -1
    }
  }
  // 正式版优先于预发布版：0.2.0 > 0.2.0-beta
  if (left.prerelease && !right.prerelease) return -1
  if (!left.prerelease && right.prerelease) return 1
  if (left.prerelease && right.prerelease) {
    return left.prerelease.localeCompare(right.prerelease)
  }
  return 0
}

function parse(value) {
  const text = String(value ?? '').trim().replace(/^v/i, '')
  const [core, ...rest] = text.split('-')
  const numbers = core.split('.').slice(0, 3).map((part) => {
    const num = Number.parseInt(part, 10)
    return Number.isFinite(num) && num > 0 ? num : 0
  })
  while (numbers.length < 3) numbers.push(0)
  return { numbers, prerelease: rest.join('-') }
}
