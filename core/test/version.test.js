import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions } from '../lib/version.js'

test('compareVersions orders plain versions', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1)
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, '按数值比较而不是字符串')
})

test('compareVersions tolerates v prefix and missing segments', () => {
  assert.equal(compareVersions('v0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(compareVersions('', '0.0.0'), 0)
})

test('compareVersions ranks release above prerelease', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0-beta'), 1)
  assert.equal(compareVersions('0.2.0-beta', '0.2.0'), -1)
  assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.1') > 0, true)
})
