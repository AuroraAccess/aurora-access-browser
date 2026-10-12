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
// Legacy direct fill (kept for compatibility).
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

// ─── Aurora Autofill Menu (click-to-fill) ──────────────────────────
// Host resolved the vault matches; this builds a small in-page dropdown
// under the login field. Clicking an entry fills BOTH fields at once —
// passwords never touch the DOM before an explicit user action.
ipcRenderer.on('vault-autofill-menu', (event, { entries }) => {
  if (!Array.isArray(entries) || entries.length === 0) return;

  let menu = null;
  let attachedTo = null;

  const closeMenu = () => {
    if (menu) { menu.remove(); menu = null; attachedTo = null; }
    document.removeEventListener('mousedown', onOutside, true);
  };

  let onOutside = null;
  onOutside = (e) => {
    if (menu && !menu.contains(e.target) && e.target !== attachedTo) closeMenu();
  };

  const showMenu = (field) => {
    closeMenu();
    attachedTo = field;
    menu = document.createElement('div');
    menu.setAttribute('data-aurora-vault', 'menu');
    menu.style.cssText = [
      'position: absolute', 'z-index: 2147483646',
      'min-width: 220px', 'max-width: 320px',
      'background: rgba(10, 13, 20, 0.92)',
      'backdrop-filter: blur(18px) saturate(1.6)',
      '-webkit-backdrop-filter: blur(18px) saturate(1.6)',
      'border: 1px solid rgba(0, 212, 255, 0.35)',
      'border-radius: 12px',
      'box-shadow: 0 15px 50px rgba(0, 0, 0, 0.6)',
      'font-family: Inter, system-ui, sans-serif',
      'overflow: hidden',
    ].join(';');

    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = [
        'display: flex', 'align-items: center', 'gap: 10px',
        'width: 100%', 'padding: 10px 14px',
        'background: transparent', 'border: none',
        'color: #e8f6ff', 'font-size: 13px', 'text-align: left',
        'cursor: pointer',
      ].join(';');
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(0, 212, 255, 0.12)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#00d4ff;box-shadow:0 0 8px #00d4ff88;flex-shrink:0';
      const label = document.createElement('span');
      label.textContent = entry.username || '(no username)';
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const brand = document.createElement('span');
      brand.textContent = 'Aurora';
      brand.style.cssText = 'font-size:10px;color:#00d4ff;letter-spacing:.08em;text-transform:uppercase;opacity:.8';

      row.append(dot, label, brand);
      row.addEventListener('click', () => {
        fillForm(field, entry.username, entry.password);
        closeMenu();
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const r = field.getBoundingClientRect();
    const top = window.scrollY + r.bottom + 6;
    let left = window.scrollX + r.left;
    menu.style.top = `${Math.max(4, top)}px`;
    // Measure after insert, then clamp horizontally.
    const mw = menu.offsetWidth;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - mw - 8;
    if (left > maxLeft) left = Math.max(window.scrollX, maxLeft);
    menu.style.left = `${left}px`;

    document.addEventListener('mousedown', onOutside, true);
  };

  const fillForm = (field, username, password) => {
    const form = field.closest('form') || document;
    const passFields = form.querySelectorAll('input[type="password"]');
    const target = passFields[0] || null;
    if (target) {
      target.value = password;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (field !== target) {
      field.value = username;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Only a password field was found: put the username in the first
      // text/email sibling before it.
      const users = (form.querySelectorAll ? form : document)
        .querySelectorAll('input[type="text"], input[type="email"], input:not([type])');
      for (const u of users) {
        if (u.value === username || u.value === '') { u.value = username; u.dispatchEvent(new Event('input', { bubbles: true })); break; }
      }
    }
  };

  const wireField = (field) => {
    if (field.dataset.auroraVaultWired) return;
    field.dataset.auroraVaultWired = '1';
    field.addEventListener('focus', () => showMenu(field));
    field.addEventListener('click', () => showMenu(field));
  };

  const scan = () => {
    const passFields = [...document.querySelectorAll('input[type="password"]')];
    const userFields = [...document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')];
    userFields.forEach(wireField);
    passFields.forEach(wireField);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') scan();
  else document.addEventListener('DOMContentLoaded', scan);
  // Late-rendered forms (SPAs) — rescan for a while.
  setTimeout(scan, 1500);
  setTimeout(scan, 5000);
});

// ─── YouTube Voice-Over Translation (free, Yandex VOT backend) ──────
// Only wired on youtube.com hosts. A small neon button is injected into the
// player UI; pressing it asks the hub (main process) for a translated audio
// track and starts a synchronized <audio> voice-over. The track itself lives
// in the main-process RAM hub and streams from 127.0.0.1 — never disk.
(function () {
  if (!/youtube\.com$|youtu\.be$|youtube-nocookie\.com$/.test(location.hostname)) return;

  const LANGS = { auto: 'auto', ru: 'ru', en: 'en' };
  // UI language of the page → target video language for the voice-over.
  const _pageLocale = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  const pageTarget = LANGS[_pageLocale] || 'en';

  let state = {
    audio: null,
    video: null,
    sessionId: null,
    listeners: [],
    originalVolume: null,
    busy: false,
  };

  const cleanup = () => {
    for (const [el, ev, fn] of state.listeners) { try { el.removeEventListener(ev, fn); } catch (_) {} }
    state.listeners = [];
    if (state.audio) { try { state.audio.pause(); state.audio.src = ''; } catch (_) {} }
    state.audio = null;
    if (state.video && state.originalVolume !== null) {
      try { state.video.volume = state.originalVolume; } catch (_) {}
    }
    state.video = null;
    state.originalVolume = null;
    const leaving = state.sessionId;
    state.sessionId = null;
    if (leaving) ipcRenderer.invoke('video:leave', leaving).catch(() => {});
  };

  const syncAudio = () => {
    const video = state.video;
    const audio = state.audio;
    if (!video || !audio) return;
    // Duck the original, voice-over at full volume.
    if (state.originalVolume === null) state.originalVolume = video.volume;
    video.volume = Math.min(0.2, state.originalVolume ?? 0.2);
    audio.volume = 1.0;
    audio.playbackRate = video.playbackRate;

    const onPlay  = () => audio.play().catch(() => {});
    const onPause = () => audio.pause();
    const onSeek  = () => { audio.currentTime = video.currentTime % (audio.duration || video.duration || Infinity); };
    const onRate  = () => { audio.playbackRate = video.playbackRate; };
    const onEnd   = () => cleanup();
    const onWaiting = () => audio.pause();
    const onPlaying = () => { if (!video.paused) audio.play().catch(() => {}); };

    video.addEventListener('play', onPlay);   state.listeners.push([video, 'play', onPlay]);
    video.addEventListener('pause', onPause); state.listeners.push([video, 'pause', onPause]);
    video.addEventListener('seeking', onSeek);state.listeners.push([video, 'seeking', onSeek]);
    video.addEventListener('ratechange', onRate); state.listeners.push([video, 'ratechange', onRate]);
    video.addEventListener('ended', onEnd);   state.listeners.push([video, 'ended', onEnd]);
    video.addEventListener('waiting', onWaiting); state.listeners.push([video, 'waiting', onWaiting]);
    video.addEventListener('playing', onPlaying); state.listeners.push([video, 'playing', onPlaying]);
  };

  const ensureButton = () => {
    const player = document.querySelector('#movie_player');
    if (!player || document.getElementById('aurora-translate-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'aurora-translate-btn';
    btn.textContent = 'Перевести видео';
    btn.style.cssText = [
      'position: absolute', 'left: 12px', 'top: 12px', 'z-index: 2147483646',
      'display: flex', 'align-items: center', 'gap: 6px',
      'padding: 7px 12px', 'border-radius: 10px',
      'background: rgba(10,13,20,0.75)', 'color: #00d4ff',
      'border: 1px solid rgba(0,212,255,0.5)',
      'backdrop-filter: blur(14px)', '-webkit-backdrop-filter: blur(14px)',
      'font-family: Inter, system-ui, sans-serif', 'font-size: 12px', 'font-weight: 600',
      'cursor: pointer', 'box-shadow: 0 4px 18px rgba(0,212,255,0.25)',
      'transition: all .2s',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,212,255,0.15)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(10,13,20,0.75)'; });
    btn.addEventListener('click', onTranslateClick);
    player.appendChild(btn);
  };

  async function onTranslateClick() {
    if (state.busy) return;
    const player = document.getElementById('aurora-translate-btn');
    const setBtn = (t, disabled) => { if (player) { player.textContent = t; player.disabled = !!disabled; } };
    const videoId = new URLSearchParams(location.search).get('v')
      || (/\/shorts\/([A-Za-z0-9_-]{11})/.exec(location.pathname) || [])[1];
    if (!videoId) { setBtn('Нет видео ID', false); setTimeout(() => setBtn('Перевести видео', false), 1500); return; }

    state.busy = true;
    setBtn('Запрос перевода…', true);
    try {
      const res = await ipcRenderer.invoke('video:get-translation', `https://www.youtube.com/watch?v=${videoId}`, {
        translationLanguage: pageTarget === 'ru' ? 'ru' : 'en',
      });
      if (!res || !res.ok) {
        setBtn(res?.error ? String(res.error).slice(0, 30) : 'Перевод недоступен', false);
        setTimeout(() => setBtn('Перевести видео', false), 2500);
        return;
      }
      if (res.status === 'WORK_IN_PROGRESS') {
        const rem = res.remainingTime ? ` ~${Math.ceil(res.remainingTime / 60)} мин` : '';
        setBtn(`Готовится${rem}`, true);
        setTimeout(onTranslateClick, 15000); // poll once more
        return;
      }
      state.sessionId = res.sessionId;
      const video = document.querySelector('video.html5-main-video');
      const audio = document.createElement('audio');
      audio.src = res.audioUrl;
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      state.video = video;
      state.audio = audio;
      syncAudio();
      try { await audio.play(); } catch (_) { /* autoplay may need a gesture */ }
      setBtn('Выкл. перевод', false);
      state.busy = false;
    } catch (e) {
      setBtn('Ошибка перевода', false);
      setTimeout(() => setBtn('Перевести видео', false), 2500);
      state.busy = false;
    }
  }

  // SPA navigation: leaving the watch page stops the voice-over and frees RAM.
  let lastPath = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== lastPath) {
      lastPath = now;
      if (!/\/watch|\/shorts/.test(location.pathname)) cleanup();
    }
  }, 2000);

  const boot = () => { ensureButton(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
  // YouTube is a SPA: re-inject on late player mounts.
  const mo = new MutationObserver(() => ensureButton());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  if (mo.disconnect && setInterval) { /* keep it cheap */ }
  setInterval(() => { if (!document.getElementById('aurora-translate-btn')) ensureButton(); }, 4000);
})();

// ─── Inline Selection Translate (glass-morphism tooltip) ────────────
// Selection capture + floating toolbar built entirely in the page. The
// translation request goes to the MAIN process (page:translate-text),
// which contacts Lingva/gtx from an isolated RAM session — the visited
// site sees none of it, and no third-party script sees the selection.
(function () {
  let bar = null;
  let barFor = null;      // selection text the bar was built for
  let hideTimer = null;

  // Target language from the page locale (falls back to app settings later).
  const _localeTarget = () => {
    const l = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
    return ['en', 'ru', 'de', 'fr', 'es', 'zh', 'ja', 'ko', 'kk', 'ar', 'tr', 'pl', 'uk'].includes(l) ? l : 'en';
  };

  const isEditable = (el) => {
    if (!el || !el.tagName) return false;
    const t = el.tagName.toLowerCase();
    return t === 'input' || t === 'textarea' || el.isContentEditable;
  };

  const selectionText = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed) return '';
    const text = String(s).trim();
    // A user double-click word or a sentence-sized selection, not pages.
    if (text.length < 2 || text.length > 500) return '';
    return text;
  };

  const removeBar = () => {
    if (bar) { bar.remove(); bar = null; barFor = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  };

  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // Keep the bar while the SAME selection still exists (hovering it).
      if (!selectionText()) removeBar();
    }, 220);
  };

  function buildBar(rect, text) {
    removeBar();
    bar = document.createElement('div');
    bar.setAttribute('data-aurora-inline', '');
    bar.style.cssText = [
      'position: absolute', 'z-index: 2147483646',
      'min-width: 210px', 'max-width: 340px',
      'background: rgba(10, 13, 20, 0.55)',
      'backdrop-filter: blur(18px) saturate(1.8)',
      '-webkit-backdrop-filter: blur(18px) saturate(1.8)',
      'border: 1px solid rgba(0, 212, 255, 0.35)',
      'border-radius: 14px',
      'box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55)',
      'color: #e8f6ff',
      'font-family: Inter, system-ui, sans-serif', 'font-size: 13px',
      'padding: 8px', 'display: flex', 'gap: 6px', 'align-items: center',
    ].join(';');

    // Source language select (compact ISO codes).
    const fromSel = document.createElement('select');
    fromSel.style.cssText = 'background: rgba(255,255,255,0.06); color: inherit; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; font-size: 11px; padding: 4px 6px; outline: none; max-width: 74px;';
    for (const code of ['auto', 'en', 'ru', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko', 'kk', 'ar', 'tr', 'pl', 'uk']) {
      const o = document.createElement('option');
      o.value = code; o.textContent = code.toUpperCase();
      fromSel.appendChild(o);
    }
    fromSel.value = 'auto';

    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.style.cssText = 'opacity: .6;';

    const toSel = fromSel.cloneNode(true);
    toSel.value = _localeTarget();

    const btn = document.createElement('button');
    btn.textContent = 'Перевести';
    btn.style.cssText = [
      'flex: 1', 'padding: 6px 10px', 'border-radius: 9px',
      'border: none', 'cursor: pointer',
      'background: rgba(0, 212, 255, 0.9)', 'color: #05070c',
      'font-weight: 600', 'font-size: 12px',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });

    const result = document.createElement('div');
    result.style.cssText = [
      'display: none', 'flex-direction: column', 'gap: 4px', 'width: 100%',
    ].join(';');
    const resultText = document.createElement('div');
    resultText.style.cssText = 'line-height: 1.45; max-height: 130px; overflow-y: auto; white-space: pre-wrap;';
    const resultMeta = document.createElement('div');
    resultMeta.style.cssText = 'font-size: 10px; opacity: .7; display: flex; justify-content: space-between; align-items: center; gap: 6px;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Копировать';
    copyBtn.style.cssText = [
      'border: 1px solid rgba(255,255,255,0.18)', 'background: rgba(255,255,255,0.05)',
      'color: inherit', 'border-radius: 7px', 'padding: 3px 8px',
      'font-size: 10px', 'cursor: pointer',
    ].join(';');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyBtn.textContent = '✓';
      navigator.clipboard?.writeText(resultText.textContent || '').catch(() => {});
      setTimeout(() => { copyBtn.textContent = 'Копировать'; }, 1200);
    });
    const provider = document.createElement('span');
    resultMeta.append(copyBtn, provider);
    result.append(resultText, resultMeta);

    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 6px; align-items: center; width: 100%;';
    controls.append(fromSel, arrow, toSel, btn);
    bar.append(controls, result);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      resultText.textContent = '…';
      result.style.display = 'flex';
      try {
        const res = await ipcRenderer.invoke('page:translate-text', {
          text, from: fromSel.value, to: toSel.value,
        });
        if (res && res.ok) {
          resultText.textContent = res.text;
          provider.textContent = res.provider || '';
        } else {
          resultText.textContent = (res && res.error) || 'Перевод недоступен';
          resultText.style.color = '#ff5a7a';
        }
      } catch (e) {
        resultText.textContent = 'Ошибка соединения';
        resultText.style.color = '#ff5a7a';
      }
      btn.disabled = false;
      // Resize the bar around the result.
      positionBar(rect);
    });

    document.body.appendChild(bar);
    positionBar(rect);
  }

  function positionBar(rect) {
    if (!bar) return;
    const top = window.scrollY + rect.bottom + 8;
    let left = window.scrollX + rect.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - bar.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
    bar.style.top = `${Math.max(window.scrollY + 4, top)}px`;
    bar.style.left = `${left}px`;
  }

  function onSelectionChange() {
    const text = selectionText();
    // Skip editing fields — autocomplete-driven selection there is noise.
    const selAnchor = window.getSelection()?.anchorNode?.parentElement;
    if (isEditable(selAnchor)) { scheduleHide(); return; }
    if (!text) { scheduleHide(); return; }
    const s = window.getSelection();
    const range = s.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) { scheduleHide(); return; }
    if (barFor === text && bar) { positionBar(rect); return; }
    barFor = text;
    buildBar(rect, text);
  }

  document.addEventListener('selectionchange', () => {
    // Debounced: selectionchange fires per character during drag-select.
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(onSelectionChange, 180);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (bar && !bar.contains(e.target)) scheduleHide();
  }, true);

  window.addEventListener('pagehide', removeBar);
  window.addEventListener('beforeunload', removeBar);
})();
