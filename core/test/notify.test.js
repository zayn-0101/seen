import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNotificationScript, createNotifier, escapeAppleScript } from '../lib/notify.js'

test('escapeAppleScript escapes quotes, backslashes and newlines', () => {
  assert.equal(escapeAppleScript('a"b'), 'a\\"b')
  assert.equal(escapeAppleScript('a\\b'), 'a\\\\b')
  assert.equal(escapeAppleScript('line1\nline2'), 'line1 line2')
  assert.equal(escapeAppleScript(null), '')
})

test('buildNotificationScript assembles title, subtitle and body', () => {
  const script = buildNotificationScript({ title: '拾影', subtitle: '语言文化 · B站', body: '某个视频' })
  assert.equal(script, 'display notification "某个视频" with title "拾影" subtitle "语言文化 · B站"')
})

test('buildNotificationScript omits empty subtitle', () => {
  const script = buildNotificationScript({ body: 'x' })
  assert.equal(script, 'display notification "x" with title "拾影 Seen"')
})

test('notifier dedupes identical notifications within window', () => {
  const calls = []
  const notifier = createNotifier({
    enabled: true,
    platform: 'darwin',
    spawnImpl: (command, args) => {
      calls.push([command, args])
      return { on() {}, unref() {} }
    },
  })
  assert.equal(notifier.notify({ title: 't', body: 'b' }).ok, true)
  assert.equal(notifier.notify({ title: 't', body: 'b' }).skipped, 'duplicate')
  assert.equal(notifier.notify({ title: 't', body: 'c' }).ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'osascript')
})

test('notifier returns skipped when disabled or unsupported', () => {
  assert.equal(createNotifier({ enabled: false }).notify({ body: 'x' }).skipped, 'disabled')
  assert.equal(createNotifier({ enabled: true, platform: 'linux' }).notify({ body: 'x' }).skipped, 'unsupported')
})

test('notifier survives spawn errors', () => {
  const notifier = createNotifier({
    enabled: true,
    platform: 'darwin',
    spawnImpl: () => { throw new Error('boom') },
  })
  const result = notifier.notify({ title: 't', body: 'b' })
  assert.equal(result.ok, false)
  assert.match(result.error, /boom/)
})
