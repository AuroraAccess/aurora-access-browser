/* NOTICE: RCF-PL — open source
 * [RCF:OPEN]
 */
// ─── VideoTranslateWidget (Yandex VOT Voice-over Video Translation) ───
// Controls voice-over translation of videos in real time:
// - Enable / disable toggle
// - Voice-over language target (ru / en)
// - Audio volume balance: original video volume vs translated voice volume
// - Instant trigger / stop translation for the current video

import React, { useState, useEffect } from 'react';
import './VideoTranslateWidget.css';
import { i18n } from '../i18n';

export default function VideoTranslateWidget({
  language,
  currentUrl,
  onTriggerTranslate,
  onSetVolume,
  compact = false,
  onClose,
}) {
  const t = i18n[language]?.videotrans || {
    title: 'Синхронный перевод видео',
    subtitle: 'Нейросетевая русская озвучка видео (Yandex VOT)',
    enabled_label: 'Перевод видео включён',
    target_lang: 'Язык озвучки:',
    lang_ru: '🇷🇺 Русский',
    lang_en: '🇬🇧 English',
    volume_balance: 'Баланс громкости',
    orig_vol: 'Оригинальный звук видео',
    trans_vol: 'Голосовой перевод',
    translate_now: 'Перевести видео',
    stop_translate: 'Остановить перевод',
    status_ready: 'Видео обнаружено — готово к переводу',
    status_no_video: 'Откройте YouTube, VK или Rutube для перевода',
    hint: 'Нейросеть автоматически приглушает оригинальный звук и накладывает синхронный дублированный перевод.',
  };

  const [enabled, setEnabled] = useState(true);
  const [targetLang, setTargetLang] = useState('ru');
  const [originalVolume, setOriginalVolume] = useState(20);
  const [translationVolume, setTranslationVolume] = useState(100);
  const [translating, setTranslating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const isVideo = currentUrl && /youtube\.com|youtu\.be|vk\.com\/video|vkvideo\.ru|rutube\.ru|twitch\.tv|vimeo\.com/i.test(currentUrl);

  // Sync with main process setting
  useEffect(() => {
    if (window.electronAPI?.videoTranslate?.isEnabled) {
      window.electronAPI.videoTranslate.isEnabled().then((res) => {
        if (res && typeof res.enabled === 'boolean') setEnabled(res.enabled);
      }).catch(() => {});
    }

    // Load saved volume preferences
    const savedOrig = localStorage.getItem('aurora_vt_orig_vol');
    if (savedOrig !== null) setOriginalVolume(Number(savedOrig));
    const savedTrans = localStorage.getItem('aurora_vt_trans_vol');
    if (savedTrans !== null) setTranslationVolume(Number(savedTrans));
    const savedLang = localStorage.getItem('aurora_vt_lang');
    if (savedLang) setTargetLang(savedLang);
  }, []);

  const handleToggleEnabled = async (checked) => {
    setEnabled(checked);
    if (window.electronAPI?.videoTranslate?.setEnabled) {
      await window.electronAPI.videoTranslate.setEnabled(checked);
    }
  };

  const handleOriginalVolChange = (val) => {
    const num = Number(val);
    setOriginalVolume(num);
    localStorage.setItem('aurora_vt_orig_vol', String(num));
    if (onSetVolume) {
      onSetVolume({ original: num / 100, translation: translationVolume / 100 });
    }
    window.dispatchEvent(new CustomEvent('aurora:vt-volume-change', {
      detail: { original: num / 100, translation: translationVolume / 100 }
    }));
  };

  const handleTranslationVolChange = (val) => {
    const num = Number(val);
    setTranslationVolume(num);
    localStorage.setItem('aurora_vt_trans_vol', String(num));
    if (onSetVolume) {
      onSetVolume({ original: originalVolume / 100, translation: num / 100 });
    }
    window.dispatchEvent(new CustomEvent('aurora:vt-volume-change', {
      detail: { original: originalVolume / 100, translation: num / 100 }
    }));
  };

  const handleLangChange = (lang) => {
    setTargetLang(lang);
    localStorage.setItem('aurora_vt_lang', lang);
  };

  const handleActionClick = () => {
    if (!isVideo) return;
    const nextActive = !translating;
    setTranslating(nextActive);
    setStatusMsg(nextActive ? 'Синхронный голосовой перевод активен' : '');

    // Web preview simulation on localhost:5173 outside Electron
    if (typeof window !== 'undefined' && !window.electronAPI?.isElectron) {
      if (nextActive && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const text = targetLang === 'ru'
          ? 'Синхронный голосовой перевод видео включён. Нейросеть дублирует дорожку на русском языке.'
          : 'Synchronous voice-over translation is active. Neural network is dubbing the video track.';
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = targetLang === 'ru' ? 'ru-RU' : 'en-US';
        utterance.volume = translationVolume / 100;
        window.speechSynthesis.speak(utterance);
        setStatusMsg('Озвучка активна (тестовый веб-режим)');
      } else if (!nextActive && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        setStatusMsg('Перевод отключён');
      }
    }

    if (onTriggerTranslate) {
      onTriggerTranslate({
        active: nextActive,
        targetLang,
        originalVolume: originalVolume / 100,
        translationVolume: translationVolume / 100,
      });
    }
  };

  return (
    <div className={`vt-widget ${compact ? 'vt-widget--compact' : ''} glass-heavy`}>
      <div className="vt-header">
        <div className="vt-header-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
          </svg>
        </div>
        <div className="vt-header-text">
          <h3 className="vt-title">{t.title}</h3>
          <p className="vt-subtitle">{t.subtitle}</p>
        </div>
        {onClose && (
          <button className="vt-close-btn" onClick={onClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Main Feature Toggle */}
      <div className="vt-row vt-toggle-row glass">
        <div>
          <div className="vt-label">{t.enabled_label}</div>
          <div className="vt-desc">{t.hint}</div>
        </div>
        <input
          type="checkbox"
          className="settings-checkbox"
          checked={enabled}
          onChange={(e) => handleToggleEnabled(e.target.checked)}
        />
      </div>

      {enabled && (
        <>
          {/* Target Language Select */}
          <div className="vt-row glass">
            <span className="vt-label">{t.target_lang}</span>
            <div className="vt-lang-buttons">
              <button
                className={`vt-lang-btn ${targetLang === 'ru' ? 'active' : ''}`}
                onClick={() => handleLangChange('ru')}
              >
                {t.lang_ru}
              </button>
              <button
                className={`vt-lang-btn ${targetLang === 'en' ? 'active' : ''}`}
                onClick={() => handleLangChange('en')}
              >
                {t.lang_en}
              </button>
            </div>
          </div>

          {/* Volume Balance Sliders */}
          <div className="vt-section glass">
            <div className="vt-section-title">{t.volume_balance}</div>

            <div className="vt-slider-row">
              <div className="vt-slider-header">
                <span>{t.orig_vol}</span>
                <span className="vt-slider-val">{originalVolume}%</span>
              </div>
              <input
                type="range"
                className="vt-slider"
                min="0"
                max="100"
                value={originalVolume}
                onChange={(e) => handleOriginalVolChange(e.target.value)}
              />
            </div>

            <div className="vt-slider-row">
              <div className="vt-slider-header">
                <span>{t.trans_vol}</span>
                <span className="vt-slider-val">{translationVolume}%</span>
              </div>
              <input
                type="range"
                className="vt-slider"
                min="0"
                max="100"
                value={translationVolume}
                onChange={(e) => handleTranslationVolChange(e.target.value)}
              />
            </div>
          </div>

          {/* Action Trigger for current video page */}
          <div className="vt-action-section">
            <button
              className={`vt-action-btn ${translating ? 'active' : ''} ${!isVideo ? 'disabled' : ''}`}
              onClick={handleActionClick}
              disabled={!isVideo}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              {translating ? t.stop_translate : t.translate_now}
            </button>
            <div className="vt-status">
              {statusMsg || (isVideo ? t.status_ready : t.status_no_video)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
