/**
 * Consistency tests: the Sec-CH-UA brand list must be BYTE-FOR-BYTE identical
 * across the three places it is defined:
 *
 *   1. HTTP request headers — patched per-session in main.js via
 *      applyClientHintPatch(), backed by electron/identity.js.
 *   2. The JS side — navigator.userAgentData patched in the sandboxed
 *      webview preload (webview-preload.js).
 *   3. High-entropy variants (full version list) in both places.
 *
 * A JS-vs-HTTP mismatch is read by captcha providers as UA spoofing, so any
 * drift between these files is a fingerprint bug. The test parses the actual
 * source files (the sandboxed preload cannot require() shared modules, so
 * its literals are the source of truth for the JS side) and asserts parity.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const identity = require('../electron/identity')

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
const mainSrc = readSrc('electron/main.js')
const preloadSrc = readSrc('electron/webview-preload.js')

const CHROME = '139.0.7258.139' // representative version; format matters, not the value
const CHROME_MAJOR = CHROME.split('.')[0]
// The full version the preload can see: the app sets the canonical UA with
// "Chrome/<major>.0.0.0", so the UA-derived chromeFull is <major>.0.0.0.
const CHROME_UA_FULL = `${CHROME_MAJOR}.0.0.0`

test('identity.secChUaBrands: header format (major-only grease "99")', () => {
  const header = identity.secChUaBrands(false, CHROME)
  assert.equal(
    header,
    `"Not_A Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"`
  )
})

test('identity.secChUaBrands: full-version header format', () => {
  const header = identity.secChUaBrands(true, CHROME)
  assert.equal(
    header,
    `"Not_A Brand";v="99.0.0.0", "Google Chrome";v="${CHROME}", "Chromium";v="${CHROME}"`
  )
})

test('main.js delegates sec-ch-ua headers to the shared identity module', () => {
  // No inline brand literals left in main.js — drilling a second copy there
  // is exactly the drift this test suite exists to prevent.
  assert.doesNotMatch(mainSrc, /"Not_A Brand"/, 'main.js must not carry its own brand list')
  assert.match(mainSrc, /identity\.secChUaBrands\(/, 'main.js must build headers via identity.secChUaBrands()')
})

/**
 * Parse every item of a JS brand array: version may be a string literal
 * ('99') or an identifier (chromeMajor, chromeFull, full). Returns tokens
 * { brand, version } where version stays unresolved when it is an identifier.
 */
function parseBrandItems(blockBody) {
  return [...blockBody.matchAll(/\{\s*brand:\s*'([^']+)'\s*,\s*version:\s*(?:'([^']*)'|([A-Za-z_$][\w$]*))\s*\}/g)].map(
    (m) => ({ brand: m[1], version: m[2] !== undefined ? m[2] : m[3] })
  )
}

/** Resolve identifier tokens to the versions the patched UA carries. */
function resolveBrands(items) {
  return items.map(({ brand, version }) => ({
    brand,
    version:
      version === 'chromeMajor' ? CHROME_MAJOR
      : version === 'chromeFull' ? CHROME_UA_FULL
      : version, // string literal (grease) left as-is
  }))
}

/**
 * Extract the brand-list literals from the preload source:
 *   brands = [ ... ]  and  fullVersionList = [ ... ]
 */
function parsePreloadBrands(src) {
  const brandsBlock = src.match(/const brands = \[([\s\S]*?)\];/)
  const fullBlock = src.match(/const fullVersionList = \[([\s\S]*?)\];/)
  assert.ok(brandsBlock, 'webview-preload.js must define the low-entropy brands list')
  assert.ok(fullBlock, 'webview-preload.js must define the fullVersionList')

  return {
    brands: resolveBrands(parseBrandItems(brandsBlock[1])),
    fullVersionList: resolveBrands(parseBrandItems(fullBlock[1])),
  }
}

test('JS brands (preload) match the HTTP header list byte-for-byte', () => {
  const { brands } = parsePreloadBrands(preloadSrc)
  const header = identity.secChUaBrands(false, CHROME)

  // Same list, same order, same values as the shared module produces.
  assert.deepEqual(brands, identity.userAgentDataBrands(CHROME_UA_FULL).brands)
  assert.equal(brands[0].brand, 'Not_A Brand')
  assert.equal(brands[0].version, '99')
  assert.equal(brands[1].version, CHROME_MAJOR)
  assert.equal(brands[2].version, CHROME_MAJOR)

  // Serialize the JS list the way Chromium sends the header and compare —
  // this is the actual JS-vs-HTTP parity check.
  const serialized = brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
  assert.equal(serialized, header)
})

test('JS fullVersionList (preload) is consistent with the UA string the app sets', () => {
  const { fullVersionList } = parsePreloadBrands(preloadSrc)
  // The preload derives chromeFull from navigator.userAgent — which the app
  // normalizes to Chrome/<major>.0.0.0 — so the statically visible fallback is
  // <major>.0.0.0, never a version the UA string doesn't show.
  const uaFallback = identity.userAgentDataBrands(CHROME_UA_FULL).fullVersionList
  assert.deepEqual(fullVersionList, uaFallback)
  assert.equal(fullVersionList[0].version, '99.0.0.0')
  assert.equal(fullVersionList[1].version, CHROME_UA_FULL)
  assert.equal(fullVersionList[2].version, CHROME_UA_FULL)
})

test('getHighEntropyValues preserves the real uaFullVersion (matches the HTTP full-version headers)', () => {
  // The dynamic path reuses the real getHighEntropyValues and maps its
  // uaFullVersion (the REAL Chromium version, same value main.js writes into
  // sec-ch-ua-full-version) into Google Chrome/Chromium brands. The fallback
  // only fires when the API is missing, and it must still be UA-consistent.
  assert.match(
    preloadSrc,
    /const full = values\.uaFullVersion \|\| chromeFull;/,
    'dynamic path must preserve the real uaFullVersion'
  )
  assert.match(preloadSrc, /uaFullVersion: chromeFull/, 'fallback path must expose the UA-derived full version')

  const hiBlock = preloadSrc.match(/fullVersionList: \[([\s\S]*?)\],\s*\};/)
  assert.ok(hiBlock, 'preload must return fullVersionList from getHighEntropyValues')
  const items = parseBrandItems(hiBlock[1])
  assert.deepEqual(
    items.map((b) => b.brand),
    ['Not_A Brand', 'Google Chrome', 'Chromium']
  )
  assert.equal(items[0].version, '99.0.0.0')
  // Chrome/Chromium carry the `full` identifier (real version at runtime).
  assert.equal(items[1].version, 'full')
  assert.equal(items[2].version, 'full')
})

test('canonical UA format: Chrome/<major>.0.0.0, no Electron token, platform preserved', () => {
  const ua = identity.canonicalUserAgent(CHROME, 'Windows NT 10.0; Win64; x64')
  assert.equal(
    ua,
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36`
  )
  assert.ok(!/Electron\//.test(ua), 'UA must not leak the Electron token')
  assert.ok(!/aurora/i.test(ua), 'UA must not leak the app name')

  // Defensive normalization path.
  const dirty = 'Mozilla/5.0 (X11; Linux x86_64) aurora-access-browser/1.1.7 Electron/44.6.0 Chrome/139.0.7258.139 Safari/537.36'
  const fixed = identity.normalizeUserAgent(dirty, CHROME)
  assert.ok(!/Electron/.test(fixed))
  assert.ok(!/aurora/i.test(fixed))
  assert.match(fixed, /Chrome\/139\.0\.0\.0/)
})

test('webview-preload derives chromeMajor/chromeFull from the same UA string the app sets', () => {
  // The preload parses Chrome/<version> out of navigator.userAgent — which is
  // set by main.js via setUserAgent(canonicalUserAgent()). The canonical UA
  // carries Chrome/<major>.0.0.0, so both extractors see exactly those values.
  const ua = identity.canonicalUserAgent(CHROME, 'Windows NT 10.0; Win64; x64')
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1]
  const full = (ua.match(/Chrome\/([\d.]+)/) || [])[1]
  assert.equal(major, CHROME_MAJOR)
  assert.equal(full, CHROME_UA_FULL)
  assert.match(full, /\.0\.0\.0$/, 'canonical UA never exposes the full build number')

  assert.match(preloadSrc, /Chrome\\\/\(\\d\+\)|Chrome\\\/\(\[\\d\.\]\+\)/, 'preload must parse versions out of the UA string')
})
