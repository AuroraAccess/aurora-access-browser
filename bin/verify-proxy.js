#!/usr/bin/env node

/**
 * verify-proxy.js — proves that traffic really leaves through the SOCKS5 proxy.
 *
 * It resolves the machine's public IP twice: once directly (baseline) and once
 * through the same SOCKS5 tunnel the Site Inspector and password audit use. If
 * both addresses are identical, the tunnel is not in effect and the script
 * exits non-zero.
 *
 * The comparison is the entire proof, so a failed baseline lookup is reported
 * as INCONCLUSIVE rather than quietly skipped — the script never exits 0
 * without having actually compared two addresses.
 *
 * Exit codes:
 *   0  tunnel verified (the two addresses differ)
 *   1  FAILED — not tunnelled, no proxy configured, or the proxy is unreachable
 *   2  INCONCLUSIVE — the direct address could not be obtained, so nothing
 *      was proven. Not a success: check from a network with direct access.
 *
 * Node-side only. The Chromium/browser part (tabs and <webview>) is covered by
 * the "[Sentinel] SOCKS5 proxy active" log line in the Electron main process.
 *
 * Usage:
 *   node bin/verify-proxy.js
 *
 * By default this reads the development config (electron/proxy-config.js). To
 * check the file a packaged build actually uses, point it at the application's
 * data directory:
 *   AURORA_USER_DATA="$HOME/Library/Application Support/aurora-access-browser" \
 *     node bin/verify-proxy.js
 */

const https = require('https')
const { getProxyConfig, setUserDataPath } = require('../electron/proxy')
const { Socks5HttpsAgent } = require('../electron/socks5')

const IP_ECHO_URL = 'https://api.ipify.org?format=json'
const TIMEOUT_MS = 15000

const EXIT_FAILED = 1
const EXIT_INCONCLUSIVE = 2

function fetchPublicIp(agent) {
  return new Promise((resolve, reject) => {
    const options = {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'AuroraAccessBrowser-Verify/2.1' },
    }
    if (agent) options.agent = agent

    const req = https.get(IP_ECHO_URL, options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`IP service returned ${res.statusCode}`))
          return
        }
        try {
          const parsed = JSON.parse(body)
          if (!parsed.ip) throw new Error('missing "ip" field')
          resolve(parsed.ip)
        } catch (err) {
          reject(new Error(`unexpected IP service response: ${body.slice(0, 80)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')) })
  })
}

async function main() {
  // External JSON config, when the caller asks for it — otherwise this stays on
  // the development config, exactly as before.
  if (process.env.AURORA_USER_DATA) {
    setUserDataPath(process.env.AURORA_USER_DATA)
    console.log(`[verify-proxy] User data directory: ${process.env.AURORA_USER_DATA}`)
  }

  const proxy = getProxyConfig()

  if (!proxy) {
    console.error('[verify-proxy] No proxy configured.')
    console.error(process.env.AURORA_USER_DATA
      ? '[verify-proxy] No proxy-config.json in that user data directory.'
      : '[verify-proxy] Fill in electron/proxy-config.js (see proxy-config.example.js), or pass '
        + 'AURORA_USER_DATA to read the file a packaged build uses.')
    process.exit(EXIT_FAILED)
  }

  console.log(`[verify-proxy] Endpoint: socks5://${proxy.host}:${proxy.port} (auth ${proxy.username ? 'on' : 'off'})`)

  let directIp = null
  let directError = null
  try {
    directIp = await fetchPublicIp(null)
  } catch (err) {
    directError = err.message
  }

  const agent = new Socks5HttpsAgent(proxy)
  let proxiedIp = null
  try {
    proxiedIp = await fetchPublicIp(agent)
  } catch (err) {
    console.error(`[verify-proxy] FAILED: cannot reach the internet through the proxy — ${err.message}`)
    console.error('[verify-proxy] Check the port, credentials and that the proxy is active.')
    process.exit(EXIT_FAILED)
  } finally {
    agent.destroy()
  }

  console.log(`[verify-proxy] Direct IP : ${directIp || `(unavailable — ${directError})`}`)
  console.log(`[verify-proxy] Proxied IP: ${proxiedIp}`)

  if (!directIp) {
    console.error(
      '[verify-proxy] INCONCLUSIVE: the direct address could not be obtained, so the proxied ' +
      'address cannot be compared against it.'
    )
    console.error(
      '[verify-proxy] The tunnel may well be working, but this run proves nothing. Retry from a ' +
      'network with direct internet access.'
    )
    process.exit(EXIT_INCONCLUSIVE)
  }

  if (directIp === proxiedIp) {
    console.error('[verify-proxy] FAILED: proxied IP equals the direct IP — traffic is NOT tunnelled.')
    process.exit(EXIT_FAILED)
  }

  console.log('[verify-proxy] OK: the SOCKS5 tunnel is in effect.')
}

main().catch((err) => {
  console.error(`[verify-proxy] Unexpected error: ${err.message}`)
  process.exit(EXIT_FAILED)
})
