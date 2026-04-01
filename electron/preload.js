const { contextBridge, ipcRenderer } = require('electron')

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
  },

  // ── Platform Info ─────────────────────────────────────────────
  platform: process.platform,
  isElectron: true,
})
