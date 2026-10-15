const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, shell, protocol } = require('electron')
const path = require('path')
const { Vault }     = require('./vault')
const { History }   = require('./history')
const { Privacy }   = require('./privacy')
const sysStats      = require('./system-stats')
const inspector     = require('./inspector')
const passaudit     = require('./passaudit')
const updater       = require('./updater')
const { getProxyConfig, setUserDataPath } = require('./proxy')
const proxyControl = require('./proxy-control')
const identity = require('./identity')
const vaultFiles = require('./vault')
const { VideoTranslationHub } = require('./videotranslate')
// TZ v2.0.9 feature #4: user-facing release notification (GitHub API probe).
const { checkForUpdate } = require('./release-check')
// Feature: full release creation from the UI (GitHub REST API, env token).
const { createRelease, hasReleaseToken } = require('./release-publisher')
const { IpcValidationError } = require('./ipc-guard')
// TZ v2.0.9 Anti-Bloat: Chromium trash sweep (start + shutdown).
const { purgeChromiumTrash } = require('./anti-bloat')
// Security audit TZ rule #2: the renderer is untrusted — strict IPC guards.
const { vStr, vNonEmpty, vWebUrl, vProxyConfig } = require('./ipc-guard')
const { translateText } = require('./translate')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ─── Password CSV Parser ─────────────────────────────────────
// Handles the header-name variations used by Chrome, Safari, Firefox and
// 1Password/Bitwarden exports: url/website/login_uri, username/user/username_value,
// password/pass/password_value. Handles quoted fields with embedded commas.
// NOTE: runs in the MAIN process — CSV rows (plaintext passwords) never
// cross the contextBridge; the renderer only receives summary counts.
function parsePasswordCsv(csvText) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }

  if (rows.length === 0) return []
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/^\uFEFF/, ''))
  const pick = (...names) => {
    for (const n of names) {
      const idx = header.indexOf(n)
      if (idx !== -1) return idx
    }
    return -1
  }
  // Accept the column names used by the big four password managers.
  const urlIdx = pick('url', 'website', 'login_uri', 'web site', 'site', 'hostname', 'origin')
  const userIdx = pick('username', 'user', 'login_username', 'user name', 'login')
  const passIdx = pick('password', 'pass', 'login_password', 'password_value')
  if (urlIdx === -1 || userIdx === -1 || passIdx === -1) return []

  return rows.slice(1).map(cols => ({
    url: cols[urlIdx] || '',
    username: cols[userIdx] || '',
    password: cols[passIdx] || '',
  }))
}

// ─── Internal-scheme registration ───────────────────────────────
// 'panel' is the internal client-side router marker of the app's tools
// (panel://security, panel://vault …). Chromium treats unknown schemes as
// non-standard and REFUSES their URL patterns in webRequest filters
// ("Invalid url pattern panel://*/*: Wrong scheme type") — which used to
// poison the whole internal-CSP registration below, silently disabling the
// CSP even for file:// pages. Registering 'panel' as privileged BEFORE
// app.whenReady() types it as a standard scheme so filters accept it.
// Nothing is ever really served over panel:// — no protocol handler exists.
protocol.registerSchemesAsPrivileged([
  { scheme: 'panel', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } },
])

// ─── Headless / Container Guards ──────────────────────────────────
// Codespaces/Docker/CI have no GPU and a restricted dbus; without these flags
// Electron floods the console and may fail to paint. Must run before
// app.whenReady(). AURORA_HEADLESS=1 forces them in a packaged container build.
if (isDev || process.env.AURORA_HEADLESS) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-dev-shm-usage')
}

// Since Chromium 139 the SwiftShader fallback for WebGL is blocked by
// default: with the GPU disabled (dev/containers) canvas.getContext('webgl')
// returns null and captcha widgets fail their fingerprint step. This switch
// restores the software fallback; on machines with a real GPU it is unused.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// ─── Process Optimizations (Chrome memory appetite) ───────────────
// Must run before app.whenReady(), like the other switches above.
//
// process-per-site: same-site pages share ONE renderer process instead of
// spinning up a new one per tab, so ten github.com tabs cost one process.
app.commandLine.appendSwitch('process-per-site')
// renderer-process-limit: even with many tabs Chromium caps the total
// number of renderer processes at 4 and multiplexes further tabs into
// existing ones. Trade-off: a crash takes out more tabs at once — accepted
// for a privacy-focused browser where RAM discipline matters more.
app.commandLine.appendSwitch('renderer-process-limit', '4')
// disable-background-networking: Chromium services stop phoning home
// (component updates, safebrowsing fetches, metrics uploads) — aligns with
// the tracker-blocking stance; our own updater uses its own session.
app.commandLine.appendSwitch('disable-background-networking')
// TZ v2.0.8: hardening pass — kill every remaining Chromium phoning-home
// channel. disable-component-update stops the component updater (Widevine,
// crl-set, MEI et al.); disable-default-apps keeps system app providers out;
// no-pings + disable-hyperlink-auditing drop <a ping> beacon requests;
// disable-domain-reliability stops network outage reporting to Google.
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-default-apps')
app.commandLine.appendSwitch('no-pings')
app.commandLine.appendSwitch('disable-hyperlink-auditing')
app.commandLine.appendSwitch('disable-domain-reliability')
// anti-bloat: never persist crash dumps / reporter output / file logs.
// disable-breakpad + disable-crash-reporter kill the crash dump pipeline;
// disable-logging drops on-disk logging of internal processes; log-level 3
// keeps console output to critical errors only (nothing written to files).
app.commandLine.appendSwitch('disable-breakpad')
app.commandLine.appendSwitch('disable-crash-reporter')
app.commandLine.appendSwitch('disable-logging')
app.commandLine.appendSwitch('log-level', '3')
// disable-renderer-backgrounding: background tabs keep full CPU priority
// instead of being throttled to ~1% timers. Keeps audio/video translation
// playback smooth when the YouTube tab is not focused. Note: this raises
// idle power draw slightly; without it Chromium heavily deprioritizes
// hidden tabs and the voice-over drifts out of sync.
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// ─── Strict HTTPS Enforcement ─────────────────────────────────────
// Block cleartext HTTP and TLS errors. file://, localhost/dev-server,
// and devtools are exempt (development needs cleartext).
const HTTPS_EXEMPT_PATTERNS = [
  /^devtools:/i,
  /^chrome:/i,
  /^file:/i,
  /^about:/i,
  /^data:/i,
  /^blob:/i,
  /^ws:\/\/localhost/i,
  /^wss:\/\/localhost/i,
  /^http:\/\/localhost[:/]/i,
  /^http:\/\/127\.0\.0\.1[:/]/i,
]

function isHttpsExempt(url) {
  return HTTPS_EXEMPT_PATTERNS.some(re => re.test(url))
}

// ─── Protocol Gate ─────────────────────────────────────────────
// Only trusted web protocols may load: http(s), ws(s), and the internal
// panel:// scheme (client-side routed tools), plus the dev server in dev.
// Everything else — file:, content:, smb:, ftp:, custom URL handlers — is
// refused, so a page cannot bootstrap a system protocol out of the web.
// Exemptions mirror HTTPS_EXEMPT_PATTERNS: localhost/devtools/file are app
// infrastructure, not attacker-controlled targets.
const ALLOWED_URL_PREFIXES = [
  /^https?:/i,
  /^wss?:\/\/localhost/i,
  /^http:\/\/localhost[:/]/i,
  /^http:\/\/127\.0\.0\.1[:/]/i,
  /^panel:\/\//i,
  /^about:/i,
  /^data:/i,
  /^blob:/i,
  /^devtools:/i,
  /^file:/i,
]

function isAllowedNavigation(url) {
  // Missing or garbage scheme → refuse (new URL() would throw on garbage).
  if (!url || !/^[a-z][a-z0-9+.-]*:/i.test(url)) return false
  return ALLOWED_URL_PREFIXES.some((re) => re.test(url))
}

function enforceStrictHTTPS() {
  // 2. Fail hard on TLS errors (no "Proceed anyway" path)
  // (The cleartext HTTP block lives inside privacy.attach() — see note there:
  //  Electron allows only one onBeforeRequest listener per session.)
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault()
    if (!isHttpsExempt(url)) {
      console.warn(`[Sentinel] Blocked certificate error for ${url}: ${error}`)
    }
    callback(false)
  })
}

// ─── Permission Gate ──────────────────────────────────────────────
// Every sensitive permission is denied by default. `notifications` is the
// sole exception and only for the trusted messenger domains — WhatsApp and
// Telegram need it for message alerts; no other origin gets anything.
const TRUSTED_NOTIFICATION_DOMAINS = [
  'whatsapp.com',
  'telegram.org',
]
const SENSITIVE_PERMISSIONS = new Set([
  'geolocation',
  'notifications',
  'media',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'openExternal',
  'display-capture',
  // TZ v2.0.8: silent clipboard scraping (passwords, crypto addresses)
  // through navigator.clipboard.readText is denied for every external site.
  // Explicit user paste gestures do not need the ambient grant.
  'clipboard-read',
])

function isInternalPage(url) {
  return isHttpsExempt(url) || url.startsWith('file://')
}

// ─── Permission Gate ──────────────────────────────────────────────
// Sensitive permissions are denied by default; the ONLY auto-approved case
// is `notifications` from the trusted messenger domains below (and from
// internal app pages / devtools). `media` and friends are always refused,
// so no site ever obtains a persistent grant on camera/microphone.
function isTrustedMessengerOrigin(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return TRUSTED_NOTIFICATION_DOMAINS.some(
      (d) => host === d || host.endsWith(`.${d}`)
    )
  } catch (_) {
    return false
  }
}

// Best-effort wipe of previously granted permissions (older builds had the
// auto-approving gate, so users may carry permanent media grants in their
// data directory). Absent on some Electron versions — guarded.
function resetPersistentPermissions(ses, label) {
  if (!ses) return
  try {
    if (typeof ses.resetPermissions === 'function') {
      ses.resetPermissions()
      console.log(`[Sentinel] Persistent permissions reset (${label})`)
    }
  } catch (err) {
    console.warn(`[Sentinel] Could not reset persistent permissions (${label}):`, err)
  }
}

// ─── Internal-page CSP (audit TZ rule #3) ────────────────────────
// App-local schemes get a strict Content-Security-Policy injected on every
// response: scripts only from the bundle ('self'), inline styles allowed
// (React inline styling needs it), no remote scripts, no frames, no base-uri
// tricks, no forms. Localhost dev server and network pages are untouched —
// this never restricts real websites.
const INTERNAL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

let internalCSPInstalled = false
function installInternalCSP() {
  if (internalCSPInstalled) return
  internalCSPInstalled = true
  const handler = (details, callback) => {
    const headers = { ...(details.responseHeaders || {}) }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy'
    headers[key] = INTERNAL_CSP
    callback({ responseHeaders: headers })
  }
  // Electron allows only ONE onHeadersReceived listener per session — the
  // attempt list must be installed in a single call. If the privileged-scheme
  // registration is unavailable (older Electron), degrade: try the combined
  // set, then fall back to file:// only so the load-bearing internal UI CSP
  // is never lost because of the panel pattern (TZ v2.0.9 hardening).
  const inject = (ses, label) => {
    if (!ses) return
    try {
      ses.webRequest.onHeadersReceived({ urls: ['file://*/*', 'panel://*/*'] }, handler)
      console.log(`[Sentinel] Internal CSP active (${label}: file://, panel://)`)
    } catch (err) {
      try {
        ses.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, handler)
        console.warn(`[Sentinel] Internal CSP active (${label}: file:// only — panel pattern refused: ${err.message})`)
      } catch (err2) {
        console.error(`[Sentinel] Internal CSP install failed (${label}):`, err2)
      }
    }
  }
  inject(session.defaultSession, 'default session')
  inject(session.fromPartition(WEBVIEW_PARTITION), WEBVIEW_PARTITION)
}

function installPermissionGate() {
  const permissionHandler = (webContents, permission, details, callback) => {
    const url = (webContents && webContents.getURL())
      || details?.requestingUrl
      || details?.requestingOrigin
      || ''
    if (isInternalPage(url)) {
      callback(true)
      return
    }
    if (permission === 'notifications') {
      if (isTrustedMessengerOrigin(url)) {
        callback(true)
        return
      }
      console.warn(`[Sentinel] Denied notifications request from ${url}`)
      callback(false)
      return
    }
    if (SENSITIVE_PERMISSIONS.has(permission)) {
      console.warn(`[Sentinel] Denied ${permission} request from ${url}`)
      callback(false)
      return
    }
    callback(true)
  }

  session.defaultSession.setPermissionRequestHandler(permissionHandler)
  for (const partition of [WEBVIEW_PARTITION, YOUTUBE_PARTITION]) {
    try {
      session.fromPartition(partition).setPermissionRequestHandler(permissionHandler)
    } catch (_) { /* partition not yet available */ }
  }
  if (session.defaultSession.setPermissionCheckHandler) {
    const checkHandler = (webContents, permission, requestingOrigin) => {
      const url = (webContents && webContents.getURL()) || requestingOrigin || ''
      if (isInternalPage(url)) return true
      if (permission === 'notifications') return isTrustedMessengerOrigin(url)
      return !SENSITIVE_PERMISSIONS.has(permission)
    }
    session.defaultSession.setPermissionCheckHandler(checkHandler)
    for (const partition of [WEBVIEW_PARTITION, YOUTUBE_PARTITION]) {
      try {
        session.fromPartition(partition).setPermissionCheckHandler(checkHandler)
      } catch (_) { /* partition not yet available */ }
    }
  }

  // Kill any grants issued by earlier auto-approving builds.
  resetPersistentPermissions(session.defaultSession, 'default session')
  for (const partition of [WEBVIEW_PARTITION, YOUTUBE_PARTITION]) {
    try { resetPersistentPermissions(session.fromPartition(partition), partition) } catch (_) {}
  }
}

// ─── SOCKS5 Proxy + WebRTC Leak Protection ────────────────────────
// Credentials live in electron/proxy-config.js (gitignored — see
// proxy-config.example.js) or in AURORA_PROXY_* environment variables.
// Nothing secret is ever hardcoded into this file. The config is shared with
// the Node-side tunnel in socks5.js via ./proxy.
// Loopback and the local Vite dev server must NEVER be sent through the proxy,
// or the window cannot load its own interface (ERR_PROXY_CONNECTION_FAILED).
// NOTE: deliberately excludes Chromium's '<-loopback>' rule — that rule
// SUBTRACTS the implicit loopback bypass and forces localhost through the proxy.
// TZ v2.0.9 fix #1: already in the canonical form — ';' separation, zero
// whitespace (Chromium 2026 blocks spaces and commas in proxyBypassRules).
const PROXY_BYPASS_RULES = 'localhost;127.0.0.1;[::1];<local>'
const WEBVIEW_PARTITION = 'persist:aurora'
// Session electron-updater uses for its own requests (NET_SESSION_NAME in
// electron-updater/out/electronHttpExecutor). Declared here so the tunnel is
// already in place before the first update check.
const UPDATER_PARTITION = 'electron-updater'
// RAM-ONLY session for YouTube/video tabs: no persist: prefix → Chromium
// keeps its HTTP/media cache strictly in memory, nothing lands on disk.
// Cookies for YouTube auth also stay RAM-only (cleared on app exit) — the
// vault, aurora partition and updaters are unaffected.
const YOUTUBE_PARTITION = 'nitrous_youtube_session'
// RAM-only session for the inline selection translation: no cookies kept,
// no disk cache, canonical masked UA — translation endpoints never get the
// user's real identity strings or the persistent cookie jar.
const TRANSLATE_PARTITION = 'aurora_translate_ram'
const translateSession = () => session.fromPartition(TRANSLATE_PARTITION, { cache: false })

// ─── Canonical User-Agent ──────────────────────────────────────────
// Electron's default UA leaks identifying tokens: older versions carried
// "Electron/x.y.z", newer ones embed the app name ("aurora-access-browser/
// 1.1.7") and the full Chromium build number. Real Chrome sends
// Chrome/<major>.0.0.0 and nothing else between "(KHTML, like Gecko)" and
// "Chrome/". The <webview> additionally hardcoded its own ancient UA, which
// contradicted navigator.userAgentData.brands and the Sec-CH-UA request
// headers — captcha/registration bot checks read exactly that mismatch as
// spoofing. The UA is therefore rebuilt from scratch: real platform token,
// real Chrome major, no product/Electron tokens.
function canonicalUserAgent() {
  const ua = identity.canonicalUserAgent(
    process.versions.chrome,
    identity.platformTokenFrom(app.userAgentFallback || '')
  )
  if (ua) return ua
  // Defensive fallback: strip known tokens from whatever Electron provides.
  return identity.normalizeUserAgent(app.userAgentFallback || '', process.versions.chrome)
}

function applyCanonicalUserAgent() {
  const ua = canonicalUserAgent()
  if (!ua) return
  try {
    app.userAgentFallback = ua
    session.defaultSession.setUserAgent(ua)
    session.fromPartition(WEBVIEW_PARTITION).setUserAgent(ua)
    // The translation session gets the same masked UA: the translation
    // providers must never see the app's real Chromium/Electron strings.
    translateSession().setUserAgent(ua)
    console.log(`[Sentinel] User-Agent normalized: ${ua}`)
  } catch (err) {
    console.error('[Sentinel] Could not normalize the user agent:', err)
  }
}

// ─── Client Hints consistency (Sec-CH-UA) ──────────────────────────
// The sec-ch-ua request header must equal the brand list patched into
// navigator.userAgentData (see webview-preload.js) byte-for-byte, or the
// JS-vs-HTTP mismatch reads as spoofing. Chromium also skips sec-ch-ua
// on some early navigations, so it is ensured on every request.
function secChUaBrands(fullVersion) {
  return identity.secChUaBrands(fullVersion, process.versions.chrome)
}

function applyClientHintPatch(ses, label) {
  if (!ses) return
  try {
    ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...(details.requestHeaders || {}) }
      const findKey = (name) => Object.keys(headers).find((k) => k.toLowerCase() === name)
      headers[findKey('sec-ch-ua') || 'sec-ch-ua'] = secChUaBrands(false)
      const fullVersion = process.versions.chrome
      if (fullVersion) {
        const fullKey = findKey('sec-ch-ua-full-version')
        if (fullKey) headers[fullKey] = `"${fullVersion}"`
        const listKey = findKey('sec-ch-ua-full-version-list')
        if (listKey) headers[listKey] = secChUaBrands(true)
      }
      callback({ requestHeaders: headers })
    })
    console.log(`[Sentinel] Client-hints consistency patch active (${label})`)
  } catch (err) {
    console.error(`[Sentinel] Client-hints patch failed (${label}):`, err)
  }
}

// Force every request on a session through the SOCKS5 proxy and refuse to
// leak the real IP over WebRTC's non-proxied UDP path.
async function applyProxyToSession(ses, label) {
  const cfg = getProxyConfig()
  if (!cfg || !ses) return

  try {
    await ses.setProxy({
      proxyRules: `socks5://${cfg.host}:${cfg.port}`,
      proxyBypassRules: PROXY_BYPASS_RULES,
    })
    // TZ v2.0.9 hardening: Electron ≥44 may expose a session object without
    // this property (lazily-created partitions) — a raw call here used to
    // abort the apply path with a TypeError right AFTER setProxy succeeded,
    // spamming "Failed to configure proxy" despite the tunnel being live.
    // The startup loop and the new-session guard apply the same policy when
    // the method arrives later on the object.
    if (typeof ses.setWebRTCIPHandlingPolicy === 'function') {
      ses.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    }
    console.log(`[Sentinel] SOCKS5 proxy active (${label}): ${cfg.host}:${cfg.port}`)
  } catch (err) {
    console.error(`[Sentinel] Failed to configure proxy for ${label}:`, err)
  }
}

// ─── New-session guards (ua + Sec-CH-UA + proxy) ───────────────
// Sessions created later (electron-updater's lazy net session, any future
// session.fromPartition call) must pick up the same identity patch and the
// same WebRTC policy as the sessions configured at startup — a session that
// ships its unpatched UA on a first request is exactly the kind of leak the
// patch exists to prevent. Registered once, idempotent.
let newSessionGuardsInstalled = false
function installNewSessionGuards() {
  if (newSessionGuardsInstalled) return
  newSessionGuardsInstalled = true

  app.on('session-created', (ses) => {
    // Audit TZ rule #4 (Zero-Leak) — unconditional policy: WebRTC must not
    // leak the real IP even when no SOCKS5 proxy is configured; the test
    // env fallback path and late-created sessions inherit it too.
    try {
      if (typeof ses.setWebRTCIPHandlingPolicy === 'function') {
        ses.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      }
    } catch (_) { /* policy unsupported — main.js startup path also applies it */ }
    // Identity first: the UA fallback and the header patch must be in place
    // before the session's first navigation starts.
    try {
      const ua = canonicalUserAgent()
      if (ua) {
        ses.setUserAgent(ua)
        app.userAgentFallback = ua
      }
    } catch (err) {
      console.error('[Sentinel] Could not normalize UA for a new session:', err)
    }
    applyClientHintPatch(ses, 'new session')

    // Proxy + WebRTC policy follow the launch-time config when present.
    // Runtime (UI-controlled) proxying still applies through applyProxyControl()
    // / proxyControl.setProxy(), which target every session the browser owns.
    applyProxyToSession(ses, 'new session').catch((err) => {
      console.error('[Sentinel] Failed to proxy a new session:', err)
    })
  })
  console.log('[Sentinel] New-session guards active (UA, Sec-CH-UA, proxy)')
}

async function configureProxy() {
  const cfg = getProxyConfig()
  if (!cfg) return

  // A stale proxy-config.js / AURORA_PROXY_* env var must not take the dev
  // server down before the window can even load. The launch-time proxy is
  // therefore opt-in during development; the UI panel can enable one at any
  // time. Set AURORA_PROXY_ENABLED=1 to force it at launch.
  if (isDev && process.env.AURORA_PROXY_ENABLED !== '1') {
    console.log(
      `[Sentinel] Proxy ${cfg.host}:${cfg.port} is configured but skipped in ` +
      'development. Enable it from the Proxy panel, or set AURORA_PROXY_ENABLED=1.'
    )
    return
  }

  try {
    // Default session plus the persistent partition used by <webview> tabs.
    await applyProxyToSession(session.defaultSession, 'default session')
    await applyProxyToSession(session.fromPartition(WEBVIEW_PARTITION), WEBVIEW_PARTITION)

    // electron-updater creates its session lazily on first use. Create it now
    // (it holds no data — cache: false) and wait for the proxy to be applied,
    // so an update check can never leave over the real IP before the tunnel is up.
    await applyProxyToSession(session.fromPartition(UPDATER_PARTITION, { cache: false }), UPDATER_PARTITION)

    // Inline text translation (selection popup): Google/Lingva must never see
    // the real UA or the persistent cookie jar of a browsing session.
    await applyProxyToSession(translateSession(), 'translate session')

    // Any session created later inherits the same policy.
    installNewSessionGuards()
  } catch (err) {
    // A broken proxy config must never stop the browser from starting.
    console.error('[Sentinel] configureProxy() failed; continuing without proxy:', err)
  }

  // The proxy branch above is skipped in development (AURORA_PROXY_ENABLED
  // unset), but the identity/autorization guards below apply in every mode —
  // a session created before the guards existed would leak its unpatched UA
  // and Sec-CH-UA from the very first request.
  installNewSessionGuards()
}

// Answer proxy auth natively so no system/macOS credential dialog appears.
// The runtime proxy (set from the UI) wins over the launch-time config.
function installProxyAuth() {
  app.on('login', (event, webContents, authenticationResponseDetails, authInfo, callback) => {
    if (!authInfo || !authInfo.isProxy) return

    const active = proxyControl.getActive()
    if (active) {
      event.preventDefault()
      callback(active.username, active.password)
      return
    }

    const cfg = getProxyConfig()
    if (!cfg) return

    event.preventDefault()
    callback(cfg.username, cfg.password)
  })
}

// ─── Runtime Proxy Control ────────────────────────────────────────
// Applies the UI-controlled proxy state to every session the browser uses.
// `proxyRules === null` means "direct connection". Only session.setProxy() is
// touched — system proxy settings are never modified.
function sessionsForProxy() {
  return [
    session.defaultSession,
    session.fromPartition(WEBVIEW_PARTITION),
    session.fromPartition(UPDATER_PARTITION, { cache: false }),
    session.fromPartition(YOUTUBE_PARTITION, { cache: false }),
    translateSession(),
  ].filter(Boolean)
}

async function applyProxyControl(state, proxyRules) {
  for (const ses of sessionsForProxy()) {
    if (proxyRules) {
      await ses.setProxy({
        proxyRules,
        proxyBypassRules: proxyControl.buildProxyBypassRules(state),
      })
    } else {
      await ses.setProxy({ mode: 'direct' })
    }
  }
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      sandbox: true,
      // Explicit: no Node in Web Workers, on any renderer. The default is
      // false, but the invariant is load-bearing — pin it.
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // The Vite dev server URL is overridable (port/host can differ in a
  // container or when Electron 5173 is already taken).
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

  // A failed load must never be silent; log it and retry a few times, since in
  // a container the dev server may still be coming up when Electron starts.
  let loadRetries = 0
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Sentinel] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
    if (isDev && loadRetries < 5) {
      loadRetries += 1
      setTimeout(() => {
        mainWindow.loadURL(devServerUrl).catch((err) => {
          console.error('[Sentinel] Dev server retry failed:', err.message)
        })
      }, 1000)
    }
  })

  if (isDev) {
    mainWindow.loadURL(devServerUrl).catch((err) => {
      console.error(`[Sentinel] Could not load the dev server at ${devServerUrl}:`, err.message)
    })
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
      console.error('[Sentinel] Could not load the bundled UI:', err.message)
    })
  }

  // ─── TZ v2.0.9 feature #4: release notification ────────────────
  // 4.5s AFTER the window finished loading, a single GitHub API probe asks
  // whether a newer release exists; if so the renderer receives
  // 'update-available' + the release payload for AutoUpdateModal. Runs once
  // per app lifetime (electron-updater continues its silent 6h polling in
  // parallel; this check exists purely for the user-facing modal).
  let releaseCheckDone = false
  mainWindow.webContents.on('did-finish-load', () => {
    if (releaseCheckDone) return
    releaseCheckDone = true
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      console.log('[ReleaseCheck] Scheduled probe starting (4.5s after did-finish-load)')
      try {
        const res = await checkForUpdate({ currentVersion: app.getVersion() })
        if (!res.ok) {
          console.warn('[ReleaseCheck] Probe failed (non-fatal):', res.error)
          return
        }
        if (res.isUpdate) {
          console.log(`[ReleaseCheck] Notifying renderer: ${res.latestVersion} > ${res.currentVersion}`)
          mainWindow.webContents.send('update-available', {
            version: res.release.version,
            name: res.release.name,
            url: res.release.url,
            notes: res.release.notes,
            publishedAt: res.release.publishedAt,
            currentVersion: res.currentVersion,
          })
        }
      } catch (err) {
        console.warn('[ReleaseCheck] Probe failed (non-fatal):', err.message)
      }
    }, 4500)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      // target=_blank / window.open from the app UI chrome itself (the React
      // interface is not a browser tab — open these in the system browser).
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

// ─── New-tab routing for webview guests ───────────────────────
// Electron has no built-in tab concept: window.open() / target=_blank inside
// a <webview> fire setWindowOpenHandler, and the default fate of a swallowed
// popup is either "nothing happens" or "the OS default browser takes it"
// (whenever someone calls shell.openExternal). Aurora instead publishes the
// URL to the renderer over IPC so App.jsx can create a real in-app tab.
// Only http(s) is published; everything else is dropped silently (the
// protocol gate already blocks non-web schemes at navigation time).
function routeWebviewPopupToTab(url) {
  if (!/^https?:/i.test(url)) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab:open-requested', url)
  } else {
    // No window (e.g. closed on macOS): fall back to the system browser so
    // the click is never silently lost.
    shell.openExternal(url)
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Anti-bloat: purge the trash the PREVIOUS session left behind before any
  // new session (which would otherwise see the old folders as valid state
  // and keep writing into them) starts again.
  purgeChromiumTrash(app.getPath('userData'))

  // A packaged build carries no proxy config: the bundle is read-only, so the
  // config is read from the user's data directory instead. Set before anything
  // else touches the proxy, or that read would be cached without it.
  setUserDataPath(app.getPath('userData'))
  // The Vault resolves its file paths the same lazy way AND must know the
  // directory before the first setup/unlock IPC comes in.
  vaultFiles.setUserDataDir(app.getPath('userData'))
  // TZ v2.0.9 fix #3: the video-translation toggle state file lives next to
  // the rest of the user data; load BEFORE the first webview can ask for it.
  videoTranslationUserDataPath = app.getPath('userData')
  loadVideoTranslationState()

  // UA and Sec-CH-UA headers must be consistent before any request leaves
  // the app (window, webviews and their subframes all inherit this).
  applyCanonicalUserAgent()
  applyClientHintPatch(session.defaultSession, 'default session')
  applyClientHintPatch(session.fromPartition(WEBVIEW_PARTITION), WEBVIEW_PARTITION)

  enforceStrictHTTPS()
  installPermissionGate()
  installInternalCSP()
  installProxyAuth()

  // Audit TZ rule #4 (Zero-Leak): the WebRTC policy must hold even without
  // a proxy — every session the browser owns gets disable_non_proxied_udp
  // at startup, regardless of the proxy configuration state.
  for (const ses of [
    session.defaultSession,
    session.fromPartition(WEBVIEW_PARTITION),
    session.fromPartition(YOUTUBE_PARTITION, { cache: false }),
    translateSession(),
    session.fromPartition(UPDATER_PARTITION, { cache: false }),
  ].filter(Boolean)) {
    try {
      if (typeof ses.setWebRTCIPHandlingPolicy === 'function') {
        ses.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      }
    } catch (err) {
      console.error('[Sentinel] WebRTC IP policy failed for a session:', err)
    }
  }

  // Session/network setup runs BEFORE createWindow() so the first load already
  // uses a fully configured session. Every step is guarded: a dead or
  // misconfigured proxy degrades to a direct connection instead of crashing.
  try {
    await configureProxy()
  } catch (err) {
    console.error('[Sentinel] Proxy setup failed; continuing without proxy:', err)
  }

  try {
    // UI-controlled proxy starts after the launch-time config so a persisted
    // user choice takes precedence over proxy-config.json / env overrides.
    await proxyControl.init({ userDataPath: app.getPath('userData'), apply: applyProxyControl })
  } catch (err) {
    console.error('[Sentinel] Could not restore proxy state; continuing without proxy:', err)
  }

  privacy.attach({ isHttpsExempt })
  createWindow()
  // Started after configureProxy(): the updater inherits the proxied session.
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Zeroize the vault master key in memory: a closed window must not leave
  // key material resident in the (still running) main process.
  try { vault.lock() } catch (_) {}
  if (process.platform !== 'darwin') app.quit()
})

// ─── Anti-Bloat: shutdown sweep ───────────────────────────────────
// On exit: release every session's open connections first (IndexedDB / Local
// Storage flush into their compact on-disk form once handles are gone), wait
// briefly for that to settle, then physically delete the Chromium trash
// folders the running app recreated during this session. timeout guard keeps
// a stuck connection close from ever blocking the actual quit.
let quitting = false
app.on('will-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  const sessions = [
    session.defaultSession,
    session.fromPartition(WEBVIEW_PARTITION),
    session.fromPartition(YOUTUBE_PARTITION, { cache: false }),
    translateSession(),
    session.fromPartition(UPDATER_PARTITION, { cache: false }),
  ].filter(Boolean)
  const closeAll = Promise.allSettled(
    sessions.map((s) => (typeof s.closeAllConnections === 'function' ? s.closeAllConnections() : Promise.resolve()))
  )
  const guard = new Promise((resolve) => setTimeout(resolve, 2000))
  Promise.race([closeAll, guard]).then(() => {
    try { purgeChromiumTrash(app.getPath('userData')) } catch (_) {}
    app.exit(0)
  })
})

// ─── Core Services ────────────────────────────────────────────────
const vault = new Vault()
const history = new History()
const privacy = new Privacy()

// ─── Vault Idle Auto-Lock ────────────────────────────────────
// An unlocked vault must not stay unlocked forever on an unattended machine.
// Any vault access resets the timer; after AURORA_VAULT_IDLE_LOCK minutes
// (default 5, 0 disables) without an operation the master key is zeroized.
const VAULT_IDLE_LOCK_MS = Math.max(0, Number(process.env.AURORA_VAULT_IDLE_LOCK ?? 5)) * 60_000
let vaultIdleTimer = null
function armVaultIdleLock() {
  if (!VAULT_IDLE_LOCK_MS) return
  if (vaultIdleTimer) clearTimeout(vaultIdleTimer)
  vaultIdleTimer = setTimeout(() => {
    if (vault.isUnlocked()) {
      vault.lock()
      console.log('[Vault] Auto-locked after inactivity')
    }
  }, VAULT_IDLE_LOCK_MS)
  vaultIdleTimer.unref?.()
}

// No monkey-patching of ipcMain._handlers here: that is a private Electron
// field that no longer exists in Electron ≥ 40 (reading it throws TypeError
// and kills the whole main process at startup), and the patch used to run
// before the vault handlers were registered anyway, so it never wrapped
// anything. Every vault handler below calls armVaultIdleLock() directly.

// ─── Proxy IPC (runtime, session-scoped) ─────────────────────────
ipcMain.handle('proxy:get-state', async () => {
  return proxyControl.getState()
})

// Switching endpoints (or going direct) must not carry authentication state
// over: cached proxy credentials and HTTP auth sessions issued through the
// old route would leak the new route's identity boundaries. The auth cache is
// cleared on every session the browser owns, matching sessionsForProxy().
// Cookies/storage are deliberately left alone — this is session isolation,
// not a "clear browsing data" action.
async function clearAuthCacheOnAllSessions() {
  return proxyControl.clearAuthCaches(sessionsForProxy())
}

ipcMain.handle('proxy:set', async (_event, config) => {
  // TZ v2.0.9 fix #1 — forced sanitization BEFORE validation and BEFORE
  // session.defaultSession.setProxy(): recent Chromium builds reject bypass
  // rules containing whitespace and only honour ';' as the list separator.
  // "localhost, 127.0.0.1, <local>" ➜ "localhost;127.0.0.1;<local>".
  if (typeof config?.bypassRules === 'string') {
    const normalized = config.bypassRules.replace(/\s+/g, '').replace(/,/g, ';')
    if (normalized !== config.bypassRules) {
      console.log(`[IPC-Guard] proxy bypassRules sanitized: "${config.bypassRules}" ➜ "${normalized}"`)
    }
    config = { ...config, bypassRules: normalized }
  }
  // IPC-Guard: proxy credentials arrive from the renderer — validate the
  // exact shape (host/port/protocol, optional creds) before they ever reach
  // the tunnel builder or the disk.
  const validated = vProxyConfig(config)
  const result = await proxyControl.setProxy(validated)
  // Clear even when ok === false with an unchanged rule set is wasteful but
  // harmless; clear only on a successful switch.
  if (result.ok) await clearAuthCacheOnAllSessions()
  return result
})

ipcMain.handle('proxy:disable', async () => {
  const result = await proxyControl.disable()
  if (result.ok) await clearAuthCacheOnAllSessions()
  return result
})

ipcMain.handle('proxy:test', async (_event, config) => {
  return proxyControl.testEndpoint(vProxyConfig(config))
})

// ─── Privacy / Traffic IPC ────────────────────────────────────────
ipcMain.handle('privacy:stats', async () => {
  return privacy.getStats()
})

ipcMain.handle('privacy:reset', async () => {
  privacy.reset()
  return { ok: true }
})

// ─── System Stats IPC ─────────────────────────────────────────────
ipcMain.handle('system:stats', async () => {
  return sysStats.getStats()
})

// ─── Site Inspector IPC ───────────────────────────────────────────
ipcMain.handle('site:inspect', async (_event, url) => {
  return inspector.inspect(url)
})

// ─── Password Audit IPC ───────────────────────────────────────────
ipcMain.handle('vault:audit', async () => {
  armVaultIdleLock()
  if (!vault.isUnlocked()) {
    return { ok: false, error: 'Vault is locked' }
  }
  const logins = vault._load()
  return passaudit.audit(logins)
})

// ─── History IPC ──────────────────────────────────────────────────
ipcMain.handle('history:add', async (_event, url, title) => {
  // IPC-Guard: history may only ever store web URLs; title is capped.
  const u = vWebUrl(url, { field: 'url' })
  const t = title == null ? '' : vStr(title, { field: 'title', max: 512 })
  return history.addEntry(u, t)
})

ipcMain.handle('history:get', async () => {
  return history.getEntries()
})

ipcMain.handle('history:clear', async () => {
  return history.clear()
})

// ─── Vault IPC ────────────────────────────────────────────────────
ipcMain.handle('vault:is-setup', async () => {
  return vault.isSetup()
})

ipcMain.handle('vault:is-unlocked', async () => {
  armVaultIdleLock()
  return vault.isUnlocked()
})

ipcMain.handle('vault:setup', async (_event, password) => {
  return vault.setup(password)
})

ipcMain.handle('vault:unlock', async (_event, password) => {
  armVaultIdleLock()
  return vault.unlock(password)
})

ipcMain.handle('vault:lock', async () => {
  return vault.lock()
})

ipcMain.handle('vault:save', (_event, url, username, password, twoFactorSecret) => {
  armVaultIdleLock()
  // IPC-Guard: renderer-supplied strings are capped and type-checked here —
  // vault storage must never receive unbounded hostile payloads.
  const u = vNonEmpty(url, { field: 'url', max: 2048 })
  const user = vNonEmpty(username, { field: 'username', max: 256 })
  const pass = vNonEmpty(password, { field: 'password', max: 1024 })
  const secret = twoFactorSecret == null ? undefined
    : vStr(twoFactorSecret, { field: 'twoFactorSecret', max: 256 })
  // 4th arg (optional): TOTP secret — its own encrypted column, never the
  // password field (vault.saveLogin keeps the semantics).
  return vault.saveLogin(u, user, pass, secret)
})

// ─── Vault CSV Import ─────────────────────────────────────
// Chrome-style import: user picks a CSV file exported by another password
// manager (Safari via the “Passwords → Export” flow, Chrome, Firefox, or
// 1Password/Bitwarden). Parsing happens in the MAIN process — the raw file
// never crosses into the renderer, which only sees the summary counts.
ipcMain.handle('vault:import-csv', async () => {
  armVaultIdleLock()
  if (!vault.isUnlocked()) return { ok: false, error: 'Vault is locked' }

  const { dialog } = require('electron')
  const fs = require('fs')
  const pick = await dialog.showOpenDialog({
    title: 'Import passwords (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  }).catch(() => ({ canceled: true }))
  const file = pick && !pick.canceled && pick.filePaths && pick.filePaths[0]
  if (!file) return { ok: false, error: 'Cancelled' }

  try {
    const csv = fs.readFileSync(file, 'utf8')
    const rows = parsePasswordCsv(csv)
    const entries = rows.filter(Boolean)
    if (entries.length === 0) return { ok: false, error: 'No credentials found in file' }
    return vault.importLogins(entries)
  } catch (e) {
    return { ok: false, error: 'Failed to read or parse CSV: ' + e.message }
  }
})

ipcMain.handle('vault:get', async () => {
  armVaultIdleLock()
  return vault.getLogins()
})

ipcMain.handle('vault:find-for-url', async (_event, url) => {
  armVaultIdleLock()
  return vault.findForUrl(url)
})

ipcMain.handle('vault:get-password', (_event, url, username) => {
  armVaultIdleLock()
  vNonEmpty(url, { field: 'url', max: 2048 })
  vNonEmpty(username, { field: 'username', max: 256 })
  // Decrypts exactly one password in the main process — the renderer asked
  // for it explicitly (autofill). Never part of a bulk listing.
  return vault.getPassword(url, username)
})

ipcMain.handle('vault:update', (_e, oldUrl, oldUser, newUrl, newUser, newPass) => {
  armVaultIdleLock()
  return vault.updateEntry(oldUrl, oldUser, newUrl, newUser, newPass)
})

ipcMain.handle('vault:delete', (_e, url, user) => {
  armVaultIdleLock()
  return vault.deleteEntry(url, user)
})

// ─── Vault 2FA (TOTP) IPC ───────────────────────────────────────
// Secrets live ONLY in the encrypted vault; the main process decrypts one
// secret at a time, computes the current 6-digit code locally and returns
// just the code — the secret never crosses to the renderer.
const videoHub = new VideoTranslationHub()

ipcMain.handle('vault:set-2fa', (_e, url, user, secret) => {
  armVaultIdleLock()
  try {
    return vault.setTwoFactorSecret(url, user, secret)
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('vault:get-totp', (_e, url, user) => {
  armVaultIdleLock()
  try {
    return vault.getTotpCode(url, user)
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── Video Voice-Over Translation IPC (Yandex VOT via @tskau/vtrans) ─
// The audio lives ONLY in RAM inside the hub and is served to the page
// through a 127.0.0.1 hub — no CORS, no disk writes, evicted on stop/TTL.
ipcMain.handle('video:get-translation', async (_e, videoUrl, opts) => {
  if (!videoUrl || !/^https?:\/\//i.test(String(videoUrl))) {
    return { ok: false, status: 'FAILED', error: 'Invalid video URL' }
  }
  return videoHub.translate(String(videoUrl), opts || {})
})

ipcMain.handle('video:release', (_e, sessionId) => {
  videoHub.release(sessionId)
  return { ok: true }
})

ipcMain.handle('video:touch', (_e, sessionId) => {
  videoHub.touch(sessionId)
  return { ok: true }
})

// ─── Video Translation Toggle (TZ v2.0.9 fix #3) ─────────────────
// The YouTube voice-over button in the webview-preload must render ONLY when
// the user enabled the feature in internal settings. The flag is persisted
// atomically (same discipline as the vault/history files) and broadcast to
// every webContents (renderer UI + webview guest preloads) on change.
// Default: enabled — the module was already active in configs before the
// toggle existed, so no user loses the feature after the update.
const VIDEO_TRANSLATION_STATE_FILE = 'video-translation-state.json'
let videoTranslationUserDataPath = null
let videoTranslationEnabled = true

function videoTranslationStatePath() {
  return videoTranslationUserDataPath
    ? path.join(videoTranslationUserDataPath, VIDEO_TRANSLATION_STATE_FILE)
    : null
}

function loadVideoTranslationState() {
  const file = videoTranslationStatePath()
  if (!file) return
  try {
    const fs = require('fs')
    if (!fs.existsSync(file)) return
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed.enabled === 'boolean') videoTranslationEnabled = parsed.enabled
  } catch (err) {
    console.warn('[VideoTrans] Ignoring unreadable toggle state:', err.message)
  }
}

function persistVideoTranslationState() {
  const file = videoTranslationStatePath()
  if (!file) return
  try {
    const { writeFileAtomic } = require('./atomic-file')
    writeFileAtomic(file, JSON.stringify({ enabled: videoTranslationEnabled }, null, 2), { mode: 0o600 })
  } catch (err) {
    console.error('[VideoTrans] Could not persist toggle state:', err.message)
  }
}

function broadcastVideoTranslationState() {
  for (const wc of require('electron').webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue
    wc.send('video:enabled-changed', videoTranslationEnabled)
  }
}

ipcMain.handle('video:enabled-get', async () => {
  return { enabled: videoTranslationEnabled }
})

ipcMain.handle('video:enabled-set', async (_e, enabled) => {
  videoTranslationEnabled = !!enabled
  persistVideoTranslationState()
  broadcastVideoTranslationState()
  console.log(`[VideoTrans] Toggle persisted: enabled=${videoTranslationEnabled}`)
  return { ok: true, enabled: videoTranslationEnabled }
})

// ─── Release Publisher IPC (feature: releases from the UI) ──────
// The renderer asks whether a token exists (STATUS ONLY — the token value
// itself never crosses the bridge, exactly like the proxy credentials in
// vault-ish surfaces) and posts validated release payloads through the
// publisher module. Validation failures answer in the codebase-wide
// { ok:false, error } shape.
ipcMain.handle('release:has-token', async () => {
  return { ok: true, hasToken: hasReleaseToken() }
})

ipcMain.handle('release:create', async (_e, input) => {
  console.log('[ReleasePublisher] Create request received from the UI')
  try {
    const res = await createRelease(input)
    if (!res.ok) console.warn(`[ReleasePublisher] Create failed: ${res.error}`)
    return res
  } catch (e) {
    // IpcValidationError is already normalized inside createRelease; this
    // catch is a belt-and-braces surface for anything below it.
    const error = e instanceof IpcValidationError ? e.message : (e.message || 'Unknown error')
    console.warn(`[IPC-Guard] release:create rejected: ${error}`)
    return { ok: false, error }
  }
})

// Leaves a video page → drop that session's audio from RAM and clear the
// RAM-only media session's caches (nothing on disk to clean by design).
ipcMain.handle('video:leave', async (_e, sessionId) => {
  try {
    if (sessionId) videoHub.release(sessionId)
    const ytSession = session.fromPartition(YOUTUBE_PARTITION, { cache: false })
    await ytSession.clearCache()
    await ytSession.clearStorageData({
      storages: ['cachestorage', 'appcache', 'serviceworkers'],
      quotas: ['temporary'],
    })
  } catch (e) {
    console.error('[VideoTrans] leave-cleanup failed:', e)
  }
  return { ok: true }
})

// ─── Inline Selection Translation IPC (Lingva/gtx from an isolated session) ─
// The page-preload sends selected text only (≤1000 chars). Providers are
// contacted from the main process through a RAM-only session (no cookies,
// no disk cache, proxy + masked UA) — never the user's browsing identity.
ipcMain.handle('page:translate-text', async (_e, payload) => {
  const { text, from, to } = payload || {}
  try {
    return await translateText({ session: translateSession(), text, from, to })
  } catch (e) {
    return { ok: false, error: e.message || 'Translation failed' }
  }
})

ipcMain.handle('env:get-webview-preload', async () => {
  return path.join(__dirname, 'webview-preload.js')
})

// Navigation helpers for webview
ipcMain.handle('nav:get-title', async (_event, url) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
})

// ─── Webview Hardening ───────────────────────────────────────────
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (e, webPreferences, params) => {
    // The <webview src> is attacker-steerable (React state, tab restore):
    // validate it against the protocol gate at the moment of attach, not only
    // at navigation time. Bad src → neutralize to about:blank.
    if (!isAllowedNavigation(params.src || '')) {
      params.src = 'about:blank'
    }
    delete webPreferences.preload
    webPreferences.preload = path.join(__dirname, 'webview-preload.js')
    // Security audit TZ rule #1 — hard invariants for EVERY webview, no
    // exceptions: the renderer is treated as perpetually compromised, so the
    // page world gets NO Node, NO ipcRenderer, NO contextBridge surface.
    webPreferences.nodeIntegration = false
    webPreferences.sandbox = true
    webPreferences.contextIsolation = true
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.nodeIntegrationInSubFrames = false
    // The preload now runs only in the ISOLATED world (vault autofill, the
    // context-menu translate bubble, YouTube voice-over UI — all DOM work,
    // which is shared between worlds). Identity patches (webdriver, UA
    // brands, WebGL, battery, timezone, fonts, mediaDevices) were moved to
    // electron/page-injection.js and are executed with executeJavaScript()
    // in the page's MAIN world below — page scripts still see them, but the
    // renderer never gains a Node bridge again.
  })

  contents.on('did-attach-webview', (e, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
      // Popups from pages become in-app tabs, not OS windows and not the
      // system default browser (see routeWebviewPopupToTab).
      routeWebviewPopupToTab(url)
      return { action: 'deny' }
    })

    // Security audit TZ rule #1: inject identity patches into the page's
    // MAIN world. source is a STATIC bundled file — never derived from user
    // input — so this is not an XSS gadget. Runs for the main frame (here)
    // and for every subframe (did-frame-finish-load below), restoring
    // captcha-iframe coverage previously provided by loading the preload in
    // subframes. Failure of one injection never breaks navigation.
    let pageInjectionSrc = null
    try {
      pageInjectionSrc = require('fs').readFileSync(path.join(__dirname, 'page-injection.js'), 'utf8')
    } catch (err) {
      console.error('[Sentinel] page-injection.js missing:', err)
    }
    const injectIntoFrame = (routingId, processId) => {
      if (!pageInjectionSrc) return
      try {
        const frame = guestContents.mainFrame.framesInSubtree
          .find((f) => f.frameRoutingId === routingId && f.processId === processId)
        if (!frame) return
        frame.executeJavaScript(pageInjectionSrc).catch((_err) => { /* frame navigated away */ })
      } catch (_) { /* frame API unavailable mid-flight */ }
    }
    // Main frame right after attach.
    guestContents.on('did-frame-finish-load', (_fEvent, isMainFrame, frameProcessId, frameRoutingId) => {
      injectIntoFrame(frameRoutingId, frameProcessId)
    })
  })

  contents.on('will-navigate', (e, url) => {
    const currentUrl = contents.getURL()
    const isAppPage = currentUrl.startsWith('file://')
      || currentUrl.startsWith('http://localhost:5173')
      || currentUrl.startsWith('devtools://')
    if (!isAppPage) return
    const targetIsAppPage = url.startsWith('file://')
      || url.startsWith('http://localhost:5173')
      || url.startsWith('devtools://')
    if (!targetIsAppPage) e.preventDefault()
  })
})

// ─── Guest Navigation Gate ───────────────────────────────────
// webview guests navigate freely across the web but may only load trusted
// protocols; system schemes (file:, content:, smb:, ftp:, custom handlers)
// out of the web never get through.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!isAllowedNavigation(url)) {
      e.preventDefault()
      console.warn(`[Sentinel] Navigation to non-trusted protocol blocked: ${url}`)
    }
  })
})

// ─── Context Menu Translate (TZ: правокнопочное «Перевести») ─────
// The native menu previously had NO translate item at all — clicking it was
// impossible, which read as “nothing happens”. Selected text runs through
// the same isolated pipeline as the selection popup (translateText + RAM
// translate session); the result is sent back to the page over
// 'aurora:translate-result' and rendered by the webview preload bubble.
// With no selection, the page itself is replaced by the live Google
// Translate mirror (translate.goog) inside the same webview.
async function translateSelectionInPage(contents, selectionText) {
  try {
    const { translateText } = require('./translate')
    const res = await translateText({
      session: translateSession(),
      text: selectionText,
      from: 'auto',
      to: 'ru',
    })
    contents.send('aurora:translate-result', {
      ok: !!res?.ok,
      text: res?.text || '',
      provider: res?.provider || '',
      error: res?.error || '',
    })
  } catch (e) {
    contents.send('aurora:translate-result', { ok: false, error: e.message })
  }
}

/** Live Google-Translate page mirror scheme: host dashes doubled, dots →
 *  dashes, suffixed with .translate.goog + _x_tr_* params. */
function buildTranslateGoogUrl(pageUrl) {
  const u = new URL(pageUrl)
  const mirrored = u.hostname.replace(/-/g, '--').replace(/\./g, '-')
  return `https://${mirrored}.translate.goog${u.pathname}${u.search}`
    + `?_x_tr_sl=auto&_x_tr_tl=ru&_x_tr_hl=ru`
}

// ─── Context Menu Logic ──────────────────────────────────────────
app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, props) => {
    const menu = new Menu()

    if (contents.canGoBack()) {
      menu.append(new MenuItem({ label: 'Back', click: () => contents.goBack() }))
    }
    if (contents.canGoForward()) {
      menu.append(new MenuItem({ label: 'Forward', click: () => contents.goForward() }))
    }
    menu.append(new MenuItem({ label: 'Reload', click: () => contents.reload() }))
    menu.append(new MenuItem({ type: 'separator' }))

    // TZ: translation actions in the native context menu (right click).
    const pageUrl = (typeof contents.getURL === 'function' && contents.getURL()) || ''
    if (props.selectionText) {
      menu.append(new MenuItem({
        label: 'Перевести выделенное',
        click: () => translateSelectionInPage(contents, props.selectionText),
      }))
    }
    if (/^https:/i.test(pageUrl) && !/^(localhost|127\.0\.0\.1|\[::1\])/i.test(new URL(pageUrl).host)) {
      menu.append(new MenuItem({
        label: 'Перевести страницу (Google-зеркало)',
        click: () => {
          try {
            const mirrored = buildTranslateGoogUrl(pageUrl)
            contents.loadURL(mirrored).catch((err) => {
              console.error('[Context] Page translate mirror failed:', err.message)
            })
          } catch (err) {
            console.error('[Context] Page translate mirror failed:', err.message)
          }
        },
      }))
    }

    if (props.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }))
      menu.append(new MenuItem({ role: 'paste' }))
    }
    if (props.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    if (props.linkURL) {
      menu.append(new MenuItem({ label: 'Copy Link Address', click: () => {
        require('electron').clipboard.writeText(props.linkURL)
      }}))
    }

    menu.append(new MenuItem({ type: 'separator' }))

    menu.append(new MenuItem({
      label: 'Inspect Element',
      click: () => {
        contents.inspectElement(props.x, props.y)
        if (contents.isDevToolsOpened()) {
          contents.devToolsWebContents.focus()
        } else {
          contents.openDevTools({ mode: 'detach' })
        }
      }
    }))

    menu.popup()
  })
})
