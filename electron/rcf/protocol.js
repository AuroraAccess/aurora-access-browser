/* 
 * [RCF-CORE-PROTOCOL] v1.2.9
 * [RCF:PUBLISH]
 * Electron Protocol Implementation
 */
const { protocol, net } = require('electron')
const { RCFDevice } = require('./device')

const device = new RCFDevice()

/**
 * Register the rcf:// custom protocol.
 * Must be called BEFORE app ready or using protocol.registerSchemesAsPrivileged.
 */
function registerRCFProtocol() {
  protocol.handle('rcf', (request) => {
    const url = new URL(request.url)
    const route = url.hostname + url.pathname

    let body
    let contentType = 'application/json'

    if (route === 'dashboard' || route === 'dashboard/') {
      body = JSON.stringify({
        version: 'v1.2.9 (Alpha)',
        protocol: 'RCF-PL v1.2.8',
        mcu: 'STM32F446RE',
        status: device.getStatus(),
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      })
    } else if (route.startsWith('device/')) {
      const id = url.pathname.replace('/', '')
      body = JSON.stringify(device.getDeviceInfo(id))
    } else if (route === 'scan' || route === 'scan/') {
      body = JSON.stringify({ devices: device.scan() })
    } else if (route === 'registers' || route === 'registers/') {
      const reg = url.searchParams.get('addr') || '0x00'
      body = JSON.stringify(device.readRCF(reg))
    } else if (route === 'flash' || route === 'flash/') {
      contentType = 'text/html'
      body = rcfFlashPage()
    } else {
      // 404
      body = JSON.stringify({ error: 'Unknown RCF route', route })
    }

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
    })
  })
}

function rcfFlashPage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>RCF Flash Tool</title>
  <style>
    body { font-family: monospace; background: #0a0d14; color: #00d4ff; padding: 24px; }
    h2 { color: #a78bfa; }
    .info { background: #111827; border: 1px solid #1e3a4a; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .ok { color: #34d399; }
  </style>
</head>
<body>
  <h2>⚡ RCF-PL Flash Interface</h2>
  <div class="info">
    <p class="ok">● RCF-PL Protocol v1.2.8 Ready</p>
    <p>MCU: STM32F446RE</p>
    <p>Firmware: v1.2.9 (Alpha)</p>
    <p>Security: PQC (Dilithium2) + A-VM</p>
    <p>CRC: 0xA4F2B1D3</p>
  </div>
  <p>Use the sidebar RCF panel to upload firmware.</p>
</body>
</html>`
}

module.exports = { registerRCFProtocol }
