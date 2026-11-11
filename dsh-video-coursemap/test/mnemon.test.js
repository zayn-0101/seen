import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMnemonContent, buildRememberArgs } from '../lib/mnemon.js'

test('buildMnemonContent contains key facts and is bounded', () => {
  const content = buildMnemonContent({
    title: '梯度下降详解',
    subject: '机器学习',
    summary: '讲解梯度下降原理与学习率选择。',
    keyPoints: [{ title: '学习率', points: ['太大会震荡', '太小收敛慢'] }],
    notePath: '课程知识地图/机器学习/梯度下降详解',
    bvid: 'BV1GJ411x7h7',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
  })
  assert.ok(content.includes('梯度下降详解'))
  assert.ok(content.includes('机器学习'))
  assert.ok(content.includes('学习率'))
  assert.ok(content.includes('课程知识地图/机器学习/梯度下降详解'))
  assert.ok(content.length <= 800)
})

test('buildRememberArgs matches expected flags', () => {
  const args = buildRememberArgs({
    bin: '/x/mnemon',
    content: 'hello',
    tags: '视频课程,机器学习',
    entities: '机器学习,梯度下降详解',
    store: 'default',
  })
  assert.equal(args[0], '/x/mnemon')
  assert.equal(args[1], 'remember')
  assert.equal(args[2], 'hello')
  assert.ok(args.includes('--cat'))
  assert.ok(args.includes('--imp'))
  assert.ok(args.includes('--source'))
  assert.equal(args[args.indexOf('--store') + 1], 'default')
})
