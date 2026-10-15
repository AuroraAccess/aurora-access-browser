/* NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
// ─── Releases (full GitHub release creation from the UI) ────────────
// One-form flow: tag (auto-suggested from the app version), display name,
// markdown notes, draft/prerelease toggles → POST /releases via the main
// process (electron/release-publisher.js). The token lives in the
// environment only — the UI learns a boolean, never the secret.
//
// Works both as a full panel://release page and inside the compact toolbar
// dropdown (same layout family as PassAuditPanel).
import React, { useState, useEffect, useCallback } from 'react';
import './ReleasePanel.css';
import { i18n } from '../i18n';
import { CONFIG } from '../config.js';

export default function ReleasePanel({ language }) {
  const t = i18n[language].release;
  const api = typeof window !== 'undefined' ? window.electronAPI?.releases : null;

  const nextTag = `v${CONFIG.VERSION}`; // the version shipped in this very build

  const [hasToken, setHasToken] = useState(null); // null = checking
  const [tag, setTag] = useState(nextTag);
  const [name, setName] = useState(`Release v${CONFIG.VERSION}`);
  const [notes, setNotes] = useState(
    `### Fixed\n- proxy bypass rules sanitization\n- vault unlock UI restored\n- YouTube translate button gating\n- update notification modal\n`
  );
  const [draft, setDraft] = useState(true);
  const [prerelease, setPrerelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null); // { url, tag }

  const checkToken = useCallback(async () => {
    if (!api?.hasToken) { setHasToken(false); return; }
    try {
      const res = await api.hasToken();
      setHasToken(!!res?.hasToken);
      console.log('[ReleasePanel] Token status:', !!res?.hasToken);
    } catch (e) {
      setHasToken(false);
      console.error('[ReleasePanel] has-token IPC failed:', e.message);
    }
  }, [api]);
  useEffect(() => { checkToken(); }, [checkToken]);

  const create = async (asDraft) => {
    if (!api?.create) { setError(t.no_bridge || 'Bridge unavailable — run the desktop app'); return; }
    setBusy(true);
    setError('');
    setCreated(null);
    try {
      console.log(`[ReleasePanel] Creating release ${tag} (draft=${asDraft}) via GitHub API`);
      const res = await api.create({
        tag, name, notes, draft: asDraft, prerelease,
      });
      if (!res.ok) {
        setError(res.error || (t.err_create || 'Creation failed'));
        return;
      }
      console.log('[ReleasePanel] Release created:', res.url);
      setCreated({ url: res.url, tag: res.tag });
    } catch (e) {
      setError(e.message || (t.err_create || 'Creation failed'));
    } finally {
      setBusy(false);
    }
  };

  const openRelease = () => {
    if (!created?.url) return;
    // Same http(s)-only guard as everywhere: preload rejects other schemes.
    window.electronAPI?.shell?.openExternal(String(created.url));
  };

  return (
    <div className="panel-page">
      <PanelHeader title={t.title} subtitle={t.subtitle} />

      <div className="glass section-card release-token-status">
        <span className={`release-token-dot ${hasToken ? 'ok' : 'missing'}`} />
        <span>
          {hasToken == null
            ? (t.token_checking || 'Checking token…')
            : hasToken
              ? (t.token_ok || 'GitHub token found in environment (AURORA_GITHUB_TOKEN / GITHUB_TOKEN)')
              : (t.token_missing || 'No GitHub token — set AURORA_GITHUB_TOKEN or GITHUB_TOKEN and restart')}
        </span>
      </div>

      {error && <div className="inspector-error glass">{error}</div>}

      {created && (
        <div className="glass section-card release-created">
          <strong>{(t.created || 'Release created:')} {created.tag}</strong>
          <button className="pa-locked-unlock-btn" onClick={openRelease}>
            {t.open_release || 'Open on GitHub'}
          </button>
        </div>
      )}

      <form className="glass section-card release-form" onSubmit={(e) => { e.preventDefault(); create(draft); }}>
        <label className="settings-label">{t.version_label || 'Version tag'}</label>
        <div className="release-current-hint">
          {t.current_hint || 'This build ships as:'} <code>v{CONFIG.VERSION}</code>
        </div>
        <input
          className="pa-input"
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value.trim())}
          placeholder="v2.0.9"
          spellCheck="false"
        />

        <label className="settings-label">{t.name_label || 'Release title'}</label>
        <input
          className="pa-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Release v${CONFIG.VERSION}`}
        />

        <label className="settings-label">{t.notes_label || 'Release notes (markdown)'}</label>
        <textarea
          className="pa-input release-notes-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={7}
          spellCheck="false"
        />

        <div className="settings-group-row release-toggle-row">
          <span className="settings-label" style={{ margin: 0 }}>{t.draft_label || 'Draft'}</span>
          <input type="checkbox" className="settings-checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
        </div>
        <div className="settings-group-row release-toggle-row">
          <span className="settings-label" style={{ margin: 0 }}>{t.prerelease_label || 'Prerelease'}</span>
          <input type="checkbox" className="settings-checkbox" checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} />
        </div>

        <div className="release-actions">
          <button type="button" className="pa-save-btn" disabled={busy || !draft} onClick={() => create(false)}>
            {busy ? (t.creating || 'Creating…') : (t.create_published || 'Create & publish')}
          </button>
          <button type="submit" className="pa-save-btn" disabled={busy || !draft}>
            {busy ? (t.creating || 'Creating…') : (t.create_draft || 'Create draft')}
          </button>
        </div>
        {hasToken === false && (
          <div className="release-hint">{t.token_hint || 'Draft/publish buttons require an environment token; drafts can also be created by CI after pushing the v* tag.'}</div>
        )}
      </form>
    </div>
  );
}

function PanelHeader({ title, subtitle }) {
  return (
    <div className="panel-header">
      <div className="panel-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 24, height: 24 }}>
          {/* rocket */}
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      </div>
      <div>
        <h2 className="panel-title">{title}</h2>
        <p className="panel-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}
