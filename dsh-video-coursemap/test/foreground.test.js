import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLsappinfoFront, parseLsappinfoName, parseAppleScriptTab, classifyForegroundError,
} from '../lib/foreground-darwin.js'
import { isBrowserName } from '../lib/foreground.js'

test('lsappinfo parsers', () => {
  assert.equal(parseLsappinfoFront('ASN:0x0-0x156156: (in front)'), 'ASN:0x0-0x156156:')
  assert.equal(parseLsappinfoName('"Google Chrome" ASN:0x0-0x156156:'), 'Google Chrome')
  assert.equal(parseLsappinfoName('"LSDisplayName"="Safari"'), 'Safari')
  assert.equal(parseLsappinfoName(''), null)
})

test('AppleScript tab output parser', () => {
  assert.deepEqual(parseAppleScriptTab('视频标题\nhttps://www.bilibili.com/video/BV1xx'), {
    title: '视频标题', url: 'https://www.bilibili.com/video/BV1xx',
  })
  assert.deepEqual(parseAppleScriptTab('only title'), { title: 'only title', url: '' })
  assert.equal(parseAppleScriptTab(''), null)
})

test('error classification', () => {
  assert.equal(classifyForegroundError(new Error('AppleEvent timed out (-1712)')), 'timeout')
  assert.equal(classifyForegroundError(new Error('not authorized to send Apple events')), 'denied')
  assert.equal(classifyForegroundError(new Error('something else')), 'unknown')
})

test('browser name matching', () => {
  assert.equal(isBrowserName('Google Chrome'), true)
  assert.equal(isBrowserName('Safari'), true)
  assert.equal(isBrowserName('Finder'), false)
  assert.equal(isBrowserName('Chrome', { browserNames: ['Chrome'] }), true)
})
