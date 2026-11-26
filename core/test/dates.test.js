import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePublishedAt } from '../lib/dates.js'

test('normalizePublishedAt handles the formats returned by platforms', () => {
  assert.equal(normalizePublishedAt('20261118'), '2026-11-18')
  assert.equal(normalizePublishedAt('2026-11-18T10:00:00Z'), '2026-11-18')
  assert.equal(normalizePublishedAt('2026-11-18'), '2026-11-18')
  const noon = new Date(2026, 10, 18, 12, 0, 0).getTime()
  assert.equal(normalizePublishedAt(String(Math.floor(noon / 1000))), '2026-11-18')
  assert.equal(normalizePublishedAt(String(noon)), '2026-11-18')
  assert.equal(normalizePublishedAt(new Date(2026, 10, 18, 12)), '2026-11-18')
})

test('normalizePublishedAt rejects empty or impossible dates', () => {
  assert.equal(normalizePublishedAt(''), '')
  assert.equal(normalizePublishedAt(null), '')
  assert.equal(normalizePublishedAt('not-a-date'), '')
  assert.equal(normalizePublishedAt('0'), '')
  assert.equal(normalizePublishedAt(0), '')
  assert.equal(normalizePublishedAt('20261340'), '')
  assert.equal(normalizePublishedAt('18990101'), '')
})
