/**
 * translate.js — privacy-first inline text translation (selection popup)
 *
 * Strategy (free, tracker-free):
 *   1. Lingva instances (open-source Google-Translate front-ends, no
 *      Google tracking at all) — tried in order.
 *   2. Fallback: the very endpoint Lingva itself scrapes — Google's public
 *      `client=gtx` translate API (no key, used by hundreds of OSS apps).
 *
 * ALL requests go through an isolated Electron session with `cache: false`
 * (no disk artifacts), the canonical masked User-Agent and the user's proxy
 * (passed by url from main.js) — the real UA/fingerprint of the app is not
 * what the API sees on those requests, and no cookies are stored.
 * Results are cached in RAM only, keyed by text+lang pair.
 */

const LINGVA_INSTANCES = [
  'https://translate.plausibility.cloud',
  'https://lingva.lunar.icu',
  'https://lingva.ml', // Cloudflare-gated; kept last as it may work via proxy
]

const REQUEST_TIMEOUT_MS = 10000
const CACHE_MAX = 200
const cache = new Map() // `${from}\u0000${to}\u0000${text}` → result object

function cacheGet(key) {
  const hit = cache.get(key)
  if (hit) {
    // Refresh recency for a cheap LRU behavior.
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value)
  }
}

/** Build an isolated fetch with main-process hygiene rules. */
function buildFetch(isolationSession) {
  const session = isolationSession
  return async function isolatedFetch(url) {
    // Use Electron's net stack bound to the isolated session (proxy + UA).
    const { net } = require('electron')
    const request = net.fetch(url, {
      session,
      useSessionCookies: false,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'Accept': 'application/json, text/plain;q=0.8, */*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    return request
  }
}

/** Lingva JSON: { translation: '...' , info: { detectedSource: 'en' } } */
async function tryLingva(isolatedFetch, text, from, to) {
  for (const base of LINGVA_INSTANCES) {
    try {
      const url = `${base}/api/v1/${from}/${to}/${encodeURIComponent(text).replace(/\./g, '%2E').replace(/%20/g, '+')}`
      const res = await isolatedFetch(url)
      if (!res.ok) continue
      const data = await res.json()
      if (typeof data?.translation === 'string') {
        return {
          text: data.translation,
          detectedSource: data?.info?.detectedSource || from,
          provider: `lingva (${new URL(base).hostname})`,
        }
      }
    } catch (_) { /* next instance */ }
  }
  return null
}

/** gtx fallback: `[[["Перевод","text",...]], ..., "en", ...]` → merged sentences. */
async function tryGtx(isolatedFetch, text, from, to) {
  try {
    const url = 'https://translate.googleapis.com/translate_a/single'
      + `?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`
    const res = await isolatedFetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const segments = data?.[0]
    if (!Array.isArray(segments)) return null
    const translated = segments.map(s => (Array.isArray(s) ? s[0] : '')).join('')
    if (!translated) return null
    return {
      text: translated,
      detectedSource: typeof data?.[2] === 'string' ? data[2] : from,
      provider: 'gtx (google translate public endpoint)',
    }
  } catch (_) {
    return null
  }
}

/** Normalize codes: gtx wants `zh-CN`, lingva wants `zh`/`zh_HANT` etc. — keep it simple. */
function normalizeLang(code) {
  const c = String(code || 'auto').toLowerCase()
  if (c === 'auto' || c === '') return 'auto'
  // gtx/lingva both accept base codes; region variants downgraded.
  return c.split('-')[0].replace(/[^a-z]/g, '') || 'auto'
}

/**
 * translateText({ session, proxyUrl, text, from, to })
 * `session` is the isolated session created by main.js
 * (RAM-only, canonical UA, user proxy applied). Returns
 * { ok, text, from, to, provider } or { ok:false, error }.
 */
async function translateText({ session, text, from = 'auto', to = 'ru' }) {
  const clean = String(text || '').trim().slice(0, 1000)
  if (!clean) return { ok: false, error: 'Empty selection' }

  const fromN = normalizeLang(from)
  const toN = normalizeLang(to)
  if (fromN !== 'auto' && fromN === toN) {
    return { ok: false, error: 'Source and target languages are the same' }
  }

  const key = `${fromN}\u0000${toN}\u0000${clean}`
  const hit = cacheGet(key)
  if (hit) return { ok: true, ...hit, cached: true }

  const isolatedFetch = buildFetch(session)

  let result = await tryLingva(isolatedFetch, clean, fromN === 'auto' ? 'auto' : fromN, toN)
  if (!result) result = await tryGtx(isolatedFetch, clean, fromN, toN)

  if (!result) {
    return { ok: false, error: 'Translation providers are unreachable right now' }
  }

  cacheSet(key, result)
  return { ok: true, ...result }
}

module.exports = { translateText, normalizeLang }
