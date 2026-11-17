import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createLlmClient } from '../../server/llm.js'

async function withStream(chunks, run) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const chunk of chunks) res.write(chunk)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const client = createLlmClient({ baseURL: 'http://127.0.0.1:' + server.address().port + '/v1', model: 'fixture' })
    await run(client)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('流式模型响应兼容 CRLF 和分片的 UTF-8', async () => {
  const payload = Buffer.from(
    'data: {"choices":[{"delta":{"content":"中文"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"笔记"}}]}\r\n\r\n' +
    'data: [DONE]\r\n\r\n',
  )
  const split = payload.indexOf(Buffer.from('中')) + 1
  await withStream([payload.subarray(0, split), payload.subarray(split, split + 9), payload.subarray(split + 9)], async client => {
    let text = ''
    for await (const item of client.stream({ messages: [{ role: 'user', content: 'test' }] })) text += item.text
    assert.equal(text, '中文笔记')
  })
})

test('流结束时仍处理最后一个未附空行的事件', async () => {
  await withStream(['data: {"choices":[{"delta":{"content":"最后一段"}}]}'], async client => {
    let text = ''
    for await (const item of client.stream({ messages: [{ role: 'user', content: 'test' }] })) text += item.text
    assert.equal(text, '最后一段')
  })
})
