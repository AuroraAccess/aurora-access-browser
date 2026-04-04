/* 
 * NOTICE: This file is protected under RCF-PL v1.2.8
 * [RCF:PROTECTED]
 */
import React, { useState } from 'react';
import './Sidebar.css';
import { useRCF } from '../hooks/useRCF';
import { i18n } from '../i18n';

export default function Sidebar({ activePanel, onPanelChange, collapsed, onToggle, language }) {
  const { status } = useRCF();
  const t = i18n[language].sidebar;

  const NAV_ITEMS = [
    {
      id: 'browser',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-1.41 4.25-4.25 1.41 1.41-4.25Z" /><path d="M12 12h.01" />
        </svg>
      ),
      label: t.browser,
    },
    {
      id: 'aurora',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
      label: t.aurora,
      badge: 'PRO',
    },
    {
      id: 'vault',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><circle cx="12" cy="12" r="3" />
        </svg>
      ),
      label: t.vault,
    },
    {
      id: 'security',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" />
        </svg>
      ),
      label: t.security,
    },
    {
      id: 'rcf',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M15 2v2M15 20v2M2 15h2M20 15h2M9 2v2M9 20v2M2 9h2M20 9h2" />
        </svg>
      ),
      label: t.rcf,
    },
    {
      id: 'p2p',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2.1a9 9 0 0 1 0 13.9M13 11.6l-3-3-3 3M10 8.6v9M3 21h18" />
        </svg>
      ),
      label: t.p2p,
    },
    {
      id: 'history',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      label: t.history,
    },
    {
      id: 'settings',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
        </svg>
      ),
      label: t.settings,
    },
  ];

  return (
    <aside className={`sidebar glass ${collapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <img src="/logo.png" alt="Aurora" className="sidebar-logo-image" />
        </div>
        {!collapsed && (
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">Aurora</span>
            <span className="sidebar-logo-sub">Access Browser</span>
          </div>
        )}
        <button className="sidebar-collapse-btn" onClick={onToggle} title={t.collapse}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Navigation REMOVED - moved to three dots */}

      {/* Status Footer */}
      {!collapsed && (
        <div className="sidebar-status">
          <div className="sidebar-status-indicator">
            <span className={`status-dot ${status?.sentinel?.status === 'ACTIVE' ? 'online-pulse' : 'online'}`} />
            <span>{t.sentinel}: <strong>{status?.sentinel?.status || t.status_active}</strong></span>
          </div>
          <div className="sidebar-status-indicator">
            <span className="status-dot secure" />
            <span>{t.identity}: <strong>{status?.audit?.result === 'PASSED' ? t.status_verified : t.status_guest}</strong></span>
          </div>
        </div>
      )}
    </aside>
  );
}
