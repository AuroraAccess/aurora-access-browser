/**
 * proxy.js — loads the SOCKS5 proxy configuration.
 *
 * Real credentials live in electron/proxy-config.js, which is gitignored so
 * they never reach the repository (see proxy-config.example.js). Values may
 * also come from AURORA_PROXY_HOST / _PORT / _USER / _PASS environment
 * variables, which take over whenever the config file is absent.
 *
 * Returns null when no usable config exists, so callers fall back to a direct
 * connection instead of crashing.
 *
 * There is deliberately no built-in endpoint: with neither a config file nor
 * environment variables, proxying stays off rather than dialling some baked-in
 * host that the user never asked for.
 */
let cache

function loadProxyConfig() {
  let fileConfig = null
  try {
    fileConfig = require('./proxy-config')
  } catch {
    fileConfig = null // No local config — fall back to environment variables.
  }

  if (fileConfig && fileConfig.enabled === false) return null

  const env = process.env
  const host = (fileConfig && fileConfig.host) || env.AURORA_PROXY_HOST || ''
  const port = Number((fileConfig && fileConfig.port) || env.AURORA_PROXY_PORT || 0)
  const username = (fileConfig && fileConfig.username) || env.AURORA_PROXY_USER || ''
  const password = (fileConfig && fileConfig.password) || env.AURORA_PROXY_PASS || ''

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      '[Sentinel] Proxy is not configured (host/port missing or invalid) — traffic is NOT proxied. ' +
      'Fill in electron/proxy-config.js (see proxy-config.example.js).'
    )
    return null
  }

  return { host, port, username, password }
}

function getProxyConfig() {
  if (cache === undefined) cache = loadProxyConfig()
  return cache
}

module.exports = { getProxyConfig, loadProxyConfig }
