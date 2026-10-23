// ============================================================================
// background.js — Service Worker для Asset Extractor DevTools Extension (MV3).
//
// Выполняет сетевые запросы от лица расширения с правами <all_urls>:
// в отличие от панелей DevTools, background service worker в MV3 не блокируется
// CORS-политикой страницы при загрузке внешних .map файлов и исходников.
// ============================================================================

'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'fetchUrl' && typeof message.url === 'string') {
    const url = message.url;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status, statusText: response.statusText });
          return;
        }
        const text = await response.text();
        sendResponse({ ok: true, text });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true; // Держит порт открытым для асинхронного sendResponse
  }
});
