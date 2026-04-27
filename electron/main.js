const { app, BrowserWindow, ipcMain, protocol, session, Menu, MenuItem } = require('electron')
const path = require('path')
const { registerRCFProtocol } = require('./rcf/protocol')
const { RCFDevice }           = require('./rcf/device')
const { Vault }               = require('./vault')
const { History }             = require('./history')
const { saveLicense, op_license_validate } = require('./acode-vm')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Must register schemes as privileged before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'rcf', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

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
      webviewTag: true,           // Enable <webview> tag
      sandbox: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
    show: false,
  })

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Allow webview to open external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'allow' }
  })
}

// ─── App Lifecycle ────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Register rcf:// custom protocol BEFORE window creation
  registerRCFProtocol()

  // Allow webview to access external sites (relax CSP for renderer)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"],
      },
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── RCF IPC Handlers ─────────────────────────────────────────────
const device = new RCFDevice()
const vault = new Vault()
const history = new History()

ipcMain.handle('history:add', async (_event, url, title) => {
  return history.addEntry(url, title)
})

ipcMain.handle('history:get', async () => {
  return history.getEntries()
})

ipcMain.handle('history:clear', async () => {
  return history.clear()
})

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
  console.log('[Vault-IPC] Requesting password for:', url, username);
  const all = vault._load();
  const entry = all.find(i => i.url === url && i.username === username);
  if (!entry) console.warn('[Vault-IPC] Entry not found for password request');
  return entry ? entry.password : null;
});

ipcMain.handle('vault:update', (_e, oldUrl, oldUser, newUrl, newUser, newPass) => {
  console.log('[Vault-IPC] Updating entry:', oldUrl, oldUser);
  return vault.updateEntry(oldUrl, oldUser, newUrl, newUser, newPass);
});

ipcMain.handle('vault:delete', (_e, url, user) => {
  console.log('[Vault-IPC] Deleting entry:', url, user);
  return vault.deleteEntry(url, user);
});

ipcMain.handle('rcf:scan', async () => {
  return device.scan()
})

ipcMain.handle('env:get-webview-preload', async () => {
  return path.join(__dirname, 'webview-preload.js')
})

ipcMain.handle('rcf:connect', async (_event, deviceId) => {
  return device.connect(deviceId)
})

ipcMain.handle('rcf:disconnect', async () => {
  return device.disconnect()
})

ipcMain.handle('rcf:status', async () => {
  return device.getStatus()
})

ipcMain.handle('rcf:flash', async (_event, firmwarePayload) => {
  return device.flashFirmware(firmwarePayload)
})

ipcMain.handle('rcf:read-rcf', async (_event, register) => {
  return device.readRCF(register)
})

ipcMain.handle('rcf:write-rcf', async (_event, register, value) => {
  return device.writeRCF(register, value)
})

ipcMain.handle('rcf:generateAttestation', async () => {
  return device.generateAttestation()
})
// Navigation helpers for webview
ipcMain.handle('nav:get-title', async (_event, url) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
})

// ─── RCF License IPC ──────────────────────────────────────────────
// Activate a license key from the Settings UI.
// Key is saved locally to sentinel/license.rcf (never in git).
ipcMain.handle('license:activate', async (_event, { key, issuedTo, expires }) => {
  if (!key || !key.startsWith('RCF-AUDIT-')) {
    return { ok: false, error: 'Invalid key format. Expected: RCF-AUDIT-XXXX' }
  }
  try {
    const result = saveLicense({ key, issuedTo, expires })
    return result
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Get current license status without activating.
ipcMain.handle('license:status', async () => {
  return op_license_validate()
})
// ─── Context Menu Logic ──────────────────────────────────────────
app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, props) => {
    const menu = new Menu()

    // 1. Navigation
    if (contents.canGoBack()) {
      menu.append(new MenuItem({ label: 'Back', click: () => contents.goBack() }))
    }
    if (contents.canGoForward()) {
      menu.append(new MenuItem({ label: 'Forward', click: () => contents.goForward() }))
    }
    menu.append(new MenuItem({ label: 'Reload', click: () => contents.reload() }))
    menu.append(new MenuItem({ type: 'separator' }))

    // 2. Clipboard
    if (props.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }))
      menu.append(new MenuItem({ role: 'paste' }))
    }
    if (props.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    // 3. Links/Media
    if (props.linkURL) {
      menu.append(new MenuItem({ label: 'Copy Link Address', click: () => {
        require('electron').clipboard.writeText(props.linkURL)
      }}))
    }

    menu.append(new MenuItem({ type: 'separator' }))
    
    // 4. Developer Tools
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
