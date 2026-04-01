const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
const path = require('path')
const { registerRCFProtocol } = require('./rcf/protocol')
const { RCFDevice } = require('./rcf/device')

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
    icon: path.join(__dirname, '../public/favicon.svg'),
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

// Navigation helpers for webview
ipcMain.handle('nav:get-title', async (_event, url) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
})
