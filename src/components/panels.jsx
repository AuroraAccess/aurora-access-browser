/*
 * panels.jsx — real-data tool panels:
 *   SecurityCenterPanel  — live system + protection status
 *   TrafficPanel         — per-domain traffic & blocked trackers
 *   InspectorPanel       — real TLS certificate + security headers audit
 *   PassAuditPanel       — vault password audit (strength/reuse/HIBP)
 */
import React, { useState, useEffect, useCallback } from 'react';
import './panels.css';
import { i18n } from '../i18n';

const fmtBytes = (b) => {
  if (!b) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtUptime = (sec) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

function PanelHeader({ title, subtitle, children }) {
  return (
    <div className="panel-header">
      <div className="panel-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <h2 className="panel-title">{title}</h2>
        <p className="panel-subtitle">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

// ─── Security Center ──────────────────────────────────────────────
export function SecurityCenterPanel({ language, vaultUnlocked }) {
  const t = i18n[language].securityCenter;
  const [stats, setStats] = useState(null);
  const [sys, setSys] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        window.electronAPI?.privacy?.stats(),
        window.electronAPI?.system?.stats(),
      ]);
      setStats(p);
      setSys(s);
    } catch (e) {
      console.error('[SecurityCenter] load failed:', e);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const blocked = stats?.session?.blocked ?? 0;
  const protectionScore = Math.min(100, 60 + Math.min(blocked, 40));

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle}>
        <button className="panel-action-btn" onClick={load}>{t.refresh}</button>
      </PanelHeader>

      <div className="shield-visual">
        <div className="shield-score">{protectionScore}</div>
        <div className="shield-label">{t.protection}</div>
        <div className="shield-bar-wrap">
          <div className="shield-bar" style={{ '--fill': `${protectionScore}%` }} />
        </div>
        <div className="shield-note">{t.shield_active}</div>
      </div>

      <div className="metric-grid">
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-primary)' }}>{blocked}</span>
          <span className="metric-label">{t.trackers_blocked} · {t.session_label}</span>
        </div>
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-accent)' }}>{stats?.session?.sitesVisited ?? 0}</span>
          <span className="metric-label">{t.sites_visited}</span>
        </div>
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-green)' }}>{stats?.session?.requestsTracked ?? 0}</span>
          <span className="metric-label">{t.requests}</span>
        </div>
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-text)' }}>{fmtUptime(stats?.session?.uptimeSec ?? 0)}</span>
          <span className="metric-label">{t.uptime}</span>
        </div>
      </div>

      {sys && (
        <div className="glass section-card">
          <h3 className="section-title">{t.system}</h3>
          <div className="sys-rows">
            <div className="sys-row">
              <span className="sys-label">{t.cpu}</span>
              <div className="sys-bar-wrap">
                <div className="sys-bar" style={{ width: `${sys.cpu.loadPercent}%` }} />
              </div>
              <span className="sys-val">{sys.cpu.loadPercent}%</span>
            </div>
            <div className="sys-row">
              <span className="sys-label">{t.ram}</span>
              <div className="sys-bar-wrap">
                <div className="sys-bar" style={{ width: `${sys.memory.usedPercent}%` }} />
              </div>
              <span className="sys-val">{sys.memory.usedPercent}%</span>
            </div>
            <div className="sys-row sys-detail">
              <span>{sys.cpu.model}</span>
              <span>{sys.cpu.cores} {t.cores}</span>
            </div>
            <div className="sys-row sys-detail">
              <span>{fmtBytes(sys.memory.usedBytes)} / {fmtBytes(sys.memory.totalBytes)}</span>
              <span>{fmtBytes(sys.memory.appBytes)} {t.ram_app}</span>
            </div>
            <div className="sys-row sys-detail">
              <span>{t.os}: {sys.osType} {sys.osRelease}</span>
              <span>{t.uptime_sys}: {fmtUptime(sys.uptimeSec)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="glass section-card">
        <h3 className="section-title">{t.security_layers}</h3>
        <div className="layers-list">
          {[
            { label: t.layer_https },
            { label: t.layer_trackers },
            { label: t.layer_permissions },
            { label: t.layer_sandbox },
            { label: t.layer_vault },
          ].map(l => (
            <div key={l.label} className="layer-row">
              <span className="layer-dot" />
              <span className="layer-label">{l.label}</span>
              <span className="layer-status">{t.layer_on}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass section-card vault-inline">
        <span>{t.vault_status}:</span>
        <strong style={{ color: vaultUnlocked ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }}>
          {vaultUnlocked ? t.vault_unlocked : t.vault_locked}
        </strong>
      </div>
    </div>
  );
}

// ─── Traffic Monitor ──────────────────────────────────────────────
export function TrafficPanel({ language }) {
  const t = i18n[language].traffic;
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await window.electronAPI?.privacy?.stats();
      setStats(s);
    } catch (e) {
      console.error('[Traffic] load failed:', e);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  const handleReset = async () => {
    if (confirm(t.reset_confirm)) {
      await window.electronAPI?.privacy?.reset();
      load();
    }
  };

  const blocked = stats?.session?.blocked ?? 0;

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle}>
        <button className="panel-action-btn" onClick={handleReset}>{t.reset}</button>
      </PanelHeader>

      <div className="metric-grid">
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-primary)' }}>{blocked}</span>
          <span className="metric-label">{t.blocked_total}</span>
        </div>
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-green)' }}>{stats?.session?.requestsTracked ?? 0}</span>
          <span className="metric-label">{t.requests_tracked}</span>
        </div>
        <div className="metric-card glass">
          <span className="metric-value" style={{ color: 'var(--aurora-accent)' }}>{stats?.session?.sitesVisited ?? 0}</span>
          <span className="metric-label">{t.sites}</span>
        </div>
      </div>

      <div className="glass section-card">
        <h3 className="section-title">{t.per_site}</h3>
        <div className="table-wrap">
          {(stats?.sites?.length ?? 0) === 0 ? (
            <p className="empty-hint">{t.empty_sites}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>{t.site}</th><th>{t.requests_col}</th><th>{t.trackers_col}</th></tr>
              </thead>
              <tbody>
                {stats.sites.map(s => (
                  <tr key={s.domain}>
                    <td>{s.domain}</td>
                    <td>{s.requests}</td>
                    <td>{s.trackers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="glass section-card">
        <h3 className="section-title">{t.top_trackers}</h3>
        <div className="table-wrap">
          {(stats?.topTrackers?.length ?? 0) === 0 ? (
            <p className="empty-hint">{t.empty_trackers}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>{t.tracker}</th><th>{t.count_col}</th></tr>
              </thead>
              <tbody>
                {stats.topTrackers.map(tr => (
                  <tr key={tr.domain}>
                    <td>{tr.domain}</td>
                    <td>{tr.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="glass section-card">
        <h3 className="section-title">{t.recent}</h3>
        <div className="recent-blocked">
          {(stats?.recentBlocked?.length ?? 0) === 0 ? (
            <p className="empty-hint">{t.empty_recent}</p>
          ) : (
            stats.recentBlocked.map((b, i) => (
              <div key={i} className="recent-row">
                <span className="recent-host">{b.host}</span>
                <span className="recent-url">{b.url}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Site Inspector ───────────────────────────────────────────────
export function InspectorPanel({ language, currentUrl }) {
  const t = i18n[language].inspector;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Pre-fill from the address bar when the panel opens on a real site
  useEffect(() => {
    if (currentUrl && /^https:\/\//i.test(currentUrl)) {
      setInput(currentUrl);
    }
  }, [currentUrl]);

  const run = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await window.electronAPI.inspectSite(q);
      if (res.ok) setResult(res);
      else setError(res.error || 'Unknown error');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const gradeColor = result?.security?.grade === 'A' ? 'var(--aurora-green)'
    : result?.security?.grade === 'B' ? 'var(--aurora-primary)'
    : result?.security?.grade === 'C' ? 'var(--aurora-yellow, #fbbf24)'
    : 'var(--aurora-red)';

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle} />

      <form className="inspector-form" onSubmit={run}>
        <input
          className="inspector-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t.placeholder}
          spellCheck="false"
          autoFocus
        />
        <button className="inspector-btn" disabled={busy}>
          {busy ? t.inspecting : t.button}
        </button>
      </form>

      {error && <div className="inspector-error glass">{t.error_prefix}: {error}</div>}

      {result && (
        <div className="inspector-results">
          <div className="grade-card glass">
            <div className="grade-badge" style={{ borderColor: gradeColor, color: gradeColor }}>
              {result.security.grade}
            </div>
            <div className="grade-info">
              <div className="grade-host">{result.host}</div>
              <div className="grade-sub">{t.headers_score}: {result.security.score}/100</div>
            </div>
          </div>

          <div className="glass section-card">
            <h3 className="section-title">TLS</h3>
            <div className="kv-grid">
              <div className="kv"><span>{t.tls_protocol}</span><code>{result.tls.protocol}</code></div>
              <div className="kv"><span>{t.cipher}</span><code>{result.tls.cipher || '—'}</code></div>
              <div className="kv"><span>{t.handshake}</span><code>{result.tls.handshakeMs} ms</code></div>
            </div>
          </div>

          {result.tls.cert && (
            <div className="glass section-card">
              <h3 className="section-title">{t.cert_subject}</h3>
              <div className="kv-grid">
                <div className="kv"><span>{t.cert_subject}</span><code>{result.tls.cert.subjectCN}</code></div>
                <div className="kv"><span>{t.cert_issuer}</span><code>{result.tls.cert.issuerO || result.tls.cert.issuerCN}</code></div>
                <div className="kv"><span>{t.cert_valid}</span><code>{result.tls.cert.validFrom} → {result.tls.cert.validTo}</code></div>
                <div className="kv"><span>{t.cert_days}</span><code style={{ color: result.tls.cert.daysRemaining < 14 ? 'var(--aurora-red)' : undefined }}>{result.tls.cert.daysRemaining}</code></div>
                <div className="kv"><span>{t.cert_bits}</span><code>{result.tls.cert.bits || '—'}</code></div>
              </div>
              {result.tls.cert.altNames?.length > 0 && (
                <div className="alt-names">
                  {result.tls.cert.altNames.map(n => <code key={n} className="alt-name">{n}</code>)}
                </div>
              )}
            </div>
          )}

          <div className="glass section-card">
            <h3 className="section-title">HTTP</h3>
            <div className="kv-grid">
              <div className="kv"><span>{t.http_status}</span><code>{result.http.statusCode ?? '—'}</code></div>
              <div className="kv"><span>{t.server}</span><code>{result.http.server || '—'}</code></div>
            </div>
          </div>

          <div className="glass section-card">
            <h3 className="section-title">{t.findings}</h3>
            <div className="findings-list">
              {result.security.findings.map((f, i) => (
                <div key={i} className={`finding-row ${f.status}`}>
                  <code className="finding-name">{f.header}</code>
                  <span className={`finding-status ${f.status === 'ok' ? 'ok' : 'bad'}`}>
                    {f.status === 'ok' ? t.finding_ok : t.finding_missing}
                  </span>
                  {f.value && <span className="finding-value">{f.value}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="glass section-card">
            <h3 className="section-title">{t.warnings}</h3>
            {result.warnings.length === 0 ? (
              <p className="empty-hint">{t.no_warnings}</p>
            ) : (
              result.warnings.map((w, i) => (
                <div key={i} className="warning-row">⚠ {w}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Password Audit ───────────────────────────────────────────────
// TZ v2.0.9 fix #2: onOpenVault is called from a shortcut button rendered
// next to the "vault is locked" audit error, so the lock screen with the
// master-password form (panel://vault) is one click away — the old text-only
// hint told the user to open a panel that had lost its UI entry point.
export function PassAuditPanel({ language, vaultUnlocked, onOpenVault }) {
  const t = i18n[language].passaudit;
  const tv = i18n[language].vault;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // TZ v2.0.9 fix #2: separate "vault locked" notice + fast-path button to
  // the Vault unlock screen (the panel itself renders the unlock form).
  const [lockedError, setLockedError] = useState('');
  // P.2: save-password form state + saved list.
  const [form, setForm] = useState({ label: '', user: '', pass: '', totp: '' });
  const [saved, setSaved] = useState([]);
  const [saveMsg, setSaveMsg] = useState('');
  const [copied, setCopied] = useState('');
  // 2FA: live codes are generated in the MAIN process (the secret is never
  // sent to the renderer); this clock just re-queries every second and the
  // code text swaps every 30s with it.
  const [tick, setTick] = useState(0);
  const [totpCodes, setTotpCodes] = useState({});

  useEffect(() => {
    const iv = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.electronAPI?.vault?.getTotp) return;
      const next = {};
      for (const s of saved) {
        if (!s.hasTwoFactor) continue;
        try {
          const res = await window.electronAPI.vault.getTotp(s.url, s.username);
          if (res?.ok) next[`${s.username}\u0000${s.url}`] = res;
        } catch (_) { /* locked */ }
      }
      if (!cancelled) setTotpCodes(next);
    })();
    return () => { cancelled = true; };
  }, [saved, tick]);

  const refreshSaved = useCallback(async () => {
    if (!window.electronAPI?.vault?.get) { setSaved([]); return; }
    try {
      const list = await window.electronAPI.vault.get();
      setSaved(Array.isArray(list) ? list : []);
    } catch (_) {
      // Vault locked (getLogins throws): not an error for this screen.
      setSaved([]);
    }
  }, []);

  // TZ: the list refreshes not only on mount, but also the moment the vault
  // unlock state flips — a first fetch while the vault was still locked must
  // not leave an empty list until the widget is fully remounted.
  useEffect(() => { refreshSaved(); }, [refreshSaved, vaultUnlocked]);

  // TZ: cross-surface save sync. Saving from another surface (the toolbar's
  // vault save prompt, the main Vault panel) broadcasts 'aurora:vault-changed'
  // on window; an already-open Password Audit panel re-queries the vault at
  // once instead of showing a stale/empty list until remount.
  useEffect(() => {
    const handler = () => { refreshSaved(); };
    window.addEventListener('aurora:vault-changed', handler);
    return () => window.removeEventListener('aurora:vault-changed', handler);
  }, [refreshSaved]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveMsg('');
    setError('');
    const label = form.label.trim();
    const user = form.user.trim();
    if (!label || !user || !form.pass) return;
    const url = /^https?:\/\//i.test(label) ? label : `https://${label}`;
    try {
      // Optional 2FA secret is passed as the 4th arg: the backend stores it
      // in its OWN encrypted column, never inside the password field.
      const secret = form.totp.replace(/\s+/g, '');
      // saveLogin dedups by url+username and reports what it did.
      const res = await window.electronAPI.vault.save(url, user, form.pass, secret || undefined);
      if (!res?.ok) {
        setError(res?.error || 'Save failed');
        return;
      }
      // Backend semantic: identical re-save resolves ok but unchanged.
      setSaveMsg(res.changed || res.updated
        ? (tv.saved_updated || 'Entry updated')
        : (tv.saved_added || 'Password saved to the vault'));
      setForm({ label: '', user: '', pass: '', totp: '' });
      // CRITICAL: force the list refresh before the user notices anything —
      // the fresh login must be IN the list the moment the form clears.
      await refreshSaved();
      window.dispatchEvent(new CustomEvent('aurora:vault-changed'));
    } catch (err) {
      // Vault locked (or no bridge): the save handler throws with a message.
      setError(err.message || 'Vault is locked');
    }
  };

  const handleCopy = async (url, username, kind) => {
    try {
      if (kind === 'pass') {
        const pass = await window.electronAPI.vault.getPassword(url, username);
        if (pass) { navigator.clipboard.writeText(pass); setCopied(username + ':pass'); }
      } else if (kind === 'totp') {
        const res = await window.electronAPI.vault.getTotp(url, username);
        if (res?.ok) { navigator.clipboard.writeText(res.code); setCopied(username + ':totp'); }
      } else {
        navigator.clipboard.writeText(username);
        setCopied(username + ':user');
      }
    } catch (_) { /* vault locked */ }
  };

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      if (!window.electronAPI?.vault?.audit) {
        // No Electron bridge (plain web preview): the audit needs the vault
        // contents which live in the main process.
        setError(t.no_bridge_hint || 'Aurora bridge unavailable — run the desktop app to use the vault.');
        return;
      }
      const res = await window.electronAPI.vault.audit();
      if (res.ok) setResult(res);
      // FYI: the audit needs decrypted passwords from the vault, so when the
      // vault is locked the backend refuses. We surface that as a regular
      // inline error (no gate, the button is always active) — unlocking the
      // vault in the main Vault panel makes the next click succeed.
      else setLockedError(res.error === 'Vault is locked' ? (t.locked_hint || t.locked) : '');
      setError(res.error === 'Vault is locked' ? '' : (res.error || 'Unknown error'));
    } catch (err) {
      // vault.audit() itself throws 'Vault is locked' when locked.
      setLockedError(err.message === 'Vault is locked' ? (t.locked_hint || t.locked) : '');
      setError(err.message === 'Vault is locked' ? '' : (err.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const strengthColor = { strong: 'var(--aurora-green)', good: 'var(--aurora-primary)', fair: 'var(--aurora-yellow, #fbbf24)', weak: 'var(--aurora-red)' };

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle}>
        <button className="panel-action-btn" onClick={run} disabled={busy}>
          {busy ? t.auditing : t.button}
        </button>
      </PanelHeader>

      <div className="privacy-note glass">{t.privacy_note}</div>

      {/* P.2: compact save-password form (glass style, fits the 440px
          dropdown too — flex + min-width:0 keep it overflow-safe). */}
      <form className="pa-form glass" onSubmit={handleSave}>
        <div className="pa-form-title">{t.add_title || 'Save a password'}</div>
        <input
          className="pa-input"
          type="text"
          placeholder={t.add_site || 'Site / service name (e.g. github.com)'}
          value={form.label}
          onChange={e => setForm({ ...form, label: e.target.value })}
          spellCheck="false"
          autoComplete="off"
        />
        <input
          className="pa-input"
          type="text"
          placeholder={t.add_user || 'Login / email'}
          value={form.user}
          onChange={e => setForm({ ...form, user: e.target.value })}
          spellCheck="false"
          autoComplete="off"
        />
        <input
          className="pa-input"
          type="password"
          placeholder={t.add_pass || 'Password'}
          value={form.pass}
          onChange={e => setForm({ ...form, pass: e.target.value })}
        />
        <input
          className="pa-input"
          type="text"
          placeholder={t.add_totp || '2FA Secret Key (optional, Base32)'}
          value={form.totp}
          onChange={e => setForm({ ...form, totp: e.target.value })}
          spellCheck="false"
          autoComplete="off"
        />
        <button type="submit" className="pa-save-btn" disabled={!form.label.trim() || !form.user.trim() || !form.pass}>
          {t.add_btn || 'Save Password'}
        </button>
        {saveMsg && <div className="pa-save-msg">{saveMsg}</div>}
      </form>

      {/* P.2: compact saved-credentials list with 1-click copy. Favicon from
          the same Google s2 service the welcome tile uses. */}
      <div className="pa-saved glass">
        <div className="pa-form-title">{(t.saved_title) || 'Saved passwords'} {saved.length > 0 && <span className="pa-saved-count">{saved.length}</span>}</div>
        {saved.length === 0 ? (
          <p className="empty-hint">{(t.saved_empty) || 'Nothing saved yet.'}</p>
        ) : (
          <div className="pa-saved-list">
            {saved.map((s, i) => {
              let host = s.url;
              try { host = new URL(s.url).hostname; } catch (_) { /* keep raw */ }
              const copyUser = () => handleCopy(s.url, s.username, 'user');
              const copyPass = () => handleCopy(s.url, s.username, 'pass');
              return (
                <div key={i} className="pa-saved-row">
                  <img
                    className="pa-saved-favicon"
                    src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="pa-saved-info">
                    <span className="pa-saved-host">{host}</span>
                    <span className="pa-saved-user">{s.username}</span>
                  </div>
                  <div className="pa-saved-actions">
                    {s.hasTwoFactor && totpCodes[`${s.username}\u0000${s.url}`]?.ok && (
                      <button
                        className="pa-totp-btn"
                        onClick={() => handleCopy(s.url, s.username, 'totp')}
                        title={t.totp_copy_hint || 'Click to copy the current 2FA code'}
                      >
                        <span className="pa-totp-code">{totpCodes[`${s.username}\u0000${s.url}`].code}</span>
                        <span className="pa-totp-ring" style={{ animationDuration: `${Math.max(1, totpCodes[`${s.username}\u0000${s.url}`].expiresIn || 30)}s` }} />
                      </button>
                    )}
                    <button className="pa-copy-btn" onClick={copyUser} title={tv.copy_user || 'Copy username'}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    </button>
                    <button className="pa-copy-btn" onClick={copyPass} title={tv.copy_pass || 'Copy password'}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      {copied === s.username + ':pass' && <span className="pa-copied-flash">{tv.copied_flash || '✓'}</span>}
                    </button>
                  </div>
                </div>
              );
            })
            // copied-state feedback for the user-copy button too.
            }
            {copied && copied.endsWith(':user') && (
              <div className="pa-save-msg">{tv.copied_user || 'Username copied'}</div>
            )}
          </div>
        )}
      </div>
      {error && <div className="inspector-error glass">{t.error_prefix}: {error}</div>}

      {/* TZ v2.0.9 fix #2: a visible, clickable path back to the vault when
          the audit is refused because it is locked — the button opens the
          Vault panel whose lock screen holds the master-password form. */}
      {lockedError && (
        <div className="inspector-error glass pa-locked-notice">
          <span>{t.error_prefix}: {lockedError}</span>
          {onOpenVault && (
            <button className="pa-locked-unlock-btn" onClick={() => onOpenVault()}>
              {tv.unlock || 'Unlock'}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="audit-results">
          <div className="metric-grid">
            <div className="metric-card glass">
              <span className="metric-value" style={{ color: 'var(--aurora-text)' }}>{result.summary.total}</span>
              <span className="metric-label">{t.summary_total}</span>
            </div>
            <div className="metric-card glass">
              <span className="metric-value" style={{ color: 'var(--aurora-green)' }}>{result.summary.ok}</span>
              <span className="metric-label">{t.summary_ok}</span>
            </div>
            <div className="metric-card glass">
              <span className="metric-value" style={{ color: 'var(--aurora-yellow, #fbbf24)' }}>{result.summary.weak}</span>
              <span className="metric-label">{t.summary_weak}</span>
            </div>
            <div className="metric-card glass">
              <span className="metric-value" style={{ color: 'var(--aurora-primary)' }}>{result.summary.reused}</span>
              <span className="metric-label">{t.summary_reused}</span>
            </div>
            <div className="metric-card glass">
              <span className="metric-value" style={{ color: 'var(--aurora-red)' }}>{result.summary.breached}</span>
              <span className="metric-label">{t.summary_breached}</span>
            </div>
          </div>

          <div className="glass section-card">
            <h3 className="section-title">{t.health}: {result.summary.health}%</h3>
            <div className="shield-bar-wrap">
              <div
                className="shield-bar"
                style={{
                  '--fill': `${result.summary.health}%`,
                  background: result.summary.health >= 80
                    ? 'linear-gradient(90deg, var(--aurora-primary), var(--aurora-green))'
                    : 'linear-gradient(90deg, var(--aurora-red), var(--aurora-yellow, #fbbf24))',
                }}
              />
            </div>
          </div>

          <div className="glass section-card">
            {(result.entries?.length ?? 0) === 0 ? (
              <p className="empty-hint">{t.empty}</p>
            ) : (
              <div className="audit-list">
                {result.entries.map((e, i) => (
                  <div key={i} className={`audit-entry glass ${e.issues.length ? 'has-issues' : ''}`}>
                    <div className="audit-entry-head">
                      <span className="audit-host">{(() => { try { return new URL(e.url).hostname } catch { return e.url } })()}</span>
                      <span className="audit-user">{e.username}</span>
                    </div>
                    <div className="audit-entry-tags">
                      <span className="audit-tag" style={{ color: strengthColor[e.strength.label] }}>
                        {t.strength}: {e.strength.label} ({e.strength.entropyBits} bits)
                      </span>
                      <span className={`audit-tag ${e.reused ? 'bad' : 'ok'}`}>
                        {e.reused ? t.reused_badge : '—'}
                      </span>
                      <span className={`audit-tag ${e.breach?.breached ? 'bad' : e.breach?.checked ? 'ok' : ''}`}>
                        {!e.breach?.checked
                          ? t.breach_unknown
                          : e.breach.breached
                            ? `${t.breach_found} ×${e.breach.count}`
                            : t.breach_ok}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
