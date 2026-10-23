/**
 * identity.js — canonical browser identity strings, shared by main.js and
 * unit tests.
 *
 * Electron's default User-Agent leaks identifying tokens ("Electron/x.y.z",
 * the app name as "<app>/<version>") and its Chromium-only brand list
 * contradicts the "Chrome/<major>" UA string — captcha providers read that
 * JS-vs-HTTP mismatch as spoofing. Everything here is therefore rebuilt from
 * the real Chromium version + real platform so that:
 *
 *   - the UA string,                                       (canonicalUserAgent)
 *   - the Sec-CH-UA / -Full-Version / -Full-Version-List request headers, (secChUaBrands)
 *   - and navigator.userAgentData patched in the webview preload          (webview-preload.js)
 *
 * all agree byte-for-byte.
 *
 * No electron import: this module is require()d under plain Node by
 * test/identity.test.js, which also reads webview-preload.js source and
 * asserts the two sides stay in sync.
 */

/**
 * The canonical User-Agent: real platform token, real Chromium major,
 * "Chrome/<major>.0.0.0" (real Chrome never sends the full build number),
 * no Electron/product tokens.
 *
 * @param {string} chromiumVersion  e.g. "139.0.7258.139" (process.versions.chrome)
 * @param {string} platformToken    content of the "(...)" group of the real
 *                                  Electron UA fallback, e.g. "Windows NT 10.0; Win64; x64"
 * @returns {string}
 */
function canonicalUserAgent(chromiumVersion, platformToken) {
  const major = String(chromiumVersion || '').split('.')[0]
  if (major && platformToken) {
    return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
  }
  return ''
}

/**
 * Defensive fallback: strip known identity tokens from whatever Electron
 * provided and normalize the Chrome version to "<major>.0.0.0".
 *
 * @param {string} fallback        Electron's default UA string
 * @param {string} chromiumVersion process.versions.chrome
 * @returns {string}
 */
function normalizeUserAgent(fallback, chromiumVersion) {
  let ua = String(fallback || '')
    .replace(/\s*Electron\/[\d.]+/, '')
    .replace(/\s*[\w.-]+\/[\d.]+(?=\s+Chrome\/)/, '')
  const major = String(chromiumVersion || '').split('.')[0]
  if (major) ua = ua.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`)
  return ua.trim()
}

/**
 * Extract the "(...)" platform group from an Electron UA fallback.
 * Returns '' when the string does not contain one.
 */
function platformTokenFrom(ua) {
  const m = String(ua || '').match(/\(([^)]+)\)/)
  return m ? m[1] : ''
}

/**
 * Sec-CH-UA brand list, formatted either for the header value or for
 * getHighEntropyValues. "grease" is the deliberately weird first brand
 * ("Not_A Brand") real Chrome sends; keep it in every variant because its
 * ABSENCE is itself detectable.
 *
 * @param {boolean} fullVersion  true → full Chromium version ("139.0.7258.139"),
 *                               false → major only ("139")
 * @param {string}  chromiumVersion process.versions.chrome
 * @returns {string} e.g. `"Not_A Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"`
 */
function secChUaBrands(fullVersion, chromiumVersion) {
  const chrome = String(chromiumVersion || '')
  const major = chrome.split('.')[0] || '0'
  const version = fullVersion ? (chrome || `${major}.0.0.0`) : major
  const grease = fullVersion ? '99.0.0.0' : '99'
  return [
    `"Not_A Brand";v="${grease}"`,
    `"Google Chrome";v="${version}"`,
    `"Chromium";v="${version}"`,
  ].join(', ')
}

/**
 * The JS-side brand lists the webview preload must expose through
 * navigator.userAgentData. Returns low-entropy ({brands}) and high-entropy
 * ({fullVersionList}) variants as arrays — the exact shapes the preload
 * patches in. test/identity.test.js compares these against the literals in
 * webview-preload.js so the JS and HTTP sides can never drift apart.
 *
 * @param {string} chromiumVersion process.versions.chrome
 */
function userAgentDataBrands(chromiumVersion) {
  const chrome = String(chromiumVersion || '')
  const major = chrome.split('.')[0] || ''
  const full = chrome || `${major}.0.0.0`
  return {
    brands: [
      { brand: 'Not_A Brand', version: '99' },
      { brand: 'Google Chrome', version: major },
      { brand: 'Chromium', version: major },
    ],
    fullVersionList: [
      { brand: 'Not_A Brand', version: '99.0.0.0' },
      { brand: 'Google Chrome', version: full },
      { brand: 'Chromium', version: full },
    ],
  }
}

/**
 * Clean desktop Firefox User-Agent tailored for Google auth bypass (accounts.google.com).
 * Google blocks embedded Chromium/Electron WebViews by probing for proprietary
 * Chrome binaries/BotGuard. When presented with Firefox, Google switches to its
 * universal, non-Chromium sign-in form without webview restrictions.
 *
 * @param {string} platform process.platform ('darwin', 'win32', 'linux')
 */
function getFirefoxUserAgent(platform) {
  const p = platform || (typeof process !== 'undefined' ? process.platform : 'win32')
  if (p === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0'
  }
  if (p === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0'
  }
  return 'Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0'
}

/**
 * Checks if a given URL belongs to Google authentication domains.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isGoogleAuthUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase()
    return /(?:^|\.)(?:accounts\.google\.com|accounts\.youtube\.com|oauth2\.googleapis\.com|myaccount\.google\.com)$/.test(hostname)
  } catch (_) {
    return false
  }
}

module.exports = {
  canonicalUserAgent,
  normalizeUserAgent,
  platformTokenFrom,
  secChUaBrands,
  userAgentDataBrands,
  getFirefoxUserAgent,
  isGoogleAuthUrl,
}
