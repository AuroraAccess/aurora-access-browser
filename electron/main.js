const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, shell } = require('electron')
const path = require('path')
const { Vault }     = require('./vault')
const { History }   = require('./history')
const { Privacy }   = require('./privacy')
const sysStats      = require('./system-stats')
const inspector     = require('./inspector')
const passaudit     = require('./passaudit')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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
  enforceStrictHTTPS()
  installPermissionGate()
  privacy.attach({ isHttpsExempt })
  createWindow()

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
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
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
