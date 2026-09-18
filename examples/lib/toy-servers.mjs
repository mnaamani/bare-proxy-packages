// Scaffolding, not the point.
//
// Every example in this folder runs on its own, with nothing installed and nothing
// listening: the proxies they go through are these, started on a loopback port and shut
// down at the end. They are the smallest thing that speaks each protocol correctly enough
// to be worth pointing a client at, and each one keeps a log of what it was asked for -
// which is how the examples show what actually went over the wire rather than asserting it.
//
// None of this is how you would write a proxy. Read the examples themselves for the parts
// that matter; come here only when you want to know what the far end was doing.
import tcp from 'bare-tcp'
import http from 'bare-http1'

// The names the proxies below know how to reach. The examples ask for hosts that resolve
// nowhere - the whole point being that the client never looks them up - so the proxy is
// the one that has to know where they are.
//
// An address is passed through as written, since there is nothing to resolve; a name that
// is not in the map is refused, which is what lets an example show a proxy saying it
// cannot get there.
export function hosts(map) {
  return (host, port) => {
    const mapped = map[host]
    if (mapped !== undefined) return { host: '127.0.0.1', port: mapped }
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? { host, port } : null
  }
}

/**
 * An http origin that reports what it was handed: the address it was reached from, the url
 * asked for, and the headers that arrived with it.
 */
export async function origin(body = 'hello from the origin') {
  const seen = []

  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, from: req.socket.remoteAddress, headers: { ...req.headers } })
    res.setHeader('content-type', 'text/plain')

    // One path answers badly, for the example that needs a failure which is the target's
    // own rather than the proxy's.
    if (req.url === '/broken') {
      res.statusCode = 502
      return void res.end('the origin is having a bad day')
    }

    res.end(body)
  })

  return { seen, ...(await listening(server)) }
}

/**
 * An http proxy asked to forward: it reads a request in absolute-form, makes it onwards in
 * origin-form, and pipes the answer back. What `barex-http-proxy-agent` talks to.
 */
export function forwardProxy({ resolve = null } = {}) {
  const asked = []

  return listener((socket) => {
    let head = ''
    let upstream = null

    socket.on('data', (data) => {
      if (upstream) return void upstream.write(data)

      head += data.toString()
      const end = head.indexOf('\r\n\r\n')
      if (end === -1) return

      const rest = Buffer.from(head.slice(end + 4), 'latin1')
      const [line, ...rawHeaders] = head.slice(0, end).split('\r\n')
      const headers = fields(rawHeaders)
      const [method, target, version] = line.split(' ')

      asked.push({ line, headers, credentials: basic(headers['proxy-authorization']) })

      // Absolute-form is the whole point of forwarding: the proxy is told where to go by
      // the request line itself, and makes the request in origin-form onwards.
      let url
      try {
        url = new URL(target)
      } catch {
        return void socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
      }

      const to = where(resolve, url.hostname, Number(url.port) || 80)
      if (to === null) {
        return void socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
      }

      upstream = tcp.createConnection(to)
      upstream.write(
        [`${method} ${url.pathname}${url.search} ${version}`, ...rawHeaders, '', ''].join('\r\n')
      )
      if (rest.byteLength > 0) upstream.write(rest)
      join(socket, upstream)

      head = ''
    })
  }, asked)
}

/**
 * An http proxy asked for a tunnel with `CONNECT`, which carries whatever is written into
 * it and reads none of it. What `barex-https-proxy-agent` talks to.
 */
export function connectProxy({ resolve = null, requireCredentials = false } = {}) {
  const asked = []

  return listener((socket) => {
    let head = ''
    let upstream = null

    socket.on('data', (data) => {
      if (upstream) return void upstream.write(data)

      head += data.toString()
      const end = head.indexOf('\r\n\r\n')
      if (end === -1) return

      const rest = Buffer.from(head.slice(end + 4), 'latin1')
      const [line, ...rawHeaders] = head.slice(0, end).split('\r\n')
      const headers = fields(rawHeaders)
      const credentials = basic(headers['proxy-authorization'])
      const [method, target] = line.split(' ')

      asked.push({ line, headers, credentials })

      if (method !== 'CONNECT') {
        return void socket.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n')
      }
      if (requireCredentials && credentials === null) {
        // What a proxy that wants a password answers, and what the agent turns into a
        // ProxyError naming the proxy.
        return void socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\n' +
            'Proxy-Authenticate: Basic realm="toy"\r\nContent-Length: 0\r\n\r\n'
        )
      }

      const at = target.lastIndexOf(':')
      const to = where(resolve, target.slice(0, at), Number(target.slice(at + 1)))
      if (to === null) {
        return void socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
      }

      upstream = tcp.createConnection(to)
      upstream.on('connect', () => socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'))
      if (rest.byteLength > 0) upstream.write(rest)
      join(socket, upstream)

      head = ''
    })
  }, asked)
}

/**
 * Enough of SOCKS5 (RFC 1928) to serve a client: greet, maybe authenticate, then connect
 * and pipe. What `barex-socks-proxy-agent` talks to.
 */
export function socks5Proxy({ resolve = null, requireCredentials = false } = {}) {
  const asked = []

  return listener((socket) => {
    let stage = 'greeting'
    let buffer = Buffer.alloc(0)
    let upstream = null
    let credentials = null

    socket.on('data', (data) => {
      if (upstream) return void upstream.write(data)
      buffer = Buffer.concat([buffer, data])
      step()
    })

    function step() {
      if (stage === 'greeting') {
        if (buffer.byteLength < 2) return
        const count = buffer[1]
        if (buffer.byteLength < 2 + count) return
        const methods = [...buffer.subarray(2, 2 + count)]
        buffer = buffer.subarray(2 + count)

        // 0x02 is username and password, 0x00 is none, 0xff is "none of what you offered".
        if (requireCredentials && !methods.includes(2)) {
          return void socket.end(Buffer.from([5, 0xff]))
        }
        socket.write(Buffer.from([5, requireCredentials ? 2 : 0]))
        stage = requireCredentials ? 'auth' : 'request'
        return step()
      }

      if (stage === 'auth') {
        if (buffer.byteLength < 2) return
        const ulen = buffer[1]
        if (buffer.byteLength < 3 + ulen) return
        const plen = buffer[2 + ulen]
        if (buffer.byteLength < 3 + ulen + plen) return

        credentials = {
          username: buffer.subarray(2, 2 + ulen).toString(),
          password: buffer.subarray(3 + ulen, 3 + ulen + plen).toString()
        }
        buffer = buffer.subarray(3 + ulen + plen)
        socket.write(Buffer.from([1, 0]))
        stage = 'request'
        return step()
      }

      if (buffer.byteLength < 5) return
      const type = buffer[3]
      let host
      let offset

      if (type === 3) {
        // A name, which is the whole point: the client did not resolve it, so the proxy is
        // the one that has to.
        const length = buffer[4]
        if (buffer.byteLength < 7 + length) return
        host = buffer.subarray(5, 5 + length).toString()
        offset = 5 + length
      } else if (type === 1) {
        if (buffer.byteLength < 10) return
        host = [...buffer.subarray(4, 8)].join('.')
        offset = 8
      } else {
        return void socket.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]))
      }

      const port = (buffer[offset] << 8) | buffer[offset + 1]
      const rest = buffer.subarray(offset + 2)
      asked.push({ host, port, credentials, type: type === 3 ? 'a name' : 'an address' })

      const to = where(resolve, host, port)
      if (to === null) {
        // 0x05 is "connection refused", which the agent reports in those words.
        return void socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
      }

      upstream = tcp.createConnection(to)
      upstream.on('connect', () => socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])))
      if (rest.byteLength > 0) upstream.write(rest)
      join(socket, upstream)
    }
  }, asked)
}

/** A port that accepts connections and then says nothing at all. */
export function silentPort() {
  return listener(() => {}, [])
}

// The plumbing below is shared by all of them.

function where(resolve, host, port) {
  if (resolve === null) return { host, port }
  return resolve(host, port)
}

async function listener(onconnection, asked) {
  const server = tcp.createServer((socket) => {
    socket.on('error', () => socket.destroy())
    onconnection(socket)
  })

  return { asked, ...(await listening(server)) }
}

function listening(server) {
  const open = new Set()

  server.on('connection', (socket) => {
    open.add(socket)
    socket.on('close', () => open.delete(socket))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close() {
          return new Promise((closed) => {
            for (const socket of open) socket.destroy()
            server.close(closed)
          })
        }
      })
    })
  })
}

// Everything the far end says, back to the client, and the two sockets tied together so
// that either closing takes the other down.
//
// Only the one direction: each proxy above is already forwarding client-to-upstream from
// its own `data` handler, which is where it has to be - that handler is what decides when
// the handshake has ended and the bytes stop being the proxy's business. Adding the other
// half here as well would write every chunk twice.
function join(client, upstream) {
  upstream.on('data', (data) => client.write(data))
  client.on('close', () => upstream.destroy())
  upstream.on('close', () => client.destroy())
  upstream.on('error', () => upstream.destroy())
}

function fields(raw) {
  const headers = {}
  for (const line of raw) {
    const at = line.indexOf(': ')
    if (at !== -1) headers[line.slice(0, at).toLowerCase()] = line.slice(at + 2)
  }
  return headers
}

function basic(value) {
  if (!value) return null
  const [scheme, encoded] = value.split(' ')
  if (scheme !== 'Basic') return null
  return Buffer.from(encoded, 'base64').toString()
}
