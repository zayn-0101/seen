import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractBvid,
  extractPage,
  cleanBiliTitle,
  titleSimilarity,
  buildBiliDisplayTitle,
  normalizeSubtitleUrl,
  isAiSubtitleEntry,
  subtitleSourceFromEntry,
  pickSubtitleEntry,
} from '../lib/bilibili.js'

test('extractBvid supports URLs and bare BV', () => {
  assert.equal(extractBvid('https://www.bilibili.com/video/BV1GJ411x7h7?p=2'), 'BV1GJ411x7h7')
  assert.equal(extractBvid('BV1GJ411x7h7'), 'BV1GJ411x7h7')
  assert.equal(extractBvid('https://b23.tv/abc'), null)
  assert.equal(extractBvid('no video here'), null)
})

test('extractPage', () => {
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x?p=3'), 3)
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x'), 1)
  assert.equal(extractPage('https://www.bilibili.com/video/BV1x?p=abc'), 1)
})

test('cleanBiliTitle strips platform suffix', () => {
  assert.equal(cleanBiliTitle('梯度下降详解_哔哩哔哩_bilibili'), '梯度下降详解')
  assert.equal(cleanBiliTitle('机器学习 - Google Chrome'), '机器学习')
  assert.equal(cleanBiliTitle('  A   B  '), 'A B')
})

test('titleSimilarity', () => {
  assert.equal(titleSimilarity('梯度下降详解', '梯度下降详解'), 1)
  assert.ok(titleSimilarity('梯度下降详解', '梯度下降') >= 0.5)
  assert.ok(titleSimilarity('完全不同的标题', '机器学习入门') < 0.5)
})

test('buildBiliDisplayTitle marks later parts without changing P1', () => {
  assert.equal(buildBiliDisplayTitle({ seriesTitle: '新概念英语', part: '开篇', page: 1 }), '新概念英语')
  assert.equal(buildBiliDisplayTitle({ seriesTitle: '新概念英语', part: '课前准备', page: 2 }), '新概念英语 - P2 课前准备')
  assert.equal(buildBiliDisplayTitle({ seriesTitle: '新概念英语', part: '新概念英语', page: 3 }), '新概念英语')
  assert.equal(buildBiliDisplayTitle({ seriesTitle: '', part: '单集', page: 2 }), 'P2 单集')
})

test('normalizeSubtitleUrl only accepts https and fixes protocol-relative URLs', () => {
  assert.equal(normalizeSubtitleUrl('//aisubtitle.hdslb.com/a.json'), 'https://aisubtitle.hdslb.com/a.json')
  assert.equal(normalizeSubtitleUrl('http://aisubtitle.hdslb.com/a.json'), 'https://aisubtitle.hdslb.com/a.json')
  assert.equal(normalizeSubtitleUrl('https://aisubtitle.hdslb.com/a.json'), 'https://aisubtitle.hdslb.com/a.json')
  assert.equal(normalizeSubtitleUrl('ftp://example.com/a'), '')
  assert.equal(normalizeSubtitleUrl(''), '')
})

test('AI subtitle detection and source labels', () => {
  assert.equal(isAiSubtitleEntry({ lan: 'ai-zh' }), true)
  assert.equal(isAiSubtitleEntry({ lan: 'zh-CN', lan_doc: '中文（自动生成）' }), true)
  assert.equal(isAiSubtitleEntry({ lan: 'zh-CN', lan_doc: '中文（UP主上传）' }), false)
  assert.equal(subtitleSourceFromEntry({ lan: 'ai-zh' }), 'ai-subtitle')
  assert.equal(subtitleSourceFromEntry({ lan: 'zh-CN' }), 'up-subtitle')
})

test('pickSubtitleEntry rejects AI URLs for another video and prefers Chinese', () => {
  const aid = '117630295874449'
  const cid = '43680465674'
  const entries = [
    { lan: 'ai-en', subtitle_url: '//aisubtitle.hdslb.com/' + aid + cid + 'en.json' },
    { lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/other-video.json' },
    { lan: 'zh-CN', subtitle_url: 'https://example.com/zh.json' },
  ]
  const picked = pickSubtitleEntry(entries, { aid, cid })
  assert.equal(picked.lan, 'zh-CN')
  assert.equal(pickSubtitleEntry([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/' + aid + cid + 'zh.json' }], { aid, cid }).lan, 'ai-zh')
  assert.equal(pickSubtitleEntry([{ lan: 'ai-zh', subtitle_url: '//aisubtitle.hdslb.com/other.json' }], { aid, cid }), null)
})
