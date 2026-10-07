const { ipcRenderer } = require('electron');

// ─── Stealth Mode ──────────────────────────────────────────────────
// contextIsolation is disabled for <webview> (see main.js), so everything
// below runs in the page's own world and is visible to site scripts —
// including captcha widgets inside cross-origin iframes, because the
// preload is also loaded in subframes. Nothing here contradicts the
// network layer: the UA string and Sec-CH-UA headers are normalized in
// main.js, and platform/languages/WebGL stay rooted in the real values.
(function () {
  const ua = navigator.userAgent || '';
  const chromeMajor = (ua.match(/Chrome\/(\d+)/) || [])[1] || '';
  const chromeFull = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '';

  // 1. Automation flag.
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  } catch (_) { /* ignore */ }

  // 2. Hardware profile — hides tiny VM cores; nothing in the browser or
  //    on the wire contradicts these numbers.
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); } catch (_) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true }); } catch (_) {}

  // 3. User-Agent Client Hints: Electron ships Chromium-only brands while
  //    the UA string says "Chrome/<major>" — a classic spoof signal.
  //    Patch the JS brand list to the stock Google Chrome set; main.js
  //    rewrites the sec-ch-ua request header to the exact same list, so
  //    JS and HTTP stay byte-for-byte in sync. Everything else returned
  //    by getHighEntropyValues (platformVersion, arch, uaFullVersion…)
  //    is real and is deliberately left untouched.
  try {
    const brands = [
      { brand: 'Not_A Brand', version: '99' },
      { brand: 'Google Chrome', version: chromeMajor },
      { brand: 'Chromium', version: chromeMajor },
    ];
    const fullVersionList = [
      { brand: 'Not_A Brand', version: '99.0.0.0' },
      { brand: 'Google Chrome', version: chromeFull },
      { brand: 'Chromium', version: chromeFull },
    ];
    const uad = navigator.userAgentData;
    if (uad && chromeMajor) {
      const originalGet = typeof uad.getHighEntropyValues === 'function'
        ? uad.getHighEntropyValues.bind(uad)
        : null;
      const patched = {
        brands,
        mobile: !!uad.mobile,
        platform: uad.platform,
        toJSON() {
          return { brands: this.brands, mobile: this.mobile, platform: this.platform };
        },
        getHighEntropyValues: originalGet
          ? (hints) => originalGet(hints).then((values) => {
              const full = values.uaFullVersion || chromeFull;
              return {
                ...values,
                brands,
                fullVersionList: [
                  { brand: 'Not_A Brand', version: '99.0.0.0' },
                  { brand: 'Google Chrome', version: full },
                  { brand: 'Chromium', version: full },
                ],
              };
            })
          : (hints) => Promise.resolve({
              brands,
              fullVersionList,
              uaFullVersion: chromeFull,
              platformVersion: '',
              architecture: 'x86',
              bitness: '64',
              model: '',
              formFactors: ['Desktop'],
            }),
      };
      Object.defineProperty(navigator, 'userAgentData', { get: () => patched, configurable: true });
    }
  } catch (_) { /* ignore */ }

  // 4. WebGL: keep the real driver whenever it is hardware, but never
  //    expose a software rasterizer (SwiftShader/llvmpipe marks the client
  //    as headless/CI). WebGL1 AND WebGL2 are patched together — masking
  //    only WebGLRenderingContext was itself a detectable inconsistency.
  try {
    const isMac = /Macintosh/.test(ua);
    const isWin = /Windows/.test(ua);
    const HW_VENDOR = isMac ? 'Intel Inc.' : 'Google Inc. (Intel)';
    const HW_RENDERER = isMac
      ? 'Intel Iris OpenGL Engine'
      : isWin
        ? 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'
        : 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (CML GT2), OpenGL 4.6)';
    const SOFTWARE = /swiftshader|subzero|llvmpipe|software rasterizer|softpipe|mesa offscreen/i;
    const patchedContexts = new WeakSet();

    for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Context || !Context.prototype || patchedContexts.has(Context.prototype)) continue;
      const original = Context.prototype.getParameter;
      const patchedGetParameter = function (parameter) {
        const value = original.call(this, parameter);
        if ((parameter === 37445 || parameter === 37446) && typeof value === 'string' && SOFTWARE.test(value)) {
          return parameter === 37445 ? HW_VENDOR : HW_RENDERER;
        }
        return value;
      };
      Context.prototype.getParameter = patchedGetParameter;
      patchedContexts.add(Context.prototype);
    }
  } catch (_) { /* ignore */ }

  // 5. Permissions API — keep the notifications shim working.
  try {
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (parameters) => (
      parameters && parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );
  } catch (_) { /* ignore */ }

  // 6. window.chrome — Electron ships an EMPTY object, so
  //    !window.chrome.loadTimes is a classic Electron/bot check. Fill it
  //    with what real Chrome exposes (app/csi/loadTimes/runtime).
  try {
    const now = Date.now() / 1000;
    const chromeFill = {
      app: {
        isInstalled: false,
        getDetails: () => null,
        installState: () => {},
        runningState: () => 'started',
      },
      csi: () => ({ startE: now, onloadT: now, pageT: 1234, tran: 15, ect: 4, dom: 210, dcl: 198 }),
      loadTimes: () => ({
        requestTime: now,
        startLoadTime: now,
        commitLoadTime: now,
        finishDocumentLoadTime: now,
        finishLoadTime: now,
        firstPaintTime: now,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'http/1.1',
      }),
      runtime: {},
    };
    const target = window.chrome || {};
    for (const key of Object.keys(chromeFill)) {
      if (!(key in target)) target[key] = chromeFill[key];
    }
    if (!window.chrome) window.chrome = target;
  } catch (_) { /* ignore */ }

  // 7. Identity comes from the real environment: main.js builds the UA
  //    from the real platform, so navigator.platform, navigator.languages
  //    and the Sec-CH-UA-Platform header all agree by themselves. The old
  //    fake-Mac overrides (platform=MacIntel, languages=['en-US','en','ru'])
  //    produced exactly the mismatch captcha providers flag. Only obviously
  //    broken locale tags (e.g. "c" from a LANG=C container) are dropped.
  try {
    const raw = Array.isArray(navigator.languages) ? navigator.languages : [];
    const valid = raw.filter((l) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l));
    const list = valid.length ? valid : ['en-US'];
    if (list.length !== raw.length || list[0] !== raw[0]) {
      Object.defineProperty(navigator, 'languages', { get: () => list, configurable: true });
    }
  } catch (_) { /* ignore */ }

  // 8. Plugins: Electron already exposes the spec's canonical five PDF
  //    plugins as real Plugin/MimeType objects (instanceof PluginArray,
  //    .item(), mimeTypes[0].enabledPlugin all intact). The previous mock
  //    replaced them with plain literals, which BROKE those checks and
  //    flagged the client harder than the real list ever could — so the
  //    real objects are simply left alone.

  console.log('[AURORA-STEALTH] fingerprint aligned:', chromeMajor || 'ua-unknown');
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
