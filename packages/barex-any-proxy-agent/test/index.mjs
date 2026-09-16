// The table: that every scheme lands on the package that speaks it, and that one nothing
// speaks is refused rather than passed over.
import test from 'brittle'
import 'bare-fetch/global'
import tcp from 'bare-tcp'
import https from 'bare-https'
import { cert, key } from '../../../test/fixtures/tls.mjs'
import { HttpProxyAgent } from 'barex-http-proxy-agent'
import { HttpsProxyHTTPAgent, HttpsProxyHTTPSAgent } from 'barex-https-proxy-agent'
import { SocksProxyHTTPAgent, SocksProxyHTTPSAgent } from 'barex-socks-proxy-agent'
import { createAgents, parse, protocols, proxyErrorIn, proxyName } from '../index.mjs'

test('every scheme there is an agent for', (t) => {
  t.alike(protocols, ['socks5', 'socks5h', 'http', 'https'])
})

test('a socks proxy makes a pair of socks agents', (t) => {
  const agents = destroyed(t, createAgents('socks5://127.0.0.1:1080'))
  t.ok(agents.http instanceof SocksProxyHTTPAgent)
  t.ok(agents.https instanceof SocksProxyHTTPSAgent)
  t.is(agents.http.proxyUrl, 'socks5://127.0.0.1:1080')
})

test('socks5h is the same proxy, spelled the way it was configured', (t) => {
  const agents = destroyed(t, createAgents('socks5h://127.0.0.1:1080'))
  t.ok(agents.https instanceof SocksProxyHTTPSAgent)
  t.is(agents.https.proxyUrl, 'socks5h://127.0.0.1:1080')
})

// The one scheme where the two agents are not the same protocol: an http: target is
// forwarded to the proxy, an https: one is asked for as a tunnel.
test('an http proxy forwards http targets and tunnels https ones', (t) => {
  const agents = destroyed(t, createAgents('http://127.0.0.1:3128'))
  t.ok(agents.http instanceof HttpProxyAgent, 'forwarded')
  t.ok(agents.https instanceof HttpsProxyHTTPSAgent, 'tunnelled')
  t.absent(
    agents.https instanceof HttpsProxyHTTPAgent,
    'and not through the tunnel meant for http:'
  )
})

test('an https proxy is the same, reached over TLS', (t) => {
  const agents = destroyed(t, createAgents('https://proxy.example:8443'))
  t.ok(agents.http instanceof HttpProxyAgent)
  t.ok(agents.https instanceof HttpsProxyHTTPSAgent)
  t.is(agents.http.proxy.secure, true, 'the first hop is TLS')
  t.is(agents.http.proxy.port, 8443)
})

// Every scheme here has a port some client somewhere treats as its default, and no two agree
// — so none of them is guessed. The one word costs less than a Proxy-Authorization header
// handed to whatever was listening on the guess.
test('a proxy url with no port is refused, whatever its scheme', (t) => {
  for (const url of ['http://proxy.lan', 'https://proxy.lan', 'socks5://127.0.0.1']) {
    t.exception.all(() => parse(url), /names no port/, url)
    t.exception.all(() => createAgents(url), /names no port/, url)
  }
})

test('a url is read once, and what it read can be handed back', (t) => {
  const proxy = parse('socks5://me:s3cret@127.0.0.1:1080')
  t.is(proxyName(proxy), 'socks5://127.0.0.1:1080', 'the address, never the password')

  const agents = destroyed(t, createAgents(proxy))
  t.is(agents.http.proxy, proxy, 'the same object, not parsed a second time')
})

test('a URL is taken as readily as a string', (t) => {
  const agents = destroyed(t, createAgents(new URL('http://proxy.lan:3128')))
  t.is(agents.http.proxyUrl, 'http://proxy.lan:3128')
})

test('a scheme nothing here speaks is refused, with the ones it does named', (t) => {
  t.exception.all(() => parse('ftp://127.0.0.1:21'), /unsupported proxy scheme/)
  t.exception.all(
    () => parse('ftp://127.0.0.1:21'),
    /socks5:\/\/, socks5h:\/\/, http:\/\/, https:\/\//
  )
  t.exception.all(() => createAgents('ftp://127.0.0.1:21'), /unsupported proxy scheme/)
  t.exception.all(() => parse('not a url'), /not a proxy url/)
  t.exception.all(() => parse('http://proxy.lan/path'), /a host and a port only/)
})

test('options reach the agent the scheme called for', (t) => {
  const agents = destroyed(
    t,
    createAgents('http://proxy.lan:3128', { headers: { 'X-Probe': '1' } })
  )
  t.alike(agents.http.proxyHeaders, { 'X-Probe': '1' })
})

test(
  'standalone plaintext agents reject HTTPS on a nonstandard port before opening sockets',
  { timeout: 3000 },
  async (t) => {
    for (const agent of [
      new HttpProxyAgent('http://127.0.0.1:1'),
      new HttpsProxyHTTPAgent('http://127.0.0.1:1'),
      new SocksProxyHTTPAgent('socks5://127.0.0.1:1')
    ]) {
      t.teardown(() => agent.destroy())
      const error = await fetch('https://secret.example:8443/vault', { agent }).then(
        () => null,
        (err) => proxyErrorIn(err)
      )
      t.is(error?.code, 'PROXY_ERROR')
      t.ok(error?.message.includes('https: target on port 8443'))
      t.is([...agent.sockets].length, 0, 'no connection was opened')
    }
  }
)

function destroyed(t, agents) {
  t.teardown(() => {
    agents.http.destroy()
    agents.https.destroy()
  })
  return agents
}

test(
  'redirects switch between forwarding and TLS on the same nonstandard port',
  { timeout: 5000 },
  async (t) => {
    const received = []
    const origin = https.createServer({ cert, key }, (req, res) => {
      received.push({ path: req.url, authorization: req.headers['proxy-authorization'] })
      if (req.url === '/back') {
        res.writeHead(302, { location: `http://localhost:${origin.address().port}/final` })
        res.end()
      } else res.end('encrypted response')
    })
    await listen(t, origin)
    const targetPort = origin.address().port
    const lines = []
    const proxy = tcp.createServer((socket) => {
      let head = ''
      const ondata = (chunk) => {
        head += chunk.toString()
        const end = head.indexOf('\r\n\r\n')
        if (end === -1) return
        const line = head.slice(0, head.indexOf('\r\n'))
        lines.push(line)
        if (line.startsWith('CONNECT ')) {
          socket.off('data', ondata)
          const upstream = tcp.createConnection({ host: '127.0.0.1', port: targetPort })
          upstream.on('error', () => socket.destroy())
          socket.on('close', () => upstream.destroy())
          const rest = Buffer.from(head.slice(end + 4))
          if (rest.length) upstream.write(rest)
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          socket.pipe(upstream).pipe(socket)
        } else {
          const target = new URL(line.split(' ')[1])
          if (target.pathname === '/final') {
            socket.write('HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\ndone')
          } else {
            socket.write(
              `HTTP/1.1 302 Found\r\nLocation: https://localhost:${targetPort}/secure\r\nContent-Length: 0\r\n\r\n`
            )
          }
          head = ''
        }
      }
      socket.on('error', () => {})
      socket.on('data', ondata)
    })
    await listen(t, proxy)
    const agents = destroyed(
      t,
      createAgents(`http://user:password@127.0.0.1:${proxy.address().port}`, { ca: cert })
    )

    const response = await fetch(`http://localhost:${targetPort}/start`, { agent: agents.http })
    t.is(await response.text(), 'encrypted response')
    // Start on the TLS member too; the redirect must reach the forwarding member.
    const back = await fetch(`https://localhost:${targetPort}/back`, { agent: agents.https })
    t.is(await back.text(), 'done')
    t.alike(
      lines,
      [
        `GET http://localhost:${targetPort}/start HTTP/1.1`,
        `CONNECT localhost:${targetPort} HTTP/1.1`,
        `GET http://localhost:${targetPort}/final HTTP/1.1`
      ],
      'the redirect did not reuse a plaintext socket for TLS or forward a TLS request'
    )
    t.alike(
      received,
      [
        { path: '/secure', authorization: undefined },
        { path: '/back', authorization: undefined }
      ],
      'origin requests keep origin-form and carry no proxy credentials'
    )
  }
)

function listen(t, server) {
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
  })
  t.teardown(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(resolve)
      })
  )
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}
