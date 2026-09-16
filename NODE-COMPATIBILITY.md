# How `bare-http1` differs from Node's `http`, and what that costs

Every package here has a Node counterpart, and every one of them stops short of being a
drop-in port of it. That is not a matter of unfinished work: the shape of a proxy agent is
decided by the http client it plugs into, and `bare-http1` is a different client from Node's
`http` in ways that reach the public surface. This is the list, and what each one forces.

Written against `bare-http1` 4.6.2, `bare-https` 3.1.0 and Bare 1.33.0. Where a claim is
about behaviour rather than about an API's spelling, it was checked against those versions
rather than taken from documentation.

## 1. Networking is npm packages, so there is nothing to subclass

Bare ships no `http`, `https`, `net` or `tls` module. Under `bare` 1.33.0 all eight of
`http`, `https`, `net`, `tls` and their `node:`-prefixed spellings fail to resolve with
`MODULE_NOT_FOUND`. What there is instead is
[`bare-http1`](https://github.com/holepunchto/bare-http1), `bare-https`, `bare-net`,
`bare-tcp` and `bare-tls`: ordinary npm packages, resolved out of `node_modules` like any
other dependency, each with an API of its own.

Two things that _are_ called builtins in Bare are worth separating out, because neither one
puts these modules back.

**Static addons.** Bare links a fixed set of native addons into the binary — its
`src/builtins.json` lists `bare-buffer`, `bare-hrtime`, `bare-inspect`, `bare-logger`,
`bare-module`, `bare-module-lexer`, `bare-path`, `bare-structured-clone`,
`bare-system-logger`, `bare-timers`, `bare-type`, `bare-type-stripper` and `bare-url`. An
addon is the native half of a package, not a module name: `require('bare-url')` still
resolves the npm package, which then finds its binding already linked in rather than loading
a `.bare` file. Nothing in that list is networking, and nothing in it is spelled as a Node
module name.

**Host-injected builtins.** Bare's module system does take a name-to-exports map:
`Module.load(url, source, { builtins })` registers it, and `bare-module-resolve` consults
`builtinTarget()` _before_ it walks `node_modules`, so a builtin shadows a package of the
same name. An embedder is therefore free to register `net`, `tls`, `http` or `https` as
builtins, and code running inside it will `require('net')` successfully. That mechanism is
real and was verified, but it is a host's choice, not the runtime's: neither the `bare` CLI
nor Pear registers any of these names, and there is no published shim that does (there is no
`bare-node` package on npm). Nothing here can assume those names exist.

The `/global` subpath some Bare packages carry is a third thing again, and not this one.
`bare-buffer/global`, `bare-url/global`, `bare-process/global`, `bare-fetch/global` and
`bare-ws/global` assign global _variables_ — `Buffer`, `URL`, `process`, `fetch`,
`WebSocket` — because those are ambient globals in Node and the browser. `net` and `http`
never were: they are module names, so there is nothing for such a shim to install, and none
of `bare-net`, `bare-tcp`, `bare-tls`, `bare-http1` or `bare-https` exports a `/global` at
all.

The nuance does not rescue the Node stack even where a host does inject them, because a
builtin is only a name. Whatever a host puts behind `net` or `http` in a Bare process is
going to be `bare-net` or `bare-http1`, with the surface described in the rest of this
document — not Node's `http.Agent` and its internals. So read every claim below as being
about the API a name reaches, never about whether the name resolves.

The immediate consequence is that [`agent-base`](https://www.npmjs.com/package/agent-base) —
the package every Node proxy agent is built on — cannot be used or ported cheaply. It
subclasses `http.Agent` and reaches into its internals to do it. So
[`barex-proxy-agent`](packages/barex-proxy-agent) exists: it is the `agent-base` layer of the
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
  [`ProxySocket`](packages/barex-proxy-agent/lib/socket.mjs), a socket that is returned
  immediately and connects by running a handshake, rather than one you get after connecting.
- **No delegation.** Node lets `connect()` return another agent, which is how
  `pac-proxy-agent` dispatches per url. There is no return-value equivalent. These agents delegate through
  `addRequest(req, opts)` when a paired request changes scheme.

## 3. Target schemes and redirects

Node's `agent-base` adds `secureEndpoint`. The supported Bare HTTP clients pass
`opts.protocol` instead (`bare-http1` 4.6.2 and `bare-https` 3.1.0).
Each agent still owns either plaintext or TLS connections. `createAgents()` links the pair
so a request with a different scheme is delegated in `addRequest()`, before looking in the
connection pool or rewriting forwarding headers. `bare-fetch` can therefore retain the
initial agent across HTTP/HTTPS redirects, including on nonstandard ports.

A standalone agent rejects an incompatible explicit scheme with `ProxyError`. Calls that
omit `protocol` use the selected agent; the plaintext handshake conservatively rejects
port 443 for those calls. Older clients that omit the scheme cannot support automatic
scheme-changing redirects. Use the supported client versions, or follow redirects manually
and select the appropriate agent before issuing each request.

The pair uses a fixed proxy. It does not reevaluate environment or `no_proxy` rules at each
redirect; applications needing that policy must perform that selection themselves.

## 4. TLS is the agent's job, and the wrapper is not exported

Because of §3, an https-capable proxy agent has to run TLS itself, over the socket the
handshake produced. `bare-https` does exactly this, but its TLS socket wrapper — the one that
forwards `setKeepAlive`, `setNoDelay`, `setTimeout`, `ref` and `unref` down to the socket
underneath, which an http agent calls and a bare `tls.Socket` does not forward — is internal.
`bare-https` exports `Agent`, `globalAgent`, `Server`, `ClientRequest`, `createServer`,
`request` and `get`, and nothing else.

So `barex-proxy-agent` carries its own copy of that wrapper. In Node this problem does not
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
| `secureEndpoint`          | added by `agent-base`        | `opts.protocol` instead                                 |

The idle teardown is worth knowing when porting: a keep-alive pool in Node holds the process
open unless its sockets are unref'd, whereas here the runtime going idle is what tears the
pool down.

## 9. The private extension points have moved

A proxy agent for `http:` targets has to rewrite the request line into absolute form
(`GET http://origin.example/v1/info HTTP/1.1`). Neither client offers a public way to do it.
Node's `http-proxy-agent` assigns `req.path` and calls `req.setHeader()` from `addRequest`.

That works under `bare-http1` 4.6 too — `ClientRequest` assigns `_path` and `_headers`
before it calls `agent.addRequest`, and an edit made there does reach the wire (checked, not
assumed), which is why [`barex-http-proxy-agent`](packages/barex-http-proxy-agent) requires
`^4.6.0` and does the rewrite in the same place Node does. What differs is only the
spelling: `req._path` rather than `req.path`, and `req._headers` alongside `setHeader`,
because `_header()` lowercases every name on its way out and two casings of one name would
otherwise go out as two headers.

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
| One agent for `http:` and `https:` targets       | Paired agents delegate using `opts.protocol` (§3)             |
| `connect(req, opts)`, async, may return an agent | Hook is a synchronous `createConnection(opts)` (§2)           |
| `ProxyAgent` resolving a proxy per request       | Nothing per-request to resolve it in (§2, §3)                 |
| PAC support via `pac-proxy-agent`                | Needs a script sandbox and resolver; also §2 (delegation)     |
| Reuse of `agent-base`                            | Written against `http.Agent` internals that do not exist (§1) |
| `opts.timeout` for the handshake                 | Taken by `bare-http1`'s socket timeout (§6)                   |
| Node error codes                                 | `HTTPError` with its own codes (§7)                           |
| SOCKS4 / SOCKS4a, `onProxyAuth`, NTLM/Kerberos   | Not implemented — scope, not a constraint                     |
