// ─── Release Publisher (feature: full release creation from the UI) ──
// Counterpart of ./release-check.js (read-only probe). This module CREATES
// GitHub releases on the official repository via the GitHub REST API,
// using the native `net.request` client and a token that lives ONLY in the
// environment (AURORA_GITHUB_TOKEN, falling back to the broadly used
// GITHUB_TOKEN) — the same "nothing secret is ever hardcoded" discipline the
// proxy config follows. A missing token is surfaced to the UI as a status
// rather than an error path that pretends success.
//
// Authentication is required for POST /releases; without it GitHub answers
// 401 and this module surfaces that verbatim. Renderer-supplied input is
// validated through ./ipc-guard exactly like every other IPC surface.
//
// testable under plain node --test: an injectable fake `net` (same contract
// as release-check) replaces Electron's client in unit tests.

const { vStr, vNonEmpty, IpcValidationError } = require('./ipc-guard')

const RELEASES_API_URL = 'https://api.github.com/repos/AuroraAccess/aurora-access-browser/releases'
// 10s default ceiling — creation is a single fast POST (no artifacts here:
// attach binaries via the CI release workflow, tags v* trigger it).
const REQUEST_TIMEOUT_MS = Number(process.env.AURORA_RELEASE_PUBLISH_TIMEOUT || 10_000)

/** The token for authenticated POSTs. Never logged, never returned. */
function releaseToken() {
  return process.env.AURORA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
}

function hasReleaseToken() {
  return Boolean(releaseToken())
}

/**
 * Validate + normalize renderer input into the exact GitHub payload shape.
 * Throws IpcValidationError (full ipc-guard discipline). Tag gets the
 * canonical "v" prefix: "2.0.9" ➜ "v2.0.9"; pattern-checked so a hostile
 * renderer cannot smuggle arbitrary refs as tags.
 *
 * @returns {{ tag_name: string, name?: string, body?: string,
 *             target_commitish?: string, draft: boolean, prerelease: boolean }}
 */
function buildReleasePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IpcValidationError('release input: expected object')
  }

  // Tag: strict version-ish tag (v2.0.9, v2.1.0-beta… letters never variants
  // like 'main'). The v prefix is normalized in, not user-required.
  let tag = vNonEmpty(input.tag, { field: 'release.tag', max: 32 }).trim()
  if (!/^v?(\d+\.\d+\.\d+(?:[-.][a-z0-9._-]+)?)$/i.test(tag)) {
    throw new IpcValidationError('release.tag: not a version tag (expected v2.0.9-like)')
  }
  tag = tag.toLowerCase()
  if (!tag.startsWith('v')) tag = `v${tag}`

  const out = { tag_name: tag, draft: !!input.draft, prerelease: !!input.prerelease }

  // Display name — optional; GitHub defaults to the tag.
  if (input.name != null && String(input.name).trim()) {
    out.name = vStr(input.name, { field: 'release.name', max: 120 }).trim()
  }
  // Release notes (markdown) — optional but normally present.
  if (input.notes != null && String(input.notes).trim()) {
    out.body = vStr(input.notes, { field: 'release.notes', max: 16_000 })
  }
  // Target branch/commitish — optional; CI tags from main by default.
  if (input.target != null && String(input.target).trim()) {
    const target = vStr(input.target, { field: 'release.target', max: 100 }).trim()
    if (!/^[A-Za-z0-9._/-]+$/.test(target)) {
      throw new IpcValidationError('release.target: invalid ref')
    }
    out.target_commitish = target
  }
  return out
}

/**
 * Create a release. Resolves:
 *   { ok: true, id, url, tag } on 201, or
 *   { ok: false, error } for every failure (auth, validation, GitHub 422…).
 *
 * @param {object} raw input from the renderer
 * @param {{net?: object, url?: string, token?: string}} opts — injectable for
 *   tests; defaults to the Electron net client and the env token.
 */
async function createRelease(raw, opts = {}) {
  let payload
  try {
    payload = buildReleasePayload(raw)
  } catch (e) {
    if (e instanceof IpcValidationError) return { ok: false, error: e.message }
    throw e
  }

  const token = opts.token !== undefined ? opts.token : releaseToken()
  if (!token) return { ok: false, error: 'No GitHub token: set AURORA_GITHUB_TOKEN (or GITHUB_TOKEN) and restart the app' }

  const net = opts.net || (() => { try { return require('electron').net } catch (_) { return null } })()
  if (!net || typeof net.request !== 'function') {
    return { ok: false, error: 'No net client available' }
  }

  const body = JSON.stringify(payload)
  let result
  try {
    result = await new Promise((resolve, reject) => {
      let settled = false
      const finish = (fn) => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        fn()
      }
      const guard = setTimeout(
        () => finish(() => reject(new Error(`GitHub API timed out after ${REQUEST_TIMEOUT_MS}ms`))),
        REQUEST_TIMEOUT_MS
      )

      const req = net.request({
        method: 'POST',
        url: opts.url || RELEASES_API_URL,
        headers: {
          'User-Agent': 'AuroraAccess-Browser',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      req.on('response', (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => finish(() => resolve({ status: res.statusCode, text: data })))
      })
      req.on('error', (err) => finish(() => reject(err)))
      // Send before the timeout fires — writes happen inside end().
      req.end(body)
    })
  } catch (err) {
    console.warn('[ReleasePublisher] Request failed:', err.message)
    return { ok: false, error: err.message }
  }

  let json = null
  try { json = JSON.parse(result.text) } catch (_) { /* body unused on failure */ }

  if (result.status === 201 && json && json.html_url) {
    console.log(`[ReleasePublisher] Created release ${payload.tag_name} (draft=${payload.draft}) → ${json.html_url}`)
    return { ok: true, id: json.id, tag: payload.tag_name, url: json.html_url }
  }
  if (result.status === 401) {
    return { ok: false, error: 'GitHub rejected the token (HTTP 401) — check AURORA_GITHUB_TOKEN' }
  }
  if (result.status === 404) {
    return { ok: false, error: 'Repository or endpoint not found (HTTP 404)' }
  }
  if (result.status === 422 && json) {
    const detail = Array.isArray(json.errors) && json.errors.length
      ? json.errors.map((x) => x.message || JSON.stringify(x)).join('; ')
      : json.message || 'validation failed'
    return { ok: false, error: `GitHub rejected the release (HTTP 422): ${detail}` }
  }
  console.warn(`[ReleasePublisher] Unexpected GitHub status ${result.status}`)
  return {
    ok: false,
    error: `GitHub answered HTTP ${result.status}: ${json?.message || 'no message'}`,
  }
}

module.exports = { buildReleasePayload, createRelease, hasReleaseToken, releaseToken, RELEASES_API_URL }
