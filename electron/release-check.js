// ─── Release Checker (TZ v2.0.9, feature #4) ────────────────────────
// Lightweight "is there a newer release?" probe against the official GitHub
// API. Different from electron-updater (./updater.js): that one downloads and
// installs artifacts in the background; this one exists to ASK the user — it
// only compares versions against package.json and hands release data
// (version tag, notes, release URL) to the renderer for AutoUpdateModal.
//
// Uses the NATIVE `net.request` client (no fetch, no npm deps) and accepts an
// injected net-like object so the whole flow is unit-testable under plain
// node:test without Electron. GitHub's API requires a User-Agent header on
// every request; the HTTPS-strict/exempt rules in main.js do not touch
// requestHeaders made this way, and the response is never cached to disk.

// 4.5s fallback net timeout — a desktop behind a dead tunnel must not hang
// the promise forever, the caller schedules nothing else on this chain.
const REQUEST_TIMEOUT_MS = Number(process.env.AURORA_RELEASE_CHECK_TIMEOUT || 10_000)

const RELEASES_API_URL = 'https://api.github.com/repos/AuroraAccess/aurora-access-browser/releases/latest'

/**
 * Numeric semver comparison for the dotted version strings used by the
 * repo (2.0.8, 2.0.9-beta.1 is truncated to its numeric prefix). Returns
 * positive when a > b, negative when a < b, 0 when equal.
 */
function compareVersions(a, b) {
  const pa = String(a).split('.')
  const pb = String(b).split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0
    const nb = parseInt(pb[i] || '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

/** GitHub tag names usually look like "v2.0.9" — strip the "v" prefix. */
function stripTagPrefix(tag) {
  return String(tag || '').trim().replace(/^v/i, '')
}

/**
 * Perform ONE check. Resolves to:
 *   { ok: true,  isUpdate, currentVersion, latestVersion, release }
 *   { ok: false, error }
 * `release` is the trimmed GitHub release payload consumed by the UI:
 *   { version, name, url, notes, publishedAt }
 *
 * @param {{currentVersion: string, net?: object, url?: string}} opts
 *   `net` — injectable net client (defaults to Electron's), either exposes
 *   net.request(options) or net.fetch(url)-like behavior is NOT needed.
 */
async function checkForUpdate(opts = {}) {
  const currentVersion = String(opts.currentVersion || '')
  if (!currentVersion) return { ok: false, error: 'No current version provided' }

  const net = opts.net || (() => { try { return require('electron').net } catch (_) { return null } })()
  if (!net || typeof net.request !== 'function') {
    // Without Electron net (plain node:test run) the caller MUST inject a
    // fake; standalone there is simply nothing to ask.
    return { ok: false, error: 'No net client available' }
  }

  // Promise-wrapped net.request streaming pipeline. A transport failure
  // (timeout, DNS, dead tunnel) is a SOFT failure surfaced as { ok:false }:
  // a background probe must never throw into an unguarded async chain.
  let raw
  try {
    raw = await new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      fn()
    }
    const guard = setTimeout(() => finish(() => reject(new Error(`GitHub API timed out after ${REQUEST_TIMEOUT_MS}ms`))), REQUEST_TIMEOUT_MS)

    const req = net.request({
      method: 'GET',
      url: opts.url || RELEASES_API_URL,
      headers: {
        'User-Agent': 'AuroraAccess-Browser',
        Accept: 'application/vnd.github+json',
      },
    })
    // Never let a proxy-auth dialog appear for this background check: a
    // 403/401 response is answered below as a soft failure instead.
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        finish(() => reject(new Error(`GitHub API answered HTTP ${res.statusCode}`)))
        return
      }
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => finish(() => resolve(body)))
    })
    req.on('error', (err) => finish(() => reject(err)))
    req.end()
  })
  } catch (err) {
    console.warn('[ReleaseCheck] Request failed:', err.message)
    return { ok: false, error: err.message }
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: 'GitHub API returned malformed JSON' }
  }

  if (!json || typeof json.tag_name !== 'string') {
    return { ok: false, error: 'GitHub API payload misses tag_name' }
  }

  const latestVersion = stripTagPrefix(json.tag_name)
  const isUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false

  // Release notes can be missing (regular GitHub releases always carry body,
  // but a build may publish with an empty one — the modal shows a fallback).
  const release = {
    version: latestVersion,
    name: typeof json.name === 'string' && json.name ? json.name : '' ,
    url: (typeof json.html_url === 'string' && json.html_url) || 'https://github.com/AuroraAccess/aurora-access-browser/releases',
    notes: typeof json.body === 'string' ? json.body : '',
    publishedAt: typeof json.published_at === 'string' ? json.published_at : '',
  }

  console.log(
    `[ReleaseCheck] GitHub latest=${latestVersion} current=${currentVersion} → ` +
    (isUpdate ? 'update available' : 'up to date')
  )

  return {
    ok: true,
    isUpdate,
    currentVersion,
    latestVersion,
    release,
  }
}

module.exports = { checkForUpdate, compareVersions, stripTagPrefix, RELEASES_API_URL }
