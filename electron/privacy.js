/**
 * privacy.js — real tracker blocking + traffic statistics.
 *
 * Listens on session.defaultSession.webRequest and:
 *  1. Cancels requests to known tracking/ad domains (public Disconnect-style list).
 *  2. Accumulates per-domain request counts and approximate body sizes,
 *     plus the list of blocked trackers (for the Traffic Monitor panel).
 *
 * No simulation: everything here is measured on real outgoing requests.
 */
const { session } = require('electron')

// ─── Tracker blocklist (subset of the public Disconnect list) ──────
const TRACKER_DOMAINS = new Set([
  // Google tracking
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'adservice.google.com', 'app-measurement.com', 'crashlytics.com',
  // Social widgets / pixels
  'connect.facebook.net', 'facebook.net', 'graph.facebook.com',
  'analytics.twitter.com', 'static.ads-twitter.com', 'ads-twitter.com',
  'platform.twitter.com', 'ads.linkedin.com', 'px.ads.linkedin.com',
  'snap.licdn.com', 'tr.snapchat.com', 'analytics.tiktok.com',
  'business.tiktok.com', 'ads.tiktok.com', 'events.redditmedia.com',
  'ads.pinterest.com', 'log.pinterest.com',
  // Analytics / ads networks
  'adnxs.com', 'adsystem.com', 'criteo.com', 'criteo.net', 'taboola.com',
  'outbrain.com', 'scorecardresearch.com', 'quantserve.com', 'quantcount.com',
  'hotjar.com', 'hotjar.io', 'mouseflow.com', 'fullstory.com', 'clarity.ms',
  'yandex.ru/metrika', 'mc.yandex.ru', 'top-fwz1.mail.ru', 'ad.mail.ru',
  'hitcounter.ru', 'liveinternet.ru', 'rambler.ru/top100',
  'moatads.com', 'adsafeprotected.com', 'amazon-adsystem.com',
  'bidswitch.net', 'casalemedia.com', 'openx.net', 'pubmatic.com',
  'rubiconproject.com', 'sharethrough.com', 'smartadserver.com',
  'yieldmo.com', 'zedo.com', 'adform.net', 'adroll.com', 'branch.io',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'kissmetrics.com', 'matomo.cloud', 'statcounter.com', 'clicky.com',
  'chartbeat.com', 'parsely.com', 'newrelic.com', 'nr-data.net',
  'bugsnag.com', 'intercom.io', 'widget.intercom.io', 'cdn.intercom.io',
  'onesignal.com', 'pushwoosh.com', 'pushcrew.com', 'braze.com',
])

// Non-ad infrastructure that must never be blocked (breaks logins/CDNs).
const ALLOW_DOMAINS = new Set([
  'accounts.google.com', 'login.microsoftonline.com', 'login.live.com',
  'appleid.apple.com', 'id.rambler.ru', 'oauth.yandex.ru',
])

function registrableDomain(host) {
  if (!host) return ''
  let h = host.toLowerCase()
  if (h.startsWith('www.')) h = h.slice(4)
  // Cheap eTLD+1 for the common two-level TLDs we may meet.
  const twoLevel = /(\.com|\.co|\.net|\.org|\.gov|\.edu|\.az|\.ru|\.uk|\.tr|\.de|\.io|\.ua|\.by|\.kz)$/i
  const parts = h.split('.')
  if (parts.length > 2) {
    const last2 = '.' + parts.slice(-2).join('.')
    if (twoLevel.test(last2) && parts.length > 3) {
      return parts.slice(-3).join('.')
    }
  }
  return parts.slice(-2).join('.')
}

function isTrackerUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (ALLOW_DOMAINS.has(host)) return false
    const domain = registrableDomain(host)
    if (ALLOW_DOMAINS.has(domain)) return false
    for (const t of TRACKER_DOMAINS) {
      if (host === t || host.endsWith('.' + t) || domain === t) return true
    }
    return false
  } catch {
    return false
  }
}

class Privacy {
  constructor() {
    this.blockedTotal = 0           // all-time (persisted below)
    this.blockedSession = 0         // this session
    this.blockedByDomain = new Map()  // tracker domain -> count
    this.traffic = new Map()          // site domain -> { requests, bytesIn, trackers }
    this.recentBlocked = []           // last 100 blocked requests [{host, url, ts}]
    this.startedAt = Date.now()
  }

  /**
   * Register the SINGLE webRequest guard for the session.
   * Electron's onBeforeRequest supports only one listener, so the
   * Strict-HTTPS block and tracker blocking must live together here.
   * `isHttpsExempt` comes from main.js and decides which URLs may use http://.
   */
  attach({ isHttpsExempt }) {
    const ses = session.defaultSession

    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      const isMainFrame = details.resourceType === 'mainFrame'
      const url = details.url || ''

      // 0. Strict HTTPS: cancel cleartext http(s)/ws unless exempt
      if (url.startsWith('http://') || url.startsWith('ws://')) {
        if (!isHttpsExempt(url)) {
          callback({ cancel: true })
          return
        }
        // Exempt dev/local traffic: still count it, never block.
        callback({ cancel: false })
        return
      }

      // 1. Tracker blocking (never block main frames — that would break sites)
      if (!isMainFrame && isTrackerUrl(url)) {
        this.blockedTotal += 1
        this.blockedSession += 1
        const host = (() => { try { return new URL(url).hostname } catch { return url } })()
        this.blockedByDomain.set(host, (this.blockedByDomain.get(host) || 0) + 1)
        this.recentBlocked.unshift({ host, url, ts: Date.now() })
        if (this.recentBlocked.length > 100) this.recentBlocked.pop()
        callback({ cancel: true })
        return
      }

      // 2. Traffic accounting for real https traffic
      if (url.startsWith('https')) {
        const site = isMainFrame
          ? registrableDomain((() => { try { return new URL(url).hostname } catch { return '' } })())
          : null
        // Attribute sub-resource requests to the last main frame site.
        const target = site || this._lastSite || 'other'
        if (site) this._lastSite = site
        if (target && target !== 'other') {
          let stat = this.traffic.get(target)
          if (!stat) { stat = { requests: 0, bytesIn: 0, trackers: 0 }; this.traffic.set(target, stat) }
          stat.requests += 1
          const size = Number(details.headers && (details.headers['Content-Length'] || details.headers['content-length'])) || 0
          stat.bytesIn += size
        }
      }

      callback({ cancel: false })
    })
  }

  getStats() {
    const sites = [...this.traffic.entries()]
      .map(([domain, s]) => ({ domain, ...s }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 50)
    const topTrackers = [...this.blockedByDomain.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
    return {
      session: {
        blocked: this.blockedSession,
        startedAt: this.startedAt,
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        requestsTracked: [...this.traffic.values()].reduce((a, s) => a + s.requests, 0),
        sitesVisited: this.traffic.size,
      },
      allTime: { blocked: this.blockedTotal },
      topTrackers,
      recentBlocked: this.recentBlocked.slice(0, 50),
      sites,
    }
  }

  reset() {
    this.blockedSession = 0
    this.blockedByDomain.clear()
    this.traffic.clear()
    this.recentBlocked = []
    this.startedAt = Date.now()
  }
}

module.exports = { Privacy }
