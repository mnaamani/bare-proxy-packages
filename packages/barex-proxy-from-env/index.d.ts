import URL from 'bare-url'

/** A proxy the environment named, and which variable named it. */
export interface ProxySetting {
  /** The proxy url, with `http://` put in front of a value that carried no scheme. */
  url: string
  /**
   * The variable that actually won, so a value that turns out to be unusable can say which
   * one to go and fix.
   */
  source: string
}

/** A parsed `no_proxy`: the hosts and networks exempted from going through a proxy. */
export interface NoProxy {
  /** Whether `no_proxy` was `*`, which exempts every host. */
  all: boolean
  /**
   * The host entries, lowercased, with a leading `*` or `.` and any port stripped. An
   * entry matches the hostname itself or any domain under it.
   */
  hosts: string[]
  /** The CIDR entries, as an IPv4 base address and mask. */
  nets: { base: number; mask: number }[]
}

/**
 * The first of `names` that is set to something, and which one it was.
 *
 * The building block the rest of this is made of, and the one to reach for when a program
 * wants to say where a setting came from rather than just what it was. A variable set to
 * nothing counts as unset: exporting an empty `http_proxy` is how the convention says "no
 * proxy here", usually to undo one the login shell exported.
 *
 * @param names The variables to consult, in the order they win.
 * @returns The proxy and its source, or `null` when none of them is set.
 */
export function fromEnv(...names: string[]): ProxySetting | null

/**
 * The proxy for a target scheme, falling back to `ALL_PROXY`.
 *
 * `ws:` and `wss:` are read as `http:` and `https:` — nothing in the convention defines a
 * `ws_proxy`, and a program that proxies its http traffic means its websockets too.
 *
 * `no_proxy` is not consulted: that is a question about a host, and this one is only about
 * a scheme. Use {@link getProxyForUrl} to have both answered.
 *
 * @param protocol A scheme, with or without its colon, or a whole `URL`'s `protocol`.
 * @returns The proxy and the variable that named it, or `null` for none.
 */
export function proxyForProtocol(protocol: string): ProxySetting | null

/**
 * The proxy url for a target url, or the empty string when it should go direct.
 *
 * Node's `proxy-from-env`, name and shape included, and the same answer for the ordinary
 * cases. It differs deliberately in five: `HTTP_PROXY` in upper case is not read (under CGI
 * a request header `Proxy:` arrives in the environment as `HTTP_PROXY`, so honouring it
 * would let whoever sent the request choose the proxy — CVE-2016-5385); `npm_config_*_proxy`
 * is not read; a scheme-less value is given `http://` rather than the target's scheme, as
 * curl does; a port in `no_proxy` is ignored, since it is the host being exempted; and CIDR
 * entries in `no_proxy` are supported, as curl has since 7.86.
 *
 * @param url The target url, as a string or anything with `protocol` and `hostname` — a
 *   `URL` will do.
 * @returns The proxy url, or `''` to go direct. Also `''` for a value that is not a url.
 */
export function getProxyForUrl(url: string | URL | { protocol: string; hostname: string }): string

/**
 * `no_proxy` as the environment has it, parsed.
 *
 * Read in lower case first, then upper.
 *
 * @returns The parsed list, or `null` when the variable is not set.
 */
export function noProxy(): NoProxy | null

/**
 * Parses a `no_proxy` value.
 *
 * A comma-separated list where `*` alone means every host, an entry matches the hostname
 * itself or any domain under it (`local.com` covers `www.local.com` but not
 * `www.notlocal.com`), and an entry may be an address or a CIDR block instead of a name. A
 * leading `.` or `*.` is the same entry written differently. A port on an entry is ignored,
 * since it is the host that is being exempted — which is curl's reading, where Node's
 * `proxy-from-env` matches the port too.
 *
 * @param value The raw variable, which may be absent.
 * @returns The parsed list, or `null` when there is nothing in it.
 */
export function parseNoProxy(value: string | null | undefined): NoProxy | null

/**
 * Whether a parsed `no_proxy` exempts this host.
 *
 * @param bypass The parsed list. A `null` bypass exempts nothing, so the caller need not
 *   check whether the variable was set.
 * @param hostname The host to test, with or without the brackets of an IPv6 address.
 * @returns `true` when the host should be reached directly.
 */
export function bypassed(bypass: NoProxy | null, hostname: string): boolean

/**
 * Puts a scheme on a proxy value that carries none.
 *
 * The convention writes a value as `[protocol://]host[:port]`, so a bare `host:port` is a
 * proxy reached over http — which is what curl assumes for it too. Node's `proxy-from-env`
 * assumes the *target's* scheme instead, so a bare host in `https_proxy` becomes an
 * `https://` proxy there and an `http://` one here.
 *
 * Anything already carrying a scheme is left alone, including one no agent can speak, so
 * that whoever parses it can name it.
 *
 * @param value The raw variable.
 * @returns The value with a scheme on it.
 */
export function normalize(value: string): string
