const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
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

ipcMain.handle('vault:save', async (_event, url, username, password) => {
  return vault.saveLogin(url, username, password)
})

ipcMain.handle('vault:get', async () => {
  return vault.getLogins()
})

ipcMain.handle('rcf:scan', async () => {
  return device.scan()
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
