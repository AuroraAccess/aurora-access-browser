/**
 * Unit tests for electron/release-check.js — the GitHub-API release probe
 * behind the AutoUpdateModal (TZ v2.0.9 feature #4).
 *
 * Runs under plain node --test: the module takes an injectable `net` client,
 * so no Electron and no real network round-trips are involved. The fake net
 * records the request options and lets a test script the HTTP response that
 * the real net.request would have streamed back.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const releaseCheck = require('../electron/release-check')

/** Fake net client: records the request and replays a scripted response. */
function fakeNet({ statusCode = 200, body = '', streamError = null, onRequest = null } = {}) {
  const recorded = []
  return {
    recorded,
    request(options) {
      recorded.push(options)
      if (onRequest) onRequest(options)
      const req = new EventEmitter()
      // net.request is also an emitter for life-cycle errors (offline, DNS…).
      req.end = () => {
        if (streamError) {
          process.nextTick(() => req.emit('error', streamError))
          return
        }
        const res = new EventEmitter()
        res.statusCode = statusCode // the real net response exposes this
        process.nextTick(() => {
          req.emit('response', res)
          if (statusCode === 200) {
            res.emit('data', Buffer.from(body))
            res.emit('end')
          }
        })
      }
      return req
    },
  }
}

const RELEASE_JSON = {
  tag_name: 'v2.0.9',
  name: 'Aurora Access 2.0.9',
  html_url: 'https://github.com/AuroraAccess/aurora-access-browser/releases/tag/v2.0.9',
  body: '### Fixed\n- proxy bypass rules',
  published_at: '2026-10-14T12:00:00Z',
}

test('compareVersions: numeric dotted comparison', () => {
  assert.ok(releaseCheck.compareVersions('2.0.9', '2.0.8') > 0)
  assert.ok(releaseCheck.compareVersions('2.0.8', '2.0.8') === 0)
  assert.ok(releaseCheck.compareVersions('2.0.7', '2.0.8') < 0)
  assert.ok(releaseCheck.compareVersions('2.1', '2.0.10') > 0)
})

test('stripTagPrefix cuts the v prefix', () => {
  assert.equal(releaseCheck.stripTagPrefix('v2.0.9'), '2.0.9')
  assert.equal(releaseCheck.stripTagPrefix('2.0.9'), '2.0.9')
  assert.equal(releaseCheck.stripTagPrefix('V2.1.0'), '2.1.0')
})

test('checkForUpdate: newer GitHub release → isUpdate with UI payload', async () => {
  const net = fakeNet({ body: JSON.stringify(RELEASE_JSON) })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })

  assert.equal(res.ok, true)
  assert.equal(res.isUpdate, true)
  assert.equal(res.latestVersion, '2.0.9')
  // The release payload the modal consumes — trimmed to safe plain fields.
  assert.equal(res.release.version, '2.0.9')
  assert.equal(res.release.url, RELEASE_JSON.html_url)
  assert.match(res.release.notes, /proxy bypass rules/)
})

test('checkForUpdate: same version → no update', async () => {
  const net = fakeNet({ body: JSON.stringify(RELEASE_JSON) })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.9', net })
  assert.equal(res.ok, true)
  assert.equal(res.isUpdate, false)
})

test('checkForUpdate: request carries the mandatory GitHub headers', async () => {
  const net = fakeNet({ body: JSON.stringify(RELEASE_JSON) })
  await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })
  const opts = net.recorded[0]
  assert.equal(opts.method, 'GET')
  assert.match(opts.url, /api\.github\.com\/repos\/AuroraAccess\/aurora-access-browser\/releases\/latest/)
  assert.equal(opts.headers['User-Agent'], 'AuroraAccess-Browser')
  assert.match(opts.headers.Accept, /vnd\.github\+json/)
})

test('checkForUpdate: non-200 HTTP answer is a soft failure', async () => {
  // e.g. GitHub rate-limit / proxy auth failure — must not crash the app.
  const net = fakeNet({ statusCode: 403, body: '{"message":"rate limited"}' })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })
  assert.equal(res.ok, false)
  assert.match(res.error, /HTTP 403/)
})

test('checkForUpdate: malformed JSON is a soft failure', async () => {
  const net = fakeNet({ body: 'not json at all' })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })
  assert.equal(res.ok, false)
  assert.match(res.error, /malformed JSON/)
})

test('checkForUpdate: payload without tag_name is a soft failure', async () => {
  const net = fakeNet({ body: JSON.stringify({ ok: true }) })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })
  assert.equal(res.ok, false)
  assert.match(res.error, /tag_name/)
})

test('checkForUpdate: stream error propagates as a soft failure', async () => {
  const net = fakeNet({ streamError: new Error('ENOTFOUND') })
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net })
  assert.equal(res.ok, false)
  assert.match(res.error, /ENOTFOUND/)
})

test('checkForUpdate: missing net client is a soft failure, not a throw', async () => {
  const res = await releaseCheck.checkForUpdate({ currentVersion: '2.0.8', net: null })
  assert.equal(res.ok, false)
  assert.match(res.error, /No net client/)
})

test('checkForUpdate: missing current version aborted early', async () => {
  const res = await releaseCheck.checkForUpdate({ currentVersion: '', net: fakeNet() })
  assert.equal(res.ok, false)
})
