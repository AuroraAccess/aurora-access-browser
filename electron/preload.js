const { contextBridge, ipcRenderer, shell } = require('electron')

console.log('[Aurora-Preload] Preload script starting...');

contextBridge.exposeInMainWorld('electronAPI', {
  version: '1.0.0',
  // ── RCF Protocol API ──────────────────────────────────────────
  rcf: {
    scan:        ()                     => ipcRenderer.invoke('rcf:scan'),
    connect:     (deviceId)             => ipcRenderer.invoke('rcf:connect', deviceId),
    disconnect:  ()                     => ipcRenderer.invoke('rcf:disconnect'),
    status:      ()                     => ipcRenderer.invoke('rcf:status'),
    flash:       (firmwarePayload)      => ipcRenderer.invoke('rcf:flash', firmwarePayload),
    readRCF:      (register)             => ipcRenderer.invoke('rcf:read-rcf', register),
    writeRCF:     (register, value)      => ipcRenderer.invoke('rcf:write-rcf', register, value),
    generateAttestation: ()              => ipcRenderer.invoke('rcf:generateAttestation'),
  },

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
  },

  // ── Platform Info ─────────────────────────────────────────────
  platform: process.platform,
  getWebviewPreload: () => ipcRenderer.invoke('env:get-webview-preload'),
  isElectron: true,

  // ── RCF License API ──────────────────────────────────────────
  // key is saved locally to sentinel/license.rcf — never in git
  license: {
    activate: (key, issuedTo, expires) =>
      ipcRenderer.invoke('license:activate', { key, issuedTo, expires }),
    status: () =>
      ipcRenderer.invoke('license:status'),
  },

  // ── Shell API (open external URLs in system browser) ─────────
  shell: {
    openExternal: (url) => shell.openExternal(url),
  },
})
