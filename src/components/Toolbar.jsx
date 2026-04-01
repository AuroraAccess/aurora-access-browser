import React, { useState, useRef, useEffect } from 'react';
import './Toolbar.css';

const PROTOCOLS = [
  { id: 'https', label: 'HTTPS', color: 'var(--aurora-green)', icon: '🔒' },
  { id: 'rcf', label: 'RCF-PL', color: 'var(--aurora-primary)', icon: '⚡' },
  { id: 'aurora', label: 'AURORA', color: 'var(--aurora-accent)', icon: '✦' },
];

export default function Toolbar({ tabs, activeTab, onTabChange, onNewTab, onCloseTab, onNavigate, isLoading }) {
  const [urlValue, setUrlValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [protocolIdx, setProtocolIdx] = useState(0);
  const inputRef = useRef(null);

  const currentTab = tabs[activeTab];
  const protocol = PROTOCOLS[protocolIdx];

  useEffect(() => {
    if (currentTab) setUrlValue(currentTab.url || '');
  }, [activeTab, currentTab]);

  const handleNavigate = (e) => {
    e.preventDefault();
    let url = urlValue.trim();
    if (!url) return;
    if (!url.includes('.') && !url.startsWith('aurora://') && !url.startsWith('rcf://')) {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (!url.startsWith('http') && !url.startsWith('aurora://') && !url.startsWith('rcf://')) {
      url = `https://${url}`;
    }
    setUrlValue(url);
    onNavigate(url);
    inputRef.current?.blur();
  };

  return (
    <div className="toolbar glass">
      {/* Tab Bar */}
      <div className="tabbar">
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
              )}
            </span>
            <span className="tab-title truncate">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
              title="Закрыть вкладку"
            >×</button>
          </div>
        ))}
        <button className="tab-new" onClick={onNewTab} title="Новая вкладка">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}>
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {/* URL + Controls Row */}
      <div className="toolbar-controls">
        {/* Navigation Buttons */}
        <div className="nav-buttons">
          <button className="nav-btn" title="Назад" onClick={() => onNavigate('BACK')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button className="nav-btn" title="Вперёд" onClick={() => onNavigate('FORWARD')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button className={`nav-btn ${isLoading ? 'spin' : ''}`} title={isLoading ? 'Стоп' : 'Обновить'} onClick={() => onNavigate(isLoading ? 'STOP' : 'RELOAD')}>
            {isLoading ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            )}
          </button>
        </div>

        {/* Protocol Badge */}
        <button
          className="protocol-badge"
          style={{ '--proto-color': protocol.color }}
          onClick={() => setProtocolIdx((protocolIdx + 1) % PROTOCOLS.length)}
          title="Переключить протокол"
        >
          <span className="protocol-dot" />
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
            placeholder="Введите адрес или поисковый запрос…"
            spellCheck="false"
            autoComplete="off"
          />
          {isFocused && (
            <button type="submit" className="address-go-btn" title="Перейти">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          )}
        </form>

        {/* Action Buttons */}
        <div className="toolbar-actions">
          <button className="action-btn" title="Закладки">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button className="action-btn" title="Расширения">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
          </button>
          <button className="action-btn action-btn--aurora" title="Aurora Access Panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </button>
          <button className="action-btn" title="Профиль">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
