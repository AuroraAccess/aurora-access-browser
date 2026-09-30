/**
 * proxy.js — loads the SOCKS5 proxy configuration.
 *
 * Two sources are supported, in this order:
 *
 *   1. proxy-config.json in the user's data directory (see setUserDataPath).
 *      This is how a packaged build is configured: the application bundle is
 *      read-only, so the file has to live outside it. macOS puts it at
 *      ~/Library/Application Support/aurora-access-browser/proxy-config.json.
 *      JSON on purpose — the file sits in a directory other processes can
 *      write to, and parsing it cannot execute code the way requiring a .js
 *      module from that directory would.
 *   2. electron/proxy-config.js, which is gitignored and only exists in a
 *      development checkout (see proxy-config.example.js).
 *
 * Individual values fall back to the AURORA_PROXY_HOST / _PORT / _USER / _PASS
 * environment variables.
 *
 * Returns null when no usable config exists, so callers fall back to a direct
 * connection instead of crashing.
 *
 * There is deliberately no built-in endpoint: with no config file and no
 * environment variables, proxying stays off rather than dialling some baked-in
 * host that the user never asked for.
 *
 * Kept free of electron imports: bin/verify-proxy.js requires this module under
 * plain Node, so the user data directory has to be injected by the caller.
 */
const fs = require('fs')
const path = require('path')

const EXTERNAL_CONFIG_NAME = 'proxy-config.json'

let userDataPath = null
let cache

/**
 * Points this module at the user's data directory (Electron's
 * app.getPath('userData')). Call it before the first getProxyConfig(); calling
 * it later still works, it just drops the cached result.
 */
function setUserDataPath(dir) {
  userDataPath = dir || null
  cache = undefined
}

function getExternalConfigPath() {
  return userDataPath ? path.join(userDataPath, EXTERNAL_CONFIG_NAME) : null
}

function loadExternalConfig() {
  const file = getExternalConfigPath()
  if (!file || !fs.existsSync(file)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error(`[Sentinel] Ignoring ${file}: expected a JSON object`)
      return null
    }
    console.log(`[Sentinel] Loaded proxy config from ${file}`)
    return parsed
  } catch (err) {
    console.error(`[Sentinel] Ignoring ${file}: ${err.message}`)
    return null
  }
}

function loadBundledConfig() {
  try {
    return require('./proxy-config')
  } catch {
    return null // No local config — fall back to environment variables.
  }
}

function loadProxyConfig() {
  const fileConfig = loadExternalConfig() || loadBundledConfig()

  if (fileConfig && fileConfig.enabled === false) return null

  const env = process.env
  const host = (fileConfig && fileConfig.host) || env.AURORA_PROXY_HOST || ''
  const port = Number((fileConfig && fileConfig.port) || env.AURORA_PROXY_PORT || 0)
  const username = (fileConfig && fileConfig.username) || env.AURORA_PROXY_USER || ''
  const password = (fileConfig && fileConfig.password) || env.AURORA_PROXY_PASS || ''

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      '[Sentinel] Proxy is not configured (host/port missing or invalid) — traffic is NOT proxied. ' +
      `Put ${EXTERNAL_CONFIG_NAME} in ${userDataPath || "the application's data directory"} ` +
      '(see proxy-config.example.json), or fill in electron/proxy-config.js in a development ' +
      'checkout (see proxy-config.example.js).'
    )
    return null
  }

  return { host, port, username, password }
}

function getProxyConfig() {
  if (cache === undefined) cache = loadProxyConfig()
  return cache
}

module.exports = { getProxyConfig, loadProxyConfig, setUserDataPath }
