import Buffer from 'bare-buffer'
import URL from 'bare-url'
import { Duplex } from 'bare-stream'
import { Agent, type HTTPAgentOptions } from 'bare-http1'
import { TCPSocketConnectOptions, TCPSocketOptions } from 'bare-tcp'
import { TLSSocketOptions } from 'bare-tls'

/**
 * A proxy url read into the parts an agent and a handshake need.
 *
 * Produced by {@link parseProxyUrl}, and by the `parse()` of whichever package speaks the
 * scheme. Accepted anywhere a proxy url is, so a url need only be read once.
 */
export interface Proxy {
  /** The scheme the url was written with, with its colon: `'socks5:'`, `'http:'`. */
  protocol: string
  /** The host, with an IPv6 address stripped of the brackets a url writes it in. */
  host: string
  /** The port, which a proxy url must name — none is guessed. */
  port: number
  /** The username, percent-decoded, or `''` when the url carries none. */
  username: string
  /** The password, percent-decoded, or `''` when the url carries none. */
  password: string
  /**
   * Whether the first hop is itself TLS, so that the handshake — and any credentials in it
   * — is encrypted to the proxy rather than sent in the clear. Set by whoever parsed the
   * url; an `https://` proxy is one.
   */
  secure: boolean
}

/** Where a request is going, as the handshake is told it. */
export interface ProxyTarget {
  /** The request scheme when supplied by the HTTP client. */
  protocol?: string
  /** The target's hostname, unresolved. */
  host: string
  /** The target's port. */
  port: number
}

/**
 * Reads a proxy url into a {@link Proxy}.
 *
 * `schemes` is the list the calling package answers to, spelled with the colon:
 * `['socks5:', 'socks5h:']`.
 *
 * A host and a port, both written down, and nothing else: a path, a query or a fragment
 * means whoever configured this pasted something that is not a proxy address. A missing
 * port is refused rather than defaulted, which is the one place this departs from every
 * proxy agent in the Node ecosystem — `http-proxy-agent` reads a port-less url as 80, curl
 * as 1080, and proxies tend to listen on 8080, so any default is a guess, and a guess that
 * lands on the wrong service is handed the credentials before anything notices.
 *
 * @param value The proxy url, as a string or anything that stringifies to one.
 * @param schemes The schemes to accept, each with its trailing colon.
 * @returns The url read into its parts, with `secure` left `false` for the caller to set.
 * @throws `Error` when the value is not a url, names a scheme not in `schemes`, carries a
 *   path, query or fragment, or names no host or no port.
 */
export function parseProxyUrl(value: string | URL, schemes: string[]): Proxy

/**
 * How a proxy is named in an error: the address it was configured with, and never its
 * password.
 *
 * @param proxy The proxy to name.
 * @returns `'socks5://127.0.0.1:1080'`, with an IPv6 host in brackets.
 */
export function proxyName(proxy: Pick<Proxy, 'protocol' | 'host' | 'port'>): string

/**
 * `host:port`, with an IPv6 host in the brackets that a url and an http header both want.
 *
 * @param target The host and port to write.
 * @returns The authority, ready for a request line or a `Host` header.
 */
export function authority(target: ProxyTarget): string

/**
 * Whether a proxy url carries credentials to authenticate with.
 *
 * @param proxy The proxy to check.
 * @returns `true` when either a username or a password was written in the url.
 */
export function hasCredentials(proxy: Pick<Proxy, 'username' | 'password'>): boolean

/**
 * Something went wrong on the way through a proxy.
 *
 * A proxy failure reaches the caller through whatever made the request — `bare-fetch`
 * answers one with `NETWORK_ERROR` and keeps the reason as its `cause`, and a library above
 * that may wrap it again — so {@link proxyErrorIn} is usually how it is found rather than
 * `instanceof`.
 */
export class ProxyError extends Error {
  /** Always `'ProxyError'`. */
  get name(): 'ProxyError'
  /** Always `'PROXY_ERROR'`. What {@link proxyErrorIn} looks for. */
  readonly code: 'PROXY_ERROR'

  /** @param message What went wrong, in the words of whoever asked. */
  constructor(message: string)
}

/**
 * The proxy error behind a failure, however deeply it has been wrapped.
 *
 * Follows the `cause` chain rather than testing the error itself, since the error a caller
 * is handed is whatever the http client wrapped it in.
 *
 * @param err The error to look inside. Anything at all; a non-error answers `null`.
 * @returns The {@link ProxyError} found, or `null` when the failure was not a proxy's.
 */
export function proxyErrorIn(err: unknown): ProxyError | null

/**
 * Reads exact counts out of a socket while a handshake is being spoken.
 *
 * Only one read is outstanding at a time — a handshake is a conversation — and whatever was
 * read past the end of it is handed back by {@link Reader.release}, since it belongs to the
 * target. A {@link ProxySocket} makes one of these and passes it to the handshake; there is
 * rarely a reason to construct one yourself.
 */
export class Reader {
  /**
   * @param socket The socket to the proxy, which the reader listens to until released.
   * @param proxy The proxy, used only to name it in the errors below.
   */
  constructor(socket: Duplex, proxy: Proxy)

  /**
   * Exactly `n` bytes.
   *
   * @param n How many bytes to wait for.
   * @returns The bytes read.
   * @throws {@link ProxyError} when the socket fails or the proxy closes the connection
   *   before that many arrive.
   */
  read(n: number): Promise<Buffer>

  /**
   * Everything up to and including `delimiter`, which is how an http response head ends.
   *
   * @param delimiter What to read up to, included in what comes back.
   * @param maxBytes Maximum bytes through the delimiter, default 16384. Target bytes
   *   after the delimiter do not count toward this limit.
   * @returns The bytes read, delimiter and all.
   * @throws {@link ProxyError} when the socket fails or the proxy closes the connection
   *   before the delimiter arrives, or when the limit is reached without the delimiter.
   */
  until(delimiter: string | Buffer, maxBytes?: number): Promise<Buffer>

  /**
   * Stops reading and hands back anything read past the end of the handshake.
   *
   * The target may have spoken first, and its first bytes can arrive in the same read as
   * the last of the handshake. They must not be lost with the reader.
   *
   * @returns Whatever was buffered and unread, which belongs to the target.
   */
  release(): Buffer
}

/** What a handshake is given: a socket to the proxy, a reader over it, and both ends. */
export interface HandshakeContext {
  /** The socket to the proxy — TLS to it already running when `proxy.secure`. */
  socket: Duplex
  /** A {@link Reader} over that socket, released for you once the handshake resolves. */
  reader: Reader
  /** The proxy being spoken to. */
  proxy: Proxy
  /** Where the caller is trying to get to. */
  target: ProxyTarget
}

/**
 * Opens the tunnel. Called once per connection, on a socket to the proxy.
 *
 * Resolve and everything after belongs to the target; throw a {@link ProxyError} and the
 * request fails with your words.
 */
export type Handshake = (context: HandshakeContext) => void | Promise<void>

/** A proxy and the way to speak to it: what {@link ProxySocket} and the agents take. */
export interface Tunnel {
  /** The proxy to connect to. */
  proxy: Proxy
  /** How to open the tunnel once connected. */
  handshake: Handshake
  /**
   * How long the proxy has to answer its own handshake, in milliseconds.
   *
   * @defaultValue 30000
   */
  timeout?: number
}

/** Options a {@link ProxySocket} is built with, as an http agent passes them. */
export interface ProxySocketOptions {
  /** The request scheme when supplied by the HTTP client. */
  protocol?: string
  /** The target's host, which reaches the handshake as `target.host`. */
  host?: string
  /** The target's port, which reaches the handshake as `target.port`. */
  port?: number
  /**
   * The socket's idle timeout in milliseconds, refreshed by traffic. Seeded from the
   * options because `bare-tcp`'s own `Socket` takes it that way, so an agent that sets it
   * there does not find it quietly dropped.
   */
  timeout?: number
}

/**
 * A connection to a target that runs through a proxy.
 *
 * A `Duplex` rather than a wrapper around a connected socket, because an http agent asks
 * for a connection and gets one back on the spot while a proxy handshake takes round trips.
 * Writes made before it finishes are held by the stream and go out after — which is what
 * lets a TLS socket be layered straight on top of one of these, its `ClientHello` written
 * during construction and leaving once the tunnel is open.
 *
 * The handshake itself is not this class's business; see {@link Tunnel}.
 */
export class ProxySocket extends Duplex {
  /**
   * @param tunnel The proxy to reach and the handshake to speak to it.
   * @param opts Where the connection is going, as an http agent names it.
   */
  constructor(tunnel: Tunnel, opts?: ProxySocketOptions)

  /** The proxy this connection runs through. */
  get proxy(): Proxy

  /** Where it is going. */
  get target(): ProxyTarget

  /**
   * The far end of the underlying socket, which is the proxy — more honest than reporting a
   * target no socket was ever opened to. `undefined` until the connection is up.
   */
  get remoteAddress(): string | undefined

  /** The proxy's port, or `undefined` until the connection is up. */
  get remotePort(): number | undefined

  /**
   * Remembered as well as forwarded, since an agent may call it mid-handshake, before there
   * is a socket to apply it to.
   */
  setKeepAlive(enable?: boolean, delay?: number): this

  /** Remembered as well as forwarded, as {@link ProxySocket.setKeepAlive} is. */
  setNoDelay(enable?: boolean): this

  /** Remembered as well as forwarded, as {@link ProxySocket.setKeepAlive} is. */
  setTimeout(ms: number, ontimeout?: () => void): this

  /** Remembered as well as forwarded, as {@link ProxySocket.setKeepAlive} is. */
  ref(): this

  /** Remembered as well as forwarded, as {@link ProxySocket.setKeepAlive} is. */
  unref(): this
}

/** Options the proxy agents take, which are `bare-http1`'s plus one. */
export interface ProxyAgentOptions
  extends HTTPAgentOptions, TCPSocketOptions, TCPSocketConnectOptions, TLSSocketOptions {
  /**
   * How long the proxy has to answer its own handshake, in milliseconds.
   *
   * Named apart from `timeout`, which `bare-http1` has already taken for the socket's idle
   * timeout and copies onto every connection the agent makes. The one option here with no
   * counterpart in Node's proxy agents, where this is what `timeout` means.
   *
   * @defaultValue 30000
   */
  handshakeTimeout?: number
}

/**
 * An http agent whose connections run through a proxy. For `http:` targets.
 *
 * `bare-fetch` and `bare-ws` both take an agent, so a pair of these is the whole of routing
 * a program's traffic. Keep-alive is on by default, and matters more here than it does on a
 * direct agent: a reused tunnel is a handshake that is not spoken again.
 *
 * Note that `createConnection()` returns a {@link ProxySocket}. It is left out of these
 * typings rather than narrowed, because `bare-http1` declares it as returning a `TCPSocket`
 * and a `ProxySocket` is not one — the only place these typings are looser than the code.
 */
export class ProxyHTTPAgent extends Agent {
  /**
   * The proxy schemes this agent speaks, as Node's proxy agents carry them. Empty here and
   * filled in by the package that knows: `['socks5', 'socks5h']`, `['http', 'https']`.
   */
  static protocols: string[]

  /**
   * @param tunnel The proxy to reach and the handshake to speak to it.
   * @param opts Passed to `bare-http1`'s `Agent`, less `handshakeTimeout`. `host`, `port`,
   *   `path` and `protocol` are dropped: an agent's options beat a request's, so one left here by
   *   mistake would silently redirect every request the agent ever carries.
   */
  constructor(tunnel: Tunnel, opts?: ProxyAgentOptions)

  /** The proxy as its package parsed it. Named after `socks-proxy-agent`'s pair. */
  get proxy(): Proxy

  /** The address the proxy was configured with, as a string, and never its password. */
  get proxyUrl(): string

  /**
   * What a connection is opened with.
   *
   * A getter, so a subclass can fold in something that changes between requests — the
   * `proxyHeaders` of `bare-https-proxy-agent` is the case in point. A subclass that
   * overrides it must build on `super.tunnel` rather than on the underlying tunnel, or it
   * drops the refusal described below.
   *
   * The handshake rejects explicit secure schemes. For connections with no scheme it
   * conservatively rejects port 443. Requests are routed to a paired agent, or rejected
   * when their scheme is incompatible, before consulting the connection pool.
   */
  get tunnel(): Tunnel
}

/**
 * An http agent whose connections run through a proxy. For `https:` targets.
 *
 * The same tunnel as {@link ProxyHTTPAgent}, with TLS to the target negotiated inside it —
 * so the proxy carries ciphertext and never reads it. The certificate is checked against
 * the target, not against the proxy that carried the bytes.
 */
export class ProxyHTTPSAgent extends ProxyHTTPAgent {
  /**
   * @param tunnel The proxy to reach and the handshake to speak to it.
   * @param opts As {@link ProxyHTTPAgent}, with `defaultPort` 443.
   */
  constructor(tunnel: Tunnel, opts?: ProxyAgentOptions)
}

/** An agent for `http:` targets and one for `https:` ones. */
export interface ProxyAgents<
  Http extends ProxyHTTPAgent = ProxyHTTPAgent,
  Https extends ProxyHTTPSAgent = ProxyHTTPSAgent
> {
  /** For `http:` and `ws:` targets. */
  http: Http
  /** For `https:` and `wss:` targets. */
  https: Https
}

/**
 * The pair a caller usually wants: one agent for `http:` urls, one for `https:`, both
 * through the same proxy.
 *
 * Pick the initial agent by target scheme. The pair routes subsequent requests using
 * `opts.protocol`, including redirects followed by `bare-fetch` on nonstandard ports.
 *
 * @param tunnel The proxy to reach and the handshake to speak to it.
 * @param opts Passed to both agents.
 * @returns Both agents.
 */
export function createAgents(tunnel: Tunnel, opts?: ProxyAgentOptions): ProxyAgents

/**
 * Links two agents so scheme-changing requests are delegated before pooling or rewriting
 * headers. Used by every `createAgents()` factory. Each agent keeps its own connection
 * pool; destroy both when finished. A request without `protocol` uses the selected agent.
 */
export function pairAgents<Http extends ProxyHTTPAgent, Https extends ProxyHTTPSAgent>(
  http: Http,
  https: Https
): ProxyAgents<Http, Https>
