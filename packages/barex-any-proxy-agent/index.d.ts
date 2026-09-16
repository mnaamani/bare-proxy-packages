import URL from 'bare-url'
import {
  Proxy,
  ProxyAgentOptions,
  ProxyAgents,
  ProxyError,
  ProxyHTTPAgent,
  ProxyHTTPSAgent,
  proxyErrorIn,
  proxyName
} from 'barex-proxy-agent'

/**
 * A proxy this package will take: a url of any scheme in {@link protocols}, or one already
 * read by {@link parse}.
 */
export type ProxyLike = string | URL | Proxy

/** Options the agents take, plus the headers an http proxy is given. */
export interface AnyProxyAgentOptions extends ProxyAgentOptions {
  /**
   * Headers for the proxy, for the `http:` and `https:` schemes. Ignored by a SOCKS5
   * proxy, which has no headers.
   */
  headers?:
    | Record<string, string | number | null | undefined>
    | (() => Record<string, string | number | null | undefined>)
}

/**
 * The proxy schemes there is an agent for: `['socks5', 'socks5h', 'http', 'https']`.
 *
 * Node's `proxy-agent` exports the same list under the same name.
 */
export const protocols: string[]

/**
 * Reads a proxy url of any scheme this package speaks, by the package that speaks it.
 *
 * @param url The proxy url.
 * @returns The url read into its parts, ready to hand to {@link createAgents}.
 * @throws `Error` naming the schemes on offer when it is one of the many no agent here
 *   speaks — a proxy url that cannot be honoured is better refused than quietly ignored,
 *   since going direct is exactly what whoever set it was trying to prevent. Also for a url
 *   with no port: every scheme here has a port some client treats as its default and no two
 *   agree, so none of them is guessed.
 */
export function parse(url: string | URL): Proxy

/**
 * An agent for `http:` targets and one for `https:` ones, both going through `proxy`,
 * whichever scheme it is written with.
 *
 * This is what a program wants when the proxy url comes from a user or from the environment
 * rather than from its own source: the scheme is then a fact about the url, not a choice,
 * and the difference between `socks5://` and `http://` stops being the program's business.
 *
 * Which of the two a request needs is the caller's to pick, and it is the target's scheme
 * that decides: `http:` and `ws:` take `agents.http`, `https:` and `wss:` take
 * `agents.https`.
 *
 * An http proxy is spoken to two different ways depending on where the request is going,
 * which is the same split Node makes between `http-proxy-agent` and `https-proxy-agent`: an
 * `http:` target is forwarded, with the whole url in the request line, and an `https:` one
 * gets a `CONNECT` tunnel with TLS negotiated end to end inside it.
 *
 * @param proxy The proxy url, or one already parsed.
 * @param opts Passed to the agents the scheme calls for.
 * @returns Both agents.
 * @throws `Error` as {@link parse} does, when `proxy` is a url rather than a parsed one.
 */
export function createAgents(proxy: ProxyLike, opts?: AnyProxyAgentOptions): ProxyAgents

export { ProxyError, proxyErrorIn, proxyName, type Proxy }
