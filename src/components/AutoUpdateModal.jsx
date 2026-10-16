/* NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
// ─── AutoUpdateModal (In-App Update Engine) ─────────────────────────
// Full in-app update experience:
// 1. Detects available updates from GitHub Releases
// 2. Shows release notes and version diff
// 3. Downloads the update binary in-app with a live progress bar
// 4. Offers one-click "Restart & Update" (quitAndInstall) directly inside the browser!

import React, { useEffect, useState } from 'react';
import './AutoUpdateModal.css';
import { i18n } from '../i18n';
import { CONFIG } from '../config.js';

export default function AutoUpdateModal({ language }) {
  const t = i18n[language]?.update || i18n.en.update;
  const [release, setRelease] = useState(null);
  const [stage, setStage] = useState('available'); // 'available' | 'downloading' | 'downloaded' | 'error'
  const [progress, setProgress] = useState({ percent: 0, transferred: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return undefined;

    // Listen for update available notifications
    const unsubs = [];

    const handleAvailable = (payload) => {
      console.log('[AutoUpdateModal] Update available received:', payload?.version);
      if (payload) {
        setRelease(payload);
        setStage('available');
        setErrorMsg('');
      }
    };

    if (api.updater?.onUpdateAvailable) {
      unsubs.push(api.updater.onUpdateAvailable(handleAvailable));
    } else if (api.onUpdateAvailable) {
      unsubs.push(api.onUpdateAvailable(handleAvailable));
    }

    if (api.updater?.onDownloadProgress) {
      unsubs.push(api.updater.onDownloadProgress((prog) => {
        setStage('downloading');
        setProgress(prog || { percent: 0, transferred: 0, total: 0 });
      }));
    }

    if (api.updater?.onUpdateDownloaded) {
      unsubs.push(api.updater.onUpdateDownloaded(() => {
        console.log('[AutoUpdateModal] Update fully downloaded');
        setStage('downloaded');
        setProgress({ percent: 100, transferred: 0, total: 0 });
      }));
    }

    if (api.updater?.onError) {
      unsubs.push(api.updater.onError((err) => {
        console.warn('[AutoUpdateModal] Update error received:', err);
        setErrorMsg(err?.message || (t.error || 'Update failed'));
        setStage('error');
      }));
    }

    return () => {
      unsubs.forEach((fn) => {
        try { if (typeof fn === 'function') fn(); } catch (_) {}
      });
    };
  }, [t.error]);

  if (!release) return null;

  const handleStartDownload = async () => {
    setStage('downloading');
    setProgress({ percent: 0, transferred: 0, total: 0 });
    setErrorMsg('');
    try {
      if (window.electronAPI?.updater?.download) {
        const res = await window.electronAPI.updater.download();
        if (res && res.ok === false) {
          setErrorMsg(res.error || t.error || 'Download failed');
          setStage('error');
        }
      } else {
        // Fallback if desktop bridge is unavailable
        if (release.url) {
          window.electronAPI?.shell?.openExternal(String(release.url));
        }
      }
    } catch (err) {
      setErrorMsg(err.message || (t.error || 'Download failed'));
      setStage('error');
    }
  };

  const handleRestartAndInstall = () => {
    console.log('[AutoUpdateModal] Triggering restart and install');
    try {
      if (window.electronAPI?.updater?.install) {
        window.electronAPI.updater.install();
      }
    } catch (err) {
      console.error('[AutoUpdateModal] Install failed:', err);
      setErrorMsg(err.message);
      setStage('error');
    }
  };

  const handleLater = () => {
    console.log('[AutoUpdateModal] Dismissed ("Later")');
    setRelease(null);
  };

  const onOverlayMouseDown = (e) => {
    if (e.target === e.currentTarget && stage !== 'downloading') {
      handleLater();
    }
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

        {stage === 'available' && (
          <>
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
              <button className="update-btn primary" onClick={handleStartDownload} autoFocus>
                {t.update_now}
              </button>
            </div>
          </>
        )}

        {stage === 'downloading' && (
          <>
            <h2 className="update-title">{t.downloading}</h2>

            <div className="update-progress-container">
              <div className="update-progress-bar">
                <div
                  className="update-progress-fill"
                  style={{ width: `${Math.min(Math.max(progress.percent, 3), 100)}%` }}
                />
              </div>
              <div className="update-progress-label">
                {t.download_progress.replace('{percent}', String(progress.percent))}
              </div>
            </div>

            <div className="update-actions">
              <button className="update-btn secondary" onClick={handleLater}>
                {t.later}
              </button>
            </div>
          </>
        )}

        {stage === 'downloaded' && (
          <>
            <h2 className="update-title">{t.ready_title}</h2>
            <p className="update-ready-desc">{t.ready_desc}</p>

            <div className="update-versions">
              <span className="update-version-badge">
                v{release.version}
              </span>
            </div>

            <div className="update-actions">
              <button className="update-btn secondary" onClick={handleLater}>
                {t.later}
              </button>
              <button className="update-btn primary" onClick={handleRestartAndInstall} autoFocus>
                {t.restart_and_update}
              </button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <>
            <h2 className="update-title">{t.error}</h2>
            {errorMsg && <div className="update-error-text glass">{errorMsg}</div>}

            <div className="update-actions">
              <button className="update-btn secondary" onClick={handleLater}>
                {t.later}
              </button>
              <button className="update-btn primary" onClick={handleStartDownload}>
                {t.update_now}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
