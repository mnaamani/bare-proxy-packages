# barex-proxy-agent

Tunnel http and websocket traffic through a proxy under [Bare](https://github.com/holepunchto/bare).

This is the half every proxy protocol shares: a socket that is opened by handshake rather
than by connecting, the [bare-http1](https://github.com/holepunchto/bare-http1) agents built
on it, and the reading and error types a handshake is written against.

**Start with one of these instead**, unless you are teaching this package a protocol of your
own:

- [`barex-any-proxy-agent`](../barex-any-proxy-agent) - any of the below, picked from the url
- [`barex-socks-proxy-agent`](../barex-socks-proxy-agent) - SOCKS5
- [`barex-http-proxy-agent`](../barex-http-proxy-agent) - an http proxy asked to forward
- [`barex-https-proxy-agent`](../barex-https-proxy-agent) - HTTP CONNECT

```
npm i barex-proxy-agent
```

## Usage

An agent is what `bare-fetch` and `bare-ws` take, so a pair of them is the whole of routing
a program's traffic:

```js
import { createAgents, parseProxyUrl, ProxyError, authority } from 'barex-proxy-agent'

const proxy = parseProxyUrl('demo://127.0.0.1:1080', ['demo:'])

// Called once per connection, on a socket to the proxy. Resolve and everything after
// belongs to the target; throw a ProxyError and the request fails with your words.
async function handshake({ socket, reader, proxy, target }) {
  socket.write(`GOTO ${authority(target)}\n`)
  const answer = (await reader.until('\n')).toString().trim()
  if (answer !== 'OPEN') throw new ProxyError(`the proxy answered ${answer}`)
}

const agents = createAgents({ proxy, handshake })

const response = await fetch('https://example.com', { agent: agents.https })
const socket = new Socket('wss://relay.example', { agent: agents.https }) // bare-ws
```

TLS to the target is negotiated inside the tunnel by `agents.https`, so the certificate is
checked against the host that was asked for, not against the proxy. A proxy url that is
itself TLS (`secure: true`) is reached over TLS as well.

## API

#### `createAgents(tunnel[, opts])`

`{ http, https }` - an agent for `http:` targets and one for `https:` ones. `tunnel` is
`{ proxy, handshake, timeout }`; `opts` goes to `bare-http1`'s `Agent` (keep-alive is on by
default). `ProxyHTTPAgent` and
`ProxyHTTPSAgent` are exported for subclassing.

#### `new ProxySocket({ proxy, handshake, timeout }, { host, port })`

The connection itself, a `bare-stream` `Duplex`. Writes made before the handshake finishes
are held and go out after, which is what lets a TLS socket be layered straight on top.
`timeout` (default 30s) is how long the proxy has to answer its own handshake - a port that
is listening but is not a proxy says nothing at all.

#### `handshake({ socket, reader, proxy, target })`

Yours to write. `reader.read(n)` resolves exactly `n` bytes and `reader.until(delimiter)`
everything up to and including it; anything read past the end of the handshake is kept and
handed to the stream, so a target that answers immediately loses nothing.

`reader.until(delimiter, maxBytes)` limits the bytes through the delimiter to 16384 by
default, rejecting larger responses with `ProxyError`. A custom protocol can specify a
different positive limit. Target bytes following a valid delimiter do not count against
it. Reads scan chunks incrementally and pause the socket between requests; only one read
may be pending at a time.

#### `parseProxyUrl(url, ports)`

`{ protocol, host, port, username, password, secure }`, with `ports` giving the default port
per scheme. `schemes` is the list this protocol answers to, spelled with the colon. Host and
port only - a path or a query is refused rather than guessed at, and so is a missing port:
every scheme has a port some client treats as its default, no two agree, and a guess that
lands on the wrong service is handed the credentials before anything notices. An
IPv6 host comes back without its brackets; `authority({ host, port })` puts them back.

#### `proxyName(proxy)` / `authority(target)` / `hasCredentials(proxy)`

Small shared helpers for writing a handshake's errors and requests.

#### `ProxyError` / `proxyErrorIn(err)`

Everything that goes wrong on the way through a proxy, carrying `code: 'PROXY_ERROR'`.
`bare-fetch` reports every failure as `NETWORK_ERROR: Network error` and keeps the reason as
its cause, and a library above it may wrap that again - `proxyErrorIn` digs the reason back
out, which is what the person whose proxy is not running needs to read.

## Compared to Node's proxy agents

Node's proxy agents share `agent-base`, whose `connect(req, opts)` receives
`secureEndpoint`. This package uses `bare-http1`'s `addRequest(req, opts)` and
`createConnection(opts)`, with `opts.protocol` identifying the request scheme.

## Redirects and standalone agents

`createAgents()` returns linked HTTP and HTTPS agents. Either member delegates a request
with the other scheme before consulting its connection pool. This supports `bare-fetch`
redirects on every port while keeping TLS connections separate from plaintext ones.
`pairAgents(http, https)` links separately constructed agents in the same way. Destroy both
members when finished.

A standalone agent rejects an incompatible explicit scheme with `ProxyError`. A direct
connection without `protocol` uses the selected agent, with a conservative port-443 refusal
on the plaintext agent. Subclasses overriding `tunnel` must build on `super.tunnel` to keep
that socket-level guard.

Use `bare-http1` 4.6.2 and `bare-https` 3.1.0 or newer. Older clients that omit the scheme
require manual redirect handling and agent selection before each request. The pair retains
its configured proxy across redirects; it does not reevaluate environment bypass rules.

## Licence

Apache-2.0
