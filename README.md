# bare-proxy-packages

Proxy support for [Bare](https://github.com/holepunchto/bare): agents that `bare-fetch` and
`bare-ws` take, so a program's http and websocket traffic goes through a proxy.

An npm workspace — each directory under `packages/` is published on its own.

| Package                                                     | What it does                                                                         | Node counterpart                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`bare-any-proxy-agent`](packages/bare-any-proxy-agent)     | One entry point for every scheme below, picked from the proxy url                    | [`proxy-agent`](https://www.npmjs.com/package/proxy-agent)             |
| [`bare-socks-proxy-agent`](packages/bare-socks-proxy-agent) | SOCKS5, and `socks5h` where the proxy resolves the target name                       | [`socks-proxy-agent`](https://www.npmjs.com/package/socks-proxy-agent) |
| [`bare-http-proxy-agent`](packages/bare-http-proxy-agent)   | An http proxy asked to forward — the absolute-form half of Node's `http-proxy-agent` | [`http-proxy-agent`](https://www.npmjs.com/package/http-proxy-agent)   |
| [`bare-https-proxy-agent`](packages/bare-https-proxy-agent) | HTTP `CONNECT` tunnels                                                               | [`https-proxy-agent`](https://www.npmjs.com/package/https-proxy-agent) |
| [`bare-proxy-agent`](packages/bare-proxy-agent)             | The socket, agents and handshake plumbing the three above share                      | [`agent-base`](https://www.npmjs.com/package/agent-base)               |
| [`bare-proxy-from-env`](packages/bare-proxy-from-env)       | Reads `http_proxy`, `https_proxy`, `ALL_PROXY` and `no_proxy`                        | [`proxy-from-env`](https://www.npmjs.com/package/proxy-from-env)       |

None of them is a drop-in port of its Node counterpart. [NODE-COMPATIBILITY.md](NODE-COMPATIBILITY.md)
is the account of why: how `bare-http1` differs from Node's `http`, and which of those
differences reach the surface of these packages.

Most programs want `bare-any-proxy-agent` with `bare-proxy-from-env`:

```js
import { getProxyForUrl } from 'bare-proxy-from-env'
import { createAgents } from 'bare-any-proxy-agent'

const target = 'https://example.com'
const proxy = getProxyForUrl(target)
const agents = proxy ? createAgents(proxy) : null

const response = await fetch(target, { agent: agents?.https })
```

Pairs automatically select their HTTP or HTTPS member for scheme-changing redirects,
including nonstandard ports, using the target protocol supplied by `bare-http1` 4.6.2 and
`bare-https` 3.1.0 or newer. A standalone agent rejects an incompatible explicit scheme.
The configured proxy stays the same across redirects.

Each package's README has its own reference, and [`examples/`](examples) has programs that
run: routing from the environment, a `CONNECT` tunnel, SOCKS5 without a local DNS lookup, a
websocket through a proxy, teaching the base a protocol of your own, and getting the reason
out of a failure. Each starts the proxy it goes through, so there is nothing to set up.

```sh
bare examples/01-from-env.mjs
```

## Types

Every package ships a handwritten `index.d.ts`, documented with TSDoc, so an editor has
both the signature and the reasoning at the call site. Nothing needs installing — the
declarations come with the package, under its `types` export condition.

`bare-url` and `bare-buffer` are optional peer dependencies: a `URL` and a `Buffer` appear
in the signatures, and a project that typechecks against Bare will have both, but neither
is loaded at run time. This is how `bare-http1` declares the same pair.

Declaration files are handwritten, so nothing makes them agree with the code on their own —
`npm run types` is what does, and it runs in CI:

```sh
npm run types   # tsc --noEmit over every .d.ts and the type tests,
                # then checks that what each .d.ts declares is what the package exports
```

## Development

```sh
npm install
npm i -g bare-runtime   # the tests run under Bare
npm test                # every workspace
npm test --workspace bare-socks-proxy-agent
npm run examples        # every example, which CI does too
npm run lint            # prettier, lunte, and the type checks above
```

## License

Apache-2.0
