import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFailedNotification,
  buildSavedNotification,
  buildStartedNotification,
  buildTranscribingNotification,
  cleanNotificationTitle,
  notificationSubtitle,
  platformLabel,
} from '../../server/notification.js'

test('notification 平台标签与副标题', () => {
  assert.equal(platformLabel('douyin'), '抖音精选')
  assert.equal(platformLabel('youtube'), 'YouTube')
  assert.equal(platformLabel('bilibili'), 'B站')
  assert.equal(platformLabel('other'), '')
  assert.equal(notificationSubtitle('开始整理', 'douyin'), '拾影 · 抖音精选 · 开始整理')
  assert.equal(notificationSubtitle('开始整理', ''), '拾影 · 开始整理')
})

test('notification 标题去掉站点后缀和话题标签', () => {
  assert.equal(cleanNotificationTitle('梯度下降详解_哔哩哔哩_bilibili'), '梯度下降详解')
  assert.equal(cleanNotificationTitle('Why we sleep - YouTube'), 'Why we sleep')
  assert.equal(cleanNotificationTitle('一人公司 #创业 #商业'), '一人公司')
  assert.equal(cleanNotificationTitle('  '), '')
})

test('notification 开始整理：标题是视频标题，平台在副标题', () => {
  const note = buildStartedNotification({
    title: '为什么越努力越焦虑',
    source: 'douyin',
    author: '某某',
  })
  assert.deepEqual(note, {
    title: '为什么越努力越焦虑',
    subtitle: '拾影 · 抖音精选 · 开始整理',
    body: '作者：某某',
  })
})

test('notification 开始整理：没有作者时给说明，标题缺失时回退', () => {
  const note = buildStartedNotification({ title: '', source: 'bilibili' })
  assert.equal(note.title, '新视频')
  assert.equal(note.subtitle, '拾影 · B站 · 开始整理')
  assert.equal(note.body, '正在识别视频内容，稍后开始整理')
})

test('notification 本地转写：保留视频标题和预计时间', () => {
  const note = buildTranscribingNotification({
    title: '三十分钟讲透货币史',
    source: 'youtube',
    estimateMinutes: 12,
  })
  assert.equal(note.title, '三十分钟讲透货币史')
  assert.equal(note.subtitle, '拾影 · YouTube · 本地转写中')
  assert.equal(note.body, '没有可用字幕，预计约 12 分钟')
})

test('notification 笔记已生成：副标题带平台和学科', () => {
  const note = buildSavedNotification({
    title: '一人公司全攻略',
    source: 'douyin',
    subject: '商业',
  })
  assert.equal(note.title, '一人公司全攻略')
  assert.equal(note.subtitle, '拾影 · 抖音精选 · 笔记已生成')
  assert.equal(note.body, '已归入「商业」，笔记已写入 Obsidian')
})

test('notification 处理失败：显示视频标题、平台与错误原因', () => {
  const note = buildFailedNotification({
    title: '打不开的视频',
    source: 'bilibili',
    message: '字幕抓取失败',
  })
  assert.equal(note.title, '打不开的视频')
  assert.equal(note.subtitle, '拾影 · B站 · 处理失败')
  assert.equal(note.body, '字幕抓取失败')
})
