// The base on its own: url reading, and a ProxySocket driven by a handshake of the test's
// own invention. Nothing here speaks SOCKS5 or CONNECT - those are the two packages that
// depend on this one, and each tests its own protocol.
import 'bare-fetch/global'
import test from 'brittle'
import './reader.mjs'
import tcp from 'bare-tcp'
import http from 'bare-http1'
import {
  ProxyError,
  ProxyHTTPAgent,
  ProxyHTTPSAgent,
  ProxySocket,
  authority,
  createAgents,
  hasCredentials,
  parseProxyUrl,
  proxyErrorIn,
  proxyName
} from '../index.mjs'

const SCHEMES = ['demo:']

test('a proxy url is read into a host, a port and credentials', (t) => {
  t.alike(parseProxyUrl('demo://127.0.0.1:1080', SCHEMES), {
    protocol: 'demo:',
    host: '127.0.0.1',
    port: 1080,
    username: '',
    password: '',
    secure: false
  })
  t.exception.all(
    () => parseProxyUrl('demo://127.0.0.1', SCHEMES),
    /names no port/,
    'a port is written down, never guessed'
  )
  t.is(parseProxyUrl('demo://[::1]:1080', SCHEMES).host, '::1', 'an ipv6 host loses its brackets')

  const withCredentials = parseProxyUrl('demo://me:s3%3Acret@127.0.0.1:1080', SCHEMES)
  t.alike([withCredentials.username, withCredentials.password], ['me', 's3:cret'])
  t.ok(hasCredentials(withCredentials))
  t.absent(hasCredentials(parseProxyUrl('demo://127.0.0.1:1080', SCHEMES)))
})

test('anything that is not a proxy address is refused', (t) => {
  t.exception.all(() => parseProxyUrl('not a url', SCHEMES), /not a proxy url/)
  t.exception.all(() => parseProxyUrl('ftp://127.0.0.1:21', SCHEMES), /unsupported proxy scheme/)
  t.exception.all(() => parseProxyUrl('demo://127.0.0.1:1/path', SCHEMES), /host and a port only/)
  t.exception.all(() => parseProxyUrl('demo://127.0.0.1:1?x=1', SCHEMES), /host and a port only/)
})

test('a proxy is named by the address it was configured with, never its password', (t) => {
  const proxy = parseProxyUrl('demo://me:s3cret@[::1]:1080', SCHEMES)
  t.is(proxyName(proxy), 'demo://[::1]:1080')
  t.is(authority({ host: 'origin.example', port: 443 }), 'origin.example:443')
  t.is(authority({ host: '::1', port: 443 }), '[::1]:443', 'an ipv6 host goes back in brackets')
})

test('proxy URL validation errors never echo credentials', (t) => {
  const urls = [
    'http://alice:s3cret@proxy.lan:8080/path',
    'http://alice:s3cret@proxy.lan:8080?password=s3cret',
    'http://alice:s3cret@proxy.lan:8080#s3cret',
    'http://alice:s3cret@proxy.lan',
    'http://alice:s3cret@proxy.lan:invalid',
    'http://alice:s3cret@[invalid]:8080',
    'demo://alice:s3cret@:8080',
    'ftp://alice:s3cret@proxy.lan:21',
    'http://alice:s3cret%ZZ@proxy.lan:8080',
    'http://alice%ZZ:s3cret@proxy.lan:8080',
    'alice:s3cret@not a URL'
  ]
  for (const url of urls) {
    let error
    try {
      parseProxyUrl(url, ['http:', 'demo:'])
    } catch (err) {
      error = err
    }
    t.ok(error instanceof Error, 'invalid proxy rejected')
    t.absent(/alice|s3cret/.test(String(error)), 'credentials are absent from the error')
  }
  t.exception.all(
    () => parseProxyUrl('http://alice:s3cret@proxy.lan:8080/path', ['http:']),
    /host and a port only: http:\/\/proxy.lan:8080/,
    'a parsed URL still names the address to fix'
  )
})

test('a proxy error is found again however deeply it has been wrapped', (t) => {
  const proxied = new ProxyError('the proxy said no')
  const wrapped = new Error('Network error', { cause: new Error('lost', { cause: proxied }) })
  t.is(proxyErrorIn(wrapped), proxied)
  t.is(proxyErrorIn(new Error('something else')), null)
  t.is(proxied.name, 'ProxyError')
})

test('an agent carries the proxy it was built with, and what it speaks', (t) => {
  const proxy = parseProxyUrl('demo://me:s3cret@127.0.0.1:1080', SCHEMES)
  const agent = new ProxyHTTPAgent({ proxy, handshake }, { handshakeTimeout: 200 })
  t.teardown(() => agent.destroy())

  t.is(agent.proxy, proxy)
  t.is(agent.proxyUrl, 'demo://127.0.0.1:1080', 'the address, never the password')
  t.is(agent.tunnel.timeout, 200, 'and the handshake timeout reaches the connection')
  t.alike(ProxyHTTPAgent.protocols, [], 'which schemes it speaks is for its package to say')
})

test('a request goes out over whatever the handshake opened', async (t) => {
  const origin = await server(t)
  const proxy = await demoProxy(t)
  const agents = agentsFor(t, proxy.port)

  const response = await fetch(`http://127.0.0.1:${origin.port}/hello`, { agent: agents.http })

  t.is(await response.text(), 'hello from the origin')
  t.alike(proxy.asked, [`127.0.0.1:${origin.port}`], 'the handshake was told where to go')
  t.is(origin.seen[0].from, '127.0.0.1', 'and the origin saw the proxy')
})

// Every http-target agent writes the request to whatever the handshake opened, with nothing
// negotiated on top, so port 443 means an https: target has reached the agent built for
// http: - which is what bare-fetch does when it follows a redirect that changes scheme,
// since it keeps the agent it was handed and an agent under bare-http1 *is* the scheme.
test('the http agent refuses to carry a plain request to port 443', async (t) => {
  const proxy = await demoProxy(t)
  const agent = new ProxyHTTPAgent({
    proxy: parseProxyUrl(`demo://127.0.0.1:${proxy.port}`, SCHEMES),
    handshake
  })
  t.teardown(() => agent.destroy())

  const err = await fetch('https://secret.example/vault', { agent }).then(
    () => null,
    (err) => proxyErrorIn(err) ?? err
  )

  t.is(err?.code, 'PROXY_ERROR')
  t.ok(/port 443/.test(err.message), err.message)
  t.alike(proxy.asked, [], 'and the handshake was never spoken')
})

test(
  'the https agent is the one that may, since it is the one that runs TLS',
  { timeout: 3000 },
  async (t) => {
    const targetPort = await listener(t, (socket) => socket.once('data', () => socket.destroy()))
    const proxy = await demoProxy(t)
    const agents = agentsFor(t, proxy.port)

    // No TLS server behind the demo proxy, so this fails - but at the handshake having been
    // spoken, which is the half being asserted.
    await fetch(`https://secret.example:${targetPort}/vault`, { agent: agents.https }).catch(
      () => {}
    )

    t.alike(proxy.asked, [`secret.example:${targetPort}`])
  }
)

test(
  'a stalled TLS handshake reports the socket timeout to the request',
  { timeout: 3000 },
  async (t) => {
    const port = await listener(t, (socket) => socket.resume())
    const agent = new ProxyHTTPSAgent(
      {
        proxy: parseProxyUrl(`demo://127.0.0.1:${port}`, SCHEMES),
        handshake() {}
      },
      { timeout: 50 }
    )
    t.teardown(() => agent.destroy())

    const req = http.get({ host: 'secret.example', port: 443, agent })
    req.on('error', () => {})
    await new Promise((resolve) => {
      req.once('timeout', () => {
        t.pass('the request receives the underlying timeout during TLS negotiation')
        req.destroy()
      })
      req.once('close', resolve)
    })
  }
)

test('TLS socket timeout callbacks run once on the wrapper', { timeout: 3000 }, async (t) => {
  const port = await listener(t, (socket) => socket.resume())
  const agent = new ProxyHTTPSAgent({
    proxy: parseProxyUrl(`demo://127.0.0.1:${port}`, SCHEMES),
    handshake() {}
  })
  t.teardown(() => agent.destroy())
  const socket = agent.createConnection({ host: 'secret.example', port: 443 })
  socket.on('error', () => {})
  t.teardown(() => socket.destroy())
  let calls = 0
  const cancelled = () => t.fail('disabled timeout callback ran')
  socket.setTimeout(50, cancelled).setTimeout(0, cancelled)
  await new Promise((resolve) => {
    socket.setTimeout(50, function () {
      calls++
      t.is(this, socket)
      resolve()
    })
  })
  socket.socket.emit('timeout')
  t.is(calls, 1)
  const closed = new Promise((resolve) => socket.once('close', resolve))
  socket.destroy()
  await closed
  t.is(socket.socket.listenerCount('timeout'), 0, 'the relay is removed on close')
})

test('bytes the target already sent are kept, not lost with the handshake', async (t) => {
  // The proxy answers its handshake and the target's first bytes in one write, which is
  // what a real one does whenever the target is quick.
  const proxy = await demoProxy(t, { greeting: 'early bytes\n' })
  const socket = new ProxySocket(
    { proxy: parseProxyUrl(`demo://127.0.0.1:${proxy.port}`, SCHEMES), handshake },
    { host: 'target.example', port: 80 }
  )
  t.teardown(() => socket.destroy())

  const first = await new Promise((resolve) => socket.once('data', resolve))
  t.is(first.toString(), 'early bytes\n')
})

test('a proxy that never answers gives up rather than waiting for good', async (t) => {
  const port = await listener(t, () => {}) // accepts, says nothing
  const socket = new ProxySocket(
    { proxy: parseProxyUrl(`demo://127.0.0.1:${port}`, SCHEMES), handshake, timeout: 200 },
    { host: 'target.example', port: 80 }
  )

  const err = await new Promise((resolve) => socket.once('error', resolve))
  t.is(err.code, 'PROXY_ERROR')
  t.ok(/did not answer within 0.2s/.test(err.message), err.message)
})

test('a socket an agent is done with can be settled before it is even open', (t) => {
  // The order bare-http1 uses when it hands a connection back: these all land while the
  // handshake is still in flight, and must be applied to the socket once there is one.
  const socket = new ProxySocket(
    { proxy: parseProxyUrl('demo://127.0.0.1:1', SCHEMES), handshake },
    { host: 'target.example', port: 80 }
  )
  t.is(socket.setKeepAlive(true, 1000), socket)
  t.is(socket.setNoDelay(true), socket)
  t.is(socket.setTimeout(5000), socket)
  t.is(socket.unref(), socket)
  t.is(socket.ref(), socket)
  t.alike(socket.target, { host: 'target.example', port: 80 })
  socket.destroy()
  t.pass('and none of them threw with no socket underneath')
})

// A handshake of the test's own: say where we are going, be told it is open. Two lines,
// which is all the base needs to know about any protocol.
async function handshake({ socket, reader, proxy, target }) {
  socket.write(`GOTO ${authority(target)}\n`)
  const answer = (await reader.until('\n')).toString().trim()
  if (answer !== 'OPEN') throw new ProxyError(`${proxyName(proxy)} answered ${answer}`)
}

function agentsFor(t, port) {
  const agents = createAgents({
    proxy: parseProxyUrl(`demo://127.0.0.1:${port}`, SCHEMES),
    handshake
  })
  t.teardown(() => {
    agents.http.destroy()
    agents.https.destroy()
  })
  return agents
}

// The other side of it: read the line, open the tunnel, pipe.
function demoProxy(t, { greeting = '' } = {}) {
  const asked = []
  const port = listener(t, (socket) => {
    let head = ''
    let upstream = null
    socket.on('data', (data) => {
      if (upstream) return upstream.write(data)

      head += data.toString()
      const end = head.indexOf('\n')
      if (end === -1) return

      const rest = Buffer.from(head.slice(end + 1))
      const to = head.slice(0, end).replace('GOTO ', '')
      asked.push(to)
      socket.write(`OPEN\n${greeting}`)

      upstream = tcp.createConnection({ port: Number(to.split(':')[1]), host: '127.0.0.1' })
      upstream.on('data', (chunk) => socket.write(chunk))
      upstream.on('end', () => socket.end())
      upstream.on('error', () => socket.destroy())
      upstream.on('close', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
      if (rest.byteLength > 0) upstream.write(rest)
    })
  })

  return port.then((port) => ({ port, asked }))
}

// An http server to be proxied to, which records the address each request came from.
function server(t) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ from: req.socket.remoteAddress, url: req.url })
    res.end('hello from the origin')
  })
  close(t, server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen }))
  })
}

function listener(t, onconnection) {
  const server = tcp.createServer((socket) => {
    socket.on('error', () => socket.destroy())
    onconnection(socket)
  })
  close(t, server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

// A server does not finish closing while a connection is open, and the whole point of the
// agents is to keep one open between requests. So the connections come down with it.
function close(t, server) {
  const open = new Set()
  server.on('connection', (socket) => {
    open.add(socket)
    socket.on('close', () => open.delete(socket))
  })
  t.teardown(
    () =>
      new Promise((resolve) => {
        for (const socket of open) socket.destroy()
        server.close(resolve)
      })
  )
}
