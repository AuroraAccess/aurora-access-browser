const { ipcRenderer } = require('electron');

// ─── Stealth Mode ──────────────────────────────────────────────────
// This masks the browser's identity before any site script can run.
(function() {
  // 1. Mask navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. Hardware Masking (Anti-Fingerprinting)
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  // 3. WebGL Masking
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 37445) return 'Intel Inc.';
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.apply(this, arguments);
  };

  // 4. Permissions API Masking
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // 5. Mock Chrome runtime (common check for bots)
  window.chrome = {
    runtime: {},
    app: {},
    csi: () => {},
    loadTimes: () => {}
  };

  // 6. Fix languages and platform to match a real Mac
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ru'] });
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

  // 7. Mock plugins (avoid empty plugin list)
  const mockPlugins = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgieoopi', description: '' }
  ];
  Object.defineProperty(navigator, 'plugins', { get: () => mockPlugins });

  console.log('[AURORA-STEALTH] V2 Active: Hardware & Identity Masked');
})();

// ─── Aurora Vault Integration ──────────────────────────────────────
// This handles login detection and autofill securely from the preload.
window.addEventListener('DOMContentLoaded', () => {
  const passFields = document.querySelectorAll('input[type="password"]');
  if (passFields.length > 0) {
    // 1. Notify host that we found a login form (for match check)
    ipcRenderer.sendToHost('vault-form-detected', { url: window.location.href });
  }

  // 2. Handle CAPTURE on form submission
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const pass = form.querySelector('input[type="password"]');
    if (pass && pass.value) {
      const userField = form.querySelector('input[type="text"], input[type="email"], input:not([type])');
      const user = userField ? userField.value : '';
      
      // Send to host for prompt
      ipcRenderer.sendToHost('vault-capture', { u: user, p: pass.value });
    }
  }, true);
});

// ─── Autofill Listener ─────────────────────────────────────────────
// The host sends an IPC message to the webview to trigger autofill.
ipcRenderer.on('vault-autofill', (event, { username, password }) => {
  const passFields = document.querySelectorAll('input[type="password"]');
  const userFields = document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
  
  if (passFields.length > 0) {
    passFields[0].value = password;
    for (let f of userFields) {
      if (f.value === username || f.value === "") {
        f.value = username;
        break;
      }
    }
  }
});
