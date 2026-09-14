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

Most programs want `bare-any-proxy-agent` with `bare-proxy-from-env`:

```js
import { getProxyForUrl } from 'bare-proxy-from-env'
import { createAgents } from 'bare-any-proxy-agent'

const target = 'https://example.com'
const proxy = getProxyForUrl(target)
const agents = proxy ? createAgents(proxy) : null

const response = await fetch(target, { agent: agents?.https })
```

Each package's README has its own reference.

## Development

```sh
npm install
npm i -g bare-runtime   # the tests run under Bare
npm test                # every workspace
npm test --workspace bare-socks-proxy-agent
npm run lint
```

## License

Apache-2.0
