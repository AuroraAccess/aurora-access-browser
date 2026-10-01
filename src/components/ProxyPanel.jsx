/*
 * ProxyPanel.jsx — UI control for the session-scoped proxy.
 *
 * Talks to the main process through window.electronAPI.proxy (see
 * electron/proxy-control.js). The proxy applies ONLY to the current browser
 * sessions; system-wide proxy settings are never touched.
 *
 * Styling uses the Aurora design tokens (src/index.css) rather than a utility
 * framework, so it stays visually consistent with the rest of the browser.
 */
import React, { useState, useEffect, useCallback } from 'react';
import './panels.css';
import './ProxyPanel.css';
import { i18n } from '../i18n';

const PROTOCOL_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' },
];

/* ─── Minimal inline icons (lucide-style, stroke = currentColor) ─── */
const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const Icon = ({ size = 18, children, ...rest }) => (
  <svg {...svgBase} style={{ width: size, height: size }} {...rest}>{children}</svg>
);

const IconGlobe = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </Icon>
);

const IconHash = (p) => (
  <Icon {...p}>
    <line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" />
    <line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" />
  </Icon>
);

const IconLock = (p) => (
  <Icon {...p}>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);

const IconShieldAlert = (p) => (
  <Icon {...p}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" /><path d="M12 16h.01" />
  </Icon>
);

const IconRoute = (p) => (
  <Icon {...p}>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </Icon>
);

const IconWarning = (p) => (
  <Icon {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </Icon>
);

const IconCheck = (p) => (
  <Icon {...p}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <path d="m9 11 3 3L22 4" />
  </Icon>
);

function PanelHeader({ title, subtitle }) {
  return (
    <div className="panel-header">
      <div className="panel-header-icon">
        <Icon size={24}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 12h4M16 8h2M16 12h2M16 16h2M6 16h6" />
        </Icon>
      </div>
      <div style={{ flex: 1 }}>
        <h2 className="panel-title">{title}</h2>
        <p className="panel-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

function isValidHost(host) {
  if (!host) return false;
  if (host.includes('://') || /[\s/?#]/.test(host)) return false;
  if (host.startsWith('[') && host.endsWith(']')) return true;
  return /^[a-zA-Z0-9._:-]+$/.test(host);
}

export default function ProxyPanel({ language }) {
  const t = i18n[language].proxy;

  const [state, setState] = useState(null);       // last confirmed state from main
  const [protocol, setProtocol] = useState('socks5');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [bypassRules, setBypassRules] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [wakeEdit, setWakeEdit] = useState(false); // "un-dim" the settings while off
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const enabled = !!state?.enabled;
  const hasBridge = typeof window !== 'undefined' && !!window.electronAPI?.proxy;
  // Settings dim and become inert while the proxy is off, until the user
  // clicks the block to configure it — this keeps the "off" state readable
  // without trapping the user away from the fields.
  const locked = !enabled && !wakeEdit;

  // Pull the persisted state once on mount so the panel reflects a proxy that
  // was left enabled in a previous run of the browser.
  const load = useCallback(async () => {
    const api = window.electronAPI?.proxy;
    if (!api) return;
    try {
      const s = await api.getState();
      if (!s) return;
      setState(s);
      setProtocol(s.protocol || 'socks5');
      setHost(s.host || '');
      setPort(s.port ? String(s.port) : '');
      setUsername(s.username || '');
      setPassword(s.password || '');
      setBypassRules(s.bypassRules || '');
      if (s.username || s.password) setShowAuth(true);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const validate = () => {
    if (!isValidHost(host.trim())) return t.err_host;
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return t.err_port;
    return '';
  };

  const applyProxy = async () => {
    const api = window.electronAPI?.proxy;
    if (!api) { setError(t.no_bridge); return; }
    const invalid = validate();
    if (invalid) { setError(invalid); return; }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.set({
        enabled: true,
        protocol,
        host: host.trim(),
        port,
        username,
        password,
        bypassRules: bypassRules.trim(),
      });
      if (!res.ok) { setError(res.error || t.err_apply); return; }
      setState(res.state);
      setNotice(t.applied);
      setWakeEdit(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    const api = window.electronAPI?.proxy;
    if (!api) { setError(t.no_bridge); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.disable();
      if (!res.ok) { setError(res.error || t.err_apply); return; }
      setState(res.state);
      setNotice(t.disabled);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = () => {
    if (busy) return;
    if (enabled) turnOff();
    else applyProxy();
  };

  // Probe the endpoint in the fields (saved or not) without applying it.
  const testConnection = async () => {
    const api = window.electronAPI?.proxy;
    if (!api?.test) { setError(t.no_bridge); return; }
    const invalid = validate();
    if (invalid) { setError(invalid); return; }

    setTesting(true);
    setError('');
    setNotice('');
    try {
      const res = await api.test({ host: host.trim(), port });
      if (res?.reachable) {
        setNotice(t.test_ok);
      } else {
        setError(res?.error ? `${t.test_fail}: ${res.error}` : t.test_fail);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  const statusText = enabled
    ? `${t.network_proxy} ${state.protocol}://${state.host}:${state.port}`
    : t.network_direct;

  return (
    <div className="panel-page proxy-page">
      <PanelHeader title={t.title} subtitle={t.subtitle} />

      {/* ── Unified card: status + toggle + server settings ───────── */}
      <div className={`proxy-card glass ${enabled ? 'is-active' : ''}`}>
        {/* Status indicator */}
        <div className={`proxy-status ${enabled ? 'active' : 'direct'}`}>
          <span className="proxy-status-dot" />
          <div className="proxy-status-text">
            <span className="proxy-status-label">{statusText}</span>
            <span className="proxy-status-sub">{enabled ? t.scope_note : t.direct_note}</span>
          </div>
        </div>

        {/* Toggle */}
        <button
          type="button"
          className="proxy-toggle-row"
          onClick={handleToggle}
          disabled={busy || !hasBridge}
        >
          <span className="proxy-toggle-icon">
            <IconShieldAlert size={20} />
          </span>
          <span className="proxy-toggle-copy">
            <span className="proxy-toggle-title">{t.enable_proxy}</span>
            <span className="proxy-toggle-state">{enabled ? t.state_on : t.state_off}</span>
          </span>
          <span className={`settings-toggle ${enabled ? 'active' : ''} ${busy ? 'busy' : ''}`} />
        </button>

        <div className="proxy-divider" />

        {/* Server settings — dim + inert while off */}
        <div
          className={`proxy-settings ${locked ? 'is-disabled' : ''}`}
          onClick={locked ? () => setWakeEdit(true) : undefined}
          title={locked ? t.enable_proxy : undefined}
        >
          {/* Protocol */}
          <div className="proxy-field">
            <label className="proxy-label"><IconGlobe size={13} /> {t.protocol}</label>
            <div className="proxy-control">
              <span className="proxy-control-icon"><IconGlobe size={15} /></span>
              <select
                className="proxy-select"
                value={protocol}
                onChange={e => setProtocol(e.target.value)}
                disabled={busy}
              >
                {PROTOCOL_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Host (3/4) + Port (1/4) */}
          <div className="proxy-grid">
            <div className="proxy-field">
              <label className="proxy-label"><IconGlobe size={13} /> {t.host}</label>
              <div className="proxy-control">
                <span className="proxy-control-icon"><IconGlobe size={15} /></span>
                <input
                  className="proxy-input"
                  type="text"
                  value={host}
                  placeholder="127.0.0.1"
                  spellCheck="false"
                  autoComplete="off"
                  disabled={busy}
                  onChange={e => { setHost(e.target.value); setError(''); }}
                />
              </div>
            </div>

            <div className="proxy-field">
              <label className="proxy-label"><IconHash size={13} /> {t.port}</label>
              <div className="proxy-control">
                <span className="proxy-control-icon"><IconHash size={15} /></span>
                <input
                  className="proxy-input"
                  type="text"
                  inputMode="numeric"
                  value={port}
                  placeholder="1080"
                  spellCheck="false"
                  autoComplete="off"
                  disabled={busy}
                  onChange={e => { setPort(e.target.value.replace(/[^\d]/g, '')); setError(''); }}
                />
              </div>
            </div>
          </div>

          {/* Optional auth */}
          <button
            type="button"
            className="proxy-auth-toggle"
            onClick={e => { e.stopPropagation(); setShowAuth(v => !v); }}
          >
            <IconLock size={14} />
            <span>{t.auth_toggle}</span>
            <span className={`proxy-chevron ${showAuth ? 'open' : ''}`}>▾</span>
          </button>

          {showAuth && (
            <div className="proxy-grid proxy-auth-fields">
              <div className="proxy-field">
                <label className="proxy-label">{t.username}</label>
                <div className="proxy-control">
                  <span className="proxy-control-icon"><IconLock size={15} /></span>
                  <input
                    className="proxy-input"
                    type="text"
                    value={username}
                    autoComplete="off"
                    disabled={busy}
                    onChange={e => setUsername(e.target.value)}
                  />
                </div>
              </div>
              <div className="proxy-field">
                <label className="proxy-label">{t.password}</label>
                <div className="proxy-control">
                  <span className="proxy-control-icon"><IconLock size={15} /></span>
                  <input
                    className="proxy-input"
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bypass rules */}
          <div className="proxy-field">
            <label className="proxy-label"><IconRoute size={13} /> {t.bypass}</label>
            <div className="proxy-control">
              <span className="proxy-control-icon"><IconRoute size={15} /></span>
              <input
                className="proxy-input"
                type="text"
                value={bypassRules}
                placeholder={t.bypass_placeholder}
                spellCheck="false"
                disabled={busy}
                onChange={e => setBypassRules(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────── */}
      {!hasBridge && (
        <div className="proxy-warning">
          <span className="proxy-warning-icon"><IconWarning size={16} /></span>
          <span>{t.no_bridge}</span>
        </div>
      )}
      {error && (
        <div className="proxy-warning">
          <span className="proxy-warning-icon"><IconWarning size={16} /></span>
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="proxy-success">
          <span className="proxy-success-icon"><IconCheck size={16} /></span>
          <span>{notice}</span>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────── */}
      <div className="proxy-actions">
        <button
          className="panel-action-btn proxy-test-btn"
          onClick={testConnection}
          disabled={busy || testing || !hasBridge}
        >
          {testing ? t.testing : t.test}
        </button>
        <button
          className="inspector-btn proxy-apply-btn"
          onClick={applyProxy}
          disabled={busy || testing || !hasBridge}
        >
          {busy ? t.working : t.apply}
        </button>
        {enabled && (
          <button
            className="panel-action-btn"
            onClick={turnOff}
            disabled={busy || testing || !hasBridge}
          >
            {t.turn_off}
          </button>
        )}
      </div>
    </div>
  );
}
