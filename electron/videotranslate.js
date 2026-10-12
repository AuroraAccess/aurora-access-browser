/**
 * videotranslate.js — free voice-over video translation (Yandex VOT API)
 *
 * Uses the reverse-engineered Yandex browser translation API through
 * the open-source client @tskau/vtrans. Privacy/diskspace invariants:
 *
 * 1. RAM ONLY — translated audio never touches the disk. A tiny HTTP hub
 *    on 127.0.0.1 serves the cached audio buffer to the page's <audio> tag
 *    (also sidesteps any CORS/mixed-content issues with Yandex S3 URLs).
 * 2. AUTO EVICTION — a session's audio is dropped when the user leaves the
 *    video, presses “Stop”, or after a TTL idle sweep; the hub holds no
 *    more than N sessions at once (default 4) and sheds the oldest.
 */

const { Client } = require('@tskau/vtrans')

const IDLE_TTL_MS = 10 * 60 * 1000     // 10 min without a play → evict
const MAX_SESSIONS = 4                 // hard memory ceiling
const SWEEP_INTERVAL_MS = 60 * 1000

class VideoTranslationHub {
  constructor() {
    this.client = new Client()
    // sessionId → { buffer, mime, duration, subtitles, lastTouch, videoUrl }
    this.sessions = new Map()
    this.server = null
    this.port = null
    this.sweepTimer = null
    this.nextId = 1
  }

  /** Start the localhost hub lazily on first use. */
  async ensureServer() {
    if (this.server) {
      if (this.port !== null) return this.port
      // still binding — wait for it
      await new Promise((resolve, reject) => {
        this.server.once('listening', resolve)
        this.server.once('error', reject)
      })
      return this.port
    }

    const http = require('http')
    this.server = http.createServer((req, res) => {
      // /t/<id> — audio, /s/<id> — subtitles JSON
      const m = /^\/(t|s)\/([a-z0-9]+)$/i.exec(req.url || '')
      if (!m) { res.writeHead(404); res.end(); return }
      const session = this.sessions.get(m[2])
      const kind = m[1].toLowerCase()
      const data = kind === 't' ? session?.buffer : session?.subtitles
      if (!data) { res.writeHead(404); res.end(); return }
      res.writeHead(200, {
        'Content-Type': kind === 't'
          ? (session.mime || 'audio/mpeg')
          : 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(data)
    })
    // Port 0 → the OS picks a free one; local-only binding.
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    this.port = this.server.address().port

    this.sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
    return this.port
  }

  _sweep() {
    const now = Date.now()
    for (const [id, s] of this.sessions) {
      if (now - s.lastTouch > IDLE_TTL_MS) {
        this.sessions.delete(id)
      }
    }
  }

  _evictOverflow() {
    while (this.sessions.size >= MAX_SESSIONS) {
      // Oldest touch first.
      let oldestKey = null
      let oldest = Infinity
      for (const [id, s] of this.sessions) {
        if (s.lastTouch < oldest) { oldest = s.lastTouch; oldestKey = id }
      }
      if (!oldestKey) break
      this.sessions.delete(oldestKey)
    }
  }

  _videoId(videoUrl) {
    try {
      const u = new URL(videoUrl)
      const v = u.searchParams.get('v')
      if (v) return v
      // youtu.be/<id> / shorts
      const m = /\/(?:shorts|embed|live)?\/?([A-Za-z0-9_-]{11})/.exec(u.pathname)
      return m ? m[1] : u.pathname
    } catch (_) {
      return videoUrl
    }
  }

  /**
   * Request (or fetch from cache) a translation for a video URL.
   * Returns { ok, status, url, duration, remainingTime, subtitlesUrl }.
   * status: SUCCESS | WORK_IN_PROGRESS | FAILED | NOT_FOUND
   */
  async translate(videoUrl, { originalLanguage = 'auto', translationLanguage = 'ru' } = {}) {
    await this.ensureServer()

    const cachedKey = (s) => s.videoUrl === videoUrl
      && s.originalLanguage === originalLanguage
      && s.translationLanguage === translationLanguage

    // Already fully cached?
    for (const s of this.sessions.values()) {
      if (cachedKey(s) && s.ready) {
        s.lastTouch = Date.now()
        return this._readyPayload(s)
      }
    }

    const lang = originalLanguage === 'auto' ? undefined : originalLanguage
    let result
    try {
      result = await this.client.translate({
        originalUrl: videoUrl,
        originalLanguage: lang,
        translationLanguage,
      })
    } catch (e) {
      return { ok: false, status: 'FAILED', error: e.message }
    }

    if (result.status === 'WORK_IN_PROGRESS') {
      return { ok: true, status: 'WORK_IN_PROGRESS', remainingTime: result.remainingTime }
    }
    if (result.status !== 'SUCCESS') {
      return { ok: false, status: result.status || 'FAILED' }
    }

    // Download the generated audio into RAM (never disk).
    let buffer
    try {
      buffer = await result.translation.content.stream()
        .then((stream) => this._collect(stream))
    } catch (e) {
      return { ok: false, status: 'FAILED', error: e.message }
    }

    const id = String(this.nextId++)
    const session = {
      id,
      videoUrl,
      videoId: this._videoId(videoUrl),
      originalLanguage,
      translationLanguage,
      mime: 'audio/mpeg',
      buffer,
      subtitles: null,
      duration: result.translation.duration || 0,
      ready: false,
      lastTouch: Date.now(),
    }
    this._evictOverflow()
    this.sessions.set(id, session)

    // Subtitles are best-effort: absence is not an error.
    try {
      const subs = await this.client.getSubtitles({
        originalUrl: videoUrl,
        originalLanguage: lang,
      })
      const translated = subs.translations?.find(t => t.language === translationLanguage)
        || subs.translations?.[0]
      const src = translated || subs.original
      if (src) {
        const sbuf = await src.content.stream().then((s) => this._collect(s))
        session.subtitles = sbuf
      }
    } catch (_) { /* subtitles are optional */ }

    session.ready = true
    return this._readyPayload(session)
  }

  _collect(stream) {
    return new Promise((resolve, reject) => {
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  _readyPayload(session) {
    return {
      ok: true,
      status: 'SUCCESS',
      audioUrl: `http://127.0.0.1:${this.port}/t/${session.id}`,
      subtitlesUrl: session.subtitles ? `http://127.0.0.1:${this.port}/s/${session.id}` : null,
      duration: session.duration,
      videoId: session.videoId,
      sessionId: session.id,
    }
  }

  /** Stop playback state tracked by the page: just refresh lastTouch. */
  touch(sessionId) {
    const s = this.sessions.get(String(sessionId))
    if (s) s.lastTouch = Date.now()
  }

  /** Explicit release of one session's memory. */
  release(sessionId) {
    const s = this.sessions.get(String(sessionId))
    if (s) {
      s.buffer = null
      s.subtitles = null
      this.sessions.delete(String(sessionId))
    }
  }

  stop() {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sessions.clear()
    if (this.server) {
      try { this.server.close() } catch (_) { /* ignore */ }
      this.server = null
      this.port = null
    }
  }
}

module.exports = { VideoTranslationHub }
