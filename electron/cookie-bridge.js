/**
 * cookie-bridge.js — one-way auth-cookie seeding for the RAM-only video
 * session.
 *
 * Video tabs run in an in-memory session (`nitrous_youtube_session`) so no
 * media state ever lands on disk. That cookie jar is isolated from
 * `persist:aurora`, so a Google sign-in made in a normal tab is invisible to
 * YouTube ("войти в аккаунт" keeps asking for a password), and a sign-in made
 * inside a video tab dies on quit. Copying the providers' auth cookies
 * (add/update only) into the RAM session makes "signed in to Google" equal
 * "signed in on YouTube" without writing video-tab state to disk.
 *
 * Deletion is intentionally NOT mirrored: a RAM-only login made inside a video
 * tab must not be wiped by a later sync, so the bridge is strictly one-way.
 *
 * No electron import: the two sessions are injected, so
 * test/cookie-bridge.test.js can exercise the real logic with fakes.
 */

const AUTH_COOKIE_DOMAINS = [
  'google.com',
  'youtube.com',
  'youtu.be',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'ggpht.com',
]

const bareHost = (domain) => String(domain || '').replace(/^\./, '').toLowerCase()

function matchesAuthDomain(domain, domains) {
  const host = bareHost(domain)
  if (!host) return false
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

function cookieUrl(cookie) {
  const path = String(cookie.path || '/')
  return `https://${bareHost(cookie.domain)}${path.startsWith('/') ? path : `/${path}`}`
}

const cookieKey = (cookie) => `${cookie.name}|${cookie.domain}|${cookie.path}`

/**
 * Copy provider auth cookies from `fromSession` into `toSession`.
 * Existing values are refreshed; cookies that only exist in the target (a
 * login made inside the video tab) are left alone.
 *
 * @param {{cookies: {get: Function}}} fromSession  persistent profile session
 * @param {{cookies: {get: Function, set: Function}}} toSession  RAM video session
 * @param {string[]} [domains]
 * @returns {Promise<{copied: number, unchanged: number, failed: number}>}
 */
async function seedAuthCookies(fromSession, toSession, domains = AUTH_COOKIE_DOMAINS) {
  const result = { copied: 0, unchanged: 0, failed: 0 }
  if (!fromSession || !toSession || fromSession === toSession) return result

  let source
  try {
    source = (await fromSession.cookies.get({})).filter((c) => matchesAuthDomain(c.domain, domains))
  } catch (_) {
    result.failed++
    return result
  }
  if (!source.length) return result

  // Cookies already in the RAM jar: skip identical values, refresh stale ones.
  const current = new Map()
  try {
    for (const c of await toSession.cookies.get({})) current.set(cookieKey(c), c.value)
  } catch (_) { /* target unreadable: copy everything */ }

  for (const cookie of source) {
    if (current.get(cookieKey(cookie)) === cookie.value) {
      result.unchanged++
      continue
    }
    try {
      await toSession.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'unspecified',
        // Host-only cookies must not become domain cookies.
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        // No expirationDate = session cookie (Chromium default).
        ...(cookie.session || !cookie.expirationDate ? {} : { expirationDate: cookie.expirationDate }),
      })
      result.copied++
    } catch (_) {
      result.failed++
    }
  }
  return result
}

module.exports = { seedAuthCookies, AUTH_COOKIE_DOMAINS }
