/* 
 * NOTICE: This file is protected under RCF-PL v1.2.8
 * [RCF:PROTECTED]
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import './Toolbar.css';
import { i18n } from '../i18n';
import { useRCF } from '../hooks/useRCF';
import { CONFIG } from '../config';

const PROTOCOLS = [
  {
    id: 'https',
    label: 'HTTPS',
    color: 'var(--aurora-green)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    )
  },
  {
    id: 'rcf',
    label: 'RCF-PL',
    color: 'var(--aurora-primary)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    )
  },
  {
    id: 'aurora',
    label: 'AURORA',
    color: 'var(--aurora-accent)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    )
  },
];

const ACCENT_COLORS = ['#00d4ff', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'];

const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

export default function Toolbar({
  tabs, activeTab, onTabChange, onNewTab, onCloseTab, onNavigate, isLoading,
  language, setLanguage, theme, setTheme, accentColor, setAccentColor,
  activePanel, onPanelChange
}) {
  const [urlValue, setUrlValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [protocolIdx, setProtocolIdx] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef(null);
  const settingsRef = useRef(null);

  const { status } = useRCF();
  const currentTab = tabs[activeTab];
  const protocol = PROTOCOLS[protocolIdx];
  const t = i18n[language].toolbar;
  const ts = i18n[language].settings;
  const t_sidebar = i18n[language].sidebar; // For status labels

  useEffect(() => {
    if (currentTab) setUrlValue(currentTab.url || '');
  }, [activeTab, currentTab]);

  // Close settings on click outside (Fixed Issue 2: Memory Leak)
  useEffect(() => {
    if (!showSettings) return;

    function handleClickOutside(event) {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings]);

  const handleNavigate = (e) => {
    e.preventDefault();
    let url = urlValue.trim();
    if (!url) return;

    // Issue 4: Use CONFIG for search engine
    if (!url.includes('.') && !url.startsWith('aurora://') && !url.startsWith('rcf://')) {
      url = `${CONFIG.DEFAULT_SEARCH_ENGINE}${encodeURIComponent(url)}`;
    } else if (!url.startsWith('http') && !url.startsWith('aurora://') && !url.startsWith('rcf://')) {
      url = `https://${url}`;
    }

    // Basic security validation
    if (url.startsWith('http') && !isValidUrl(url)) {
      console.error("Invalid URL detected:", url);
      return;
    }

    setUrlValue(url);
    onNavigate(url);
    inputRef.current?.blur();
  };

  // Issue 3: Localized nav items
  const navItems = useMemo(() => [
    {
      id: 'browser', label: t_sidebar.browser, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      )
    },
    {
      id: 'aurora', label: 'Aurora', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      )
    },
    {
      id: 'vault', label: t_sidebar.vault, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )
    },
    {
      id: 'security', label: t_sidebar.security, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )
    },
    {
      id: 'rcf', label: 'Firmware', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="15" x2="23" y2="15" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="15" x2="4" y2="15" />
        </svg>
      )
    },
    {
      id: 'p2p', label: 'P2P', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M12 1v22m5-18H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      )
    },
    {
      id: 'history', label: t_sidebar.history, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      )
    },
    {
      id: 'settings', label: t_sidebar.settings, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      )
    },
  ], [t_sidebar]);

  return (
    <div className="toolbar glass">
      {/* Tab Bar */}
      <div className="tabbar">
        {window.electronAPI?.platform === 'darwin' && <div className="toolbar-mac-spacer" />}
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            className={`tab ${i === activeTab ? 'active' : ''}`}
            onClick={() => onTabChange(i)}
          >
            <span className="tab-favicon">
              {tab.favicon ? (
                <img src={tab.favicon} alt="" width="12" height="12" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              )}
            </span>
            <span className="tab-title truncate">{tab.title || t.new_tab}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
              title={t.close_tab}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 8, height: 8 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
        <button className="tab-new" onClick={onNewTab} title={t.new_tab}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* URL + Controls Row */}
      <div className="toolbar-controls">
        {/* Brand Logo (Left, compact) */}
        <div className="toolbar-logo-compact" onClick={() => onPanelChange('browser')} title="Aurora Access" style={{ cursor: 'pointer', padding: '0 8px', display: 'flex', alignItems: 'center' }}>
          <img src="./logo.png" alt="✦" width="22" height="22" />
        </div>

        {/* Navigation Buttons */}
        <div className="nav-buttons">
          <button className="nav-btn" title={t.back} onClick={() => onNavigate('BACK')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="nav-btn" title={t.forward} onClick={() => onNavigate('FORWARD')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button className={`nav-btn ${isLoading ? 'spin' : ''}`} title={isLoading ? t.stop : t.reload} onClick={() => onNavigate(isLoading ? 'STOP' : 'RELOAD')}>
            {isLoading ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
          </button>
        </div>

        {/* Protocol Badge */}
        <button
          className="protocol-badge"
          style={{ '--proto-color': protocol.color }}
          onClick={() => setProtocolIdx((protocolIdx + 1) % PROTOCOLS.length)}
          title={t.switch_protocol}
        >
          <span className="protocol-icon-wrap">{protocol.icon}</span>
          {protocol.label}
        </button>

        {/* Address Bar */}
        <form className={`address-bar ${isFocused ? 'focused' : ''}`} onSubmit={handleNavigate}>
          <input
            ref={inputRef}
            id="address-bar-input"
            type="text"
            value={urlValue}
            onChange={e => setUrlValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={t.search_placeholder}
            spellCheck="false"
            autoComplete="off"
          />
          {isFocused && (
            <button type="submit" className="address-go-btn" title={t.go}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </form>

        {/* Action Buttons */}
        <div className="toolbar-actions">
          <button className="action-btn" title={t.bookmarks}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button className="action-btn" title={t.extensions}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </button>
          <button className="action-btn" title={t.profile}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>

          <div className="toolbar-status-group">
            <div className="toolbar-status-dot" title={t_sidebar.sentinel}>
              <span className={`status-dot ${status?.sentinel?.status === 'ACTIVE' ? 'online-pulse' : 'online'}`} />
            </div>
            <div className="toolbar-status-dot" title={t_sidebar.identity}>
              <span className={`status-dot ${status?.audit?.result === 'PASSED' ? 'secure' : 'guest'}`} />
            </div>
          </div>

          <div className="settings-menu-wrapper" ref={settingsRef}>
            <button
              className={`action-btn more-btn ${showSettings ? 'active' : ''}`}
              title={t.more}
              onClick={() => setShowSettings(!showSettings)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>

            {showSettings && (
              <div className="settings-dropdown glass-heavy">
                <div className="dropdown-section">
                  <div className="dropdown-label">{ts.categories.general}</div>
                  <div className="nav-grid">
                    {navItems.map(item => (
                      <button
                        key={item.id}
                        className={`nav-grid-item ${activePanel === item.id ? 'active' : ''}`}
                        onClick={() => { onPanelChange(item.id); setShowSettings(false); }}
                      >
                        <span className="nav-grid-icon">{item.icon}</span>
                        <span className="nav-grid-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dropdown-divider" />

                <div className="dropdown-section">
                  <div className="dropdown-label">{ts.language}</div>
                  <div className="dropdown-toggle-group">
                    <button className={`toggle-btn ${language === 'ru' ? 'active' : ''}`} onClick={() => setLanguage('ru')}>RU</button>
                    <button className={`toggle-btn ${language === 'en' ? 'active' : ''}`} onClick={() => setLanguage('en')}>EN</button>
                  </div>
                </div>

                <div className="dropdown-section">
                  <div className="dropdown-label">{ts.theme}</div>
                  <div className="dropdown-toggle-group">
                    <button className={`toggle-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>{ts.theme_dark}</button>
                    <button className={`toggle-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>{ts.theme_light}</button>
                  </div>
                </div>

                <div className="dropdown-divider" />
                <div className="dropdown-footer">
                  Aurora Access Suite v1.0.0
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
