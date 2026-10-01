/**
 * proxy-control.js — runtime proxy control for the CURRENT Electron session.
 *
 * This is the dynamic counterpart to ./proxy.js. proxy.js loads a fixed
 * endpoint from config files / environment variables at launch; this module
 * lets the user switch the proxy on and off from the UI at any moment.
 *
 * Everything here is scoped to Electron sessions: the caller injects an
 * `apply` function that calls session.setProxy() on the sessions it owns.
 * Nothing in this file touches macOS/Windows system proxy settings, and it
 * deliberately has no `require('electron')` so it can be unit-tested under
 * plain Node.
 *
 * State (protocol, host, port, credentials, bypass rules, enabled flag) is
 * persisted as JSON in the user's data directory so an enabled proxy comes
 * back after a restart. The password is stored in cleartext there — same
 * trade-off as the existing proxy-config.json, and it never leaves the
 * machine.
 *
 * On startup the saved endpoint is probed with a TCP connect before it is
 * re-applied: an unreachable proxy (dead provider, wrong port, no network)
 * would otherwise make every page fail, so it is switched off and the browser
 * starts on a direct connection instead. The endpoint is kept for next time.
 *
 * Supported protocols: http, https, socks4, socks5.
 */

const fs = require('fs')
const path = require('path')
const net = require('net')

const PROTOCOLS = ['http', 'https', 'socks4', 'socks5']

// How long the startup probe waits for the proxy to accept a TCP connection.
// Overridable so a slow/high-latency proxy is not misjudged as offline.
const REACHABILITY_TIMEOUT_MS = Number(process.env.AURORA_PROXY_CHECK_TIMEOUT || 3000)
// Escape hatch: set AURORA_PROXY_SKIP_CHECK=1 to always trust the saved state
// and skip the probe (e.g. a proxy that only accepts connections lazily).
const SKIP_REACHABILITY_CHECK = process.env.AURORA_PROXY_SKIP_CHECK === '1'

// Loopback traffic goes straight out even while the proxy is on, so the app's
// own dev server / internal panels keep working. Deliberately excludes
// Chromium's '<-loopback>' rule: that rule SUBTRACTS the implicit loopback
// bypass and forces localhost (i.e. the Vite dev server) through the proxy,
// which fails with ERR_PROXY_CONNECTION_FAILED when the proxy is unreachable.
const DEFAULT_BYPASS_RULES = 'localhost, 127.0.0.1, [::1], <local>'

const STATE_FILE = 'proxy-state.json'

let userDataPath = null
let applier = null
let state = blankState()

function blankState() {
  return {
    enabled: false,
    protocol: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
    // An empty override means "use the built-in loopback rules" (see applier).
    bypassRules: '',
  }
}

function statePath() {
  return userDataPath ? path.join(userDataPath, STATE_FILE) : null
}

function readPersisted() {
  const file = statePath()
  if (!file || !fs.existsSync(file)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    // Never restore an enabled proxy without a usable endpoint.
    if (parsed.enabled && !(parsed.host && parsed.port)) parsed.enabled = false
    return parsed
  } catch (err) {
    console.error(`[Sentinel] Ignoring ${file}: ${err.message}`)
    return null
  }
}

function persist() {
  const file = statePath()
  if (!file) return
  try {
    fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 })
  } catch (err) {
    console.error(`[Sentinel] Could not persist proxy state: ${err.message}`)
  }
}

// Coerce a possibly-partial input object into a full, valid state. Returns an
// error string instead of throwing so callers can surface it to the UI.
function normalize(input) {
  const next = { ...blankState(), ...state }

  if (input && typeof input === 'object') {
    if (input.protocol !== undefined) {
      const p = String(input.protocol).toLowerCase()
      if (!PROTOCOLS.includes(p)) return { error: `Unsupported protocol: ${input.protocol}` }
      next.protocol = p
    }
    if (input.host !== undefined) next.host = String(input.host).trim()
    if (input.port !== undefined) next.port = String(input.port).trim()
    if (input.username !== undefined) next.username = String(input.username)
    if (input.password !== undefined) next.password = String(input.password)
    if (input.bypassRules !== undefined) next.bypassRules = String(input.bypassRules).trim()
    if (input.enabled !== undefined) next.enabled = !!input.enabled
  }

  if (next.enabled) {
    if (!isValidHost(next.host)) {
      return { error: 'Enter a valid host (IP address or domain, no scheme or spaces).' }
    }
    const port = Number(next.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'Port must be a number between 1 and 65535.' }
    }
    next.port = String(port)
  }

  return { state: next }
}

/**
 * TCP-connect probe to a proxy endpoint. Works for every supported protocol
 * (http/https/socks4/socks5) because they are all plain TCP listeners — we do
 * not speak the proxy protocol here, only check that something is listening.
 * Always resolves: { reachable: true } or { reachable: false, error }.
 */
function checkReachable(host, port, timeoutMs = REACHABILITY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve({ reachable: false, error: 'No endpoint configured' })
      return
    }

    let settled = false
    const socket = net.createConnection({ host, port: Number(port) })

    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ reachable: true }))
    socket.once('timeout', () => finish({ reachable: false, error: `timed out after ${timeoutMs}ms` }))
    socket.once('error', (err) => finish({ reachable: false, error: err.message }))
  })
}

/**
 * Validate a (possibly unsaved) endpoint and probe it. Backs the UI's
 * "Test connection" button. Resolves to { reachable, error? }.
 */
async function testEndpoint(input) {
  const host = (input && input.host !== undefined ? String(input.host) : state.host).trim()
  const port = String(input && input.port !== undefined ? input.port : state.port).trim()

  if (!isValidHost(host)) {
    return { reachable: false, error: 'Enter a valid host (IP address or domain, no scheme or spaces).' }
  }
  const p = Number(port)
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { reachable: false, error: 'Port must be a number between 1 and 65535.' }
  }

  return checkReachable(host, String(p))
}

function isValidHost(host) {
  if (!host || host.length > 253) return false
  if (host.includes('://') || /[\s/?#]/.test(host)) return false
  // IPv6 literal, e.g. [::1]
  if (host.startsWith('[') && host.endsWith(']')) return true
  // Hostname / IPv4: letters, digits, dots, hyphens, colons.
  return /^[a-zA-Z0-9._:-]+$/.test(host)
}

/** Build the Electron `proxyRules` string for a state, or null if disabled. */
function buildProxyRules(s) {
  if (!s || !s.enabled || !s.host || !s.port) return null
  return `${s.protocol}://${s.host}:${s.port}`
}

/** The bypass rules Electron should use for a state. */
function buildProxyBypassRules(s) {
  return (s && s.bypassRules) || DEFAULT_BYPASS_RULES
}

/**
 * Point the controller at a data directory and give it the function that
 * applies a state to the real Electron sessions. Loads persisted state and
 * applies it immediately if the proxy was left enabled.
 */
async function init({ userDataPath: dir, apply }) {
  userDataPath = dir || null
  applier = typeof apply === 'function' ? apply : null
  state = { ...blankState(), ...(readPersisted() || {}) }

  if (!state.enabled || !applier) return

  // Probe the saved endpoint before trusting it. A dead proxy would break
  // every page, so on failure we fall back to a direct connection and remember
  // the endpoint for the next run rather than silently carrying a broken state.
  if (!SKIP_REACHABILITY_CHECK) {
    const check = await checkReachable(state.host, state.port)
    if (!check.reachable) {
      console.warn(
        `[Sentinel] Saved proxy ${state.protocol}://${state.host}:${state.port} is unreachable ` +
        `(${check.error}); starting with a direct connection. The endpoint stays configured.`
      )
      state = { ...state, enabled: false }
      persist()
      try {
        // Undo whatever configureProxy() may have applied, so sessions are direct.
        await applier(state, null, buildProxyBypassRules(state))
      } catch (err) {
        console.error(`[Sentinel] Failed to reset to a direct connection: ${err.message}`)
      }
      return
    }
  }

  try {
    await applier(state, buildProxyRules(state), buildProxyBypassRules(state))
  } catch (err) {
    console.error(`[Sentinel] Failed to restore proxy state: ${err.message}`)
  }
}

function getState() {
  return { ...state }
}

/** Credentials to answer a proxy auth challenge with, or null when off. */
function getActive() {
  if (!state.enabled || !state.host) return null
  return { username: state.username, password: state.password }
}

/** Validate, apply and persist a new state. Returns { ok, state } or { ok, error }. */
async function setProxy(input) {
  const { state: next, error } = normalize(input)
  if (error) return { ok: false, error }

  state = next
  try {
    if (applier) await applier(state, buildProxyRules(state), buildProxyBypassRules(state))
  } catch (err) {
    return { ok: false, error: err.message }
  }
  persist()
  return { ok: true, state: getState() }
}

/** Turn proxying off (direct connection) and keep the endpoint for next time. */
async function disable() {
  state = { ...state, enabled: false }
  try {
    if (applier) await applier(state, null, buildProxyBypassRules(state))
  } catch (err) {
    return { ok: false, error: err.message }
  }
  persist()
  return { ok: true, state: getState() }
}

module.exports = {
  PROTOCOLS,
  DEFAULT_BYPASS_RULES,
  init,
  getState,
  getActive,
  setProxy,
  disable,
  checkReachable,
  testEndpoint,
  buildProxyRules,
  buildProxyBypassRules,
}
