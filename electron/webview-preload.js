const { ipcRenderer } = require('electron');

// ─── Context-Menu Translate Result Bubble ─────────────────────────
// The main process translates the right-click selection through the shared
// isolated pipeline and sends the outcome here; this renders the result as
// a small glass bubble in the page (auto-hide, Escape/Click closes).
(function () {
  let bubbleTimer = null;

  function hideBubble() {
    const existing = document.getElementById('aurora-ctx-translate-bubble');
    if (existing) existing.remove();
    if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  }

  function showTranslateBubble(res) {
    if (!res) return;
    const ok = !!res.ok;
    const title = ok ? 'Перевод' : 'Перевод недоступен';
    const body = ok ? String(res.text || '') : String(res.error || 'нет подключения');
    const meta = ok && res.provider ? String(res.provider) : '';

    hideBubble();

    const el = document.createElement('div');
    el.id = 'aurora-ctx-translate-bubble';
    el.style.cssText = [
      'position: fixed', 'right: 18px', 'bottom: 18px', 'z-index: 2147483647',
      'max-width: 420px', 'max-height: 45vh', 'overflow: auto',
      'padding: 12px 14px', 'border-radius: 14px',
      'background: rgba(10, 13, 20, 0.92)',
      'backdrop-filter: blur(18px) saturate(1.6)',
      '-webkit-backdrop-filter: blur(18px) saturate(1.6)',
      'border: 1px solid rgba(0, 212, 255, 0.35)',
      'box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55)',
      'color: #e8f6ff', 'font-family: Inter, system-ui, sans-serif', 'font-size: 13px',
      'line-height: 1.45', 'cursor: pointer',
    ].join(';');

    const head = document.createElement('div');
    head.textContent = title;
    head.style.cssText = 'font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#00d4ff;opacity:.85;margin-bottom:4px';
    el.appendChild(head);

    const textNode = document.createElement('div');
    textNode.textContent = body;
    textNode.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
    el.appendChild(textNode);

    if (meta) {
      const metaNode = document.createElement('div');
      metaNode.textContent = meta;
      metaNode.style.cssText = 'font-size:10px;opacity:.5;margin-top:5px';
      el.appendChild(metaNode);
    }

    el.addEventListener('mousedown', hideBubble);
    (document.body || document.documentElement).appendChild(el);

    // Success bubbles persist while visible; failures vanish on their own.
    bubbleTimer = setTimeout(hideBubble, ok ? 6000 : 8000);
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { hideBubble(); document.removeEventListener('keydown', onEsc); }
    });
  }

  ipcRenderer.on('aurora:translate-result', (_event, res) => showTranslateBubble(res));
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

  // TZ v2.0.9 fix #3: the button renders ONLY while the feature is enabled
  // in internal settings (panel://security / Settings). The flag is fetched
  // from the main process over IPC and kept live via 'video:enabled-changed'
  // pushes, so flipping the switch adds/removes the button on open tabs.
  let vtEnabled = null; // null = unknown (buttons hidden until confirmed on)
  ipcRenderer.invoke('video:enabled-get')
    .then((res) => {
      vtEnabled = !!(res && res.enabled);
      console.log('[VideoTrans] Advance query: enabled =', vtEnabled);
      if (vtEnabled) ensureButton(); else removeButton();
    })
    .catch(() => console.warn('[VideoTrans] enabled-get IPC failed'));
  ipcRenderer.on('video:enabled-changed', (_e, enabled) => {
    const previous = vtEnabled;
    vtEnabled = !!enabled;
    console.log(`[VideoTrans] Toggle push: ${previous} ➜ ${vtEnabled}`);
    if (vtEnabled) ensureButton(); else {
      cleanup();
      removeButton();
    }
  });

  // YouTube SPARouter events: watch/shorts navigations re-mount the player
  // without a fresh document. Hooked alongside the MutationObserver so the
  // button tracks page transitions immediately (TZ v2.0.9 fix #3).
  document.addEventListener('yt-navigate-finish', () => {
    if (!/\/watch|\/shorts/.test(location.pathname)) cleanup();
    if (vtEnabled) ensureButton();
  });
  document.addEventListener('spad-navigate', () => {
    if (vtEnabled) ensureButton();
  });

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
    // TZ v2.0.9 fix #3: strictly opt-in — no IPC confirmation, no button.
    if (vtEnabled !== true) return;
    const player = document.querySelector('#movie_player');
    if (!player || document.getElementById('aurora-translate-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'aurora-translate-btn';
    btn.textContent = 'Перевести видео';
    // z-index far above the player chrome (≥ the 99999 priority the TZ
    // demands) so YouTube overlays can never bury the control.
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
    console.log('[VideoTrans] Translate button injected into the YouTube player');
  };

  // TZ v2.0.9 fix #3: switching the toggle OFF removes the button at once
  // (and, if a voice-over was playing, tears the session down with it).
  function removeButton() {
    const btn = document.getElementById('aurora-translate-btn');
    if (btn) btn.remove();
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

  const boot = () => {
    // ensureButton() itself refuses until vtEnabled === true arrives via IPC.
    ensureButton();
  };
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
