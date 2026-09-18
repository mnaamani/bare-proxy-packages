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
} from 'barex-proxy-agent'

/**
 * A proxy this package will take: a url, or one already read by {@link parse} - or by any
 * other `parseProxyUrl`, so a url need only be read once.
 */
export type ProxyLike = string | URL | Proxy

/**
 * Headers for the proxy to read, as `https-proxy-agent` takes them: an object, or a
 * function called once per tunnel so that a value which changes - a rotating credential -
 * is read when the tunnel is opened rather than when the agent was made.
 *
 * A `undefined` or `null` value is left out. The proxy is the one hop that reads these
 * rather than the ciphertext inside the tunnel, so nothing is added that was not asked for.
 */
export type ProxyHeaders =
  | Record<string, string | number | null | undefined>
  | (() => Record<string, string | number | null | undefined>)

/** Options these agents take: {@link ProxyAgentOptions} plus the headers for the proxy. */
export interface HttpsProxyAgentOptions extends ProxyAgentOptions {
  /** Headers sent with the `CONNECT`, for the proxy rather than for the target. */
  headers?: ProxyHeaders
}

/**
 * The schemes a proxy url may be written with.
 *
 * It is the proxy url being read, not the target's, so an `https://` one is a proxy reached
 * over TLS - the `CONNECT` and any `Proxy-Authorization` on it are then encrypted to the
 * proxy rather than sent in the clear.
 *
 * No default port goes with them: a port-less proxy url is refused rather than read as 80
 * or 443, which is what `https-proxy-agent` reads it as.
 */
export const SCHEMES: string[]

/**
 * Reads an http proxy url, setting `secure` for an `https://` one.
 *
 * @param url The proxy url, `http://` or `https://`.
 * @returns The url read into its parts.
 * @throws `Error` when the scheme is not one of {@link SCHEMES}, or the url names no host
 *   or no port.
 */
export function parse(url: string | URL): Proxy

/** What the `CONNECT` handshake is given: a {@link HandshakeContext} plus the headers. */
export interface ConnectHandshakeContext extends HandshakeContext {
  /** Headers for the proxy, already resolved from {@link ProxyHeaders}. */
  headers?: Record<string, string | number | null | undefined>
}

/**
 * The HTTP `CONNECT` handshake (RFC 9110 section 9.3.6): ask the proxy for a tunnel, and
 * everything after the blank line belongs to the target.
 *
 * Nothing is sent beyond what the method needs - no user agent, no cookies - since the
 * proxy is the one hop that sees these headers rather than the ciphertext inside them.
 *
 * Exported for anyone assembling a tunnel by hand; the agents below already use it.
 *
 * @param context The socket, reader, proxy and target, as `ProxySocket` supplies them,
 *   plus any headers for the proxy.
 * @throws {@link ProxyError} when the target or a header carries a newline, the proxy
 *   answers something that is not HTTP, asks for authentication, or refuses the tunnel.
 */
export function handshake(context: ConnectHandshakeContext): Promise<void>

/**
 * An agent for `http:` targets, tunnelled with `CONNECT`.
 *
 * Note that forwarding, not tunnelling, is what an `http:` target usually wants:
 * `barex-http-proxy-agent` is that half, and a proxy configured to allow `CONNECT` to port
 * 443 only - a common Squid default - will refuse a tunnel to port 80 that a forwarded
 * request would have got through. Use this one when the tunnel is wanted specifically.
 */
export class HttpsProxyHTTPAgent extends ProxyHTTPAgent {
  /** `['http', 'https']` - the proxy's schemes, as `https-proxy-agent` lists them. */
  static protocols: string[]

  /**
   * @param proxy The proxy url, or one already parsed.
   * @param opts Passed to {@link ProxyHTTPAgent}, less `headers`.
   */
  constructor(proxy: ProxyLike, opts?: HttpsProxyAgentOptions)

  /** Headers sent with the `CONNECT`, read once per tunnel when given as a function. */
  proxyHeaders: ProxyHeaders
}

/**
 * An agent for `https:` targets: the same tunnel, with TLS to the target negotiated inside
 * it, so the proxy carries ciphertext and never reads it.
 */
export class HttpsProxyHTTPSAgent extends ProxyHTTPSAgent {
  /** `['http', 'https']` - the proxy's schemes, as `https-proxy-agent` lists them. */
  static protocols: string[]

  /**
   * @param proxy The proxy url, or one already parsed.
   * @param opts Passed to {@link ProxyHTTPSAgent}, less `headers`.
   */
  constructor(proxy: ProxyLike, opts?: HttpsProxyAgentOptions)

  /** Headers sent with the `CONNECT`, read once per tunnel when given as a function. */
  proxyHeaders: ProxyHeaders
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
  opts?: HttpsProxyAgentOptions
): ProxyAgents<HttpsProxyHTTPAgent, HttpsProxyHTTPSAgent>

export { ProxyError, proxyErrorIn, Reader, type HandshakeContext, type Proxy }
