import test from 'brittle'
import { PassThrough } from 'bare-stream'
import { Reader, parseProxyUrl } from '../index.mjs'

const proxy = parseProxyUrl('http://proxy.lan:8080', ['http:'])

function setup(t) {
  const socket = new PassThrough()
  const reader = new Reader(socket, proxy)
  t.teardown(() => {
    reader.release()
    socket.destroy()
  })
  return { socket, reader }
}

test('Reader finds delimiters split across one-byte chunks', async (t) => {
  const { socket, reader } = setup(t)
  const response = 'HTTP/1.1 200 OK\r\n\r\n'
  const pending = reader.until('\r\n\r\n')
  for (const byte of Buffer.from(response)) socket.emit('data', Buffer.from([byte]))
  t.is((await pending).toString(), response)
})

test('Reader handles overlapping delimiter prefixes', async (t) => {
  const { socket, reader } = setup(t)
  const pending = reader.until('aaab')
  for (const chunk of ['aaaa', 'aaaa', 'abTAIL']) socket.emit('data', Buffer.from(chunk))
  t.is((await pending).toString(), 'aaaaaaaaab')
  t.is(reader.release().toString(), 'TAIL')
})

test('Reader preserves target data beyond a header exactly at its limit', async (t) => {
  const { socket, reader } = setup(t)
  const head = Buffer.from('x'.repeat(16380) + '\r\n\r\n')
  const payload = Buffer.alloc(128 * 1024, 42)
  const pending = reader.until('\r\n\r\n')
  socket.emit('data', Buffer.concat([head, payload]))
  t.alike(await pending, head)
  t.alike(reader.release(), payload, 'the limit excludes target bytes')
})

test('Reader rejects an unterminated header at the default limit', async (t) => {
  const { socket, reader } = setup(t)
  const pending = reader.until('\r\n\r\n').catch((err) => err)
  for (let i = 0; i < 16; i++) socket.emit('data', Buffer.alloc(1024, 65))
  const err = await pending
  t.is(err.code, 'PROXY_ERROR')
  t.ok(err.message.includes('16384 bytes'))
  socket.emit('data', Buffer.alloc(1024, 65))
  t.is(reader.release().byteLength, 0, 'failed input is discarded')
})

test('Reader rejects a delimiter finishing beyond the configured limit', async (t) => {
  const { socket, reader } = setup(t)
  const pending = reader.until('\r\n\r\n', 8).catch((err) => err)
  socket.emit('data', Buffer.from('12345\r\n\r\n'))
  t.is((await pending).code, 'PROXY_ERROR')
})

test('Reader supports explicit larger limits and successive reads from one chunk', async (t) => {
  const { socket, reader } = setup(t)
  const pending = reader.read(2)
  socket.emit('data', Buffer.from('OK' + 'x'.repeat(20000) + '\nTAIL'))
  t.is((await pending).toString(), 'OK')
  t.is((await reader.until('\n', 32768)).byteLength, 20001)
  t.is((await reader.read(2)).toString(), 'TA')
  t.is(reader.release().toString(), 'IL')
})

test('Reader resumes a real stream between handshake reads', { timeout: 3000 }, async (t) => {
  const { socket, reader } = setup(t)
  const first = reader.read(1)
  socket.write(Buffer.from('a'))
  t.is((await first).toString(), 'a')
  socket.write(Buffer.from('b'))
  t.is((await reader.read(1)).toString(), 'b')
})

test('Reader rejects a read when the socket closes without an end event', async (t) => {
  const { socket, reader } = setup(t)
  const pending = reader.read(2).catch((err) => err)
  socket.emit('data', Buffer.from('a'))
  socket.emit('close')
  t.is((await pending).code, 'PROXY_ERROR')
})

test('Reader refuses concurrent reads without replacing the pending one', async (t) => {
  const { socket, reader } = setup(t)
  const first = reader.read(1)
  t.is((await reader.read(1).catch((err) => err)).code, 'PROXY_ERROR')
  socket.emit('data', Buffer.from('a'))
  t.is((await first).toString(), 'a')
})
