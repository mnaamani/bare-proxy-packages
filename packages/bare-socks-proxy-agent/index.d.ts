import URL from 'bare-url'
import {
  HandshakeContext,
  Proxy,
  ProxyAgentOptions,
  ProxyAgents,
  ProxyError,
  ProxyHTTPAgent,
  ProxyHTTPSAgent,
  Reader,
  proxyErrorIn
} from 'bare-proxy-agent'

/**
 * A proxy this package will take: a url, or one already read by {@link parse} — or by any
 * other `parseProxyUrl`, so a url need only be read once.
 */
export type ProxyLike = string | URL | Proxy

/**
 * The schemes a proxy url may be written with here.
 *
 * `socks5://` and `socks5h://` are the same proxy to this package — the target is never
 * resolved locally under either — and the spelling is kept only so that errors quote back
 * what was configured.
 *
 * No default port goes with them: a port-less proxy url is refused rather than read as
 * 1080, which is what `socks-proxy-agent` and curl both read it as.
 */
export const SCHEMES: string[]

/**
 * Reads a SOCKS5 proxy url.
 *
 * @param url The proxy url, `socks5://` or `socks5h://`.
 * @returns The url read into its parts.
 * @throws `Error` when the scheme is not one of {@link SCHEMES}, or the url names no host
 *   or no port.
 */
export function parse(url: string | URL): Proxy

/**
 * The SOCKS5 handshake (RFC 1928), with username and password authentication (RFC 1929)
 * when the proxy url carries credentials.
 *
 * Three round trips at most: what we can authenticate with, the credentials themselves, and
 * the connect request. The target goes over the wire as written and the proxy resolves it,
 * so no DNS query for it leaves the machine.
 *
 * Exported for anyone assembling a tunnel by hand; the agents below already use it.
 *
 * @param context The socket, reader, proxy and target, as `ProxySocket` supplies them.
 * @throws {@link ProxyError} when the proxy does not speak SOCKS5, wants an authentication
 *   method we do not have, refuses the credentials, or cannot reach the target.
 */
export function handshake(context: HandshakeContext): Promise<void>

/** An agent for `http:` targets, reached through a SOCKS5 proxy. */
export class SocksProxyHTTPAgent extends ProxyHTTPAgent {
  /** `['socks5', 'socks5h']`, as `socks-proxy-agent` lists them. */
  static protocols: string[]

  /**
   * @param proxy The proxy url, or one already parsed.
   * @param opts Passed to {@link ProxyHTTPAgent}.
   */
  constructor(proxy: ProxyLike, opts?: ProxyAgentOptions)
}

/**
 * An agent for `https:` targets: the same tunnel, with TLS to the target negotiated inside
 * it.
 */
export class SocksProxyHTTPSAgent extends ProxyHTTPSAgent {
  /** `['socks5', 'socks5h']`, as `socks-proxy-agent` lists them. */
  static protocols: string[]

  /**
   * @param proxy The proxy url, or one already parsed.
   * @param opts Passed to {@link ProxyHTTPSAgent}.
   */
  constructor(proxy: ProxyLike, opts?: ProxyAgentOptions)
}

/**
 * Both agents at once, which is what a program routing all of its traffic wants.
 *
 * Which of the two a request needs is the caller's to pick: `http:` and `ws:` targets take
 * `agents.http`, `https:` and `wss:` take `agents.https`.
 *
 * @param proxy The proxy url, or one already parsed.
 * @param opts Passed to both agents.
 * @returns Both agents.
 */
export function createAgents(
  proxy: ProxyLike,
  opts?: ProxyAgentOptions
): ProxyAgents<SocksProxyHTTPAgent, SocksProxyHTTPSAgent>

export { ProxyError, proxyErrorIn, Reader, type HandshakeContext, type Proxy }
