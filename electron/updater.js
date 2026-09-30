const { app } = require('electron')
const { autoUpdater } = require('electron-updater')

// ─── Auto Update ──────────────────────────────────────────────────
// Artefacts are served from GitHub Releases, configured in `build.publish`
// (package.json). electron-updater discovers them through the repository's
// public Atom feed, so a release has to be PUBLISHED — a draft release is
// invisible to every installed copy and will never be offered as an update.
//
// electron-updater performs its requests in its own session
// ("electron-updater", created lazily inside the package). main.js pins the
// SOCKS5 proxy onto that session before the first check, so update traffic
// does not bypass the tunnel.
//
// Update flow: check in the background, download automatically, apply on the
// next quit. Nothing is shown to the user and nothing is installed while the
// app is running.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const logger = {
  info:  (...args) => console.log('[Updater]', ...args),
  warn:  (...args) => console.warn('[Updater]', ...args),
  error: (...args) => console.error('[Updater]', ...args),
  debug: (...args) => console.debug('[Updater]', ...args),
}

let timer = null

function check() {
  autoUpdater.checkForUpdates().catch(err => {
    logger.error('Update check failed:', err.message)
  })
}

function start() {
  // In development there is no app-update.yml, and the updater would fail on
  // every start. Use autoUpdater.forceDevUpdateConfig with dev-app-update.yml
  // if the flow needs to be exercised locally.
  if (!app.isPackaged) {
    console.log('[Updater] Skipped: not a packaged build')
    return
  }

  autoUpdater.logger = logger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => logger.info('Checking for update'))
  autoUpdater.on('update-available', info => logger.info(`Update available: ${info.version}`))
  autoUpdater.on('update-not-available', () => logger.info('Already up to date'))
  autoUpdater.on('download-progress', ({ percent }) => logger.debug(`Downloaded ${percent.toFixed(1)}%`))
  autoUpdater.on('update-downloaded', info => {
    logger.info(`Update ${info.version} downloaded; it will be installed on quit`)
  })
  // EventEmitter rethrows an 'error' event when nothing listens for it.
  autoUpdater.on('error', err => logger.error('Update failed:', err.message))

  check()

  // A browser session can stay open for days, so poll instead of only
  // checking once at startup.
  timer = setInterval(check, CHECK_INTERVAL_MS)
  timer.unref()
}

module.exports = { start }
