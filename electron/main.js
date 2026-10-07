const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, shell } = require('electron')
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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

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
// Deny sensitive permissions by default; internal app pages and
// devtools are exempt.
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
])

function isInternalPage(url) {
  return isHttpsExempt(url) || url.startsWith('file://')
}

function installPermissionGate() {
  const permissionHandler = (webContents, permission, details, callback) => {
    const url = (webContents && webContents.getURL()) || ''
    if (isInternalPage(url)) {
      callback(true)
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
  if (session.defaultSession.setPermissionCheckHandler) {
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const url = (webContents && webContents.getURL()) || requestingOrigin || ''
      if (isInternalPage(url)) return true
      return !SENSITIVE_PERMISSIONS.has(permission)
    })
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
const PROXY_BYPASS_RULES = 'localhost, 127.0.0.1, [::1], <local>'
const WEBVIEW_PARTITION = 'persist:aurora'
// Session electron-updater uses for its own requests (NET_SESSION_NAME in
// electron-updater/out/electronHttpExecutor). Declared here so the tunnel is
// already in place before the first update check.
const UPDATER_PARTITION = 'electron-updater'

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
  const fallback = app.userAgentFallback || ''
  const major = (process.versions.chrome || '').split('.')[0]
  const platform = (fallback.match(/\(([^)]+)\)/) || [])[1]
  if (major && platform) {
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
  }
  // Defensive fallback: strip known tokens from whatever Electron provides.
  let ua = fallback
    .replace(/\s*Electron\/[\d.]+/, '')
    .replace(/\s*[\w.-]+\/[\d.]+(?=\s+Chrome\/)/, '')
  if (major) ua = ua.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`)
  return ua.trim()
}

function applyCanonicalUserAgent() {
  const ua = canonicalUserAgent()
  if (!ua) return
  try {
    app.userAgentFallback = ua
    session.defaultSession.setUserAgent(ua)
    session.fromPartition(WEBVIEW_PARTITION).setUserAgent(ua)
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
  const chrome = process.versions.chrome || ''
  const major = chrome.split('.')[0] || '0'
  const version = fullVersion ? (chrome || `${major}.0.0.0`) : major
  const grease = fullVersion ? '99.0.0.0' : '99'
  return [
    `"Not_A Brand";v="${grease}"`,
    `"Google Chrome";v="${version}"`,
    `"Chromium";v="${version}"`,
  ].join(', ')
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
    ses.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    console.log(`[Sentinel] SOCKS5 proxy active (${label}): ${cfg.host}:${cfg.port}`)
  } catch (err) {
    console.error(`[Sentinel] Failed to configure proxy for ${label}:`, err)
  }
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

    // Any session created later inherits the same policy.
    app.on('session-created', (ses) => {
      applyProxyToSession(ses, 'new session').catch((err) => {
        console.error('[Sentinel] Failed to proxy a new session:', err)
      })
    })
  } catch (err) {
    // A broken proxy config must never stop the browser from starting.
    console.error('[Sentinel] configureProxy() failed; continuing without proxy:', err)
  }
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

// ─── App Lifecycle ────────────────────────────────────────────────
app.whenReady().then(async () => {
  // A packaged build carries no proxy config: the bundle is read-only, so the
  // config is read from the user's data directory instead. Set before anything
  // else touches the proxy, or that read would be cached without it.
  setUserDataPath(app.getPath('userData'))

  // UA and Sec-CH-UA headers must be consistent before any request leaves
  // the app (window, webviews and their subframes all inherit this).
  applyCanonicalUserAgent()
  applyClientHintPatch(session.defaultSession, 'default session')
  applyClientHintPatch(session.fromPartition(WEBVIEW_PARTITION), WEBVIEW_PARTITION)

  enforceStrictHTTPS()
  installPermissionGate()
  installProxyAuth()

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
  if (process.platform !== 'darwin') app.quit()
})

// ─── Core Services ────────────────────────────────────────────────
const vault = new Vault()
const history = new History()
const privacy = new Privacy()

// ─── Proxy IPC (runtime, session-scoped) ─────────────────────────
ipcMain.handle('proxy:get-state', async () => {
  return proxyControl.getState()
})

ipcMain.handle('proxy:set', async (_event, config) => {
  return proxyControl.setProxy(config)
})

ipcMain.handle('proxy:disable', async () => {
  return proxyControl.disable()
})

ipcMain.handle('proxy:test', async (_event, config) => {
  return proxyControl.testEndpoint(config)
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
  if (!vault.isUnlocked()) {
    return { ok: false, error: 'Vault is locked' }
  }
  const logins = vault._load()
  return passaudit.audit(logins)
})

// ─── History IPC ──────────────────────────────────────────────────
ipcMain.handle('history:add', async (_event, url, title) => {
  return history.addEntry(url, title)
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
  return vault.isUnlocked()
})

ipcMain.handle('vault:setup', async (_event, password) => {
  return vault.setup(password)
})

ipcMain.handle('vault:unlock', async (_event, password) => {
  return vault.unlock(password)
})

ipcMain.handle('vault:lock', async () => {
  return vault.lock()
})

ipcMain.handle('vault:save', async (_event, url, username, password) => {
  return vault.saveLogin(url, username, password)
})

ipcMain.handle('vault:get', async () => {
  return vault.getLogins()
})

ipcMain.handle('vault:find-for-url', async (_event, url) => {
  return vault.findForUrl(url)
})

ipcMain.handle('vault:get-password', async (_event, url, username) => {
  const all = vault._load()
  const entry = all.find(i => i.url === url && i.username === username)
  return entry ? entry.password : null
})

ipcMain.handle('vault:update', (_e, oldUrl, oldUser, newUrl, newUser, newPass) => {
  return vault.updateEntry(oldUrl, oldUser, newUrl, newUser, newPass)
})

ipcMain.handle('vault:delete', (_e, url, user) => {
  return vault.deleteEntry(url, user)
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
    delete webPreferences.preload
    webPreferences.preload = path.join(__dirname, 'webview-preload.js')
    webPreferences.nodeIntegration = false
    webPreferences.sandbox = true
    // Stealth masks must be visible to page scripts: with contextIsolation
    // the preload runs in an isolated world, so every override it makes
    // (webdriver, brands, WebGL, chrome object) was invisible to sites —
    // that was the fingerprint bug. The preload stays a module-wrapped
    // sandbox script, so ipcRenderer/require never leak into the page.
    webPreferences.contextIsolation = false
    // Captcha widgets run inside cross-origin iframes: load the preload in
    // subframes too, otherwise their frames see the unpatched fingerprint.
    webPreferences.nodeIntegrationInSubFrames = true
  })

  contents.on('did-attach-webview', (e, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        shell.openExternal(url)
      }
      return { action: 'deny' }
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
