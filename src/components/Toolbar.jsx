/* 
 * NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import './Toolbar.css';
import { i18n } from '../i18n';
import { CONFIG } from '../config';
import { WELCOME_URL } from './MainContent.jsx';

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
  activePanel, onPanelChange, vaultPrompt, onVaultAction,
  appearance, setAppearance
}) {
  const [urlValue, setUrlValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef(null);
  const settingsRef = useRef(null);

  const currentTab = tabs[activeTab];
  const t = i18n[language].toolbar;
  const ts = i18n[language].settings;
  const t_sidebar = i18n[language].sidebar;

  useEffect(() => {
    if (currentTab) {
      const u = currentTab.url || '';
      setUrlValue(u === WELCOME_URL || u.startsWith('panel://') ? '' : u);
    }
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

    // Check if user already provided a full protocol
    const hasProtocol = url.startsWith('http') || url.startsWith('panel://');

    if (!hasProtocol) {
      if (!url.includes('.') && !url.includes(':')) {
        url = `${CONFIG.DEFAULT_SEARCH_ENGINE}${encodeURIComponent(url)}`;
      } else if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
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
      id: 'security', label: t_sidebar.security, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" />
        </svg>
      )
    },
    {
      id: 'traffic', label: t_sidebar.traffic, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
        </svg>
      )
    },
    {
      id: 'inspector', label: t_sidebar.inspector, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      )
    },
    {
      id: 'passaudit', label: t_sidebar.passaudit, icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
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

      {/* Vault Save Prompt */}
      {vaultPrompt && (
        <div className="vault-save-prompt glass-heavy animated-slide-down">
          <div className="vault-prompt-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="vault-prompt-text">
            <strong>{t.save_password || 'Save Password?'}</strong>
            <span>{vaultPrompt.u} · {(() => { try { return new URL(vaultPrompt.url).hostname } catch (e) { return vaultPrompt.url } })()}</span>
          </div>
          <div className="vault-prompt-actions">
            <button className="prompt-btn secondary" onClick={() => { console.log('Vault: IGNORE'); onVaultAction('IGNORE'); }}>{t.no || 'No'}</button>
            <button className="prompt-btn primary" onClick={() => { console.log('Vault: SAVE'); onVaultAction('SAVE'); }}>{t.save || 'Save'}</button>
          </div>
        </div>
      )}

      {/* URL + Controls Row */}
      <div className="toolbar-controls">
        {/* Brand Logo (Left, compact) */}
        <div className="toolbar-logo-compact" onClick={() => onPanelChange('browser')} title="Aurora Access" style={{ cursor: 'pointer', padding: '0 8px', display: 'flex', alignItems: 'center' }}>
          <img src="./logo.png" alt="✦" width="32" height="32" />
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
            <div className="toolbar-status-dot" title={t_sidebar.status_active}>
              <span className="status-dot online" />
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
