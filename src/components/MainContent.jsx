import React, { useState, useRef, useEffect, useCallback } from 'react';
import './MainContent.css';
import { useRCF } from '../hooks/useRCF.js';

const WELCOME_URL = '__welcome__';

// ─── Welcome Page ─────────────────────────────────────────────────
function WelcomePage({ onNavigate }) {
  const quickLinks = [
    { label: 'Aurora Access', url: 'rcf://dashboard', icon: '⚡' },
    { label: 'RCF Flash Tool', url: 'rcf://flash', icon: '🔧' },
    { label: 'P2P Exchange',   url: 'https://t.me/PremiumAzBot', icon: '💱' },
    { label: 'AladdinAI',     url: 'https://aliyev.site', icon: '🌐' },
    { label: 'GitHub',         url: 'https://github.com', icon: '🐙' },
    { label: 'Telegram',       url: 'https://t.me', icon: '✈️' },
  ];

  return (
    <div className="welcome-page">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg viewBox="0 0 80 80" fill="none">
            <defs>
              <linearGradient id="welcomeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(195,100%,55%)" />
                <stop offset="100%" stopColor="hsl(270,80%,65%)" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <circle cx="40" cy="40" r="36" stroke="url(#welcomeGrad)" strokeWidth="2" fill="none" filter="url(#glow)"/>
            <path d="M22 52 L40 20 L58 52" stroke="url(#welcomeGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" filter="url(#glow)"/>
            <path d="M27 40h26" stroke="url(#welcomeGrad)" strokeWidth="2.4" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="welcome-title">Aurora Access Browser</h1>
        <p className="welcome-subtitle">Защищённый браузер экосистемы Aurora Access</p>

        <div className="welcome-search">
          <span className="welcome-search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input
            type="text"
            placeholder="Поиск или адрес…"
            className="welcome-search-input"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                const q = e.target.value.trim();
                if (q.startsWith('rcf://') || q.startsWith('aurora://')) { onNavigate(q); return; }
                onNavigate(q.includes('.') ? `https://${q}` : `https://www.google.com/search?q=${encodeURIComponent(q)}`);
              }
            }}
          />
        </div>

        <div className="quick-links">
          {quickLinks.map(link => (
            <button key={link.url} className="quick-link" onClick={() => onNavigate(link.url)}>
              <span className="quick-link-icon">{link.icon}</span>
              <span className="quick-link-label">{link.label}</span>
            </button>
          ))}
        </div>

        <div className="welcome-stats">
          <div className="stat-item"><span className="stat-value" style={{color:'var(--aurora-green)'}}>●</span><span>Aurora Network активен</span></div>
          <div className="stat-item"><span className="stat-value" style={{color:'var(--aurora-primary)'}}>RCF-PL v1.2.8</span><span>протокол готов</span></div>
          <div className="stat-item"><span className="stat-value" style={{color:'var(--aurora-accent)'}}>256-bit</span><span>шифрование</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Real Webview (Electron only) ─────────────────────────────────
function ElectronWebview({ url, onLoadStart, onLoadStop, onTitleChange, onRef }) {
  const wvRef = useRef(null);
  const isReady = useRef(false);
  const pendingUrl = useRef(url);

  // Forward the ref to the parent
  useEffect(() => {
    console.log('[Aurora-Webview] Mounting... url:', url);
    if (onRef) {
      if (typeof onRef === 'function') onRef(wvRef);
      else onRef.current = wvRef;
    }
  }, [onRef, url]);

  // Attach all event listeners once on mount
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;

    const handleStart = () => { console.log('[Aurora-Webview] Start Loading'); onLoadStart?.(); };
    const handleStop  = () => { console.log('[Aurora-Webview] Stop Loading'); onLoadStop?.(); };
    const handleTitle = (e) => onTitleChange?.(e.title);
    const handleReady = () => {
      console.log('[Aurora-Webview] DOM Ready');
      isReady.current = true;
      if (pendingUrl.current) {
        wv.loadURL(pendingUrl.current).catch(err => console.error('[Aurora-Webview] Load failed:', err));
        pendingUrl.current = null;
      }
    };

    wv.addEventListener('dom-ready',          handleReady);
    wv.addEventListener('did-start-loading',  handleStart);
    wv.addEventListener('did-stop-loading',   handleStop);
    wv.addEventListener('page-title-updated', handleTitle);

    return () => {
      wv.removeEventListener('dom-ready',          handleReady);
      wv.removeEventListener('did-start-loading',  handleStart);
      wv.removeEventListener('did-stop-loading',   handleStop);
      wv.removeEventListener('page-title-updated', handleTitle);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate imperatively whenever url prop changes after mount
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !url || url === WELCOME_URL) return;
    
    console.log('[Aurora-Webview] URL Change detected:', url);
    if (isReady.current) {
      wv.loadURL(url).catch(err => console.error('[Aurora-Webview] Nav failed:', err));
    } else {
      pendingUrl.current = url;
    }
  }, [url]);

  return (
    <webview
      ref={wvRef}
      src={url}
      className="rcf-webview"
      partition="persist:aurora"
      useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Aurora/1.0"
      allowpopups="true"
      style={{ display: 'flex', width: '100%', height: '100%', background: '#fff', border: '2px solid var(--aurora-primary)' }}
    />
  );
}

// ─── RCF Panel ────────────────────────────────────────────────────
function RCFPanel() {
  const { status, devices, connected, loading, flashProgress, logs, error, scan, connect, disconnect, readRegister } = useRCF();
  const [activeTab, setActiveTabLocal] = useState('devices');
  const [registers, setRegisters] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [selectedReg, setSelectedReg] = useState('0x00');

  const handleScan = async () => {
    setScanning(true);
    await scan();
    setScanning(false);
  };

  const handleReadReg = async () => {
    const result = await readRegister(selectedReg);
    setRegisters(prev => [result, ...prev.slice(0, 9)]);
  };

  const tabs = ['devices', 'registers', 'logs'];

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">🔧</div>
        <div>
          <h2 className="panel-title">RCF Firmware</h2>
          <p className="panel-subtitle">
            {connected ? `✅ ${connected.name || connected.id}` : status?.state || 'Инициализация…'}
          </p>
        </div>
        {connected && (
          <button className="disconnect-btn" onClick={disconnect} title="Отключиться">Отключить</button>
        )}
      </div>

      <div className="panel-tabs">
        {tabs.map(t => (
          <button key={t} className={`panel-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTabLocal(t)}>
            {t === 'devices' ? 'Устройства' : t === 'registers' ? 'Регистры RCF' : 'Логи'}
          </button>
        ))}
      </div>

      {error && <div className="rcf-error">{error}</div>}

      <div className="panel-body">

        {activeTab === 'devices' && (
          <div className="rcf-devices-section">
            <button className="scan-btn" onClick={handleScan} disabled={scanning || loading}>
              {scanning ? '⟳ Сканирую…' : '⚡ Сканировать устройства'}
            </button>
            <div className="device-list">
              {devices.length === 0 && <p className="empty-hint">Нажмите «Сканировать» для поиска RCF устройств</p>}
              {devices.map(dev => (
                <div key={dev.id} className={`device-card glass ${connected?.id === dev.id ? 'connected' : ''}`}>
                  <div className="device-card-header">
                    <span className="device-dot" style={{ background: connected?.id === dev.id ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }} />
                    <span className="device-name">{dev.name}</span>
                    {connected?.id === dev.id
                      ? <span className="device-tag connected-tag">CONNECTED</span>
                      : <button className="connect-btn" onClick={() => connect(dev.id)} disabled={loading}>Подключить</button>
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
                {['0x00','0x01','0x02','0x03','0x04','0x05','0x06','0x07'].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button className="scan-btn" onClick={handleReadReg}>Читать RCF</button>
            </div>
            <div className="reg-results">
              {registers.length === 0 && <p className="empty-hint">Выберите регистр и нажмите «Читать RCF»</p>}
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
                      {Object.entries(r.packet).map(([k,v]) => (
                        <span key={k} className="rcf-field"><span className="rcf-key">{k}</span><span className="rcf-val">{v}</span></span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="reg-result reg-error glass">❌ {r.error}</div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="log-section">
            {logs.length === 0 && <p className="empty-hint">Логи появятся при подключении устройства</p>}
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
function SecurityPanel() {
  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">🛡️</div>
        <div><h2 className="panel-title">Защита</h2><p className="panel-subtitle">Мониторинг безопасности</p></div>
      </div>
      <div className="shield-visual">
        <div className="shield-score">98</div>
        <div className="shield-label">Уровень защиты</div>
        <div className="shield-bar-wrap">
          <div className="shield-bar" style={{ '--fill': '98%', background: 'linear-gradient(90deg, var(--aurora-primary), var(--aurora-green))' }} />
        </div>
      </div>
      <div className="threats-list">
        {[
          { type: 'Трекеры заблокированы', count: 142, icon: '🚫' },
          { type: 'Cookies очищены',        count: 56,  icon: '🍪' },
          { type: 'SSL соединений',         count: 28,  icon: '🔒' },
        ].map(t => (
          <div key={t.type} className="threat-item glass">
            <span className="threat-icon">{t.icon}</span>
            <span className="threat-type">{t.type}</span>
            <span className="threat-count" style={{ color: 'var(--aurora-primary)' }}>{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Aurora Panel ─────────────────────────────────────────────────
function AuroraPanel() {
  const [activeSection, setActiveSection] = useState('overview');
  const sections = [
    { id: 'overview', label: 'Обзор' },
    { id: 'security', label: 'Безопасность' },
    { id: 'vpn', label: 'VPN' },
    { id: 'protocols', label: 'Протоколы' },
  ];

  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">⚡</div>
        <div><h2 className="panel-title">Aurora Access</h2><p className="panel-subtitle">Управление экосистемой</p></div>
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
              { label: 'Статус сети', value: 'ACTIVE',  color: 'var(--aurora-green)',   unit: '' },
              { label: 'Задержка',    value: '12',       color: 'var(--aurora-primary)', unit: 'ms' },
              { label: 'Трафик',      value: '2.4',      color: 'var(--aurora-accent)',  unit: 'GB' },
              { label: 'Защита',      value: '100',      color: 'var(--aurora-green)',   unit: '%' },
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
              { icon: '🔒', label: 'TLS 1.3', status: 'Активно' },
              { icon: '🛡️', label: 'Блокировка трекеров', status: 'Защищено' },
              { icon: '🔐', label: 'RCF-PL Протокол v1.2.8', status: 'OK' },
              { icon: '🌐', label: 'DNS over HTTPS', status: 'Включено' },
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
              <button className="vpn-toggle connected">Отключить</button>
            </div>
            <div className="vpn-servers-list">
              {['Frankfurt, DE','Amsterdam, NL','Tokyo, JP','New York, US'].map(loc => (
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
              { name: 'RCF-PL v1.2.8',   desc: 'Restricted Correlation Framework', active: true },
              { name: 'HTTPS/3',    desc: 'HTTP over QUIC',                  active: true },
              { name: 'Aurora P2P', desc: 'Peer-to-peer tunneling',          active: false },
            ].map(p => (
              <div key={p.name} className="protocol-item glass">
                <div className="protocol-dot-indicator" style={{ background: p.active ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }} />
                <div><div className="protocol-name">{p.name}</div><div className="protocol-desc">{p.desc}</div></div>
                <span className="protocol-badge-status" style={{ color: p.active ? 'var(--aurora-green)' : 'var(--aurora-text-muted)' }}>{p.active ? 'Активен' : 'Отключён'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function P2PPanel() {
  return (
    <div className="panel-page">
      <div className="panel-header">
        <div className="panel-header-icon">💱</div>
        <div><h2 className="panel-title">P2P Exchange</h2><p className="panel-subtitle">PremiumAzerbaijan</p></div>
      </div>
      <div className="p2p-rates">
        {[
          { pair: 'TON / AZN',    rate: '4.92',   change: '+0.3%', up: true },
          { pair: 'USDT / AZN',   rate: '1.71',   change: '+0.1%', up: true },
          { pair: 'BTC / USDT',   rate: '67,840', change: '-0.8%', up: false },
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

function SettingsPanel() {
  const [activeCategory, setActiveCategory] = useState('general');

  const categories = [
    { id: 'general',    label: 'Общие',      icon: '⚙️' },
    { id: 'appearance', label: 'Внешний вид', icon: '🎨' },
    { id: 'security',   label: 'Безопасность', icon: '🛡️' },
    { id: 'hardware',   label: 'Оборудование', icon: '🔌' },
    { id: 'about',      label: 'О программе',  icon: 'ℹ️' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-sidebar glass">
        {categories.map(cat => (
          <button 
            key={cat.id} 
            className={`settings-nav-item ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            <span className="settings-nav-icon">{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>
      
      <div className="settings-content glass">
        {activeCategory === 'general' && (
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

        {activeCategory === 'appearance' && (
          <div className="settings-section">
            <h2 className="settings-title">Внешний вид</h2>
            <div className="settings-group">
              <label className="settings-label">Тема оформления</label>
              <div className="settings-toggle-group">
                <button className="settings-toggle-btn active">Темная</button>
                <button className="settings-toggle-btn">Светлая</button>
                <button className="settings-toggle-btn">Системная</button>
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">Акцентный цвет</label>
              <div className="settings-color-row">
                {['#00d4ff', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'].map(color => (
                  <button key={color} className="settings-color-btn" style={{ background: color }} />
                ))}
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-label">Интенсивность Blur</label>
              <input type="range" className="settings-range" min="0" max="40" defaultValue="20" />
            </div>
          </div>
        )}

        {activeCategory === 'security' && (
          <div className="settings-section">
            <h2 className="settings-title">Безопасность</h2>
            <div className="settings-group-row">
              <div>
                <div className="settings-label">Aurora Shield</div>
                <div className="settings-desc">Защита от фишинга и вредоносных скриптов на уровне RCF</div>
              </div>
              <input type="checkbox" className="settings-checkbox" defaultChecked />
            </div>
            <div className="settings-group-row">
              <div>
                <div className="settings-label">Строгий HTTPS</div>
                <div className="settings-desc">Блокировать все незащищенные соединения</div>
              </div>
              <input type="checkbox" className="settings-checkbox" defaultChecked />
            </div>
          </div>
        )}

        {activeCategory === 'hardware' && (
          <div className="settings-section">
            <h2 className="settings-title">Оборудование RCF</h2>
            <div className="settings-group">
              <label className="settings-label">Протокол доступа</label>
              <select className="settings-select">
                <option>RCF-PL v1.2.8 (Universal)</option>
                <option>RCF-PL v1.0.0 (Legacy)</option>
                <option>Direct SPI/I2C (Advanced)</option>
              </select>
            </div>
            <div className="settings-group">
              <label className="settings-label">Default COM Port</label>
              <input type="text" className="settings-input" defaultValue="AUTO Detect" />
            </div>
            <div className="settings-group-row">
              <div>
                <div className="settings-label">Safe Flashing</div>
                <div className="settings-desc">Проверка контрольной суммы перед записью образа</div>
              </div>
              <input type="checkbox" className="settings-checkbox" defaultChecked />
            </div>
          </div>
        )}

        {activeCategory === 'about' && (
          <div className="settings-section about-section">
            <div className="about-logo">✦</div>
            <h2 className="settings-title">Aurora Access Browser</h2>
            <p className="about-version">Версия v1.2.9 (Alpha)</p>
            <p className="about-desc">
              Специализированный браузер для работы в защищенной среде Aurora Access. 
              Включает нативную поддержку аппаратных мостов RCF.
            </p>
            <div className="about-copyright">© 2026 Aurora Access Ecosystem. All rights reserved.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────
const PANEL_MAP = {
  aurora:   <AuroraPanel />,
  security: <SecurityPanel />,
  rcf:      <RCFPanel />,
  p2p:      <P2PPanel />,
  settings: <SettingsPanel />,
};

export default function MainContent({ tabs, activeTab, panel, onNavigate, webviewRef, onLoadStart, onLoadStop, onTitleUpdate }) {
  const currentTab = tabs[activeTab];
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

  if (panel && panel !== 'browser') {
    return <main className="main-content">{PANEL_MAP[panel] || null}</main>;
  }

  const url = currentTab?.url;

  return (
    <main className="main-content">
      {!url || url === WELCOME_URL ? (
        <WelcomePage onNavigate={onNavigate} />
      ) : isElectron ? (
        <div className="webview-wrapper">
          <ElectronWebview
            url={url}
            onLoadStart={onLoadStart}
            onLoadStop={onLoadStop}
            onTitleChange={onTitleUpdate}
            onRef={webviewRef}
          />
        </div>
      ) : (
        <div className="webview-container">
          <div className="webview-notice glass">
            <span className="notice-icon">🌐</span>
            <div>
              <strong>Webview</strong>
              <p style={{ color: 'var(--aurora-text-muted)', marginTop: 4, fontSize: 12 }}>
                Запустите через <code>npm run electron:dev</code> для открытия страниц.<br/>
                <span style={{ color: 'var(--aurora-primary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{url}</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export { WELCOME_URL };
