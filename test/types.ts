// Exercises every export of every package, so that the typings are checked in use rather
// than only parsed. `tsc --noEmit` runs with `skipLibCheck`, which means a declaration file
// is not checked on its own — this is what checks them.
//
// Nothing here runs. It is compiled, never executed, which is why a socket may be a cast
// and a proxy url need not be listening.
import URL from 'bare-url'
import Buffer from 'bare-buffer'
import {
  ProxyError,
  ProxyHTTPAgent,
  ProxyHTTPSAgent,
  ProxySocket,
  Reader,
  authority,
  createAgents,
  hasCredentials,
  parseProxyUrl,
  pairAgents,
  proxyErrorIn,
  proxyName,
  type Handshake,
  type HandshakeContext,
  type Proxy,
  type ProxyAgentOptions,
  type ProxyAgents,
  type ProxySocketOptions,
  type ProxyTarget,
  type Tunnel
} from 'bare-proxy-agent'
import * as socks from 'bare-socks-proxy-agent'
import * as connect from 'bare-https-proxy-agent'
import * as forward from 'bare-http-proxy-agent'
import * as any from 'bare-any-proxy-agent'
import * as env from 'bare-proxy-from-env'

// Asserts a type rather than a value: the call compiles only when what it is handed is
// assignable to T. Nothing here is ever run.
function expect<T>(value: T): void {
  void value
}

// bare-proxy-agent ───────────────────────────────────────────────────────────────────────

const proxy: Proxy = parseProxyUrl('demo://127.0.0.1:1080', ['demo:'])
expect<string>(proxy.protocol)
expect<string>(proxy.host)
expect<number>(proxy.port)
expect<string>(proxy.username)
expect<string>(proxy.password)
expect<boolean>(proxy.secure)

expect<Proxy>(parseProxyUrl(new URL('demo://127.0.0.1:1080'), ['demo:']))
expect<string>(proxyName(proxy))
expect<string>(authority({ host: 'origin.example', port: 443 }))
expect<boolean>(hasCredentials(proxy))
expect<string>(authority(proxy))

const err = new ProxyError('the proxy is not running')
expect<'ProxyError'>(err.name)
expect<'PROXY_ERROR'>(err.code)
expect<string>(err.message)
expect<ProxyError | null>(proxyErrorIn(err))
expect<ProxyError | null>(proxyErrorIn('not an error'))

const handshake: Handshake = async ({ socket, reader, proxy, target }: HandshakeContext) => {
  socket.write(`GOTO ${authority(target)}\n`)
  expect<Buffer>(await reader.read(2))
  expect<Buffer>(await reader.until('\r\n\r\n'))
  expect<Buffer>(await reader.until(Buffer.from('\n')))
  expect<Buffer>(await reader.until('\n', 32768))
  expect<Buffer>(reader.release())
  if (proxy.host === '') throw new ProxyError('nowhere to go')
}

// A handshake may be synchronous, and a Reader may be built by hand.
const sync: Handshake = ({ socket, proxy }) => {
  expect<Reader>(new Reader(socket, proxy))
}

const tunnel: Tunnel = { proxy, handshake, timeout: 5000 }
const minimal: Tunnel = { proxy, handshake: sync }

const socketOptions: ProxySocketOptions = { host: 'origin.example', port: 443, timeout: 5000 }
const socket = new ProxySocket(tunnel, socketOptions)
expect<Proxy>(socket.proxy)
expect<ProxyTarget>(socket.target)
expect<string | undefined>(socket.remoteAddress)
expect<number | undefined>(socket.remotePort)
expect<ProxySocket>(socket.setKeepAlive(true, 1000))
expect<ProxySocket>(socket.setNoDelay())
expect<ProxySocket>(socket.setTimeout(5000, () => {}))
expect<ProxySocket>(socket.ref())
expect<ProxySocket>(socket.unref())
socket.write('a ProxySocket is a Duplex')
new ProxySocket(minimal)

const agentOptions: ProxyAgentOptions = {
  handshakeTimeout: 10000,
  keepAlive: true,
  timeout: 5000,
  maxSockets: 4
}
const base = new ProxyHTTPAgent(tunnel, agentOptions)
expect<Proxy>(base.proxy)
expect<string>(base.proxyUrl)
expect<Tunnel>(base.tunnel)
expect<string[]>(ProxyHTTPAgent.protocols)
new ProxyHTTPSAgent(tunnel)

const pair: ProxyAgents = createAgents(tunnel, agentOptions)
expect<ProxyHTTPAgent>(pair.http)
expect<ProxyHTTPSAgent>(pair.https)

// A protocol of one's own, which is what the base is for.
class DemoAgent extends ProxyHTTPAgent {
  static protocols = ['demo']

  constructor(url: string, opts?: ProxyAgentOptions) {
    super({ proxy: parseProxyUrl(url, ['demo:']), handshake }, opts)
  }

  get tunnel(): Tunnel {
    return { ...super.tunnel, timeout: 1000 }
  }
}
expect<string>(new DemoAgent('demo://127.0.0.1:1080').proxyUrl)

// bare-socks-proxy-agent ─────────────────────────────────────────────────────────────────

expect<string[]>(socks.SCHEMES)
expect<Proxy>(socks.parse('socks5://127.0.0.1:1080'))
expect<Proxy>(socks.parse(new URL('socks5h://127.0.0.1:1080')))
expect<Promise<void>>(socks.handshake({} as HandshakeContext))
expect<string[]>(socks.SocksProxyHTTPAgent.protocols)

const socksAgents = socks.createAgents('socks5://127.0.0.1:1080')
expect<socks.SocksProxyHTTPAgent>(socksAgents.http)
expect<socks.SocksProxyHTTPSAgent>(socksAgents.https)
expect<ProxyHTTPAgent>(socksAgents.http)
socks.createAgents(socks.parse('socks5://127.0.0.1:1080'), { handshakeTimeout: 2000 })
new socks.SocksProxyHTTPAgent('socks5://me:s3cret@127.0.0.1:1080')
new socks.SocksProxyHTTPSAgent(new URL('socks5://127.0.0.1:1080'), { keepAlive: true })
expect<ProxyError | null>(socks.proxyErrorIn(err))
expect<socks.ProxyLike>('socks5://127.0.0.1:1080')

// bare-https-proxy-agent ─────────────────────────────────────────────────────────────────

expect<string[]>(connect.SCHEMES)
expect<Proxy>(connect.parse('http://127.0.0.1:3128'))
expect<Promise<void>>(connect.handshake({} as connect.ConnectHandshakeContext))

const connectAgents = connect.createAgents('http://127.0.0.1:3128', {
  headers: { 'Proxy-Probe': 'yes' }
})
expect<connect.HttpsProxyHTTPAgent>(connectAgents.http)
expect<connect.HttpsProxyHTTPSAgent>(connectAgents.https)
expect<connect.ProxyHeaders>(connectAgents.http.proxyHeaders)

// Headers as a function, called once per tunnel.
let nonce = 0
const rotating: connect.HttpsProxyAgentOptions = {
  headers: () => ({ 'Proxy-Probe': `probe/${++nonce}`, 'X-Absent': null }),
  handshakeTimeout: 2000
}
new connect.HttpsProxyHTTPSAgent('https://proxy.lan:443', rotating)

// bare-http-proxy-agent ──────────────────────────────────────────────────────────────────

expect<string[]>(forward.SCHEMES)
expect<Proxy>(forward.parse('http://127.0.0.1:3128'))
expect<string[]>(forward.HttpProxyAgent.protocols)

const forwarding = new forward.HttpProxyAgent('http://127.0.0.1:3128', {
  headers: { 'Proxy-Probe': 'yes' }
})
expect<ProxyHTTPAgent>(forwarding)
expect<forward.ProxyHeaders>(forwarding.proxyHeaders)
forwarding.proxyHeaders = () => ({ 'Proxy-Probe': 'again' })
new forward.HttpProxyAgent(forward.parse('https://proxy.lan:443'))

// bare-any-proxy-agent ───────────────────────────────────────────────────────────────────

expect<string[]>(any.protocols)
expect<Proxy>(any.parse('socks5://127.0.0.1:1080'))
expect<Proxy>(any.parse('http://127.0.0.1:3128'))
expect<string>(any.proxyName(proxy))

const anyAgents = any.createAgents('socks5://127.0.0.1:1080')
expect<ProxyHTTPAgent>(anyAgents.http)
expect<ProxyHTTPSAgent>(anyAgents.https)
any.createAgents(any.parse('http://127.0.0.1:3128'), { headers: () => ({ A: 1 }) })

// bare-proxy-from-env ────────────────────────────────────────────────────────────────────

expect<env.ProxySetting | null>(env.fromEnv('https_proxy', 'HTTPS_PROXY'))
expect<env.ProxySetting | null>(env.proxyForProtocol('https:'))
expect<env.ProxySetting | null>(env.proxyForProtocol('https'))

const setting = env.fromEnv('all_proxy')
if (setting) {
  expect<string>(setting.url)
  expect<string>(setting.source)
}

expect<string>(env.getProxyForUrl('https://origin.example/v1/info'))
expect<string>(env.getProxyForUrl(new URL('https://origin.example')))
expect<string>(env.getProxyForUrl({ protocol: 'https:', hostname: 'origin.example' }))
expect<string>(env.normalize('proxy.lan:3128'))

const bypass: env.NoProxy | null = env.noProxy()
expect<boolean>(env.bypassed(bypass, 'origin.example'))
expect<boolean>(env.bypassed(null, 'origin.example'))
expect<env.NoProxy | null>(env.parseNoProxy('localhost,.local.com,10.0.0.0/8'))
expect<env.NoProxy | null>(env.parseNoProxy(undefined))

if (bypass) {
  expect<boolean>(bypass.all)
  expect<string[]>(bypass.hosts)
  expect<number>(bypass.nets[0].base)
  expect<number>(bypass.nets[0].mask)
}

// The pairing most programs want, and the one the root README shows.
const target = 'https://origin.example'
const found = env.getProxyForUrl(target)
const agents = found ? any.createAgents(found) : null
expect<ProxyHTTPSAgent | undefined>(agents?.https)

const linked = pairAgents(
  new forward.HttpProxyAgent(proxy),
  new connect.HttpsProxyHTTPSAgent(proxy)
)
expect<forward.HttpProxyAgent>(linked.http)
expect<connect.HttpsProxyHTTPSAgent>(linked.https)
expect<ProxyAgentOptions>({ ca: Buffer.alloc(0) })
