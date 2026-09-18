# barex-proxy-from-env

Which proxy the environment is asking for, under [Bare](https://github.com/holepunchto/bare) -
`http_proxy`, `https_proxy`, `ALL_PROXY`, `no_proxy`. Node's
[`proxy-from-env`](https://www.npmjs.com/package/proxy-from-env).

No sockets and no agents: this is the string half of using a proxy. What to do with the url
it hands back is [`barex-any-proxy-agent`](../barex-any-proxy-agent)'s business, or your own.

```
npm i barex-proxy-from-env
```

## Usage

```js
import { getProxyForUrl } from 'barex-proxy-from-env'

getProxyForUrl('https://example.com') // 'http://proxy.lan:3128', or '' to go direct
```

Where a program wants to say what it did and why - which is most of them, since a proxy that
was picked up rather than asked for is worth mentioning - read it a piece at a time:

```js
import { proxyForProtocol, noProxy, bypassed } from 'barex-proxy-from-env'

const found = proxyForProtocol('https:') // { url, source } - `source` is the variable that won
const bypass = noProxy()

if (found && !bypassed(bypass, 'example.com'))
  console.log('going through', found.url, `(${found.source})`)
```

## The convention

As curl documents it: `http_proxy`, `https_proxy` and `ALL_PROXY` as the fallback for a
scheme with none of its own, in either case, with the lower case spelling winning where both
are set - **except `http_proxy`, which is read in lower case only**. Under CGI a request
header `Proxy: ...` arrives in the environment as `HTTP_PROXY`, so honouring the upper case
spelling would let whoever sent the request choose the proxy (CVE-2016-5385 and friends).
The other variables have no such collision.

**On Windows that exception buys nothing.** Environment variables are case-insensitive
there, so `http_proxy` and `HTTP_PROXY` are one variable and reading the lower case spelling
reads whatever was put in the upper case one. curl documents the same hole - the mitigation
is by spelling, and Windows has only the one. Node is in the same position, and does not
try: its `process.env` is case-insensitive on Windows too, and `proxy-from-env`, undici's
`EnvHttpProxyAgent` and Node's own built-in proxy support all read `HTTP_PROXY` deliberately
on every platform. Where the guard does have to hold, the way to get it is not a spelling:
Ruby and libwww-perl look for a CGI context and read `CGI_HTTP_PROXY` instead, which is what
[httpoxy.org](https://httpoxy.org) recommends.

A variable set to the empty string is not set: exporting an empty `http_proxy` is how the
convention says "no proxy here", usually to undo one the login shell exported.

`ws:` and `wss:` are read as `http:` and `https:`. Nothing in the convention defines a
`ws_proxy`, and a program proxying its http traffic means its websockets too.

## API

#### `getProxyForUrl(url)`

The proxy url for a target url, or `''` to go direct. `url` is a string or anything with
`protocol` and `hostname` - a `URL` will do. Consults `no_proxy`.

#### `proxyForProtocol(protocol)`

`{ url, source }` for a target scheme - `'https'`, `'https:'` or a `URL`'s `protocol` -
falling back to `ALL_PROXY`, or `null`. `source` is the spelling that actually won, so a
value that turns out to be unusable can say which variable to go and fix. Does not consult
`no_proxy`: that is a question about a host, and this is only about a scheme.

#### `fromEnv(...names)`

`{ url, source }` for the first of `names` that is set to something, or `null`. The building
block the rest of this is made of, for a program with variables of its own to read on the
same terms.

#### `noProxy()` / `parseNoProxy(value)` / `bypassed(bypass, hostname)`

Malformed CIDR entries are ignored. Prefixes must be decimal digits from `0` to `32`;
an omitted prefix never means `/0`.

`no_proxy`, parsed once and asked about many times. `*` alone means every host; an entry
matches the hostname itself or any domain under it (`local.com` covers `www.local.com` but
not `www.notlocal.com`); an entry may be an address or a CIDR block instead of a name; a
leading `.` or `*.` is the same entry written differently. `bypassed(null, host)` is `false`,
so a caller need not check whether the variable was set.

#### `normalize(value)`

`host:port` as written in these variables, given the `http://` the convention leaves out.
Anything already carrying a scheme is returned unchanged, including one no agent can speak,
so that whoever parses it can name it.

## Compared to Node's `proxy-from-env`

`getProxyForUrl` is the same call with the same answer for the ordinary cases. Five
deliberate differences:

|                         | Node                                   | here                                                                                                             |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `HTTP_PROXY`            | read, upper case as well as lower      | lower case only - see above, and not on Windows, where the two spellings are one variable                        |
| `npm_config_*_proxy`    | read, and outranks the plain variables | not read: npm's own config, injected by `npm run`, and a program's traffic should not turn on how it was started |
| scheme-less proxy value | given the **target's** scheme          | given `http://`, as curl does                                                                                    |
| a port in `no_proxy`    | matched against the target's port      | ignored - it is the host being exempted, which is curl's reading                                                 |
| CIDR in `no_proxy`      | not supported                          | supported, as curl has since 7.86                                                                                |

The pieces below `getProxyForUrl` are ours: Node's package exports that one function, and a
program that wants to tell the user which variable it obeyed cannot get it from there.

## Licence

Apache-2.0
