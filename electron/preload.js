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
  },

  // ── Vault API ────────────────────────────────────────────────
  vault: {
    save: (url, user, pass) => ipcRenderer.invoke('vault:save', url, user, pass),
    get:  ()                => ipcRenderer.invoke('vault:get'),
  },

  // ── Platform Info ─────────────────────────────────────────────
  platform: process.platform,
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
