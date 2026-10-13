// █ PAGE-WORLD INJECTION (main-world, executeJavaScript) ──────────────
// Security audit TZ rule #1: <webview> now runs with contextIsolation: true.
// This file is executed via executeJavaScript() in the PAGE'S MAIN WORLD
// (main.js: did-attach-webview + every did-frame-finish-load), so identity
// patches stay visible to sites/captchas while the renderer has NO Node,
// NO ipcRenderer and NO contextBridge access. Static file, never built from
// user input — only main.js may load it.
// ─── Stealth Mode ──────────────────────────────────────────────────
// contextIsolation is disabled for <webview> (see main.js), so everything
// below runs in the page's own world and is visible to site scripts —
// including captcha widgets inside cross-origin iframes, because the
// preload is also loaded in subframes. Nothing here contradicts the
// network layer: the UA string and Sec-CH-UA headers are normalized in
// main.js, and platform/languages/WebGL stay rooted in the real values.
(function () {
  // 0. Media Devices fingerprint: Chromium exposes the real hardware names
  //    ("MacBook Air Microphone", "FaceTime HD Camera", …) — a stable,
  //    hard-to-vary fingerprint vector. Replace enumerateDevices with a
  //    generic desktop set before any page script can capture the native
  //    reference. The preload runs before the page loads, so nothing on the
  //    page can ever see the real list. Override BOTH the instance and the
  //    prototype accessor so captures through either path get the mock.
  try {
    const MOCK_DEVICES = [
      {
        kind: 'audioinput',
        label: 'Microphone (High Definition Audio Device)',
        deviceId: 'default',
        groupId: 'mock-group-id-1',
        toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; },
      },
      {
        kind: 'videoinput',
        label: 'HD Web Camera',
        deviceId: 'default',
        groupId: 'mock-group-id-2',
        toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; },
      },
      {
        kind: 'audiooutput',
        label: 'Speakers (High Definition Audio Device)',
        deviceId: 'default',
        groupId: 'mock-group-id-1',
        toJSON() { return { kind: this.kind, label: this.label, deviceId: this.deviceId, groupId: this.groupId }; },
      },
    ];
    const fakeEnumerate = () => Promise.resolve(MOCK_DEVICES);
    const md = navigator.mediaDevices;
    if (md && typeof md.enumerateDevices === 'function') {
      // Prototype first: a site caching MediaDevices.prototype.enumerateDevices
      // before our instance patch would otherwise bypass the mock. Separate
      // try-block: a prototype failure must never skip the instance patch.
      try {
        const proto = Object.getPrototypeOf(md);
        if (proto && 'enumerateDevices' in proto) {
          Object.defineProperty(proto, 'enumerateDevices', { value: fakeEnumerate, writable: false, configurable: false });
        }
      } catch (_) { /* ignore */ }
      Object.defineProperty(md, 'enumerateDevices', { value: fakeEnumerate, writable: false, configurable: false });
    }
  } catch (_) { /* ignore */ }

  // 0b. Hardware/web-status APIs: battery level and network type are
  //  quiet, high-entropy identifiers (a specific charge percent narrows the
  //  user set; "4g vs wifi vs ethernet" correlates with the carrier).
  //  Return the boring desktop defaults instead, permanently stable.
  try {
    const fakeBattery = {
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      level: 1.0,
      onchargingchange: null,
      onchargingtimechange: null,
      ondischargingtimechange: null,
      onlevelchange: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
      toJSON() { return { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0 }; },
    };
    if (typeof navigator.getBattery === 'function') {
      const getBattery = () => Promise.resolve(fakeBattery);
      Object.defineProperty(navigator, 'getBattery', { value: getBattery, writable: false, configurable: false });
    }

    const FAKE_CONNECTION = {
      downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, type: 'wifi',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
      toJSON() { return { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, type: 'wifi' }; },
    };
    try { Object.defineProperty(navigator, 'connection', { get: () => FAKE_CONNECTION, configurable: false }); } catch (_) {}
    try { Object.defineProperty(navigator, 'mozConnection', { get: () => FAKE_CONNECTION, configurable: false }); } catch (_) {}
    try { Object.defineProperty(navigator, 'webkitConnection', { get: () => FAKE_CONNECTION, configurable: false }); } catch (_) {}
  } catch (_) { /* ignore */ }

  // 0c. Locale & timezone: with a proxy route the wall-clock TZ and OS
  //  locale betray the real country (Cloudflare-style geo-consistency
  //  checks flag mismatch instantly). All date APIs report one fixed
  //  business-friendly zone and the UI language set is normalized; UA and
  //  platform (constructor-level identity below) stay real.
  try {
    const FAKE_TZ = 'Asia/Dubai'; // fixed UTC+4 → getTimezoneOffset() === -240
    const FAKE_LANGS = ['en-US', 'en', 'ru'];

    try {
      Object.defineProperty(Date.prototype, 'getTimezoneOffset', { value: () => -240, writable: false, configurable: true });
    } catch (_) {}

    try {
      Object.defineProperty(navigator, 'languages', { get: () => FAKE_LANGS, configurable: true });
      Object.defineProperty(navigator, 'language', { get: () => FAKE_LANGS[0], configurable: true });
    } catch (_) {}

    // All Intl formatting resolves to the masked zone unless the caller
    // forces an explicit one; resolvedOptions().timeZone reads 'Asia/Dubai'
    // through the prototype patch even for pre-created formatters.
    const NativeDTF = Intl.DateTimeFormat;
    const PatchedDTF = function (locales, options) {
      const opts = Object.assign({}, options || {});
      if (!opts.timeZone) opts.timeZone = FAKE_TZ;
      return new NativeDTF(locales, opts);
    };
    PatchedDTF.prototype = NativeDTF.prototype;
    PatchedDTF.supportedLocalesOf = NativeDTF.supportedLocalesOf.bind(NativeDTF);
    Object.defineProperty(Intl, 'DateTimeFormat', { value: PatchedDTF, writable: true, configurable: true });

    const origResolved = NativeDTF.prototype.resolvedOptions;
    Object.defineProperty(NativeDTF.prototype, 'resolvedOptions', {
      value: function () {
        const res = origResolved.call(this);
        return Object.assign({}, res, { timeZone: FAKE_TZ });
      },
      writable: false,
      configurable: false,
    });
  } catch (_) { /* ignore */ }

  // 0d. Font fingerprint: the classic JS font probe loads a web-font in a
  //  hidden span and measures the difference — an OS font list is a strong
  //  per-machine identifier. document.fonts.check() answers consistently:
  //  the standard system stack is always there, web fonts never are, so the
  //  universal-measure channel collapses. (Host-served CSS stays untouched.
  //  canvas measureText-based probes are NOT neutralized by this patch —
  //  they draw with the real raster stack; keeping those glyph metrics real
  //  is what keeps the canvas itself consistent with the page.)
  try {
    if (document.fonts && typeof document.fonts.check === 'function') {
      const GENERIC = new Set(['system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji']);
      const STANDARD_INSTALL = new Set(['arial', 'helvetica', 'times', 'times new roman', 'courier', 'courier new', 'georgia', 'verdana', 'roboto', 'segoe ui']);
      const origCheck = document.fonts.check.bind(document.fonts);
      document.fonts.check = function (font, text) {
        try {
          // After the last size token (12px / 1.5rem / 80%…) comes the
          // family list; unwrap quotes, split on commas.
          const spec = String(font);
          const m = spec.match(/\d+(?:\.\d+)?(?:px|pt|rem|em|%)(?:\s*\/[^\s]+)?\s+(.*)$/i);
          const famList = (m ? m[1] : spec).split(',')
            .map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
          const available = famList.some((f) => GENERIC.has(f) || STANDARD_INSTALL.has(f));
          return available ? origCheck(font, text) : false;
        } catch (_) {
          return origCheck(font, text);
        }
      };
    }
  } catch (_) { /* ignore */ }

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
          : (_hints) => Promise.resolve({
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
