/**
 * proxy.js — loads the SOCKS5 proxy configuration.
 *
 * Three sources are supported. Each field is taken from the first source that
 * supplies a value, so sources can be mixed:
 *
 *   1. AURORA_PROXY_HOST / _PORT / _USER / _PASS environment variables. These
 *      win over any file, which makes them usable as a launch-time override:
 *      pass the real endpoint on the command line and it takes effect even
 *      when a config file is present.
 *   2. proxy-config.json in the user's data directory (see setUserDataPath).
 *      This is how a packaged build is configured: the application bundle is
 *      read-only, so the file has to live outside it. macOS puts it at
 *      ~/Library/Application Support/aurora-access-browser/proxy-config.json.
 *      JSON on purpose — the file sits in a directory other processes can
 *      write to, and parsing it cannot execute code the way requiring a .js
 *      module from that directory would.
 *   3. electron/proxy-config.js, which is gitignored and only exists in a
 *      development checkout (see proxy-config.example.js).
 *
 * "enabled": false in a config file switches proxying off, but an explicit
 * AURORA_PROXY_HOST still outranks it — that is the point of an override.
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
    return null // No local config in this checkout.
  }
}

function loadProxyConfig() {
  const fileConfig = loadExternalConfig() || loadBundledConfig()

  const env = process.env
  const envHost = env.AURORA_PROXY_HOST

  // A host in the environment is an explicit override, so it also lifts a
  // file's "enabled": false.
  if (fileConfig && fileConfig.enabled === false && !envHost) return null

  const host = envHost || (fileConfig && fileConfig.host) || ''
  const port = Number(env.AURORA_PROXY_PORT || (fileConfig && fileConfig.port) || 0)
  const username = env.AURORA_PROXY_USER || (fileConfig && fileConfig.username) || ''
  const password = env.AURORA_PROXY_PASS || (fileConfig && fileConfig.password) || ''

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      '[Sentinel] Proxy is not configured (host/port missing or invalid) — traffic is NOT proxied. ' +
      'Set AURORA_PROXY_HOST/AURORA_PROXY_PORT, or put ' +
      `${EXTERNAL_CONFIG_NAME} in ${userDataPath || "the application's data directory"} ` +
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
