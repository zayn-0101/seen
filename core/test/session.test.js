import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedBilibiliCookieTarget, parseNetscapeCookies } from '../lib/session.js'

test('parseNetscapeCookies only returns bilibili cookies', () => {
  const text = [
    '# Netscape HTTP Cookie File',
    '.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tabc123',
    '.bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid3\tbuv',
    '.youtube.com\tTRUE\t/\tFALSE\t0\tSID\tno',
    '.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tduplicate',
  ].join('\n')
  const header = parseNetscapeCookies(text)
  assert.ok(header.includes('SESSDATA=abc123'))
  assert.ok(header.includes('buvid3=buv'))
  assert.ok(!header.includes('youtube'))
  assert.equal((header.match(/SESSDATA=/g) || []).length, 1)
  assert.equal(parseNetscapeCookies(''), '')
})

test('parseNetscapeCookies 保留 HttpOnly 登录项并排除相似域名', () => {
  const text = [
    '#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tfixture',
    '.api.bilibili.com\tTRUE\t/\tTRUE\t0\tDedeUserID\t123',
    '.evilbilibili.com\tTRUE\t/\tTRUE\t0\tINVALID\tvalue',
  ].join('\n')
  assert.equal(parseNetscapeCookies(text), 'SESSDATA=fixture; DedeUserID=123')
})

test('浏览器 Cookie 只可用于 HTTPS 的 B 站域名及短链', () => {
  assert.equal(isTrustedBilibiliCookieTarget('https://www.bilibili.com/video/BV1test00001'), true)
  assert.equal(isTrustedBilibiliCookieTarget('https://b23.tv/example'), true)
  assert.equal(isTrustedBilibiliCookieTarget('http://www.bilibili.com/video/BV1test00001'), false)
  assert.equal(isTrustedBilibiliCookieTarget('https://bilibili.com.example.test/video/BV1test00001'), false)
  assert.equal(isTrustedBilibiliCookieTarget('https://example.test/bilibili.com/video/BV1test00001'), false)
})
