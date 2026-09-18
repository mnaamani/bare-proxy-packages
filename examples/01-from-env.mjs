// Routing a program's traffic the way the environment asked for it.
//
//   bare examples/01-from-env.mjs
//
// This is the pairing most programs want: `barex-proxy-from-env` reads the convention the
// unix world agreed on, and `barex-any-proxy-agent` turns whatever it found into the agents
// `bare-fetch` and `bare-ws` take. Neither knows about the other; the url in the middle is
// the whole interface.
//
// The variables are set here rather than inherited, so the example runs the same wherever
// it is started, and so that `no_proxy` has something to carve a hole in.
import 'bare-fetch/global'
import process from 'bare-process'
import { bypassed, getProxyForUrl, noProxy, proxyForProtocol } from 'barex-proxy-from-env'
import { createAgents, parse } from 'barex-any-proxy-agent'
import { forwardProxy, hosts, origin } from './lib/toy-servers.mjs'

const target = await origin('hello through the proxy')
const direct = await origin('hello, reached directly')

// A proxy that can reach both, by name. Nothing resolves `origin.example` on this machine
// - the proxy is the one that knows where it is, which is the point.
const proxy = await forwardProxy({ resolve: hosts({ 'origin.example': target.port }) })

process.env.http_proxy = `http://127.0.0.1:${proxy.port}`
process.env.ALL_PROXY = 'socks5://never-used.example:1080'
process.env.no_proxy = '127.0.0.1, intranet.local, 10.0.0.0/8'

// -- what the environment is asking for ---------------------------------------------------

// `fromEnv` and `proxyForProtocol` answer with the variable that won as well as its value,
// which is what lets a program say why it is doing what it is doing. `getProxyForUrl`
// answers with the url alone, as Node's proxy-from-env does.
const setting = proxyForProtocol('http:')
console.log(`http:  ${setting.url}   (from ${setting.source})`)
console.log(
  `https: ${proxyForProtocol('https:').url}   (from ${proxyForProtocol('https:').source})`
)
console.log(`ws:    ${proxyForProtocol('ws:').url}   (websockets follow http, not a ws_proxy)`)
console.log()

// -- and which hosts are exempt from it ---------------------------------------------------

const bypass = noProxy()
for (const host of ['origin.example', 'intranet.local', 'sub.intranet.local', '10.1.2.3']) {
  console.log(`${bypassed(bypass, host) ? 'direct ' : 'proxied'}  ${host}`)
}
console.log()

// `getProxyForUrl` asks both questions at once: which variable covers this scheme, and
// whether `no_proxy` exempts this host. The empty string means go direct.
for (const url of ['http://origin.example/hello', `http://127.0.0.1:${direct.port}/hello`]) {
  console.log(`${url} -> ${getProxyForUrl(url) || '(direct)'}`)
}
console.log()

// -- making the request -------------------------------------------------------------------

// One pair of agents per proxy, made once and kept. A program with several destinations
// keeps a pair per proxy url, which is what Node's `ProxyAgent` cache amounts to.
const agents = new Map()

async function get(url) {
  const found = getProxyForUrl(url)

  if (!found) {
    const response = await fetch(url)
    return `${await response.text()}  (no agent: ${url} is exempt)`
  }

  if (!agents.has(found)) agents.set(found, createAgents(found))
  const pair = agents.get(found)

  // Which of the pair a request needs is the caller's to pick, and it is the *target's*
  // scheme that decides - `bare-http1` tells an agent nothing about where a request is
  // going. See NODE-COMPATIBILITY.md.
  const agent = new URL(url).protocol === 'https:' ? pair.https : pair.http

  const response = await fetch(url, { agent })
  return `${await response.text()}  (through ${found})`
}

console.log(await get('http://origin.example/hello'))
console.log(await get(`http://127.0.0.1:${direct.port}/hello`))
console.log()

// The proxy was told where to go by the request line itself - absolute-form, which is what
// forwarding means - and the origin saw the proxy's address rather than ours.
console.log('the proxy was asked for:', proxy.asked[0].line)
console.log('the origin was reached from:', target.seen[0].from)
console.log()

// A url of a scheme no agent here speaks is refused rather than quietly ignored: going
// direct is exactly what whoever set the variable was trying to prevent.
process.env.http_proxy = 'gopher://proxy.lan:70'
try {
  parse(getProxyForUrl('http://origin.example/hello'))
} catch (err) {
  console.log('an unusable proxy url says so:', err.message)
}

for (const server of [target, direct, proxy]) await server.close()
