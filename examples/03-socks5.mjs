// SOCKS5, and the DNS query that never leaves the machine.
//
//   bare examples/03-socks5.mjs
//
// The interesting property of SOCKS5 is not that it carries traffic — every proxy does
// that — but that it can be handed a *name*. The client writes the hostname into the
// connect request and the proxy resolves it, so nothing on this machine ever looks it up.
//
// Elsewhere that is the difference between `socks5://` and `socks5h://`, and it is a
// difference you have to remember to ask for. Here both schemes do it, and nothing is
// resolved locally under either: code moved across from `socks-proxy-agent` gets more
// privacy than it asked for, never less. A program that needs a local lookup — a proxy
// that only accepts literal addresses, say — has to do it itself.
import 'bare-fetch/global'
import { SocksProxyHTTPAgent, createAgents, parse, proxyErrorIn } from 'bare-socks-proxy-agent'
import { hosts, origin, socks5Proxy } from './lib/toy-servers.mjs'

const target = await origin()

// The proxy knows where `origin.example` is. This machine does not, and is never asked.
const proxy = await socks5Proxy({
  resolve: hosts({ 'origin.example': target.port }),
  requireCredentials: true
})

// ── reading the url ──────────────────────────────────────────────────────────────────────

// Both spellings parse, and the one that was written is kept — only so that an error can
// quote back what was configured, since they behave identically.
for (const url of ['socks5://127.0.0.1:1080', 'socks5h://me:s3cret@127.0.0.1:1080']) {
  const { protocol, host, port, username } = parse(url)
  console.log(`${url}  →  ${protocol} ${host}:${port}${username ? ` as ${username}` : ''}`)
}

// A proxy url with no port is refused rather than defaulted. `socks-proxy-agent` and curl
// both read a port-less url as 1080, http-proxy-agent reads one as 80, and proxies tend to
// listen on 8080 — three answers, so any of them is a guess, and a guess that lands on the
// wrong service is handed the username and password before anything notices.
try {
  parse('socks5://127.0.0.1')
} catch (err) {
  console.log('no port:', err.message)
}
console.log()

// ── going through it ─────────────────────────────────────────────────────────────────────

const agents = createAgents(`socks5://alice:hunter2@127.0.0.1:${proxy.port}`)

const response = await fetch('http://origin.example/hello', { agent: agents.http })
console.log('response:', await response.text())
console.log()

const [asked] = proxy.asked
console.log('the proxy was asked to reach:', `${asked.host}:${asked.port}`)
console.log('  which it was given as:     ', asked.type)
console.log('  authenticating as:         ', asked.credentials.username)
console.log()
console.log('the origin was reached from:', target.seen[0].from, '— the proxy, not us')
console.log()

// An address is sent as an address, because there is nothing to resolve and the proxy
// should not be asked to parse a dotted quad back out of a name.
const literal = createAgents(`socks5://alice:hunter2@127.0.0.1:${proxy.port}`)
await fetch(`http://127.0.0.1:${target.port}/direct`, { agent: literal.http }).then((res) =>
  res.text()
)
console.log('asked for an address instead:', proxy.asked[1].type)
console.log()

// ── one agent at a time, when that is all you need ───────────────────────────────────────

// `createAgents` is a convenience over the two classes. A program that only ever speaks to
// `http:` targets can hold the one agent — there is no cost to the other, but there is no
// reason for it either.
const single = new SocksProxyHTTPAgent(`socks5://alice:hunter2@127.0.0.1:${proxy.port}`, {
  keepAlive: true,
  handshakeTimeout: 5000
})
console.log('one agent:', single.proxyUrl, '— speaking', SocksProxyHTTPAgent.protocols.join(', '))
console.log('note the password is not in that string, and never is')
console.log()

// ── what a refusal looks like ────────────────────────────────────────────────────────────

// The proxy answers RFC 1928 reply code 5 for a host it cannot reach, and the agent says so
// in those words rather than in a number.
const unreachable = await fetch('http://nowhere.example/hello', { agent: agents.http }).then(
  () => null,
  (err) => proxyErrorIn(err)
)
console.log('a host the proxy cannot reach:', unreachable.message)

// Offering no credentials to a proxy that wants them is worth its own message, since the
// fix is to edit the url rather than to look at the network.
const anonymous = createAgents(`socks5://127.0.0.1:${proxy.port}`)
const unauthenticated = await fetch('http://origin.example/hello', {
  agent: anonymous.http
}).then(
  () => null,
  (err) => proxyErrorIn(err)
)
console.log('no credentials:               ', unauthenticated.message)

for (const pair of [agents, literal, anonymous]) {
  pair.http.destroy()
  pair.https.destroy()
}
single.destroy()
for (const server of [target, proxy]) await server.close()
