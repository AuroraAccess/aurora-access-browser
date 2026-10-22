const { contextBridge, ipcRenderer, shell } = require('electron')

console.log('[Aurora-Preload] Preload script starting...');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Privacy / Traffic Monitor API ─────────────────────────────
  privacy: {
    stats: () => ipcRenderer.invoke('privacy:stats'),
    reset: () => ipcRenderer.invoke('privacy:reset'),
  },

  // ── System Stats API (real os telemetry) ─────────────────────
  system: {
    stats: () => ipcRenderer.invoke('system:stats'),
  },

  // ── Proxy API (session-scoped, never system-wide) ────────────
  proxy: {
    getState: () => ipcRenderer.invoke('proxy:get-state'),
    set: (config) => ipcRenderer.invoke('proxy:set', config),
    disable: () => ipcRenderer.invoke('proxy:disable'),
    test: (config) => ipcRenderer.invoke('proxy:test', config),
  },

  // ── Site Inspector API (real TLS + headers audit) ────────────
  inspectSite: (url) => ipcRenderer.invoke('site:inspect', url),

  // ── History API ──────────────────────────────────────────────
  history: {
    add: (url, title) => ipcRenderer.invoke('history:add', url, title),
    get: ()           => ipcRenderer.invoke('history:get'),
    clear: ()         => ipcRenderer.invoke('history:clear'),
  },

  // ── Vault API ────────────────────────────────────────────────
  vault: {
    isSetup:    ()                => ipcRenderer.invoke('vault:is-setup'),
    isUnlocked: ()                => ipcRenderer.invoke('vault:is-unlocked'),
    setup:      (password)        => ipcRenderer.invoke('vault:setup', password),
    unlock:     (password)        => ipcRenderer.invoke('vault:unlock', password),
    lock:       ()                => ipcRenderer.invoke('vault:lock'),
    save: (url, user, pass, twoFactorSecret) => ipcRenderer.invoke('vault:save', url, user, pass, twoFactorSecret),
    get:  ()                => ipcRenderer.invoke('vault:get'),
    findForUrl: (url)       => ipcRenderer.invoke('vault:find-for-url', url),
    getPassword: (url, user) => ipcRenderer.invoke('vault:get-password', url, user),
    update: (oldUrl, oldUser, newUrl, newUser, newPass) => ipcRenderer.invoke('vault:update', oldUrl, oldUser, newUrl, newUser, newPass),
    delete: (url, user) => ipcRenderer.invoke('vault:delete', url, user),
    audit:  ()            => ipcRenderer.invoke('vault:audit'),
    importCsv: ()         => ipcRenderer.invoke('vault:import-csv'),
    // ── 2FA (TOTP): the secret is set/kept encrypted in the vault; the
    // renderer only ever receives generated 6-digit codes, never the secret.
    setTwoFactor: (url, user, secret) => ipcRenderer.invoke('vault:set-2fa', url, user, secret),
    getTotp: (url, user)             => ipcRenderer.invoke('vault:get-totp', url, user),
  },

  // ── Video voice-over translation (YouTube) ────────────────────
  // The hub runs in the main process; the page talks to it through the
  // webview-preload, this bridge only manages it from the UI side.
  videoTranslate: {
    getTranslation: (url, opts) => ipcRenderer.invoke('video:get-translation', url, opts),
    release: (sessionId) => ipcRenderer.invoke('video:release', sessionId),
    touch: (sessionId) => ipcRenderer.invoke('video:touch', sessionId),
    leave: (sessionId) => ipcRenderer.invoke('video:leave', sessionId),
    // TZ v2.0.9 fix #3: the toggle bound to the YouTube button injection.
    isEnabled: () => ipcRenderer.invoke('video:enabled-get'),
    setEnabled: (enabled) => ipcRenderer.invoke('video:enabled-set', !!enabled),
    // Live push so an open Settings panel stays in sync with other surfaces.
    onEnabledChanged: (callback) => {
      const listener = (_event, enabled) => callback(enabled)
      ipcRenderer.on('video:enabled-changed', listener)
      return () => ipcRenderer.removeListener('video:enabled-changed', listener)
    },
  },

  // ── In-App Updater ───────────────────────────────────────────
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, release) => callback(release)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.removeListener('update:available', listener)
    },
    onUpdateNotAvailable: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, info) => callback(info)
      ipcRenderer.on('update:not-available', listener)
      return () => ipcRenderer.removeListener('update:not-available', listener)
    },
    onDownloadProgress: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, progress) => callback(progress)
      ipcRenderer.on('update:download-progress', listener)
      return () => ipcRenderer.removeListener('update:download-progress', listener)
    },
    onUpdateDownloaded: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, info) => callback(info)
      ipcRenderer.on('update:downloaded', listener)
      return () => ipcRenderer.removeListener('update:downloaded', listener)
    },
    onError: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, err) => callback(err)
      ipcRenderer.on('update:error', listener)
      return () => ipcRenderer.removeListener('update:error', listener)
    },
  },

  // ── Platform Info ─────────────────────────────────────────────
  platform: process.platform,
  arch: process.arch,
  getWebviewPreload: () => ipcRenderer.invoke('env:get-webview-preload'),
  isElectron: true,

  // ── New-tab requests (target=_blank / window.open from pages) ──
  // The main process routes webview popups here instead of letting the OS
  // default browser take them; App.jsx subscribes and creates an in-app tab.
  onOpenTabRequest: (callback) => {
    const listener = (_event, url) => callback(url)
    ipcRenderer.on('tab:open-requested', listener)
    return () => ipcRenderer.removeListener('tab:open-requested', listener)
  },

  // ── TZ v2.0.9 feature #4: update-available push (AutoUpdateModal) ──
  // Main schedules the GitHub API probe right after the window finishes
  // loading; the renderer gets ONE push with the release payload when a
  // newer version exists. The unsubscribe handle mirrors onOpenTabRequest.
  onUpdateAvailable: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, release) => callback(release)
    ipcRenderer.on('update-available', listener)
    return () => ipcRenderer.removeListener('update-available', listener)
  },

  // ── Shell API (open external URLs in system browser) ─────────
  // http(s) only: a compromised renderer must not be able to invoke system
  // protocol handlers (file:, smb:, custom schemes) through this bridge.
  shell: {
    openExternal: (url) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
    },
  },
})
