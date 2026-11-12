import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

function fakeCtx(tools) {
  return {
    get: () => undefined,
    effect: (fn) => fn(),
    tools: { register: (def) => { tools.set(def.name, def); return () => {} } },
    llm: {
      listProviders: () => [{ id: 'fake', models: [{ id: 'fake-model' }] }],
      stream: async function* () { yield { type: 'text-delta', text: '{}' } },
    },
  }
}

test('standalone controller exposes start/stop/interval/scan', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'myminer-controller-'))
  const state = mkdtempSync(join(tmpdir(), 'myminer-controller-state-'))
  const tools = new Map()
  try {
    const api = apply(fakeCtx(tools), {
      vaultPath: vault,
      stateDir: state,
      autoStart: false,
      exposeController: true,
      provider: 'fake',
      model: 'fake-model',
      enableMnemon: false,
      pollIntervalMs: 5000,
    })
    assert.equal(typeof api.start, 'function')
    assert.equal(typeof api.scan, 'function')
    assert.equal((await api.getStatus()).polling, false)
    assert.equal(api.start().ok, true)
    assert.equal((await api.getStatus()).polling, true)
    assert.equal(api.setPollInterval(9000).ok, true)
    assert.equal(api.getConfig().pollIntervalMs, 9000)
    assert.equal(api.stop().ok, true)
    assert.equal((await api.getStatus()).polling, false)
  } finally {
    rmSync(vault, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
})
