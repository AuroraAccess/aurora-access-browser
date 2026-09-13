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
export function PassAuditPanel({ language, vaultUnlocked }) {
  const t = i18n[language].passaudit;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await window.electronAPI.vault.audit();
      if (res.ok) setResult(res);
      else setError(res.error || 'Unknown error');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const strengthColor = { strong: 'var(--aurora-green)', good: 'var(--aurora-primary)', fair: 'var(--aurora-yellow, #fbbf24)', weak: 'var(--aurora-red)' };

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle}>
        <button className="panel-action-btn" onClick={run} disabled={busy || !vaultUnlocked}>
          {busy ? t.auditing : t.button}
        </button>
      </PanelHeader>

      <div className="privacy-note glass">{t.privacy_note}</div>

      {!vaultUnlocked && <div className="audit-locked glass">{t.locked}</div>}
      {error && <div className="inspector-error glass">{t.error_prefix}: {error}</div>}

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
