# bare-http-proxy-agent

A forwarding http proxy agent for [Bare](https://github.com/holepunchto/bare) — for
`bare-fetch`, `bare-ws`, and anything else that takes a `bare-http1` agent.

Named for what Node's `http-proxy-agent` does: send the request to the proxy with the whole
url in the request line (`GET http://origin.example/v1/info HTTP/1.1`, what RFC 9112 §3.2.2
calls absolute-form) and let the proxy make it onwards.

`http:` targets only. The proxy makes the request, so there is no end-to-end connection for
TLS to run over — for `https:` use [`bare-https-proxy-agent`](../bare-https-proxy-agent),
whose CONNECT tunnel leaves TLS to the target intact.

## Usage

```js
import { HttpProxyAgent } from 'bare-http-proxy-agent'

const agent = new HttpProxyAgent('http://proxy.lan:3128')

const response = await fetch('http://example.com', { agent })
```

With credentials, which are sent as `Proxy-Authorization: Basic`:

```js
new HttpProxyAgent('http://me:s3cret@proxy.lan:3128')
```

An `https://` proxy url means the first hop is itself TLS, so the request — and any
credentials on it — is encrypted to the proxy rather than sent in the clear:

```js
new HttpProxyAgent('https://proxy.example:443')
```

### What the proxy sees

All of it. A forwarded request is made by the proxy, so it reads the url, the headers and
the body, and the response comes back the same way. That is the trade against a tunnel: a
proxy that will not `CONNECT` to port 80 will forward this, and in exchange it sees what it
is forwarding. Nothing is added here beyond what the method needs — no user agent, no
cookies — but nothing that was already in the request is hidden either.

## Redirects and target schemes

A standalone agent rejects an incompatible explicit target scheme with `ProxyError`,
including HTTPS on nonstandard ports. Use the linked pair from `createAgents()` in
`bare-any-proxy-agent` to route HTTP requests by forwarding and HTTPS requests by CONNECT.
The CONNECT package's own pair tunnels both kinds of target. Pairs delegate before pooling
or rewriting headers, so `bare-fetch` can safely retain its initial agent across redirects.

Automatic routing requires clients that pass `opts.protocol`: `bare-http1` 4.6.2 and
`bare-https` 3.1.0 or newer. For older clients, follow redirects manually and select the
agent before issuing each request. Checking the final response URL is too late.

## API

#### `new HttpProxyAgent(proxy[, opts])`

An agent for `http:` targets. `proxy` is a url string, a `URL`, or the result of `parse()`;
`opts` goes to `bare-http1`'s `Agent`, with `opts.headers` taken as below. Keep-alive is on
by default, so the connection to the proxy is reused rather than rebuilt per request.

#### `agent.proxyHeaders`

Headers to send to the proxy with each request, as an object or as a function called per
request. `opts.headers` sets it.

#### `parse(url)`

`{ protocol, host, port, username, password, secure }` for an `http://` or `https://` proxy
url, `secure` saying whether the proxy itself is reached over TLS. Host and port only — a
path or a query is refused rather than guessed at, and so is a missing port. There is no
default worth having: `http-proxy-agent` reads a port-less proxy url as port 80, curl reads
it as 1080, and 8080 is where proxies actually tend to listen. A guess that lands on the
wrong service is handed the `Proxy-Authorization` header before anything notices, and the
port is one word that only the person configuring it knows.

#### `ProxyError` · `proxyErrorIn(err)`

Re-exported from [`bare-proxy-agent`](../bare-proxy-agent). Note that a forwarding proxy
reports its own failures as ordinary http responses — a 407 asking for credentials, a 502
saying it could not reach the target — so they arrive as responses, not as a `ProxyError`.
What is left for `ProxyError` is failing to reach the proxy at all.

## Compared to Node's `http-proxy-agent`

The surface follows [`http-proxy-agent`](https://www.npmjs.com/package/http-proxy-agent)
wherever it can: `new HttpProxyAgent(url | URL | parsed, opts)`, `static protocols`,
`agent.proxy`, `agent.proxyHeaders` (function form included), `opts` passed through to the
underlying `Agent`, and the same headers on the wire — `Proxy-Authorization` from the url's
credentials, `Proxy-Connection` unless the caller already set one. What differs is forced by
Bare:

|                   | Node                                                | here                                                                     |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| base class        | `agent-base`'s `Agent`, over `http.Agent`           | `bare-http1`'s `Agent`                                                   |
| socket hook       | `connect(req, opts)` returning a socket or an agent | `createConnection(opts)` returning a socket                              |
| rewrite point     | `addRequest`, assigning `req.path`                  | `addRequest`, assigning `req._path`                                      |
| `agent.proxy`     | a `URL`                                             | the parsed `{ protocol, host, port, … }`; `agent.proxyUrl` is the string |
| handshake timeout | `opts.timeout`                                      | n/a — there is no handshake to time out                                  |

Both rewrite the request line from `addRequest`, which is the only place an agent is handed
the request at all. The names are the difference: `req._path` and `req._headers` here,
`req.path` and `req.setHeader` there. bare-http1 assigns both before it calls `addRequest`,
so the edit goes out as made — which is what the `bare-http1` `^4.6.0` requirement is for,
since it called `addRequest` ahead of those assignments until 4.6.

Nothing in the Node stack can be reused as it stands: Bare has no `net`, `tls` or `http`
builtins, and `agent-base` is written against Node's `http.Agent` internals.

`onProxyAuth` and `negotiate` (NTLM/Kerberos negotiation) have no equivalent here.

## Licence

Apache-2.0
