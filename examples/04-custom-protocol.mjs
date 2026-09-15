// Teaching `bare-proxy-agent` a proxy protocol of your own.
//
//   bare examples/04-custom-protocol.mjs
//
// SOCKS5 and `CONNECT` are two answers to one question — how do I ask this proxy to put me
// through to somewhere else — and `bare-proxy-agent` is the part that does not depend on
// the answer: a socket that is opened by handshake rather than by connecting, the agents
// built on it, and the reading and error types a handshake is written against.
//
// So a new protocol is a function. This one is made up: a line asking to be put through,
// and a line saying yes or no. Everything else here is what you would write for a real one.
import 'bare-fetch/global'
import tcp from 'bare-tcp'
import {
  ProxyError,
  ProxySocket,
  authority,
  createAgents,
  hasCredentials,
  parseProxyUrl,
  proxyErrorIn,
  proxyName
} from 'bare-proxy-agent'
import { hosts, origin } from './lib/toy-servers.mjs'

// ── the protocol ─────────────────────────────────────────────────────────────────────────

const SCHEMES = ['goto:']

// Reading the url is `parseProxyUrl`'s job, and the scheme list is all it needs from you.
// It refuses a url with no port, a url carrying a path, and a scheme it was not offered —
// so a handshake never has to wonder what it was handed.
function parse(url) {
  return parseProxyUrl(url, SCHEMES)
}

// The handshake. Called once per connection, on a socket to the proxy, with a `Reader` over
// it. Resolve and everything after belongs to the target; throw a `ProxyError` and the
// request fails with your words.
//
// Note what is *not* here: connecting, TLS to the proxy for a `goto+tls:` url, timing the
// proxy out, keeping whatever the target said before you stopped reading. The socket does
// all of that.
async function handshake({ socket, reader, proxy, target }) {
  const name = proxyName(proxy)

  // `authority` writes `host:port` the way a url and an http header both want it, with an
  // IPv6 host in brackets.
  const to = authority(target)

  // This line is built here rather than by an http client, so nothing upstream has checked
  // it for the characters that end one. A target carrying a newline would add a line to the
  // conversation that the caller never wrote — a second GOTO, somewhere else, being the one
  // that matters.
  if (/[\r\n\0\s]/.test(to)) throw new ProxyError(`not a host and port to go to: ${to}`)

  if (hasCredentials(proxy)) socket.write(`AUTH ${proxy.username} ${proxy.password}\n`)
  socket.write(`GOTO ${to}\n`)

  // `until` reads up to and including a delimiter; `read` reads an exact count. Either
  // throws a ProxyError naming the proxy if it fails or hangs up mid-sentence, so there is
  // no error handling to write for those.
  const answer = (await reader.until('\n')).toString().trim()

  if (answer === 'DENIED') {
    throw new ProxyError(`${name} wants credentials — put a username and password in the url`)
  }
  if (answer !== 'OPEN') {
    throw new ProxyError(`${name} would not put us through to ${to}: ${answer.toLowerCase()}`)
  }
}

// And that is the protocol. The rest is the same two lines every package here ends with.
function tunnel(proxy) {
  return { proxy: typeof proxy === 'string' ? parse(proxy) : proxy, handshake }
}

function agentsFor(proxy, opts) {
  return createAgents(tunnel(proxy), opts)
}

// ── a proxy that speaks it ───────────────────────────────────────────────────────────────

const target = await origin()
const echo = await echoServer()
const resolve = hosts({ 'origin.example': target.port, 'echo.example': echo.port })

const proxy = await gotoProxy({ resolve, password: 'hunter2' })

// ── going through it ─────────────────────────────────────────────────────────────────────

const agents = agentsFor(`goto://alice:hunter2@127.0.0.1:${proxy.port}`, {
  handshakeTimeout: 5000
})

// Every pair made below goes in here, to be shut down at the end.
const open = [agents]

const response = await fetch('http://origin.example/hello', { agent: agents.http })
console.log('through the agent:', await response.text())
console.log('the proxy was asked:', proxy.asked.join(' | '))
console.log()

// ── and through the socket, for something that is not http ───────────────────────────────

// `ProxySocket` is a `Duplex`, and an agent is only the thing that hands one to an http
// client. Anything that speaks a stream can hold one directly — which is how you would
// route a protocol that is not http at all through the same proxy.
const socket = new ProxySocket(tunnel(`goto://alice:hunter2@127.0.0.1:${proxy.port}`), {
  host: 'echo.example',
  port: 80
})

// Writes made before the handshake finishes are held by the stream and go out after it, so
// there is nothing to wait for before writing. This is also what lets a TLS socket be
// layered straight on top of one: its ClientHello is written during construction.
socket.write('anyone there?\n')

const heard = await new Promise((resolve) => socket.once('data', resolve))
console.log('through the socket:', heard.toString().trim())
console.log('  the far end of it:', `${socket.remoteAddress}:${socket.remotePort}`, '— the proxy')
console.log('  where it is going:', `${socket.target.host}:${socket.target.port}`)
socket.destroy()
console.log()

// ── failures ─────────────────────────────────────────────────────────────────────────────

// Each of these is a `ProxyError` thrown by the handshake above, found again with
// `proxyErrorIn` after bare-fetch wrapped it in a `NETWORK_ERROR`.
const cases = [
  ['a target the proxy will not reach', 'http://nowhere.example/', agents.http],
  ['no credentials for a proxy that wants them', 'http://origin.example/', anonymous().http]
]

for (const [what, url, agent] of cases) {
  const err = await fetch(url, { agent }).then(
    () => null,
    (err) => proxyErrorIn(err)
  )
  console.log(`${what}:\n  ${err.message}`)
}

// A url this protocol does not speak is refused by `parseProxyUrl`, with the schemes named.
try {
  parse('socks5://127.0.0.1:1080')
} catch (err) {
  console.log(`a url for somebody else's protocol:\n  ${err.message}`)
}

function anonymous() {
  const pair = agentsFor(`goto://127.0.0.1:${proxy.port}`)
  open.push(pair)
  return pair
}

for (const pair of open) {
  pair.http.destroy()
  pair.https.destroy()
}
for (const server of [target, echo, proxy]) await server.close()

// ── the far ends, which are scaffolding rather than the point ────────────────────────────

// A proxy that speaks the protocol above: `AUTH user pass`, then `GOTO host:port`, then it
// puts the two sockets together.
function gotoProxy({ resolve, password }) {
  const asked = []

  return listen((socket) => {
    let head = ''
    let upstream = null
    let authenticated = false

    socket.on('data', (data) => {
      if (upstream) return void upstream.write(data)

      head += data.toString()

      for (let end = head.indexOf('\n'); end !== -1; end = head.indexOf('\n')) {
        const line = head.slice(0, end).trim()
        head = head.slice(end + 1)
        asked.push(line)

        if (line.startsWith('AUTH ')) {
          authenticated = line.split(' ')[2] === password
          continue
        }
        if (!line.startsWith('GOTO ')) return void socket.end('WHAT\n')
        if (!authenticated) return void socket.end('DENIED\n')

        const to = line.slice(5)
        const at = to.lastIndexOf(':')
        const where = resolve(to.slice(0, at), Number(to.slice(at + 1)))
        if (where === null) return void socket.end('NO ROUTE TO THAT HOST\n')

        upstream = tcp.createConnection(where)
        upstream.on('connect', () => socket.write('OPEN\n'))
        upstream.on('data', (chunk) => socket.write(chunk))
        upstream.on('error', () => upstream.destroy())
        upstream.on('close', () => socket.destroy())
        socket.on('close', () => upstream.destroy())

        if (head.length > 0) {
          upstream.write(Buffer.from(head, 'latin1'))
          head = ''
        }
        return
      }
    })
  }, asked)
}

function echoServer() {
  return listen((socket) => socket.on('data', (data) => socket.write(data)), [])
}

function listen(onconnection, asked) {
  const open = new Set()

  const server = tcp.createServer((socket) => {
    open.add(socket)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => open.delete(socket))
    onconnection(socket)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        asked,
        port: server.address().port,
        close: () =>
          new Promise((closed) => {
            for (const socket of open) socket.destroy()
            server.close(closed)
          })
      })
    })
  })
}
