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
    save: (url, user, pass) => ipcRenderer.invoke('vault:save', url, user, pass),
    get:  ()                => ipcRenderer.invoke('vault:get'),
    findForUrl: (url)       => ipcRenderer.invoke('vault:find-for-url', url),
    getPassword: (url, user) => ipcRenderer.invoke('vault:get-password', url, user),
    update: (oldUrl, oldUser, newUrl, newUser, newPass) => ipcRenderer.invoke('vault:update', oldUrl, oldUser, newUrl, newUser, newPass),
    delete: (url, user) => ipcRenderer.invoke('vault:delete', url, user),
    audit:  ()            => ipcRenderer.invoke('vault:audit'),
  },

  // ── Platform Info ─────────────────────────────────────────────
  platform: process.platform,
  getWebviewPreload: () => ipcRenderer.invoke('env:get-webview-preload'),
  isElectron: true,

  // ── Shell API (open external URLs in system browser) ─────────
  shell: {
    openExternal: (url) => shell.openExternal(url),
  },
})
