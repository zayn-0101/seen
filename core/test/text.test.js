import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanDisplayTitle, pickOriginalTitle, spaceCjk } from '../lib/text.js'

test('spaceCjk inserts spaces at CJK and latin/number boundaries', () => {
  assert.equal(spaceCjk('3A游戏'), '3A 游戏')
  assert.equal(spaceCjk('B站 AI字幕'), 'B 站 AI 字幕')
  assert.equal(spaceCjk('75.8%的标普500企业'), '75.8% 的标普 500 企业')
  assert.equal(spaceCjk('GTA6之后'), 'GTA6 之后')
})

test('cleanDisplayTitle removes platform suffixes, hashtags, noise brackets', () => {
  assert.equal(
    cleanDisplayTitle('我们熟悉的那个3A游戏时代，可能真的结束了。【游戏之外】'),
    '我们熟悉的那个 3A 游戏时代，可能真的结束了'
  )
  assert.equal(
    cleanDisplayTitle('标题末尾有句号。'),
    '标题末尾有句号'
  )
  assert.equal(
    cleanDisplayTitle('【全网最全】DeepSeek Harness超详细教程！50分钟吃透DSH，让SuperAgent给你干活！', { maxLength: 80 }),
    'DeepSeek Harness 超详细教程！50 分钟吃透 DSH，让 SuperAgent 给你干活！'
  )
  assert.equal(
    cleanDisplayTitle('【全网最全】DeepSeek Harness超详细教程！50分钟吃透DSH，让SuperAgent给你干活！'),
    'DeepSeek Harness 超详细教程！50 分钟吃透 DSH'
  )
  assert.equal(
    cleanDisplayTitle('中国人不知道“司机”是开“车”的吗？#英语 #矽肺病 #辟谣'),
    '中国人不知道“司机”是开“车”的吗？'
  )
})

test('pickOriginalTitle keeps the real video title over an appended summary', () => {
  assert.equal(pickOriginalTitle('山河表里潼关路', '山河表里潼关路 潼关为关中锁钥，见证哥舒翰兵败'), '山河表里潼关路')
  assert.equal(pickOriginalTitle('示例课程一', '视频 1'), '视频 1')
  assert.equal(pickOriginalTitle('未命名视频', '模型给的标题'), '模型给的标题')
  assert.equal(pickOriginalTitle('', '模型给的标题'), '模型给的标题')
  assert.equal(pickOriginalTitle('真实标题', ''), '真实标题')
})

test('cleanDisplayTitle cuts long titles at punctuation and keeps fallback', () => {
  assert.equal(cleanDisplayTitle('一'.repeat(50), { maxLength: 10 }), '一'.repeat(10))
  const long = '这是一个很长很长的标题，后半段应该被截掉，因为超过了限制'
  assert.ok([...cleanDisplayTitle(long, { maxLength: 18 })].length <= 18)
  assert.equal(cleanDisplayTitle('', { maxLength: 10 }), '')
  assert.equal(
    cleanDisplayTitle("Give Me 15 Minutes. I'll Teach You 80% of Obsidian"),
    "Give Me 15 Minutes. I'll Teach You 80%"
  )
  assert.equal(cleanDisplayTitle('英语播客: 我为什么不回美国'), '英语播客：我为什么不回美国')
  assert.equal(cleanDisplayTitle('日本/朝鲜/越南'), '日本／朝鲜／越南')
})
