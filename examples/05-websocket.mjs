// A websocket through a proxy.
//
//   bare examples/05-websocket.mjs
//
// An agent is what `bare-ws` takes too, and for the same reason `bare-fetch` does: a
// websocket starts life as an http request, so whatever opens the connection for one opens
// it for the other. Nothing in these packages is websocket-specific, and that is the point
// - route a program's http traffic and its websockets have gone with it.
//
// The one thing to get right is which of the pair. It is the *target's* scheme that
// decides, and a websocket's scheme is not its transport's: `ws:` is http, so it takes
// `agents.http`, and `wss:` is https, so it takes `agents.https`.
import http from 'bare-http1'
import ws from 'bare-ws'
import { createAgents } from 'barex-https-proxy-agent'
import { connectProxy, hosts } from './lib/toy-servers.mjs'

const relay = await echoRelay()

// `no_proxy` and friends have nothing to say about websockets - there is no `ws_proxy` in
// the convention - which is why `barex-proxy-from-env` reads `ws:` as `http:` and `wss:` as
// `https:`. See examples/01-from-env.mjs.
const proxy = await connectProxy({ resolve: hosts({ 'relay.example': relay.port }) })

const agents = createAgents(`http://127.0.0.1:${proxy.port}`, { handshakeTimeout: 5000 })

// ws: -> agents.http. The tunnel carries the http upgrade and then the frames, and the
// proxy reads neither.
const socket = new ws.Socket('ws://relay.example/subscribe', { agent: agents.http })

// A `ws.Socket` is a Duplex that opens itself: writes made before the handshake - the http
// upgrade, and under it the proxy's own - are held and go out after. So there is nothing
// to wait for before sending, which is the same property `ProxySocket` has and for the
// same reason.
const said = []
const echoed = new Promise((resolve) => {
  socket.on('message', (payload) => {
    said.push(payload.toString())
    if (said.length === 3) resolve()
  })
})

socket.write('one')
socket.write('two')
socket.write('three')

await echoed
console.log('connected through', `127.0.0.1:${proxy.port}`)
console.log('echoed back:', said.join(', '))
console.log()

console.log('the proxy was asked for: ', proxy.asked[0].line)
console.log('  and saw of the frames: ', 'nothing - a tunnel is bytes it does not read')
console.log('the relay was asked for: ', relay.seen[0].url)
console.log('  by a client at:        ', relay.seen[0].from, '- the proxy, not us')
console.log()

// A wss: relay is the same call with `agents.https`, which negotiates TLS to the relay
// inside the tunnel the proxy opened - at which point the proxy is carrying ciphertext and
// the frames are readable only at the two ends.
console.log('for a wss: relay, the same but:')
console.log("  new ws.Socket('wss://relay.example/subscribe', { agent: agents.https })")

socket.destroy()
agents.http.destroy()
agents.https.destroy()
for (const server of [relay, proxy]) await server.close()

// -- the relay, which is scaffolding rather than the point --------------------------------

// A websocket server that says back whatever it is told. Built on an http server of our
// own so that the port is ours to know; `bare-ws` takes the upgrade from it.
function echoRelay() {
  const seen = []
  const open = new Set()

  const server = http.createServer()

  const relay = new ws.Server({ server }, (socket) => {
    open.add(socket)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => open.delete(socket))
    socket.on('data', (data) => socket.write(data))
  })

  server.on('upgrade', (req) => seen.push({ url: req.url, from: req.socket.remoteAddress }))

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        seen,
        port: server.address().port,
        close: () =>
          new Promise((closed) => {
            for (const socket of open) socket.destroy()
            relay.close(() => server.close(closed))
          })
      })
    })
  })
}
