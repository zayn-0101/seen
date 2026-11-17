import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rewriteLegacyRefs } from '../lib/legacy-refs.js'

test('rewriteLegacyRefs rewrites the old root and old video subdirectory', () => {
  const input = '> 所属学科：[[课程知识地图/视频笔记/知识管理/标题|标题]]'
  assert.equal(rewriteLegacyRefs(input), '> 所属学科：[[视频笔记/笔记/知识管理/标题|标题]]')
})

test('rewriteLegacyRefs fixes wikilinks without a leading slash', () => {
  assert.equal(
    rewriteLegacyRefs('- [[视频笔记/科技评论/割裂的30帧|割裂的30帧]]'),
    '- [[视频笔记/笔记/科技评论/割裂的30帧|割裂的30帧]]',
  )
  assert.equal(rewriteLegacyRefs('视频笔记/语言文化/x.md'), '视频笔记/笔记/语言文化/x.md')
})

test('rewriteLegacyRefs leaves the current structure untouched', () => {
  const keep = [
    '[[视频笔记/笔记/知识管理/标题]]',
    '[[视频笔记/资料/手册/知识管理|知识管理]]',
    '[[视频笔记/索引.md|索引]]'.replace('索引', '视频索引'),
    '视频笔记/_备份/迁移-1/x.md',
    '[[视频笔记/资料/手册/科技评论|科技评论 学习手册]]',
  ]
  for (const line of keep) assert.equal(rewriteLegacyRefs(line), line)
})

test('rewriteLegacyRefs renames legacy file and folder names', () => {
  assert.equal(rewriteLegacyRefs('见 [[每周回顾/2026-W46|第 46 周]]'), '见 [[资料/回顾/2026-W46|第 46 周]]')
  assert.equal(rewriteLegacyRefs('[[视频笔记/课程总览|总览]]'), '[[视频笔记/总览|总览]]')
  assert.equal(rewriteLegacyRefs('[[视频笔记/索引.md|索引]]'), '[[视频笔记/视频索引.md|索引]]')
})

test('rewriteLegacyRefs skips index files under the old subdirectory', () => {
  assert.equal(
    rewriteLegacyRefs('[[视频笔记/视频笔记/知识管理/x|y]]'),
    '[[视频笔记/笔记/知识管理/x|y]]',
  )
  assert.equal(rewriteLegacyRefs('视频笔记/总览.md'), '视频笔记/总览.md')
})
