// Asking an http proxy for a tunnel, and what the proxy does and does not get to see.
//
//   bare examples/02-connect-tunnel.mjs
//
// `CONNECT` is the method that turns an http proxy into a pipe: the proxy opens a socket to
// where it was told, answers `200`, and from then on carries bytes without reading them.
// That is what makes end-to-end TLS through a proxy possible, and it is what
// `barex-https-proxy-agent` speaks.
//
// The target here is a plain http origin, so that everything is visible in the transcript.
// A real `https:` target works the same way, with `agents.https` negotiating TLS inside the
// tunnel the proxy opened - at which point the proxy is carrying ciphertext.
import 'bare-fetch/global'
import { createAgents, HttpsProxyHTTPAgent, proxyErrorIn } from 'barex-https-proxy-agent'
import { connectProxy, hosts, origin } from './lib/toy-servers.mjs'

const target = await origin()
const proxy = await connectProxy({
  resolve: hosts({ 'origin.example': target.port }),
  requireCredentials: true
})

// -- credentials, and headers that are the proxy's rather than the target's ---------------

// Credentials go in the proxy url, as every proxy agent takes them, and leave as
// `Proxy-Authorization` on the CONNECT - never on the request inside the tunnel, which the
// proxy is not reading.
//
// `headers` is the rest of what the proxy is told. Given as a function it is called once
// per tunnel, so a value that changes - a rotating token, a request id - is read when the
// tunnel is opened rather than when the agent was made.
let opened = 0
const agents = createAgents(`http://alice:hunter2@127.0.0.1:${proxy.port}`, {
  headers: () => ({ 'Proxy-Trace': `tunnel-${++opened}`, 'X-Left-Out': null }),
  handshakeTimeout: 5000
})

// `agents.http` for an `http:` target, `agents.https` for an `https:` one. The pair exists
// because `bare-http1` tells an agent nothing about where a request is going, so the scheme
// *is* the agent - see NODE-COMPATIBILITY.md.
const first = await fetch('http://origin.example/one', { agent: agents.http })
console.log('response:', await first.text())

// Keep-alive means the second request reuses the tunnel: one CONNECT, two requests. A
// reused tunnel is a handshake that is not spoken again, which matters more here than on a
// direct connection.
const second = await fetch('http://origin.example/two', { agent: agents.http })
await second.text()

console.log()
console.log(`tunnels opened:  ${proxy.asked.length}`)
console.log(`requests made:   ${target.seen.length}`)
console.log()

// -- what each hop saw --------------------------------------------------------------------

const [asked] = proxy.asked
console.log('the proxy was asked for:', asked.line)
console.log('  with credentials:     ', asked.credentials)
console.log('  and headers:          ', {
  'proxy-trace': asked.headers['proxy-trace'],
  'x-left-out': asked.headers['x-left-out'] ?? '(a null value is left out)'
})
console.log()

// Nothing the proxy was told reaches the target: the tunnel starts after the blank line,
// and the request written into it is the caller's alone.
console.log('the origin was asked for:', target.seen.map((seen) => seen.url).join(', '))
console.log('  proxy-authorization:  ', target.seen[0].headers['proxy-authorization'] ?? '(none)')
console.log('  proxy-trace:          ', target.seen[0].headers['proxy-trace'] ?? '(none)')
console.log()

// -- the failures worth recognising -------------------------------------------------------

// A proxy failure reaches the caller through whatever made the request: `bare-fetch`
// answers every failure with `NETWORK_ERROR` and keeps the reason as its cause, so
// `proxyErrorIn` is how the reason is found again rather than `instanceof`.
const anonymous = createAgents(`http://127.0.0.1:${proxy.port}`)
const refused = await fetch('http://origin.example/three', { agent: anonymous.http }).then(
  () => null,
  (err) => err
)

console.log('what fetch threw: ', `${refused.name}: ${refused.message}`)
console.log('what went wrong:  ', proxyErrorIn(refused).message)
console.log()

const tunnelsSoFar = proxy.asked.length

// A standalone plaintext agent rejects an HTTPS target on every port. The linked pair
// above would delegate to its HTTPS member instead, including across redirects.
const plaintext = new HttpsProxyHTTPAgent(`http://127.0.0.1:${proxy.port}`)
const downgrade = await fetch('https://origin.example:8443/vault', { agent: plaintext }).then(
  () => null,
  (err) => proxyErrorIn(err)
)
console.log('the guard on the base agent:', downgrade.message)
console.log('and no tunnel was asked for:', proxy.asked.length === tunnelsSoFar)

agents.http.destroy()
plaintext.destroy()
agents.https.destroy()
anonymous.http.destroy()
anonymous.https.destroy()
for (const server of [target, proxy]) await server.close()
