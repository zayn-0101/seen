import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNetscapeCookies } from '../lib/session.js'

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
