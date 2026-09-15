# Examples

Every one of these runs on its own, with nothing installed and nothing listening. The proxy
each goes through is started on a loopback port at the top and shut down at the bottom, so
there is no setup, no network, and nothing to configure:

```sh
npm install
npm i -g bare-runtime

bare examples/01-from-env.mjs
npm run examples          # all of them, which CI does too
```

They are meant to be read in order, but each stands alone.

| Example                                                    | What it shows                                   | Packages                                      |
| ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| [`01-from-env.mjs`](01-from-env.mjs)                       | Routing a program the way the environment asked | `bare-proxy-from-env`, `bare-any-proxy-agent` |
| [`02-connect-tunnel.mjs`](02-connect-tunnel.mjs)           | `CONNECT`, credentials, and what each hop sees  | `bare-https-proxy-agent`                      |
| [`03-socks5.mjs`](03-socks5.mjs)                           | SOCKS5, and the DNS query that never leaves     | `bare-socks-proxy-agent`                      |
| [`04-custom-protocol.mjs`](04-custom-protocol.mjs)         | Teaching the base a proxy protocol of your own  | `bare-proxy-agent`                            |
| [`05-websocket.mjs`](05-websocket.mjs)                     | A websocket through a tunnel                    | `bare-ws`, `bare-https-proxy-agent`           |
| [`06-diagnosing-failures.mjs`](06-diagnosing-failures.mjs) | Getting the reason out of what you caught       | `proxyErrorIn`                                |

## What each one is actually about

**01 — from the environment.** The pairing most programs want, and the whole of it: read
`http_proxy` and friends, and turn whatever was found into agents. Shows which variable won
and why that is worth reporting, how `no_proxy` carves holes in it (including CIDR), why
websockets follow `http_proxy` rather than a `ws_proxy` that does not exist, and how to
cache a pair of agents per proxy url — which is what Node's `ProxyAgent` cache amounts to.

**02 — the tunnel.** What `CONNECT` is for, what the proxy is told versus what the target
is told, and why `proxyHeaders` may be a function. Ends on the two refusals worth knowing:
a proxy that wants a password, and the guard that stops an `https:` url being carried in
the clear by the agent built for `http:`.

**03 — SOCKS5.** The interesting property is not that it carries traffic but that it can be
handed a _name_, which the proxy resolves — so no DNS query for the target leaves the
machine. Shows that both `socks5:` and `socks5h:` do this here, that an address is still
sent as an address, and why a port-less proxy url is refused rather than defaulted.

**04 — a protocol of your own.** `bare-proxy-agent` is the half that does not depend on
which proxy protocol you speak, so a new one is a function: write, read a line, resolve or
throw. Implements a made-up protocol end to end, points `fetch` at it, and then uses a
`ProxySocket` directly to carry something that is not http at all.

**05 — websockets.** An agent is what `bare-ws` takes too. The only thing to get right is
which of the pair, and it is the target's scheme that decides: `ws:` takes `agents.http`,
`wss:` takes `agents.https`.

**06 — failures.** A proxy failure reaches you wrapped in whatever noticed it, so
`instanceof ProxyError` is false and the message says `NETWORK_ERROR`. `proxyErrorIn` walks
the `cause` chain to the real reason. Runs through the six failures worth telling apart,
and one that is the target's fault rather than the proxy's — which is the distinction the
function exists for.

## `lib/toy-servers.mjs`

Scaffolding: the smallest thing that speaks each protocol correctly enough to be worth
pointing a client at — a forwarding proxy, a `CONNECT` proxy, a SOCKS5 proxy, an origin,
and a port that accepts connections and then says nothing. Each keeps a log of what it was
asked for, which is how the examples show what went over the wire rather than asserting it.

It is not how you would write a proxy, and it is not the point. Read it only when you want
to know what the far end was doing.
