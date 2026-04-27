/* 
 * NOTICE: This file is protected under RCF-PL v1.2.8
 * [RCF:PROTECTED]
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import './MainContent.css';
import { useRCF } from '../hooks/useRCF.js';
import { i18n } from '../i18n';
import { CONFIG } from '../config.js';

const WELCOME_URL = '__welcome__';

// ─── Welcome Page ─────────────────────────────────────────────────
const DEFAULT_SHORTCUTS = [
  { label: 'Aurora Access', url: 'rcf://dashboard', type: 'bolt' },
  { label: 'RCF Flash Tool', url: 'rcf://flash', type: 'zap' },
  { label: 'P2P Exchange', url: CONFIG.SUPPORT_BOT, type: 'repeat' },
  { label: 'GitHub', url: 'https://github.com', type: 'github' },
  { label: 'Telegram', url: CONFIG.TELEGRAM_CHANNEL, type: 'send' }
];

function WelcomePage({ onNavigate, language }) {
  const t = i18n[language].welcome;
  const [shortcuts, setShortcuts] = useState(() => {
    const saved = localStorage.getItem('aurora-shortcuts');
    return saved ? JSON.parse(saved) : DEFAULT_SHORTCUTS;
  });
  const [showAdd, setShowAdd] = useState(false);
  const [newShortcut, setNewShortcut] = useState({ label: '', url: '' });

  const saveShortcuts = (list) => {
    setShortcuts(list);
    localStorage.setItem('aurora-shortcuts', JSON.stringify(list));
  };

  const addShortcut = (e) => {
    e.preventDefault();
    if (!newShortcut.label || !newShortcut.url) return;
    let url = newShortcut.url;
    if (!url.includes('://')) url = 'https://' + url;
    
    // Determine icon type: if it's an external URL, use favicon
    const type = url.startsWith('http') ? 'favicon' : 'globe';
    
    const newList = [...shortcuts, { ...newShortcut, url, type }];
    saveShortcuts(newList);
    setNewShortcut({ label: '', url: '' });
    setShowAdd(false);
  };

  const deleteShortcut = (idx, e) => {
    e.stopPropagation();
    const newList = shortcuts.filter((_, i) => i !== idx);
    saveShortcuts(newList);
  };

  const renderIcon = (type, label, url) => {
    const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { width: 22, height: 22 } };
    
    if (type === 'favicon' && url) {
      try {
        const domain = new URL(url).hostname;
        return (
          <img 
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} 
            alt="" 
            className="quick-link-img"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        );
      } catch (e) { /* ignore and fallback */ }
    }

    switch (type) {
      case 'bolt': return <svg {...props}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
      case 'zap': return <svg {...props}><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.364-7.364l-1.414 1.414M6.05 17.95l-1.414 1.414m0-14.141l1.414 1.414m11.314 11.314l1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>;
      case 'repeat': return <svg {...props}><path d="M17 2.1a9 9 0 0 1 0 13.9M13 11.6l-3-3-3 3M10 8.6v9M3 21h18" /></svg>;
      case 'github': return <svg {...props}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" /></svg>;
      case 'send': return <svg {...props}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
      case 'globe':
      case 'favicon': // fallback for favicon if img hidden
      default: return <div className="link-initial">{label ? label.charAt(0).toUpperCase() : '?'}</div>;
    }
  };

  return (
    <div className="welcome-page">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-logo">
          <img src="./logo.png" alt="Aurora" style={{ filter: 'drop-shadow(0 0 24px var(--aurora-primary-glow))' }} />
        </div>
        <h1 className="welcome-title">{t.title}</h1>
        <p className="welcome-subtitle">{t.subtitle}</p>

        <div className="welcome-search">
          <span className="welcome-search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            placeholder={t.search_placeholder}
            className="welcome-search-input"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                const q = e.target.value.trim();
                if (q.startsWith('rcf://') || q.startsWith('aurora://')) { onNavigate(q); return; }
                onNavigate(q.includes('.') ? `https://${q}` : `${CONFIG.DEFAULT_SEARCH_ENGINE}${encodeURIComponent(q)}`);
              }
            }}
          />
        </div>

        <div className="quick-links">
          {shortcuts.map((link, i) => (
            <button key={i} className="quick-link" onClick={() => onNavigate(link.url)}>
              <span className="quick-link-delete" onClick={(e) => deleteShortcut(i, e)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
              <span className="quick-link-icon">{renderIcon(link.type, link.label, link.url)}</span>
              <span className="quick-link-label">{link.label}</span>
            </button>
          ))}
          <button className="quick-link add-link" onClick={() => setShowAdd(true)}>
            <span className="quick-link-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            <span className="quick-link-label">{t.add_shortcut || 'Add'}</span>
          </button>
        </div>

        {showAdd && (
          <div className="shortcut-modal-overlay" onClick={() => setShowAdd(false)}>
            <div className="shortcut-modal glass" onClick={e => e.stopPropagation()}>
              <h3>{t.add_shortcut_title || 'New Shortcut'}</h3>
              <form onSubmit={addShortcut}>
                <input 
                  type="text" 
                  placeholder={t.name_placeholder || 'Site Name'} 
                  value={newShortcut.label}
                  onChange={e => setNewShortcut({...newShortcut, label: e.target.value})}
                  autoFocus
                />
                <input 
                  type="text" 
                  placeholder={t.url_placeholder || 'URL (e.g. google.com)'} 
                  value={newShortcut.url}
                  onChange={e => setNewShortcut({...newShortcut, url: e.target.value})}
                />
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>{t.cancel || 'Cancel'}</button>
                  <button type="submit" className="btn-primary">{t.add || 'Add'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="welcome-stats">
          <div className="stat-item">
            <span className="stat-value" style={{ color: 'var(--aurora-green)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10, marginRight: 4 }}>
                <circle cx="12" cy="12" r="10" fill="currentColor" />
              </svg>
            </span>
            <span>{t.network_active}</span>
          </div>
          <div className="stat-item">
            <span className="stat-value" style={{ color: 'var(--aurora-primary)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, marginRight: 4 }}>
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </span>
            <span>{t.protocol_ready}</span>
          </div>
          <div className="stat-item">
            <span className="stat-value" style={{ color: 'var(--aurora-accent)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12, marginRight: 4 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span>{t.encryption}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Real Webview (Electron only) ─────────────────────────────────
function ElectronWebview({ url, onLoadStart, onLoadStop, onTitleChange, onUrlUpdate, onFaviconUpdate, onRef, preloadPath }) {
  const wvRef = useRef(null);
  const isReady = useRef(false);
  const pendingUrl = useRef(url);
  const [initialSrc] = useState(url || 'about:blank');

  // Forward the ref to the parent
  useEffect(() => {
    console.log('[Aurora-Webview] Mounting... url:', url);
    if (onRef) {
      if (typeof onRef === 'function') onRef(wvRef);
      else onRef.current = wvRef;
    }
  }, [onRef, url]);

  const lastRecordedUrl = useRef('');

  // Attach all event listeners once on mount
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;

    const handleStart = () => { console.log('[Aurora-Webview] Start Loading'); onLoadStart?.(); };
    const handleStop = () => { console.log('[Aurora-Webview] Stop Loading'); onLoadStop?.(); };
    const handleTitle = (e) => onTitleChange?.(e.title);
    const handleFavicon = (e) => {
      if (e.favicons && e.favicons.length > 0) {
        onFaviconUpdate?.(e.favicons[0]);
      }
    };
    const handleReady = () => {
      console.log('[Aurora-Webview] DOM Ready');
      isReady.current = true;
      if (pendingUrl.current) {
        wv.loadURL(pendingUrl.current).catch(err => console.error('[Aurora-Webview] Load failed:', err));
        pendingUrl.current = null;
      }
    };

    const handleNavigation = (e) => {
      const normalizedUrl = e.url.replace(/\/$/, "");
      const prevUrl = lastRecordedUrl.current.replace(/\/$/, "");
      
      if (normalizedUrl !== prevUrl) {
        console.log('[Aurora-Webview] Smart Record:', e.url);
        onUrlUpdate?.(e.url);
        window.electronAPI.history.add(e.url, wv.getTitle());
        lastRecordedUrl.current = e.url;
      }
    };

    const handleIpcMessage = async (e) => {
      const { channel, args } = e;
      const data = args[0];

      if (channel === 'vault-capture') {
        const url = wv.getURL();
        console.log('[Aurora-Vault] Captured login for:', url);
        if (window.onVaultCapture) {
          window.onVaultCapture(url, data.u, data.p);
        }
      }

      if (channel === 'vault-form-detected') {
        try {
          const url = wv.getURL();
          const saved = await window.electronAPI.vault.findForUrl(url);
          if (saved && saved.length > 0) {
            const username = saved[0].username;
            const password = await window.electronAPI.vault.getPassword(url, username);
            wv.send('vault-autofill', { username, password });
          }
        } catch (_) { /* vault is locked */ }
      }
    };

    wv.addEventListener('dom-ready', handleReady);
    wv.addEventListener('did-start-loading', handleStart);
    wv.addEventListener('did-stop-loading', handleStop);
    wv.addEventListener('page-title-updated', handleTitle);
    wv.addEventListener('page-favicon-updated', handleFavicon);
    wv.addEventListener('did-navigate', handleNavigation);
    wv.addEventListener('did-navigate-in-page', handleNavigation);
    wv.addEventListener('ipc-message', handleIpcMessage);

    return () => {
      wv.removeEventListener('dom-ready', handleReady);
      wv.removeEventListener('did-start-loading', handleStart);
      wv.removeEventListener('did-stop-loading', handleStop);
      wv.removeEventListener('page-title-updated', handleTitle);
      wv.removeEventListener('page-favicon-updated', handleFavicon);
      wv.removeEventListener('did-navigate', handleNavigation);
      wv.removeEventListener('did-navigate-in-page', handleNavigation);
      wv.removeEventListener('ipc-message', handleIpcMessage);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate imperatively whenever url prop changes after mount
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !url || url === WELCOME_URL) return;

    try {
      if (isReady.current) {
        const currentWvUrl = wv.getURL ? wv.getURL() : '';
        const normProp = url.replace(/\/$/, "");
        const normCurrent = currentWvUrl.replace(/\/$/, "");
        const normRecorded = lastRecordedUrl.current.replace(/\/$/, "");

        if (normProp === normCurrent || normProp === normRecorded) return;

        wv.loadURL(url).catch(err => {
          if (err.code === '-3') return; 
          console.error('[Aurora-Webview] Nav failed:', err);
        });
      } else {
        pendingUrl.current = url;
      }
    } catch (err) {
      console.error('[Aurora-Webview] Critical navigation error:', err);
    }
  }, [url]);

  return (
    <webview
      ref={wvRef}
      src={initialSrc}
      preload={(preloadPath && preloadPath !== 'fallback' && preloadPath !== 'error') ? `file://${preloadPath}` : undefined}
      className="rcf-webview"
      partition="persist:aurora"
      useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
      allowpopups="true"
      style={{ display: 'flex', width: '100%', height: '100%', background: '#fff', border: 'none' }}
    />
  );
}

// ─── RCF Panel ────────────────────────────────────────────────────
function RCFPanel({ language }) {
  const [activeTab, setActiveTabLocal] = useState('devices');
  const [registers, setRegisters] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [auditKey, setAuditKey] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [selectedReg, setSelectedReg] = useState('0x00');

  const t = i18n[language].rcf;
  const { status, devices, connected, loading, logs, error, scan, connect, disconnect, readRegister, generateAttestation } = useRCF();


  const handleScan = async () => {
    setScanning(true);
    await scan();
    setScanning(false);
  };

  const handleReadReg = async () => {
    const result = await readRegister(selectedReg);
    setRegisters(prev => [result, ...prev.slice(0, 9)]);
  };

  const handleAttestation = async () => {
    if (!auditKey.trim()) return;
    setAuditing(true);
    await generateAttestation(auditKey);
    setAuditing(false);
  };

  const RCF_REG_MAP = {
    '0x00': 'Node Identity (ID)',
    '0x01': 'Firmware Signature',
    '0x02': 'PQC Key State',
    '0x03': 'Sentinel Entropy',
    '0x04': 'Memory Protection',
    '0x05': 'Security Policy',
    '0x06': 'Encryption Level',
    '0x07': 'Last Attestation',
  };

  const tabs = ['devices', 'registers', 'audit', 'logs'];

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <div>
          <h2 className="panel-title">{t.title}</h2>
          <p className="panel-subtitle">
            {connected ? (
              <span style={{ color: 'var(--aurora-green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {connected.name || connected.id}
              </span>
            ) : status?.state || '...'}
          </p>
        </div>
        {connected && (
          <button className="disconnect-btn" onClick={disconnect} title={t.disconnect}>{t.disconnect}</button>
        )}
      </div>

      <div className="panel-tabs">
        {tabs.map(tabKey => (
          <button key={tabKey} className={`panel-tab ${activeTab === tabKey ? 'active' : ''}`} onClick={() => setActiveTabLocal(tabKey)}>
            {t[tabKey] || tabKey}
          </button>
        ))}
      </div>

      {error && <div className="rcf-error">{error}</div>}

      <div className="panel-body">

        {activeTab === 'devices' && (
          <div className="rcf-devices-section">
            <button className="scan-btn" onClick={handleScan} disabled={scanning || loading}>
              {scanning ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg className="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {t.scanning}
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  {t.scan}
                </span>
              )}
            </button>
            <div className="device-list">
              {devices.length === 0 && <p className="empty-hint">{t.empty_devices}</p>}
              {devices.map(dev => (
                <div key={dev.id} className={`device-card glass ${connected?.id === dev.id ? 'connected' : ''}`}>
                  <div className="device-card-header">
                    <span className="device-dot" style={{ background: connected?.id === dev.id ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }} />
                    <span className="device-name">{dev.name}</span>
                    {connected?.id === dev.id
                      ? <span className="device-tag connected-tag">{t.connected}</span>
                      : <button className="connect-btn" onClick={() => connect(dev.id)} disabled={loading}>{t.connect}</button>
                    }
                  </div>
                  <div className="device-info-row">
                    <span>MCU: <code>{dev.mcu}</code></span>
                    <span>FW: <code>{dev.fw}</code></span>
                    <span>Port: <code>{dev.port}</code></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'registers' && (
          <div className="register-section">
            <div className="reg-reader">
              <select value={selectedReg} onChange={e => setSelectedReg(e.target.value)} className="reg-select">
                {Object.entries(RCF_REG_MAP).map(([addr, name]) => (
                  <option key={addr} value={addr}>{addr} — {name}</option>
                ))}
              </select>
              <button className="scan-btn" onClick={handleReadReg}>{t.read_rcf}</button>
            </div>
            <div className="reg-results">
              {registers.length === 0 && <p className="empty-hint">{t.empty_registers}</p>}
              {registers.map((r, i) => r.ok ? (
                <div key={i} className="reg-result glass">
                  <div className="reg-result-header">
                    <code className="reg-addr">{r.register}</code>
                    <span className="reg-name">{r.name}</span>
                    <code className="reg-val">{r.hex}</code>
                  </div>
                  <div className="reg-desc">{r.desc}</div>
                  {r.packet && (
                    <div className="rcf-packet">
                      {Object.entries(r.packet).map(([k, v]) => (
                        <span key={k} className="rcf-field"><span className="rcf-key">{k}</span><span className="rcf-val">{v}</span></span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="reg-result reg-error glass">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 8, color: 'var(--aurora-red)' }}>
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {r.error}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="audit-section">
            <div className="sentinel-dashboard glass">
              <div className="sentinel-header">
                <div className="sentinel-status-group">
                  <div className="sentinel-pulse" data-status={status?.sentinel?.status === 'ACTIVE' ? 'active' : 'idle'} />
                  <span className="sentinel-label">{t.sentinel_title} <strong>{status?.sentinel?.status || 'OFFLINE'}</strong></span>
                </div>
                <div className="sentinel-score">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 6, color: 'var(--aurora-primary)' }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  {status?.sentinel?.securityScore || 0}%
                </div>
              </div>
              <div className="sentinel-metrics">
                <div className="sentinel-metric">
                  <span className="metric-val">{status?.sentinel?.threatsBlocked || 0}</span>
                  <span className="metric-desc">{t.threats_blocked}</span>
                </div>
                <div className="sentinel-metric">
                  <span className="metric-val">{status?.sentinel?.lastThreatTimestamp ? 'OK' : 'SECURE'}</span>
                  <span className="metric-desc">{t.kernel_monitoring}</span>
                </div>
              </div>
            </div>

            <div className="audit-action-section">
              <div className="audit-key-entry glass">
                <div className="audit-key-header">
                  <span>{t.audit_key_label}</span>
                  <a href={CONFIG.KEY_SHOP} target="_blank" rel="noopener noreferrer" className="buy-key-link">Official Key Shop</a>
                </div>
                <input
                  type="password"
                  className="audit-key-input"
                  placeholder={t.audit_key_placeholder}
                  value={auditKey}
                  onChange={(e) => setAuditKey(e.target.value)}
                />
                <div className="audit-key-hint">{t.audit_key_hint}</div>
              </div>

              <button className="audit-btn" onClick={handleAttestation} disabled={auditing || !auditKey.trim()}>
                {auditing ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg className="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    {t.auditing}
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    {t.audit_btn}
                  </span>
                )}
              </button>

              {status?.audit && status.audit.result !== 'NOT_AUDITED' && (
                <div className={`audit-result-card glass ${status.audit.result === 'PASSED' ? 'audit-pass' : 'audit-fail'}`}>
                  <div className="audit-result-header">
                    <span className="audit-indicator">
                      {status.audit.result === 'PASSED' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                    </span>
                    <span className="audit-title">{t.audit_title}: {status.audit.result}</span>
                  </div>
                  <div className="audit-details">
                    <p><strong>{t.audit_version}:</strong> v1.2.0 (Standard OS)</p>
                    <p><strong>{t.audit_signature}:</strong> <code className="pqc-sig">{status.audit.signature}</code></p>
                    <div className="audit-files">
                      {status.audit.details?.map((item, i) => (
                        <div key={i} className="audit-file-row">
                          <span className="file-name">{item.key}</span>
                          <span className="file-hash"><code>{item.value}</code></span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'logs' && (
          <div className="log-section">
            {logs.length === 0 && <p className="empty-hint">{t.empty_logs}</p>}
            {[...logs].reverse().map((l, i) => (
              <div key={i} className="log-line">{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Security Panel ───────────────────────────────────────────────
function SecurityPanel({ language }) {
  const t = i18n[language].security;
  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
          </svg>
        </div>
        <div><h2 className="panel-title">{t.title}</h2><p className="panel-subtitle">{t.subtitle}</p></div>
      </div>
      <div className="shield-visual">
        <div className="shield-score">98</div>
        <div className="shield-label">{t.level}</div>
        <div className="shield-bar-wrap">
          <div className="shield-bar" style={{ '--fill': '98%', background: 'linear-gradient(90deg, var(--aurora-primary), var(--aurora-green))' }} />
        </div>
      </div>
      <div className="threats-list">
        {[
          {
            type: t.trackers, count: 142, icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            )
          },
          {
            type: t.cookies, count: 56, icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z" /><path d="M8.5 8.5v.01" /><path d="M16 15.5v.01" /><path d="M12 12v.01" /><path d="M11 17v.01" /><path d="M7 14v.01" />
              </svg>
            )
          },
          {
            type: t.ssl, count: 28, icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )
          },
        ].map(tInfo => (
          <div key={tInfo.type} className="threat-item glass">
            <span className="threat-icon">{tInfo.icon}</span>
            <span className="threat-type">{tInfo.type}</span>
            <span className="threat-count" style={{ color: 'var(--aurora-primary)' }}>{tInfo.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Aurora Panel ─────────────────────────────────────────────────
function AuroraPanel({ language }) {
  const [activeSection, setActiveSection] = useState('overview');
  const t = i18n[language].aurora;

  const sections = [
    { id: 'overview', label: t.tabs.overview },
    { id: 'security', label: t.tabs.security },
    { id: 'vpn', label: t.tabs.vpn },
    { id: 'protocols', label: t.tabs.protocols },
  ];

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div><h2 className="panel-title">{t.title}</h2><p className="panel-subtitle">{t.subtitle}</p></div>
      </div>
      <div className="panel-tabs">
        {sections.map(s => (
          <button key={s.id} className={`panel-tab ${activeSection === s.id ? 'active' : ''}`} onClick={() => setActiveSection(s.id)}>{s.label}</button>
        ))}
      </div>
      <div className="panel-body">
        {activeSection === 'overview' && (
          <div className="metric-grid">
            {[
              { label: t.network_status, value: t.active, color: 'var(--aurora-green)', unit: '' },
              { label: t.latency, value: '12', color: 'var(--aurora-primary)', unit: 'ms' },
              { label: t.traffic, value: '2.4', color: 'var(--aurora-accent)', unit: 'GB' },
              { label: t.protection, value: '100', color: 'var(--aurora-green)', unit: '%' },
            ].map(m => (
              <div key={m.label} className="metric-card glass">
                <span className="metric-value" style={{ color: m.color }}>{m.value}<small>{m.unit}</small></span>
                <span className="metric-label">{m.label}</span>
              </div>
            ))}
          </div>
        )}
        {activeSection === 'security' && (
          <div className="security-list">
            {[
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ), label: t.tls, status: t.active
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ), label: t.tracker_block, status: t.active
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /><circle cx="12" cy="16" r="1" />
                  </svg>
                ), label: 'RCF-PL Protocol v1.2.8', status: 'OK'
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                  </svg>
                ), label: t.dns_over_https, status: t.active
              },
            ].map(item => (
              <div key={item.label} className="security-item glass">
                <span className="security-icon">{item.icon}</span>
                <span className="security-label">{item.label}</span>
                <span className="security-status">{item.status}</span>
              </div>
            ))}
          </div>
        )}
        {activeSection === 'vpn' && (
          <div className="vpn-panel">
            <div className="vpn-status-card glass">
              <div className="vpn-indicator active" />
              <div><div className="vpn-server">Aurora Gateway #1</div><div className="vpn-location">Frankfurt, DE · 12ms</div></div>
              <button className="vpn-toggle connected">{t.vpn_disconnect}</button>
            </div>
            <div className="vpn-servers-list">
              {['Frankfurt, DE', 'Amsterdam, NL', 'Tokyo, JP', 'New York, US'].map(loc => (
                <div key={loc} className="vpn-server-item glass">
                  <span className="vpn-dot" style={{ background: loc === 'Frankfurt, DE' ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }} />
                  <span>{loc}</span>
                  <span className="vpn-ping">{Math.floor(Math.random() * 50 + 10)}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeSection === 'protocols' && (
          <div className="protocol-list">
            {[
              { name: 'RCF-PL v1.2.8', desc: 'Restricted Correlation Framework', active: true },
              { name: 'HTTPS/3', desc: 'HTTP over QUIC', active: true },
              { name: 'Aurora P2P', desc: 'Peer-to-peer tunneling', active: false },
            ].map(p => (
              <div key={p.name} className="protocol-item glass">
                <div className="protocol-dot-indicator" style={{ background: p.active ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }} />
                <div><div className="protocol-name">{p.name}</div><div className="protocol-desc">{p.desc}</div></div>
                <span className="protocol-badge-status" style={{ color: p.active ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }}>{p.active ? t.active : t.disabled}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function P2PPanel({ language }) {
  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <path d="M17 2.1a9 9 0 0 1 0 13.9M13 11.6l-3-3-3 3M10 8.6v9M3 21h18" />
          </svg>
        </div>
        <div><h2 className="panel-title">P2P Exchange</h2><p className="panel-subtitle">PremiumAzerbaijan</p></div>
      </div>
      <div className="p2p-rates">
        {[
          { pair: 'TON / AZN', rate: '4.92', change: '+0.3%', up: true },
          { pair: 'USDT / AZN', rate: '1.71', change: '+0.1%', up: true },
          { pair: 'BTC / USDT', rate: '67,840', change: '-0.8%', up: false },
        ].map(r => (
          <div key={r.pair} className="rate-card glass">
            <span className="rate-pair">{r.pair}</span>
            <span className="rate-value">{r.rate}</span>
            <span className="rate-change" style={{ color: r.up ? 'var(--aurora-green)' : 'var(--aurora-red)' }}>{r.change}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({ language, onNavigate }) {
  const [entries, setEntries] = useState([]);
  const t = i18n[language].history;

  const load = useCallback(async () => {
    const data = await window.electronAPI.history.get();
    setEntries(data || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = async () => {
    if (confirm(t.clear_confirm || 'Clear all history?')) {
      await window.electronAPI.history.clear();
      load();
    }
  };

  const getFavicon = (url) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch {
      return null;
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h2 className="panel-title">{t.title}</h2>
          <p className="panel-subtitle">{t.subtitle}</p>
        </div>
        {entries.length > 0 && (
          <button className="history-clear-btn" onClick={handleClear}>
            {t.clear || 'Clear All'}
          </button>
        )}
      </div>
      <div className="history-list">
        {entries.length === 0 && <p className="empty-hint">{t.empty}</p>}
        {entries.map((entry, i) => (
          <button 
            key={`${entry.timestamp}-${i}`} 
            className="history-item" 
            onClick={() => onNavigate(entry.url)}
          >
            <div className="history-favicon">
              <img src={getFavicon(entry.url)} alt="" onError={(e) => e.target.style.display='none'} />
            </div>
            <div className="history-info">
              <div className="history-title">{entry.title || t.no_title}</div>
              <div className="history-url">{entry.url}</div>
            </div>
            <div className="history-time">
              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function VaultPanel({ language, onNavigate, vaultUnlocked, vaultSetup, onVaultUnlock, onVaultSetup, onVaultLock }) {
  const [logins, setLogins] = useState([]);
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editForm, setEditForm] = useState({ url: '', user: '', pass: '' });
  const [showPass, setShowPass] = useState(false);
  const [masterPass, setMasterPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [lockError, setLockError] = useState('');
  const t = i18n[language].vault;

  const load = useCallback(async () => {
    if (!vaultUnlocked) return;
    const data = await window.electronAPI.vault.get();
    setLogins(data || []);
  }, [vaultUnlocked]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSetup = async () => {
    setLockError('');
    if (masterPass.length < 4) { setLockError(t.password_too_short); return; }
    if (masterPass !== confirmPass) { setLockError(t.passwords_dont_match); return; }
    const res = await onVaultSetup(masterPass);
    if (!res.ok) setLockError(res.error);
    setMasterPass(''); setConfirmPass('');
  };

  const handleUnlock = async () => {
    setLockError('');
    const res = await onVaultUnlock(masterPass);
    if (!res.ok) setLockError(t.wrong_password);
    setMasterPass('');
  };

  if (!vaultUnlocked) {
    return (
      <div className="panel-page">
        <div className="vault-lock-screen glass">
          <div className="vault-lock-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="vault-lock-title">{vaultSetup ? t.unlock : t.create_master}</h2>
          <p className="vault-lock-subtitle">{vaultSetup ? t.unlock_subtitle : t.create_subtitle}</p>

          <div className="vault-lock-form">
            <input
              className="vault-input"
              type="password"
              placeholder={t.master_password}
              value={masterPass}
              onChange={e => { setMasterPass(e.target.value); setLockError(''); }}
              onKeyDown={e => e.key === 'Enter' && (vaultSetup ? handleUnlock() : null)}
              autoFocus
            />
            {!vaultSetup && (
              <input
                className="vault-input"
                type="password"
                placeholder={t.confirm_password}
                value={confirmPass}
                onChange={e => { setConfirmPass(e.target.value); setLockError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSetup()}
              />
            )}
            {lockError && <div className="vault-lock-error">{lockError}</div>}
            <button
              className="vault-lock-btn"
              onClick={vaultSetup ? handleUnlock : handleSetup}
            >
              {vaultSetup ? t.unlock : t.create_master}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const getFavicon = (url) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch {
      return null;
    }
  };

  const handleCopy = async (url, username, type) => {
    if (type === 'pass') {
      const pass = await window.electronAPI.vault.getPassword(url, username);
      if (pass) {
        navigator.clipboard.writeText(pass);
        alert(t.copied_pass || 'Password copied to clipboard');
      }
    } else {
      navigator.clipboard.writeText(username);
      alert(t.copied_user || 'Username copied to clipboard');
    }
  };

  const startEdit = async (login, idx) => {
    const pass = await window.electronAPI.vault.getPassword(login.url, login.username);
    setEditForm({ url: login.url, user: login.username, pass: pass || '' });
    setEditingIdx(idx);
    setShowPass(false);
  };

  const saveEdit = async (idx) => {
    const old = logins[idx];
    const res = await window.electronAPI.vault.update(old.url, old.username, editForm.url, editForm.user, editForm.pass);
    if (res.ok) {
      setEditingIdx(-1);
      load();
    } else {
      alert('Update failed: ' + res.error);
    }
  };

  const handleDelete = async (url, user) => {
    if (confirm(t.confirm_delete || 'Are you sure you want to delete this login?')) {
      await window.electronAPI.vault.delete(url, user);
      load();
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div>
          <h2 className="panel-title">{t.title}</h2>
          <p className="panel-subtitle">{t.subtitle}</p>
        </div>
        <button className="vault-lock-header-btn" onClick={onVaultLock} title={t.lock}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {t.lock}
        </button>
      </div>
      <div className="vault-list ">
        {logins.length === 0 && <p className="empty-hint">{t.empty}</p>}
        {logins.map((login, i) => (
          <div key={i} className={`vault-item glass ${editingIdx === i ? 'editing' : ''}`}>
            {editingIdx === i ? (
              <div className="vault-edit-form">
                <div className="vault-input-group">
                  <label className="vault-input-label">URL</label>
                  <input 
                    className="vault-input" 
                    value={editForm.url} 
                    onChange={e => setEditForm({...editForm, url: e.target.value})} 
                  />
                </div>
                <div className="vault-input-group">
                  <label className="vault-input-label">Username</label>
                  <input 
                    className="vault-input" 
                    value={editForm.user} 
                    onChange={e => setEditForm({...editForm, user: e.target.value})} 
                  />
                </div>
                <div className="vault-input-group">
                  <label className="vault-input-label">Password</label>
                  <div style={{ position: 'relative' }}>
                    <input 
                      className="vault-input" 
                      type={showPass ? 'text' : 'password'}
                      value={editForm.pass} 
                      onChange={e => setEditForm({...editForm, pass: e.target.value})} 
                      style={{ paddingRight: '40px', width: '100%' }}
                    />
                    <button 
                      className="vault-pass-toggle" 
                      onClick={() => setShowPass(!showPass)}
                      title={showPass ? 'Hide' : 'Show'}
                    >
                      {showPass ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="vault-edit-actions">
                  <button className="vault-edit-btn cancel" onClick={() => setEditingIdx(-1)}>Cancel</button>
                  <button className="vault-edit-btn save" onClick={() => saveEdit(i)}>Save Changes</button>
                </div>
              </div>
            ) : (
              <>
                <div className="vault-site-info" onClick={() => onNavigate(login.url)} style={{ cursor: 'pointer' }}>
                  <div className="vault-favicon">
                    <img src={getFavicon(login.url)} alt="" onError={(e) => e.target.style.display='none'} />
                  </div>
                  <div className="vault-details">
                    <div className="vault-url">{(() => { try { return new URL(login.url).hostname } catch(e) { return login.url } })()}</div>
                    <div className="vault-user">{login.username}</div>
                  </div>
                </div>
                <div className="vault-actions">
                  <button className="vault-btn secondary" onClick={() => startEdit(login, i)} title="Edit">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button className="vault-btn secondary" onClick={() => handleCopy(login.url, login.username, 'user')} title={t.copy_user}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </button>
                  <button className="vault-btn primary" onClick={() => handleCopy(login.url, login.username, 'pass')} title={t.copy_pass}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </button>
                  <button className="vault-btn secondary delete" onClick={() => handleDelete(login.url, login.username)} title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Panel with RCF License ─────────────────────────────
const openExternal = (url) => {
  // In Electron use shell.openExternal, otherwise window.open
  if (window.electronAPI?.shell?.openExternal) {
    window.electronAPI.shell.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
};

function SettingsPanel({ language, appearance, setAppearance }) {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.license;

  // License state
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateResult, setActivateResult] = useState(null);

  // Settings state
  const [activeSection, setActiveSection] = useState('license');

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.license.status().then(setLicenseStatus);
  }, [isElectron]);

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    setActivating(true);
    setActivateResult(null);
    try {
      const result = await window.electronAPI.license.activate(
        keyInput.trim(), nameInput.trim() || 'User', ''
      );
      setActivateResult(result);
      if (result.ok) {
        setLicenseStatus(result);
        setKeyInput('');
      }
    } catch (e) {
      setActivateResult({ ok: false, error: e.message });
    } finally {
      setActivating(false);
    }
  };

  const navItems = [
    {
      id: 'license', label: 'RCF License', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ marginRight: 8 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )
    },
    {
      id: 'general', label: 'Общие', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ marginRight: 8 }}>
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    },
    {
      id: 'appearance', label: 'Внешний вид', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ marginRight: 8 }}>
          <circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.688-1.688h1.906c3.107 0 5.625-2.518 5.625-5.625 0-5.062-4.313-9.563-10-8.75z" />
        </svg>
      )
    },
    {
      id: 'security', label: 'Безопасность', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ marginRight: 8 }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )
    },
    {
      id: 'about', label: 'О программе', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ marginRight: 8 }}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
    },
  ];

  const tierColor = licenseStatus?.ok
    ? (licenseStatus.tier === 'ADMIN' ? '#fbbf24' : 'var(--aurora-green)')
    : 'var(--aurora-text-muted)';

  return (
    <div className="settings-page">
      <div className="settings-sidebar glass">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`settings-nav-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => setActiveSection(item.id)}
          >
            <span className="settings-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-content glass">
        {/* ── RCF LICENSE ── */}
        {activeSection === 'license' && (
          <div className="settings-section">
            <h2 className="settings-title">RCF Audit License</h2>
            <p style={{ color: 'var(--aurora-text-muted)', fontSize: 13, marginBottom: 20 }}>
              Введите ключ купленный на{' '}
              <a href="#" onClick={e => { e.preventDefault(); openExternal(CONFIG.KEY_SHOP); }}
                style={{ color: 'var(--aurora-primary)' }}>
                rcf.aliyev.site
              </a>
              {' '}(через Lemon Squeezy). Ключ сохраняется локально и никогда не попадает в репозиторий.
            </p>

            {/* Current status card */}
            <div className="glass" style={{ padding: '16px 20px', borderRadius: 12, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: tierColor, boxShadow: `0 0 8px ${tierColor}`, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {!isElectron ? (
                  <span style={{ color: 'var(--aurora-text-muted)', fontSize: 13 }}>Доступно только в Electron-режиме</span>
                ) : licenseStatus ? (
                  <>
                    <div style={{ fontWeight: 600, color: tierColor }}>
                      {licenseStatus.ok ? `✓ Активен — ${licenseStatus.tier}` : `✗ ${licenseStatus.status}`}
                    </div>
                    {licenseStatus.ok && (
                      <div style={{ fontSize: 12, color: 'var(--aurora-text-muted)', marginTop: 4 }}>
                        Кому: {licenseStatus.issuedTo} &nbsp;·&nbsp; Истекает: {licenseStatus.expires}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--aurora-text-muted)', fontSize: 13 }}>Проверка статуса…</span>
                )}
              </div>
              {licenseStatus && !licenseStatus.ok && (
                <a
                  href="#"
                  onClick={e => { e.preventDefault(); openExternal(CONFIG.KEY_SHOP_BUY); }}
                  style={{
                    background: 'linear-gradient(135deg, var(--aurora-primary), var(--aurora-accent))',
                    color: '#000',
                    padding: '8px 18px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 0 12px rgba(0,212,255,0.4)',
                  }}
                >
                  🛒 Купить ключ
                </a>
              )}
            </div>

            {/* Key activation form */}
            {isElectron && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="settings-group">
                  <label className="settings-label">Лицензионный ключ</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="RCF-AUDIT-XXXX-XXXX"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
                  />
                </div>
                <div className="settings-group">
                  <label className="settings-label">Ваше имя (опционально)</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="Например: Aladdin"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleActivate}
                  disabled={activating || !keyInput.trim()}
                  style={{
                    background: activating ? 'var(--aurora-glass)' : 'var(--aurora-primary)',
                    color: activating ? 'var(--aurora-text-muted)' : '#000',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 24px',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: activating ? 'not-allowed' : 'pointer',
                    alignSelf: 'flex-start',
                    transition: 'all 0.2s',
                  }}
                >
                  {activating ? '⟳ Активация…' : '⚡ Активировать'}
                </button>

                {activateResult && (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    background: activateResult.ok ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${activateResult.ok ? 'var(--aurora-green)' : 'var(--aurora-red)'}`,
                    color: activateResult.ok ? 'var(--aurora-green)' : 'var(--aurora-red)',
                    fontSize: 13,
                  }}>
                    {activateResult.ok
                      ? `✓ Ключ активирован! Тир: ${activateResult.tier} · Кому: ${activateResult.issuedTo}`
                      : `✗ Ошибка: ${activateResult.error || activateResult.status}`
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeSection === 'general' && (
          <div className="settings-section">
            <h2 className="settings-title">Общие настройки</h2>
            <div className="settings-group">
              <label className="settings-label">Домашняя страница</label>
              <input type="text" className="settings-input" defaultValue="aurora://welcome" />
            </div>
            <div className="settings-group">
              <label className="settings-label">Поисковая система</label>
              <select className="settings-select">
                <option>Google (Default)</option>
                <option>DuckDuckGo</option>
                <option>Bing</option>
              </select>
            </div>
          </div>
        )}

        {activeSection === 'appearance' && (
          <div className="settings-section">
            <h2 className="settings-title">Внешний вид</h2>
            
            <div className="settings-group">
              <label className="settings-label">Тема оформления</label>
              <div className="theme-grid">
                {[
                  { id: 'aurora', label: 'Aurora', color: '#00d4ff' },
                  { id: 'nebula', label: 'Nebula', color: '#ff00d4' },
                  { id: 'stealth', label: 'Stealth', color: '#ffffff' },
                  { id: 'matrix', label: 'Matrix', color: '#00ff41' },
                ].map(t => (
                  <button 
                    key={t.id} 
                    className={`theme-card glass ${appearance.theme === t.id ? 'active' : ''}`}
                    onClick={() => setAppearance({ ...appearance, theme: t.id })}
                  >
                    <div className="theme-preview" style={{ background: t.color }} />
                    <span className="theme-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <label className="settings-label">Эффект стекла (Размытие: {appearance.blur}px)</label>
              <input 
                type="range" min="0" max="40" step="1" 
                className="settings-slider"
                value={appearance.blur}
                onChange={e => setAppearance({ ...appearance, blur: parseInt(e.target.value) })}
              />
            </div>

            <div className="settings-group">
              <label className="settings-label">Прозрачность панелей ({Math.round(appearance.opacity * 100)}%)</label>
              <input 
                type="range" min="0.1" max="0.9" step="0.05" 
                className="settings-slider"
                value={appearance.opacity}
                onChange={e => setAppearance({ ...appearance, opacity: parseFloat(e.target.value) })}
              />
            </div>

            <div className="settings-group">
              <div className="settings-toggle-row" onClick={() => setAppearance({ ...appearance, animate: !appearance.animate })}>
                <div className="settings-label" style={{ margin: 0 }}>Анимация «Пульсация»</div>
                <div className={`settings-toggle ${appearance.animate ? 'active' : ''}`} />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'security' && (
          <div className="settings-section">
            <h2 className="settings-title">Безопасность</h2>
            {[
              { label: 'Aurora Shield', desc: 'Защита от фишинга на уровне RCF' },
              { label: 'Строгий HTTPS', desc: 'Блокировать незащищённые соединения' },
            ].map(item => (
              <div key={item.label} className="settings-group-row">
                <div>
                  <div className="settings-label">{item.label}</div>
                  <div className="settings-desc">{item.desc}</div>
                </div>
                <input type="checkbox" className="settings-checkbox" defaultChecked />
              </div>
            ))}
          </div>
        )}

        {activeSection === 'about' && (
          <div className="settings-section about-section">
            <div className="about-logo">✦</div>
            <h2 className="settings-title">Aurora Access Browser</h2>
            <p className="about-version">Версия {CONFIG.VERSION}</p>
            <p className="about-desc">
              Специализированный браузер экосистемы Aurora Access.
              Защищён протоколом RCF-PL v1.2.8.
            </p>
            <div style={{ marginTop: 16 }}>
              <a href="#" onClick={e => { e.preventDefault(); openExternal(CONFIG.KEY_SHOP); }}
                style={{ color: 'var(--aurora-primary)', fontSize: 13 }}>
                rcf.aliyev.site
              </a>
            </div>
            <div className="about-copyright">© 2026 Aurora Access Ecosystem. All rights reserved.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────
export default function MainContent({
  tabs, activeTab, panel, onNavigate, onLoadStart, onLoadStop,
  onTitleUpdate, onUrlUpdate, onFaviconUpdate, language, webviewRef,
  onVaultCapture, appearance, setAppearance,
  vaultUnlocked, vaultSetup, onVaultUnlock, onVaultSetup, onVaultLock
}) {
  const webviewRefsMap = useRef({});
  const [preloadPath, setPreloadPath] = useState('');

  // Fetch the absolute path for the webview preload script with fallback timeout
  useEffect(() => {
    let mounted = true;
    
    const timeout = setTimeout(() => {
      if (mounted && !preloadPath) {
        console.warn('[Aurora-Suite] Preload fetch timeout. Using fallback.');
        setPreloadPath('fallback'); // This will trigger the webview rendering even if IPC is slow
      }
    }, 1500);

    const fetchPath = async () => {
      try {
        const path = await window.electronAPI.getWebviewPreload();
        if (mounted) {
          console.log('[Aurora-Suite] Webview Preload Active:', path);
          setPreloadPath(path);
          clearTimeout(timeout);
        }
      } catch (err) {
        console.error('[Aurora-Suite] Failed to fetch preload path:', err);
        if (mounted) setPreloadPath('error');
      }
    };
    
    fetchPath();
    return () => { mounted = false; clearTimeout(timeout); };
  }, []);

  // Robust Electron detection
  const [isElectron, setIsElectron] = useState(typeof window !== 'undefined' && !!window.electronAPI?.isElectron);

  useEffect(() => {
    if (!isElectron && window.electronAPI?.isElectron) {
      console.log('[Aurora-Core] Electron API detected after mount');
      setIsElectron(true);
    }
  }, [isElectron]);

  // Sync parent's webviewRef with the active tab's webviewRef
  useEffect(() => {
    const activeRef = webviewRefsMap.current[tabs[activeTab]?.id];
    if (activeRef) {
      webviewRef.current = activeRef;
    } else {
      webviewRef.current = null;
    }
  }, [activeTab, tabs, webviewRef]);

  return (
    <main className={`main-content theme-${appearance.theme} ${appearance.animate ? 'pulse-animation' : ''}`}>
      {tabs.map((tab, idx) => {
        const isActive = idx === activeTab;
        const url = tab.url;
        const isWelcome = !url || url === WELCOME_URL;
        
        // Determine if it's an internal panel or a browser view
        let effectivePanel = isActive ? panel : null; // Props.panel is only for the active tab context generally
        if (url?.startsWith('aurora://')) {
          effectivePanel = url.replace('aurora://', '');
        }

        // We only render internal panels for the active tab (to simplify state management),
        // but webviews must be persistent to avoid reloads.
        // Actually, let's render everything persistently if it's been initialized.
        
        return (
          <div 
            key={tab.id} 
            className={`tab-container ${isActive ? 'active' : 'hidden'}`}
          >
            {isWelcome ? (
              <WelcomePage onNavigate={onNavigate} language={language} />
            ) : effectivePanel && effectivePanel !== 'browser' ? (
              <div className="panel-wrapper" style={{ height: '100%', width: '100%', overflow: 'auto' }}>
                {(() => {
                  switch (effectivePanel) {
                    case 'aurora': return <AuroraPanel language={language} />;
                    case 'security': return <SecurityPanel language={language} />;
                    case 'rcf': return <RCFPanel language={language} />;
                    case 'p2p': return <P2PPanel language={language} />;
                    case 'history': return <HistoryPanel language={language} onNavigate={onNavigate} />;
                    case 'vault': return <VaultPanel language={language} onNavigate={onNavigate} vaultUnlocked={vaultUnlocked} vaultSetup={vaultSetup} onVaultUnlock={onVaultUnlock} onVaultSetup={onVaultSetup} onVaultLock={onVaultLock} />;
                    case 'settings': return <SettingsPanel language={language} appearance={appearance} setAppearance={setAppearance} />;
                    default: return <div>Unknown Panel: {effectivePanel}</div>;
                  }
                })()}
              </div>
            ) : isElectron ? (
              <div className="webview-wrapper">
                {preloadPath ? (
                  <ElectronWebview
                    url={url}
                    preloadPath={preloadPath}
                    onLoadStart={onLoadStart}
                    onLoadStop={onLoadStop}
                    onTitleChange={(title) => onTitleUpdate(title, tab.id)}
                    onUrlUpdate={(newUrl) => onUrlUpdate(newUrl, tab.id)}
                    onFaviconUpdate={(favicon) => onFaviconUpdate(favicon, tab.id)}
                    onRef={(ref) => {
                      webviewRefsMap.current[tab.id] = ref;
                      // If this is the active tab, sync immediately
                      if (isActive) webviewRef.current = ref;
                    }}
                  />
                ) : (
                  <div className="webview-placeholder glass">
                    <div className="spinner-aurora"></div>
                    <strong>Securing Connection...</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="webview-container">
                <div className="webview-notice glass">
                  <span className="notice-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 48, height: 48, color: 'var(--aurora-primary)' }}>
                      <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </span>
                  <div>
                    <strong>Webview Restricted</strong>
                    <p style={{ color: 'var(--aurora-text-muted)', marginTop: 4, fontSize: 12 }}>{url}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}

export { WELCOME_URL };
