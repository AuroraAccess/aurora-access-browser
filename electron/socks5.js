/**
 * socks5.js — minimal SOCKS5 (RFC 1928) CONNECT client.
 *
 * Chromium's session proxy only covers Electron's own network stack. The Site
 * Inspector and the password audit talk to the network straight from Node, so
 * they need their own tunnel — otherwise they would connect from the real IP
 * and defeat the whole point of the proxy.
 *
 * Target hostnames are sent as domain names (ATYP 0x03), so the proxy resolves
 * DNS as well: no DNS leak on this path.
 */
const net = require('net')
const tls = require('tls')
const https = require('https')

const VERSION = 0x05
const AUTH_NONE = 0x00
const AUTH_USERPASS = 0x02
const AUTH_NO_ACCEPTABLE = 0xFF
const CMD_CONNECT = 0x01
const ATYP_IPV4 = 0x01
const ATYP_DOMAIN = 0x03
const ATYP_IPV6 = 0x04
const AUTH_USERPASS_VERSION = 0x01

/** Encode a textual IPv6 address as the 16 bytes SOCKS5 expects. */
function ipv6ToBuffer(address) {
  // Drop a zone index (fe80::1%eth0) and expand a dotted-quad tail such as
  // ::ffff:192.0.2.1, which stands for the final two 16-bit groups.
  let normalized = address.split('%')[0]
  const ipv4Tail = normalized.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (ipv4Tail) {
    const octets = ipv4Tail[1].split('.').map(Number)
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      throw new Error(`SOCKS5: invalid IPv6 address "${address}"`)
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    normalized = `${normalized.slice(0, ipv4Tail.index + 1)}${high}:${low}`
  }

  const elided = normalized.includes('::')
  const [left, right = ''] = normalized.split('::')
  const leftGroups = left ? left.split(':') : []
  const rightGroups = right ? right.split(':') : []
  const total = leftGroups.length + rightGroups.length

  // Exactly eight groups must remain: a "::" has to stand for at least one.
  if (elided ? total > 7 : total !== 8) {
    throw new Error(`SOCKS5: invalid IPv6 address "${address}"`)
  }

  const groups = [...leftGroups, ...new Array(8 - total).fill('0'), ...rightGroups]
  const buffer = Buffer.alloc(16)
  groups.forEach((group, index) => {
    const value = parseInt(group || '0', 16)
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`SOCKS5: invalid IPv6 address "${address}"`)
    }
    buffer.writeUInt16BE(value, index * 2)
  })
  return buffer
}

/**
 * Open a TCP tunnel through a SOCKS5 proxy to targetHost:targetPort.
 * Resolves with a connected net.Socket; rejects if the handshake fails.
 */
function connectThroughSocks5(options) {
  const {
    host, port,
    username = '', password = '',
    targetHost, targetPort,
    timeout = 10000,
  } = options

  return new Promise((resolve, reject) => {
    if (!host || !port) {
      reject(new Error('SOCKS5: proxy host/port is not configured'))
      return
    }
    if (!targetHost || !targetPort) {
      reject(new Error('SOCKS5: target host/port is not configured'))
      return
    }

    const socket = net.connect({ host, port })
    socket.setNoDelay(true)

    let settled = false
    let phase = 'greeting'
    let buffer = Buffer.alloc(0)

    const timer = setTimeout(() => fail(new Error('SOCKS5: handshake timeout')), timeout)

    // The socket is handed to the caller asynchronously, so keep one listener
    // attached: a reset landing in that window must not surface as an
    // unhandled 'error' event and take the process down.
    const swallowSocketError = () => {}

    const fail = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', fail)
      socket.on('error', swallowSocketError)
      socket.removeListener('close', onClose)
      socket.destroy()
      reject(err)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeListener('data', onData)
      socket.removeListener('error', fail)
      socket.on('error', swallowSocketError)
      socket.removeListener('close', onClose)
      socket.setTimeout(0)
      // Hand any bytes that arrived after the reply back to the TLS layer.
      if (buffer.length) socket.unshift(buffer)
      resolve(socket)
    }

    const onClose = () => fail(new Error('SOCKS5: proxy closed the connection during handshake'))

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        advance()
      } catch (err) {
        fail(err)
      }
    }

    const sendGreeting = () => {
      const useAuth = Boolean(username || password)
      const methods = useAuth ? [AUTH_NONE, AUTH_USERPASS] : [AUTH_NONE]
      socket.write(Buffer.concat([Buffer.from([VERSION, methods.length]), Buffer.from(methods)]))
    }

    const sendCredentials = () => {
      const user = Buffer.from(username, 'utf8')
      const pass = Buffer.from(password, 'utf8')
      if (user.length > 255 || pass.length > 255) {
        throw new Error('SOCKS5: proxy credentials exceed 255 bytes')
      }
      socket.write(Buffer.concat([
        Buffer.from([AUTH_USERPASS_VERSION, user.length]), user,
        Buffer.from([pass.length]), pass,
      ]))
    }

    const sendConnect = () => {
      const portBytes = Buffer.alloc(2)
      portBytes.writeUInt16BE(targetPort)

      // Literal IPs use their own address type; everything else goes as a
      // domain name so the proxy performs DNS resolution (no DNS leak).
      let atyp
      let address
      if (net.isIPv4(targetHost)) {
        atyp = ATYP_IPV4
        address = Buffer.from(targetHost.split('.').map((part) => Number(part) & 0xff))
      } else if (net.isIPv6(targetHost)) {
        atyp = ATYP_IPV6
        address = ipv6ToBuffer(targetHost)
      } else {
        atyp = ATYP_DOMAIN
        address = Buffer.from(targetHost, 'utf8')
        if (address.length > 255) throw new Error('SOCKS5: target hostname exceeds 255 bytes')
      }

      const header = [VERSION, CMD_CONNECT, 0x00, atyp]
      if (atyp === ATYP_DOMAIN) header.push(address.length)

      socket.write(Buffer.concat([Buffer.from(header), address, portBytes]))
    }

    const take = (n) => {
      const head = buffer.subarray(0, n)
      buffer = buffer.subarray(n)
      return head
    }

    const advance = () => {
      if (phase === 'greeting') {
        if (buffer.length < 2) return
        const [version, method] = take(2)
        if (version !== VERSION) throw new Error('SOCKS5: unexpected version in greeting reply')
        if (method === AUTH_NO_ACCEPTABLE) throw new Error('SOCKS5: no acceptable authentication method')
        if (method === AUTH_USERPASS) {
          sendCredentials()
          phase = 'auth'
          return
        }
        if (method !== AUTH_NONE) throw new Error(`SOCKS5: unsupported auth method ${method}`)
        sendConnect()
        phase = 'reply'
        return
      }

      if (phase === 'auth') {
        if (buffer.length < 2) return
        const [version, status] = take(2)
        if (version !== AUTH_USERPASS_VERSION) throw new Error('SOCKS5: unexpected version in auth reply')
        if (status !== 0x00) throw new Error('SOCKS5: proxy authentication failed')
        sendConnect()
        phase = 'reply'
        return
      }

      // phase === 'reply'
      if (buffer.length < 4) return
      const version = buffer[0]
      const reply = buffer[1]
      const atyp = buffer[3]
      if (version !== VERSION) throw new Error('SOCKS5: unexpected version in connect reply')
      if (reply !== 0x00) throw new Error(`SOCKS5: connect rejected by proxy (code ${reply})`)

      if (atyp === ATYP_IPV4) {
        if (buffer.length < 4 + 4 + 2) return
      } else if (atyp === ATYP_IPV6) {
        if (buffer.length < 4 + 16 + 2) return
      } else if (atyp === ATYP_DOMAIN) {
        if (buffer.length < 5) return
        const nameLength = buffer[4]
        if (buffer.length < 4 + 1 + nameLength + 2) return
      } else {
        throw new Error(`SOCKS5: unknown address type in connect reply (${atyp})`)
      }

      succeed()
    }

    socket.on('error', fail)
    socket.on('close', onClose)
    socket.on('data', onData)
    socket.once('connect', () => {
      try {
        sendGreeting()
      } catch (err) {
        fail(err)
      }
    })
  })
}

/**
 * https.Agent that tunnels each connection through the SOCKS5 proxy.
 *
 * For HTTPS the TLS wrap normally happens inside `createConnection`, so we
 * override it to build the SOCKS5 tunnel first and run the handshake on top of
 * it. This keeps the real certificate available (unlike Electron's `net`,
 * which exposes no TLS metadata) while still hiding the real IP.
 */
class Socks5HttpsAgent extends https.Agent {
  constructor(socks, agentOptions = {}) {
    super({ keepAlive: false, ...agentOptions })
    this.socks = socks
  }

  createConnection(options, callback) {
    let settled = false
    const done = (err, socket) => {
      if (settled) return
      settled = true
      callback(err, socket)
    }

    connectThroughSocks5({
      host: this.socks.host,
      port: this.socks.port,
      username: this.socks.username,
      password: this.socks.password,
      targetHost: options.host,
      targetPort: options.port || 443,
      // Honour the caller's request timeout for the handshake too; when the
      // request set none, leave it undefined so the default budget applies.
      timeout: Number.isFinite(options.timeout) ? options.timeout : undefined,
    }).then((tunnel) => {
      // SNI must not be an IP literal (RFC 6066).
      const servername = options.servername || options.host
      const tlsSocket = tls.connect({
        socket: tunnel,
        servername: net.isIP(servername) ? undefined : servername,
        rejectUnauthorized: options.rejectUnauthorized !== false,
      }, () => done(null, tlsSocket))
      tlsSocket.once('error', (err) => done(err))
    }, (err) => done(err))

    // The socket is produced asynchronously; deliver it via `callback`.
    return undefined
  }
}

module.exports = { connectThroughSocks5, Socks5HttpsAgent }
