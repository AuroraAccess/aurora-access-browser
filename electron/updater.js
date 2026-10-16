let electron = null
try {
  electron = require('electron')
} catch (_) {}

const app = electron?.app || {
  isPackaged: false,
  getVersion: () => '2.1.0',
  relaunch: () => {},
  quit: () => {},
}

let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch (_) {}

const { checkForUpdate: checkGitHubReleases } = require('./release-check')

// ─── Auto Update & In-App Update Engine ───────────────────────────
// Artefacts are served from GitHub Releases, configured in `build.publish`
// (package.json).
//
// In-App flow:
// 1. App checks GitHub for updates (at startup after window load, on 6h interval, or manually).
// 2. When an update is available, UI displays notification modal with release notes.
// 3. User clicks "Update Now" -> `downloadUpdate()` is triggered with progress reporting.
// 4. Once downloaded -> user can click "Restart & Update" which executes `quitAndInstall()`.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const logger = {
  info:  (...args) => console.log('[Updater]', ...args),
  warn:  (...args) => console.warn('[Updater]', ...args),
  error: (...args) => console.error('[Updater]', ...args),
  debug: (...args) => console.debug('[Updater]', ...args),
}

let timer = null
let mainWindowGetter = null
let isConfigured = false

function setMainWindow(getterOrWin) {
  mainWindowGetter = typeof getterOrWin === 'function' ? getterOrWin : () => getterOrWin
}

function sendToWindow(channel, data) {
  try {
    const win = mainWindowGetter ? mainWindowGetter() : null
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, data)
    }
  } catch (err) {
    logger.warn('sendToWindow failed:', err.message)
  }
}

function setupAutoUpdater() {
  if (isConfigured || !autoUpdater) return
  isConfigured = true

  autoUpdater.logger = logger
  // Manual trigger download so the user sees the release notes and confirms:
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for update...')
    sendToWindow('update:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`Update available: ${info.version}`)
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map(n => (typeof n === 'string' ? n : n?.note || '')).join('\n')
        : ''

    const payload = {
      version: info.version,
      name: info.releaseName || `v${info.version}`,
      notes,
      releaseDate: info.releaseDate,
      currentVersion: app.getVersion(),
    }

    sendToWindow('update-available', payload)
    sendToWindow('update:available', payload)
  })

  autoUpdater.on('update-not-available', (info) => {
    logger.info('Already up to date')
    sendToWindow('update:not-available', {
      currentVersion: app.getVersion(),
      latestVersion: info?.version || app.getVersion(),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToWindow('update:download-progress', {
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`Update ${info.version} downloaded; ready to install`)
    sendToWindow('update:downloaded', {
      version: info.version,
    })
  })

  autoUpdater.on('error', (err) => {
    logger.error('Update failed:', err?.message || String(err))
    sendToWindow('update:error', {
      message: err?.message || 'Update check or download failed',
    })
  })
}

async function check(manual = false) {
  setupAutoUpdater()

  if (app.isPackaged) {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      logger.error('autoUpdater check failed:', err.message)
      sendToWindow('update:error', { message: err.message })
    }
    return
  }

  // Development fallback: probe GitHub Releases API directly so developers
  // can test update notifications and release notes without a packaged app.
  logger.info('Development mode: probing GitHub Releases API directly')
  sendToWindow('update:status', { status: 'checking' })

  try {
    const res = await checkGitHubReleases({ currentVersion: app.getVersion() })
    if (!res.ok) {
      logger.warn('GitHub probe failed:', res.error)
      if (manual) sendToWindow('update:error', { message: res.error })
      return
    }

    if (res.isUpdate) {
      const payload = {
        version: res.release.version,
        name: res.release.name || `v${res.release.version}`,
        notes: res.release.notes || '',
        url: res.release.url,
        publishedAt: res.release.publishedAt,
        currentVersion: res.currentVersion,
      }
      sendToWindow('update-available', payload)
      sendToWindow('update:available', payload)
    } else if (manual) {
      sendToWindow('update:not-available', {
        currentVersion: res.currentVersion,
        latestVersion: res.latestVersion,
      })
    }
  } catch (err) {
    logger.warn('Dev update check failed:', err.message)
    if (manual) sendToWindow('update:error', { message: err.message })
  }
}

async function downloadUpdate() {
  setupAutoUpdater()
  logger.info('Starting update download...')

  if (app.isPackaged) {
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err) {
      logger.error('downloadUpdate failed:', err.message)
      sendToWindow('update:error', { message: err.message })
      return { ok: false, error: err.message }
    }
  }

  // In development, simulate download progress for UI verification
  let p = 0
  const interval = setInterval(() => {
    p += 25
    sendToWindow('update:download-progress', {
      percent: Math.min(p, 100),
      transferred: p * 1024 * 1024,
      total: 100 * 1024 * 1024,
      bytesPerSecond: 10 * 1024 * 1024,
    })
    if (p >= 100) {
      clearInterval(interval)
      sendToWindow('update:downloaded', { version: 'dev-update' })
    }
  }, 300)

  return { ok: true, dev: true }
}

function installUpdate() {
  logger.info('Installing update and restarting application...')
  if (app.isPackaged) {
    // isSilent = false, isForceRunAfter = true
    autoUpdater.quitAndInstall(false, true)
  } else {
    logger.info('Development mode relaunch')
    app.relaunch()
    app.quit()
  }
}

function start(getterOrWin) {
  if (getterOrWin) setMainWindow(getterOrWin)
  setupAutoUpdater()

  // Initial check after short delay:
  setTimeout(() => {
    check(false)
  }, 4500)

  // Background polling every 6 hours
  if (!timer) {
    timer = setInterval(() => check(false), CHECK_INTERVAL_MS)
    timer.unref()
  }
}

module.exports = {
  start,
  setMainWindow,
  checkForUpdates: check,
  downloadUpdate,
  installUpdate,
}
