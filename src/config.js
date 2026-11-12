/* 
 * [RCF-CORE-PROTOCOL]
 * [RCF:OPEN]
 * Aurora Access Central Configuration
 * Access Level: SECURE-CORE
 */

// ─── Tab session partitions ───────────────────────────────────────
// A tab's <webview partition> is immutable once the element exists, so it is
// chosen ONCE from the URL the tab was opened with and then stored on the tab.
// Recomputing it from the live URL made a tab silently switch cookie jars:
// navigating from example.com to youtube.com left the webview on the
// persistent profile, while a hibernated tab woke up on the RAM video session
// (or the other way round), losing the signed-in state.
export const DEFAULT_PARTITION = 'persist:aurora';
// No persist: prefix → Chromium keeps this session's cookies, cache and media
// in memory only (see electron/main.js YOUTUBE_PARTITION).
export const VIDEO_PARTITION = 'nitrous_youtube_session';

const VIDEO_SITE_URL = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/i;

/** The partition a tab gets when it is opened — never changes afterwards. */
export function partitionForUrl(url) {
  return VIDEO_SITE_URL.test(url || '') ? VIDEO_PARTITION : DEFAULT_PARTITION;
}

export const CONFIG = {
  // Official project domains
  OFFICIAL_SITE: 'https://aliyev.site',

  // Support & Community
  SUPPORT_BOT: 'https://t.me/PremiumAzSupportBOT',
  TELEGRAM_CHANNEL: 'https://t.me/PremiumAzerbaijanOfficial',
  GITHUB_REPO: 'https://github.com',

  // External Search
  DEFAULT_SEARCH_ENGINE: 'https://www.google.com/search?q=',

  // Metadata
  BROWSER_NAME: 'Aurora Access Browser',
  VERSION: '2.2.6',
};
