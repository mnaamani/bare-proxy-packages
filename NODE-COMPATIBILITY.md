# How `bare-http1` differs from Node's `http`, and what that costs

Every package here has a Node counterpart, and every one of them stops short of being a
drop-in port of it. That is not a matter of unfinished work: the shape of a proxy agent is
decided by the http client it plugs into, and `bare-http1` is a different client from Node's
`http` in ways that reach the public surface. This is the list, and what each one forces.

Written against `bare-http1` 4.6.2. Where a claim is about behaviour rather than about an
API's spelling, it was checked against that version rather than taken from documentation.

## 1. There are no builtins, so there is nothing to subclass

Bare has no `http`, `https`, `net` or `tls` modules. There is
[`bare-http1`](https://github.com/holepunchto/bare-http1), `bare-https`, `bare-net`,
`bare-tcp` and `bare-tls`, each an ordinary npm package with an API of its own.

The immediate consequence is that [`agent-base`](https://www.npmjs.com/package/agent-base) —
the package every Node proxy agent is built on — cannot be used or ported cheaply. It
subclasses `http.Agent` and reaches into its internals to do it. So
[`bare-proxy-agent`](packages/bare-proxy-agent) exists: it is the `agent-base` layer of the
Node stack, rewritten against `bare-http1`'s agent instead. That is why this workspace has
six packages where Node's equivalent stack has five plus `agent-base`.

## 2. The hook is `createConnection(opts)`, not `connect(req, opts)`

`agent-base` asks a subclass for:

```js
async connect(req, opts) // -> a Duplex, or another Agent
```

`bare-http1` asks for the hook Node's own `http.Agent` has:

```js
createConnection(opts) // -> a socket
```

Three differences follow from the signature alone:

- **No request.** The agent is handed connection options, not the `ClientRequest`, so it
  cannot decide anything per request that is not already in `opts`.
- **Synchronous.** It must return a socket now. A handshake that has to finish before the
  socket is usable cannot be awaited here — hence
  [`ProxySocket`](packages/bare-proxy-agent/lib/socket.mjs), a socket that is returned
  immediately and connects by running a handshake, rather than one you get after connecting.
- **No delegation.** Node lets `connect()` return another agent, which is how
  `pac-proxy-agent` dispatches per url. There is no equivalent, so a per-url decision has to
  be made before an agent is chosen, not inside one.

## 3. The agent is never told whether the target is `https:`

This is the divergence with the largest visible cost.

`agent-base` puts `secureEndpoint` on the options it passes to `connect()`. That single flag
is what lets one `SocksProxyAgent` serve both `http://` and `https://` targets: it looks at
the flag and runs TLS, or doesn't.

`bare-http1` passes nothing of the kind. The agent's options and the request's are merged and
handed to `createConnection`, and the target's scheme is not among them. In Bare, the scheme
_is_ the agent — `bare-https`'s `Agent` is a separate class that extends `bare-http1`'s and
wraps whatever it opened in a TLS socket:

```js
class HTTPSAgent extends HTTPAgent {
  createConnection(opts) {
    return new HTTPSSocket(super.createConnection(opts), opts)
  }
}
```

So every proxy agent here must come in two, one per target scheme, and the caller picks:

```js
const agents = createAgents('socks5://127.0.0.1:1080')

fetch('http://example.com', { agent: agents.http })
fetch('https://example.com', { agent: agents.https })
```

That is the whole reason `createAgents()` returns a pair rather than an agent, and it ripples
outward: [`bare-any-proxy-agent`](packages/bare-any-proxy-agent) cannot be Node's
`ProxyAgent`, one object that resolves a proxy per request, because there is no per-request
moment in which to resolve one.

It also has a safety consequence. An `https:` url can reach the plain agent — a redirect does
it, since `bare-fetch` follows redirects itself and reuses the agent it was given for every
hop. Node's agent would notice via `secureEndpoint`; here nothing would, so
`bare-proxy-agent` refuses a plaintext request to port 443 rather than send in the clear what
was asked for in confidence.

## 4. TLS is the agent's job, and the wrapper is not exported

Because of §3, an https-capable proxy agent has to run TLS itself, over the socket the
handshake produced. `bare-https` does exactly this, but its TLS socket wrapper — the one that
forwards `setKeepAlive`, `setNoDelay`, `setTimeout`, `ref` and `unref` down to the socket
underneath, which an http agent calls and a bare `tls.Socket` does not forward — is internal.
`bare-https` exports `Agent`, `globalAgent`, `Server`, `ClientRequest`, `createServer`,
`request` and `get`, and nothing else.

So `bare-proxy-agent` carries its own copy of that wrapper. In Node this problem does not
arise at all: `https-proxy-agent` gets the tunnel socket and hands it to `tls.connect`.

## 5. `bare-http1` refuses `https:`

`http.request()` in Node will take an `https:` url and throw about the protocol; so will
`bare-http1`, which accepts `http:` and `ws:` only and raises `INVALID_PROTOCOL` otherwise.
The difference is what the split means downstream: in Node `https` is a thin layer over the
same `http` machinery and `http.Agent` is the base for both, while here the two clients are
separate packages a program may not even have both of.

## 6. `opts.timeout` is already taken, and the agent's options win

`bare-http1`'s agent copies its own options over each request's:

```js
addRequest(req, opts) {
  opts = { ...opts, ...this._opts }
```

Node's `http.Agent` merges the same way round, so that part is shared — but here the merged
result is what reaches `createConnection`, and `timeout` in it is the _socket_ timeout applied
to every connection the agent makes. A proxy agent needs a second, different deadline for the
handshake, and cannot spell it `timeout` the way `socks-proxy-agent` and `https-proxy-agent`
do. Hence `opts.handshakeTimeout`, which is the one option name in this workspace that has no
Node counterpart at all.

The same merge is why the agents here strip `host`, `port` and `path` out of the options they
pass to `super()`: an agent's options beat a request's, so one of those left on an agent by
mistake would silently redirect every request that agent ever carries.

## 7. Different streams, different errors

- Sockets and messages are [`bare-stream`](https://github.com/holepunchto/bare-stream)
  streams. The spellings differ where it matters in an agent: `socket.destroying`, not
  `destroyed`.
- Failures are `HTTPError` instances with `err.name === 'HTTPError'` and codes of
  `bare-http1`'s own — `CONNECTION_LOST`, `HEADERS_SENT`, `CONTENT_LENGTH_MISMATCH`,
  `AGENT_SUSPENDED`, `INVALID_PROTOCOL`. Not `ECONNRESET`, not `ERR_*`. Code that branches on
  a Node error code will not match, and matching Node's error shapes is not something a
  package on top can retrofit.

## 8. Agent surface that has no Node equivalent, and vice versa

|                           | Node `http.Agent`            | `bare-http1` `Agent`                                    |
| ------------------------- | ---------------------------- | ------------------------------------------------------- |
| `sockets` / `freeSockets` | objects keyed by origin name | generators of sockets                                   |
| suspend / resume          | —                            | `agent.suspend()`, `agent.resume()`, `agent.suspended`  |
| idle teardown             | —                            | every agent destroys its sockets on Bare's `idle` event |
| `connect(req, opts)`      | added by `agent-base`        | —                                                       |
| `secureEndpoint`          | added by `agent-base`        | —                                                       |

The idle teardown is worth knowing when porting: a keep-alive pool in Node holds the process
open unless its sockets are unref'd, whereas here the runtime going idle is what tears the
pool down.

## 9. The private extension points have moved

A proxy agent for `http:` targets has to rewrite the request line into absolute form
(`GET http://origin.example/v1/info HTTP/1.1`). Neither client offers a public way to do it.
Node's `http-proxy-agent` assigns `req.path` and calls `req.setHeader()` from `addRequest`.

Under `bare-http1` 4.6.2 that works too — `ClientRequest` assigns `_path` and `_headers`
before it calls `agent.addRequest`, and an edit made there does reach the wire (checked, not
assumed). But the names are `_path` and `_headers`, and `_header()` is where the request line
is actually built. [`bare-http-proxy-agent`](packages/bare-http-proxy-agent) shadows
`_header()` rather than writing to `_path` in `addRequest`, so that it holds regardless of
where in construction `addRequest` is called from — bare-http1 called it before those
assignments until 4.6 — and so that `proxyHeaders` in its function form is read at flush
rather than at construction.

The general point stands for anything below the public API: `_header()`, `_frame()`,
`_fields()`, `_headers`, `_isTunnel()` are `bare-http1`'s privates, and they are not Node's
`_implicitHeader()` / `_storeHeader()` / `_headerSent`. Porting an agent means rewriting
against a different set of them, which is also why each package pins the behaviour it depends
on with tests of its own.

## What is _not_ a difference

Worth saying, since the list above is long:

- `new Agent(url | URL | parsed, opts)`, `static protocols`, `agent.proxy`, `agent.proxyUrl`
  and `agent.proxyHeaders` (function form included) all match their Node counterparts.
- The bytes on the wire match: the same `Proxy-Authorization`, the same `Proxy-Connection`,
  the same absolute-form request line, the same `CONNECT` exchange.
- `opts` passed to an agent constructor reaches the underlying `Agent`, as in Node.
- The consumer surface is, if anything, tidier: `bare-fetch` and `bare-ws` both take an
  `agent`, where Node's `fetch` takes an undici dispatcher and has no use for an
  `http.Agent` at all.

## Summary

| Node                                             | Why it cannot be matched here                                 |
| ------------------------------------------------ | ------------------------------------------------------------- |
| One agent for `http:` and `https:` targets       | No `secureEndpoint`; the scheme is the agent (§3)             |
| `connect(req, opts)`, async, may return an agent | Hook is a synchronous `createConnection(opts)` (§2)           |
| `ProxyAgent` resolving a proxy per request       | Nothing per-request to resolve it in (§2, §3)                 |
| PAC support via `pac-proxy-agent`                | Needs a script sandbox and resolver; also §2 (delegation)     |
| Reuse of `agent-base`                            | Written against `http.Agent` internals that do not exist (§1) |
| `opts.timeout` for the handshake                 | Taken by `bare-http1`'s socket timeout (§6)                   |
| Node error codes                                 | `HTTPError` with its own codes (§7)                           |
| SOCKS4 / SOCKS4a, `onProxyAuth`, NTLM/Kerberos   | Not implemented — scope, not a constraint                     |
