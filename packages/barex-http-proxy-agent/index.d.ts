import URL from 'bare-url'
import {
  Proxy,
  ProxyAgentOptions,
  ProxyError,
  ProxyHTTPAgent,
  proxyErrorIn
} from 'barex-proxy-agent'

/**
 * A proxy this package will take: a url, or one already read by {@link parse} - or by any
 * other `parseProxyUrl`, so a url need only be read once.
 */
export type ProxyLike = string | URL | Proxy

/**
 * Headers for the proxy to read, as `http-proxy-agent` takes them: an object, or a function
 * called once per request. A `undefined`, `null` or empty value is left out.
 */
export type ProxyHeaders =
  | Record<string, string | number | null | undefined>
  | (() => Record<string, string | number | null | undefined>)

/** Options this agent takes: {@link ProxyAgentOptions} plus the headers for the proxy. */
export interface HttpProxyAgentOptions extends ProxyAgentOptions {
  /** Headers sent with the forwarded request, for the proxy rather than for the target. */
  headers?: ProxyHeaders
}

/**
 * The schemes a proxy url may be written with.
 *
 * It is the proxy url being read, not the target's, so an `https://` one is a proxy reached
 * over TLS - the request, and any `Proxy-Authorization` on it, is then encrypted to the
 * proxy rather than sent in the clear. What the proxy does onwards is unchanged, and it
 * still reads the whole request.
 *
 * No default port goes with them: a port-less proxy url is refused rather than read as 80
 * or 443, which is what `http-proxy-agent` reads it as.
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

/**
 * An agent that asks an http proxy to forward, for `http:` targets.
 *
 * The request goes to the proxy with the whole url in the request line -
 * `GET http://origin.example/v1/info HTTP/1.1`, what RFC 9112 section 3.2.2 calls absolute-form -
 * and the proxy makes the request onwards. Node's `http-proxy-agent`, and the same half of
 * the job: `barex-https-proxy-agent` is the other, asking for a tunnel with `CONNECT`.
 *
 * The split is worth keeping for the reason Node keeps it. Forwarding is the form every
 * http proxy must accept, while a proxy configured to allow `CONNECT` to port 443 only - a
 * common Squid default - will refuse a tunnel to port 80 and forward this happily.
 *
 * `http:` targets only, exactly as `http-proxy-agent`. The proxy makes the request, so
 * there is no end-to-end connection for TLS to run over and nothing here for an `https:`
 * target to use; the tunnel of `barex-https-proxy-agent` is what leaves TLS to the target
 * intact. There is no agent pair here for the same reason.
 */
export class HttpProxyAgent extends ProxyHTTPAgent {
  /** `['http', 'https']` - the proxy's schemes, as `http-proxy-agent` lists them. */
  static protocols: string[]

  /**
   * @param proxy The proxy url, or one already parsed.
   * @param opts Passed to {@link ProxyHTTPAgent}, less `headers`. `handshakeTimeout` has
   *   nothing to time out here: a forwarding proxy says nothing until it has answered the
   *   request, so a proxy that is listening and not answering is the request's own timeout
   *   to report.
   */
  constructor(proxy: ProxyLike, opts?: HttpProxyAgentOptions)

  /** Headers sent with the request, read once per request when given as a function. */
  proxyHeaders: ProxyHeaders
}

export { ProxyError, proxyErrorIn, type Proxy }
