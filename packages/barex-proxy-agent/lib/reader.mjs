import { ProxyError } from './errors.mjs'
import { proxyName } from './url.mjs'

const DEFAULT_MAX_HEADER_SIZE = 16 * 1024

// Handshake reads hold chunks until a complete answer arrives. Delimiter searches continue
// where the previous chunk stopped, and bytes are copied only when returning a result.
export class Reader {
  constructor(socket, proxy) {
    this._socket = socket
    this._proxy = proxy
    this._chunks = []
    this._buffered = 0
    this._pending = null
    this._error = null
    this._ended = false

    this._ondata = (data) => {
      if (this._error) return
      if (data.byteLength) {
        this._chunks.push(data)
        this._buffered += data.byteLength
      }
      this._settle()
      // A completed read may leave target bytes behind. Stop until the next read or until
      // the tunnel takes over, rather than accumulate an unsolicited stream of data.
      if (!this._pending) socket.pause()
    }
    this._onerror = (err) => {
      this._error = err
      this._settle()
    }
    this._onend = () => {
      this._ended = true
      this._settle()
    }

    socket
      .on('data', this._ondata)
      .on('error', this._onerror)
      .on('end', this._onend)
      .on('close', this._onend)
  }

  // Exactly n bytes. The caller explicitly chooses how many to retain.
  read(n) {
    if (!Number.isSafeInteger(n) || n < 0) {
      return Promise.reject(new RangeError('invalid read size'))
    }
    return this._want({ n })
  }

  // Everything up to and including delimiter. Only the handshake counts against the
  // limit: bytes following a valid delimiter belong to the target and are preserved.
  until(delimiter, maxBytes = DEFAULT_MAX_HEADER_SIZE) {
    delimiter = Buffer.from(delimiter)
    if (
      !delimiter.byteLength ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < delimiter.byteLength
    ) {
      return Promise.reject(new RangeError('invalid delimiter or handshake limit'))
    }
    return this._want({
      delimiter,
      maxBytes,
      prefix: prefixes(delimiter),
      chunk: 0,
      offset: 0,
      scanned: 0,
      matched: 0
    })
  }

  release() {
    this._socket
      .off('data', this._ondata)
      .off('error', this._onerror)
      .off('end', this._onend)
      .off('close', this._onend)
    if (this._pending) {
      this._pending.reject(new ProxyError('handshake reader released during a read'))
      this._pending = null
    }
    return this._take(this._buffered)
  }

  _want(request) {
    if (this._pending) return Promise.reject(new ProxyError('a handshake read is already pending'))
    return new Promise((resolve, reject) => {
      this._pending = { ...request, resolve, reject }
      this._settle()
      if (this._pending) this._socket.resume()
    })
  }

  _settle() {
    const pending = this._pending
    if (!pending) return

    const upto = pending.delimiter
      ? this._find(pending)
      : this._buffered >= pending.n
        ? pending.n
        : -1

    if (upto !== -1) {
      this._pending = null
      pending.resolve(this._take(upto))
      return
    }

    if (pending.delimiter && pending.scanned === pending.maxBytes) {
      this._error = new ProxyError(
        `${proxyName(this._proxy)} handshake exceeds ${pending.maxBytes} bytes`
      )
      this._chunks = []
      this._buffered = 0
      this._socket.pause()
    }

    if (this._error || this._ended) {
      this._pending = null
      const name = proxyName(this._proxy)
      pending.reject(
        this._error instanceof ProxyError
          ? this._error
          : this._error
            ? new ProxyError(`could not reach the proxy at ${name}: ${this._error.message}`)
            : new ProxyError(`${name} closed the connection in the middle of its handshake`)
      )
    }
  }

  // KMP keeps overlapping delimiters and chunk boundaries linear in bytes received.
  _find(pending) {
    const { delimiter, prefix } = pending
    while (pending.chunk < this._chunks.length) {
      const chunk = this._chunks[pending.chunk]
      while (pending.offset < chunk.byteLength && pending.scanned < pending.maxBytes) {
        const byte = chunk[pending.offset++]
        while (pending.matched && delimiter[pending.matched] !== byte) {
          pending.matched = prefix[pending.matched - 1]
        }
        if (delimiter[pending.matched] === byte) pending.matched++
        pending.scanned++
        if (pending.matched === delimiter.byteLength) return pending.scanned
      }
      if (pending.scanned === pending.maxBytes) break
      pending.chunk++
      pending.offset = 0
    }
    return -1
  }

  _take(n) {
    const result = Buffer.allocUnsafe(n)
    let copied = 0
    let consumed = 0
    while (copied < n) {
      const chunk = this._chunks[consumed]
      const count = Math.min(chunk.byteLength, n - copied)
      result.set(chunk.subarray(0, count), copied)
      copied += count
      if (count === chunk.byteLength) consumed++
      else this._chunks[consumed] = chunk.subarray(count)
    }
    this._chunks = this._chunks.slice(consumed)
    this._buffered -= n
    return result
  }
}

function prefixes(delimiter) {
  const prefix = new Uint32Array(delimiter.byteLength)
  let matched = 0
  for (let i = 1; i < delimiter.byteLength; i++) {
    while (matched && delimiter[i] !== delimiter[matched]) matched = prefix[matched - 1]
    if (delimiter[i] === delimiter[matched]) matched++
    prefix[i] = matched
  }
  return prefix
}
