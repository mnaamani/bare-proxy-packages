// Why the request failed, and how to get that out of what you were thrown.
//
//   bare examples/06-diagnosing-failures.mjs
//
// A proxy failure is almost never reported by the thing that noticed it. `bare-fetch`
// answers every failure with `NETWORK_ERROR: Network error` and keeps the reason as its
// `cause`; a library above that may wrap it again. So the error a caller catches says
// nothing, and `instanceof ProxyError` is false.
//
// `proxyErrorIn` is the way back: it walks the `cause` chain and answers with the proxy
// error, or null when the failure was not a proxy's. That distinction is the useful one —
// it is the difference between "your proxy is not running" and "that host is down", which
// are fixed by different people.
import 'bare-fetch/global'
import { createAgents as socksAgents } from 'bare-socks-proxy-agent'
import { createAgents as connectAgents } from 'bare-https-proxy-agent'
import { proxyErrorIn } from 'bare-proxy-agent'
import { connectProxy, hosts, origin, silentPort, socks5Proxy } from './lib/toy-servers.mjs'

const target = await origin()
const resolve = hosts({ 'origin.example': target.port })

const socks = await socks5Proxy({ resolve })
const guarded = await socks5Proxy({ resolve, requireCredentials: true })
const http = await connectProxy({ resolve })
const silent = await silentPort()

// A port nothing is listening on. Opened and closed, so that the number is one nothing
// else has taken.
const closed = await silentPort()
const closedPort = closed.port
await closed.close()

const open = []

function agents(pair) {
  open.push(pair)
  return pair
}

// ── the shape of a failure ───────────────────────────────────────────────────────────────

const pair = agents(socksAgents(`socks5://127.0.0.1:${closedPort}`))
const thrown = await fetch('http://origin.example/', { agent: pair.http }).then(
  () => null,
  (err) => err
)

console.log('what the caller catches:')
console.log(`  ${thrown.name}: ${thrown.message}   (code ${thrown.code})`)
console.log('  instanceof ProxyError:', proxyErrorIn(thrown) === thrown)
console.log()
console.log('what proxyErrorIn finds, however deep:')
console.log(`  ${proxyErrorIn(thrown).message}   (code ${proxyErrorIn(thrown).code})`)
console.log()

// Wrapped again, twice over, as a library layered on top of fetch would. The chain is
// followed rather than the error inspected, so depth does not matter.
const buried = new Error('could not load the profile', {
  cause: new Error('the request failed', { cause: thrown })
})
console.log('buried two levels down:', proxyErrorIn(buried)?.code)

// And a failure that is nobody's proxy answers null, which is the answer a caller acts on.
console.log('an ordinary failure:    ', proxyErrorIn(new Error('disk full')))
console.log()

// ── the failures worth telling apart ─────────────────────────────────────────────────────

const cases = [
  [
    'nothing is listening on the proxy port',
    'http://origin.example/',
    agents(socksAgents(`socks5://127.0.0.1:${closedPort}`)).http
  ],
  [
    'something is listening, but it is not a proxy',
    'http://origin.example/',
    // A port that accepts the connection and then says nothing would leave the request
    // waiting there, so the handshake has a deadline of its own. It is `handshakeTimeout`
    // rather than `timeout`, which bare-http1 has already taken for the socket's idle
    // timeout — the one option in these packages with no counterpart in Node's.
    agents(socksAgents(`socks5://127.0.0.1:${silent.port}`, { handshakeTimeout: 300 })).http
  ],
  [
    'the port speaks something else entirely',
    'http://origin.example/',
    // A SOCKS5 client pointed at an http server. It answers — with `HTTP/1.1 400`, whose
    // first byte is not 5 — so this is caught by the handshake rather than by a timeout.
    agents(socksAgents(`socks5://127.0.0.1:${target.port}`)).http
  ],
  [
    'the proxy wants credentials and has none',
    'http://origin.example/',
    agents(socksAgents(`socks5://127.0.0.1:${guarded.port}`)).http
  ],
  [
    'the proxy cannot reach the target',
    'http://nowhere.example/',
    agents(socksAgents(`socks5://127.0.0.1:${socks.port}`)).http
  ],
  [
    'an https: target reached the agent built for http:',
    'https://origin.example/vault',
    agents(connectAgents(`http://127.0.0.1:${http.port}`)).http
  ]
]

for (const [what, url, agent] of cases) {
  const err = await fetch(url, { agent }).then(
    () => null,
    (err) => proxyErrorIn(err)
  )
  console.log(`${what}\n  → ${err.message}\n`)
}

// ── and a failure that is not the proxy's ────────────────────────────────────────────────

// The proxy did its job: it reached the target, and the target answered 502. There is no
// ProxyError here, and there should not be — the request succeeded as far as the proxy is
// concerned, and a caller that treats every failure as a proxy problem would blame the
// wrong hop.
const working = agents(socksAgents(`socks5://127.0.0.1:${socks.port}`))
const answered = await fetch('http://origin.example/broken', { agent: working.http })

console.log("the target answered badly, and that is the target's business")
console.log(`  → HTTP ${answered.status} ${await answered.text()}`)
console.log('  → proxyErrorIn has nothing to say about it:', proxyErrorIn(null))

for (const pair of open) {
  pair.http.destroy()
  pair.https.destroy()
}
for (const server of [target, socks, guarded, http, silent]) await server.close()
