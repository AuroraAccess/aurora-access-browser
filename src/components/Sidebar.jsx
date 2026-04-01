import React, { useState } from 'react';
import './Sidebar.css';

const NAV_ITEMS = [
  {
    id: 'browser',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    label: 'Браузер',
  },
  {
    id: 'aurora',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    label: 'Aurora Access',
    badge: 'PRO',
  },
  {
    id: 'security',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    label: 'Защита',
  },
  {
    id: 'rcf',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="6"/>
        <rect x="16" y="16" width="6" height="6"/>
        <rect x="2" y="16" width="6" height="6"/>
        <path d="M12 8v4M5 16v-4h14v4"/>
      </svg>
    ),
    label: 'RCF Firmware',
  },
  {
    id: 'p2p',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    label: 'P2P Exchange',
  },
  {
    id: 'downloads',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    ),
    label: 'Загрузки',
  },
  {
    id: 'history',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
      </svg>
    ),
    label: 'История',
  },
  {
    id: 'settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
    label: 'Настройки',
  },
];

export default function Sidebar({ activePanel, onPanelChange, collapsed, onToggle }) {
  return (
    <aside className={`sidebar glass ${collapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <img src="/logo.png" alt="Aurora Logo" className="sidebar-logo-image" />
        </div>
        {!collapsed && (
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">Aurora</span>
            <span className="sidebar-logo-sub">Access Browser</span>
          </div>
        )}
        <button className="sidebar-collapse-btn" onClick={onToggle} title="Свернуть панель">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.slice(0, -1).map(item => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onPanelChange(item.id)}
            title={collapsed ? item.label : ''}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
            {!collapsed && item.badge && <span className="sidebar-badge">{item.badge}</span>}
          </button>
        ))}
      </nav>

      {/* Status Footer */}
      {!collapsed && (
        <div className="sidebar-status">
          <div className="sidebar-status-indicator">
            <span className="status-dot online" />
            <span>Aurora Network: <strong>Active</strong></span>
          </div>
          <div className="sidebar-status-indicator">
            <span className="status-dot secure" />
            <span>RCF-PL Protocol: <strong>OK</strong></span>
          </div>
        </div>
      )}

      {/* Settings bottom */}
      <button
        className={`sidebar-nav-item settings-btn ${activePanel === 'settings' ? 'active' : ''}`}
        onClick={() => onPanelChange('settings')}
        title={collapsed ? 'Настройки' : ''}
      >
        <span className="sidebar-nav-icon">{NAV_ITEMS[NAV_ITEMS.length - 1].icon}</span>
        {!collapsed && <span className="sidebar-nav-label">Настройки</span>}
      </button>
    </aside>
  );
}
