// ─── Browser Fallback / Web Mock ──────────────────────────────────
// When opening the UI directly in a web browser (e.g. http://localhost:5173/)
// outside Electron, window.electronAPI is undefined because there is no
// preload bridge. This module provides a safe browser-side mock backed by
// localStorage/sessionStorage so that Vault, PassAudit, Updates, and UI navigation
// can be fully exercised and previewed in a standard browser.
//
// In real Electron, preload.js runs FIRST and sets window.electronAPI,
// so this mock does NOT touch anything in desktop mode.

if (typeof window !== 'undefined' && !window.electronAPI) {
  console.log('[Aurora] Web preview mode detected: initializing mock desktop bridge');

  window.electronAPI = {
    isElectron: false,
    platform: 'web',
    getWebviewPreload: async () => null,

    // ── Vault API (LocalStorage / SessionStorage) ─────────────────
    vault: {
      isSetup: async () => {
        return !!localStorage.getItem('aurora_vault_master');
      },
      isUnlocked: async () => {
        return sessionStorage.getItem('aurora_vault_unlocked') === 'true';
      },
      setup: async (password) => {
        if (!password || password.length < 4) {
          return { ok: false, error: 'Password too short' };
        }
        localStorage.setItem('aurora_vault_master', password);
        sessionStorage.setItem('aurora_vault_unlocked', 'true');
        return { ok: true };
      },
      unlock: async (password) => {
        const stored = localStorage.getItem('aurora_vault_master');
        if (!stored) {
          return { ok: false, error: 'Vault is not configured yet' };
        }
        if (stored === password) {
          sessionStorage.setItem('aurora_vault_unlocked', 'true');
          return { ok: true };
        }
        return { ok: false, error: 'Wrong password' };
      },
      lock: async () => {
        sessionStorage.removeItem('aurora_vault_unlocked');
        return { ok: true };
      },
      get: async () => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        const list = raw ? JSON.parse(raw) : [];
        return list.map(l => ({
          url: l.url,
          username: l.username,
          hasTwoFactor: !!l.twoFactorSecret,
        }));
      },
      save: async (url, user, pass, twoFactorSecret) => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        let list = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex(l => l.url === url && l.username === user);
        if (idx >= 0) {
          list[idx] = { url, username: user, password: pass, twoFactorSecret };
        } else {
          list.push({ url, username: user, password: pass, twoFactorSecret });
        }
        localStorage.setItem('aurora_vault_logins', JSON.stringify(list));
        return { ok: true };
      },
      getPassword: async (url, user) => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        const list = raw ? JSON.parse(raw) : [];
        const item = list.find(l => l.url === url && l.username === user);
        return item ? item.password : '';
      },
      update: async (oldUrl, oldUser, newUrl, newUser, newPass) => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        let list = raw ? JSON.parse(raw) : [];
        list = list.filter(l => !(l.url === oldUrl && l.username === oldUser));
        list.push({ url: newUrl, username: newUser, password: newPass });
        localStorage.setItem('aurora_vault_logins', JSON.stringify(list));
        return { ok: true };
      },
      delete: async (url, user) => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        let list = raw ? JSON.parse(raw) : [];
        list = list.filter(l => !(l.url === url && l.username === user));
        localStorage.setItem('aurora_vault_logins', JSON.stringify(list));
        return { ok: true };
      },
      findForUrl: async (url) => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) return [];
        const raw = localStorage.getItem('aurora_vault_logins');
        const list = raw ? JSON.parse(raw) : [];
        return list.filter(l => l.url === url).map(l => ({ url: l.url, username: l.username }));
      },
      audit: async () => {
        const isUnlocked = sessionStorage.getItem('aurora_vault_unlocked') === 'true';
        if (!isUnlocked) throw new Error('Vault is locked');
        const raw = localStorage.getItem('aurora_vault_logins');
        const list = raw ? JSON.parse(raw) : [];
        const entries = list.map(l => {
          const issues = [];
          if (!l.password || l.password.length < 8) issues.push('Weak password (< 8 chars)');
          return { url: l.url, username: l.username, issues };
        });
        const weak = entries.filter(e => e.issues.length > 0).length;
        const total = entries.length;
        const ok = total - weak;
        const health = total > 0 ? Math.round((ok / total) * 100) : 100;
        return {
          ok: true,
          summary: { total, ok, weak, reused: 0, breached: 0, health },
          entries,
        };
      },
      getTotp: async () => ({ ok: true, code: '849201', expiresIn: 28 }),
      importCsv: async () => ({ ok: true, added: 0, updated: 0, skipped: 0 }),
    },

    // ── Privacy & Telemetry ───────────────────────────────────────
    privacy: {
      stats: async () => ({
        blockedCount: 42,
        allowedCount: 156,
        blockedTrackers: { 'analytics.google.com': 18, 'doubleclick.net': 14, 'facebook.net': 10 },
      }),
      reset: async () => ({ ok: true }),
    },

    // ── Proxy API ─────────────────────────────────────────────────
    proxy: {
      getState: async () => {
        const raw = localStorage.getItem('aurora_proxy_state');
        return raw ? JSON.parse(raw) : { enabled: false, protocol: 'socks5', host: '', port: '', bypassRules: '' };
      },
      set: async (cfg) => {
        const state = { ...cfg, enabled: true };
        localStorage.setItem('aurora_proxy_state', JSON.stringify(state));
        return { ok: true, state };
      },
      disable: async () => {
        const raw = localStorage.getItem('aurora_proxy_state');
        const state = raw ? JSON.parse(raw) : {};
        state.enabled = false;
        localStorage.setItem('aurora_proxy_state', JSON.stringify(state));
        return { ok: true, state };
      },
      test: async () => ({ ok: true, latencyMs: 42 }),
    },

    system: {
      stats: async () => ({
        cpu: { percent: 18.4, model: 'Web Virtual Core' },
        memory: { percent: 46.2, usedMb: 3780, totalMb: 8192 },
      }),
    },

    // ── History API ───────────────────────────────────────────────
    history: {
      add: async () => ({ ok: true }),
      get: async () => [
        { url: 'https://github.com/AuroraAccess/aurora-access-browser', title: 'Aurora Access Browser - GitHub', visitCount: 5, lastVisit: Date.now() - 3600000 },
        { url: 'https://google.com', title: 'Google', visitCount: 12, lastVisit: Date.now() - 7200000 },
      ],
      clear: async () => ({ ok: true }),
    },

    // ── Video Voice-Over Translation API ──────────────────────────
    videoTranslate: {
      isEnabled: async () => ({ enabled: localStorage.getItem('aurora_vt_enabled') !== 'false' }),
      setEnabled: async (enabled) => {
        localStorage.setItem('aurora_vt_enabled', String(enabled));
        return { ok: true, enabled };
      },
      getTranslation: async (url, opts) => {
        console.log('[WebMock] Video translation requested for:', url, opts);
        return {
          ok: true,
          status: 'SUCCESS',
          audioUrl: 'https://example.com/mock-audio.mp3',
          duration: 120,
        };
      },
    },

    // ── In-App Updater API ─────────────────────────────────────────
    updater: {
      check: async () => {
        console.log('[WebMock] Checking for updates...');
        setTimeout(() => {
          if (window.electronAPI?.updater?._onNotAvailable) {
            window.electronAPI.updater._onNotAvailable({ currentVersion: '2.0.9' });
          }
        }, 800);
        return { ok: true };
      },
      download: async () => {
        console.log('[WebMock] Downloading update...');
        return { ok: true };
      },
      install: () => {
        alert('Update completed! In desktop mode this restarts the browser with the new version.');
      },
      onUpdateAvailable: (cb) => {
        window.electronAPI.updater._onAvailable = cb;
        return () => { window.electronAPI.updater._onAvailable = null; };
      },
      onUpdateNotAvailable: (cb) => {
        window.electronAPI.updater._onNotAvailable = cb;
        return () => { window.electronAPI.updater._onNotAvailable = null; };
      },
      onDownloadProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
      onError: () => () => {},
    },

    shell: {
      openExternal: (url) => {
        if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
  };
}
