/* NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
// ─── AutoUpdateModal (TZ v2.0.9 feature #4) ─────────────────────────
// Global update notification. The Main process schedules ONE GitHub API
// probe 4.5s after the window finished loading; when a newer release exists
// it pushes 'update-available' over IPC, this modal appears immediately and
// offers to open the release page in the OS browser (shell.openExternal —
// the http(s)-only guard in preload.js still holds) or to dismiss it.
//
// Mounted ONCE at the App root (see App.jsx), so it renders over tabs,
// panels and dropdowns alike; the fixed overlay with backdrop-filter: blur
// keeps every surface behind it dimmed and out of reach.
import React, { useEffect, useState } from 'react';
import './AutoUpdateModal.css';
import { i18n } from '../i18n';
import { CONFIG } from '../config.js';

export default function AutoUpdateModal({ language }) {
  const t = i18n[language].update;
  // release === null → the modal is closed; a push fills it with the payload.
  const [release, setRelease] = useState(null);
  const [busyOpen, setBusyOpen] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateAvailable) return undefined;
    console.log('[AutoUpdateModal] Subscribing to update-available pushes');
    const off = api.onUpdateAvailable((releasePayload) => {
      console.log('[AutoUpdateModal] update-available received:', releasePayload?.version);
      setRelease(releasePayload || null);
      setBusyOpen(false);
    });
    // Reconciliation: discard a stale listener on remount.
    return () => { console.log('[AutoUpdateModal] Unsubscribed'); off(); };
  }, []);

  if (!release) return null;

  const handleUpdate = () => {
    if (busyOpen) return;
    setBusyOpen(true);
    const url = release.url;
    console.log('[AutoUpdateModal] Opening release page in OS browser:', url);
    try {
      // preload.js shells out only for http(s) — a hostile payload cannot
      // bootstrap a system protocol handler through this click.
      window.electronAPI.shell.openExternal(String(url || ''));
    } catch (err) {
      console.error('[AutoUpdateModal] shell.openExternal failed:', err.message);
    }
    setBusyOpen(false);
    // The modal stays open for the user to browse the notes; "Later" closes.
  };

  const handleLater = () => {
    console.log('[AutoUpdateModal] Dismissed ("Later")');
    setRelease(null);
  };

  const onOverlayMouseDown = (e) => {
    // Clicking the dimmed area behaves like "Later"; clicks inside the card
    // do not leak to it (stopPropagation on the card).
    if (e.target === e.currentTarget) handleLater();
  };

  return (
    <div className="update-overlay" onMouseDown={onOverlayMouseDown} role="dialog" aria-modal="true">
      <div className="update-modal glass-heavy" onMouseDown={(e) => e.stopPropagation()}>
        <div className="update-modal-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 40, height: 40 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>

        <h2 className="update-title">{t.title}</h2>

        <div className="update-versions">
          <span className="update-version-badge" title={release.name || undefined}>
            v{release.version}
          </span>
          <span className="update-version-current">
            {t.current_label} v{release.currentVersion || CONFIG.VERSION}
          </span>
        </div>

        {release.notes && (
          <div className="update-notes glass" aria-label={t.notes}>
            <div className="update-notes-heading">{t.notes}</div>
            <pre className="update-notes-body">{String(release.notes).slice(0, 4000)}</pre>
          </div>
        )}

        <div className="update-actions">
          <button className="update-btn secondary" onClick={handleLater}>
            {t.later}
          </button>
          <button className="update-btn primary" onClick={handleUpdate} disabled={busyOpen} autoFocus>
            {t.update_now}
          </button>
        </div>
      </div>
    </div>
  );
}
