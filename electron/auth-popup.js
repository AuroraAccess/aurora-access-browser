/**
 * auth-popup.js — decides whether a window.open() from a page must become a
 * REAL popup window instead of an in-app tab.
 *
 * OAuth / OpenID Connect logins ("Sign in with Google", PayPal, GitHub, …)
 * hand the result back to the opener page through window.opener.postMessage().
 * Aurora used to convert every popup into an ordinary tab, which severs
 * window.opener — the opener never receives the answer and the login silently
 * fails. Only requests that need an opener get a real window; plain
 * target=_blank links keep becoming tabs.
 *
 * No electron import: require()d under plain Node by test/auth-popup.test.js.
 */
const identity = require('./identity')

// Authorization endpoints of OAuth2 / OpenID Connect providers.
const OAUTH_ENDPOINT =
  /(?:[?&](?:client_id|redirect_uri|response_type|code_challenge|id_token_hint)=)|\/(?:oauth2?|openid|authorize|connect\/authorize)(?:[/?#]|$)/i
const POPUP_SIZE = /(?:^|[,&\s])(?:width|height)=\d+/i

/**
 * @param {string} url          target of window.open()
 * @param {string} features     the window features string ("width=480,height=640")
 * @param {string} disposition  'new-window' | 'foreground-tab' | 'background-tab' | ...
 */
function isOAuthPopupRequest(url, features = '', disposition = '') {
  if (!/^https?:/i.test(url || '')) return false
  if (identity.isGoogleAuthUrl(url)) return true
  if (OAUTH_ENDPOINT.test(url)) return true
  // A sized window is a popup by definition, and popups almost always expect
  // window.opener. Plain target=_blank links arrive as "foreground-tab" with
  // no width/height and still become tabs.
  return disposition === 'new-window' && POPUP_SIZE.test(features || '')
}

/** Popup size from the features string, clamped to something usable. */
function popupDimensions(features = '') {
  const read = (name, fallback, max) => {
    const m = new RegExp(`(?:^|[,&\\s])${name}=(\\d+)`, 'i').exec(features || '')
    const value = Number(m && m[1]) || fallback
    return Math.min(max, Math.max(360, value))
  }
  return { width: read('width', 520, 1200), height: read('height', 640, 1000) }
}

module.exports = { isOAuthPopupRequest, popupDimensions }
