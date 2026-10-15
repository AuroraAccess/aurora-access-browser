/**
 * Unit tests for electron/release-publisher.js — the GitHub release creator
 * behind the Releases panel. Runs under plain node --test with an injectable
 * fake net client (same trick as test/release-check.test.js): no Electron,
 * no real network. Payload validation is exercised directly too.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const publisher = require('../electron/release-publisher')

/** Fake net client capturing POST requests and replaying a scripted answer. */
function fakeNet({ statusCode = 201, body = '{"id":42,"html_url":"https://github.com/AuroraAccess/aurora-access-browser/releases/tag/v2.0.9"}', streamError = null } = {}) {
  const recorded = []
  return {
    recorded,
    request(options) {
      recorded.push(options)
      const req = new EventEmitter()
      req.end = (payload) => {
        recorded[recorded.length - 1].payload = String(payload || '')
        if (streamError) {
          process.nextTick(() => req.emit('error', streamError))
          return
        }
        const res = new EventEmitter()
        res.statusCode = statusCode
        process.nextTick(() => {
          req.emit('response', res)
          res.emit('data', Buffer.from(body))
          res.emit('end')
        })
      }
      return req
    },
  }
}

test('buildReleasePayload: normalizes the tag and fills defaults', () => {
  const p = publisher.buildReleasePayload({ tag: '2.0.9', draft: true })
  assert.equal(p.tag_name, 'v2.0.9')
  assert.equal(p.draft, true)
  assert.equal(p.prerelease, false)
  assert.equal(p.name, undefined)
  assert.equal(p.body, undefined)
})

test('buildReleasePayload: keeps name, notes and target', () => {
  const p = publisher.buildReleasePayload({
    tag: 'v2.0.9',
    name: 'Release v2.0.9',
    notes: '### Fixed\n- proxy rules',
    target: 'main',
    draft: false,
    prerelease: true,
  })
  assert.equal(p.name, 'Release v2.0.9')
  assert.equal(p.body, '### Fixed\n- proxy rules')
  assert.equal(p.target_commitish, 'main')
  assert.equal(p.draft, false)
  assert.equal(p.prerelease, true)
})

test('buildReleasePayload: rejects non-version tags', () => {
  assert.throws(() => publisher.buildReleasePayload({ tag: 'main', draft: true }), /not a version tag/)
  assert.throws(() => publisher.buildReleasePayload({ tag: 'drop;table', draft: true }), /not a version tag/)
})

test('buildReleasePayload: rejects hostile target refs', () => {
  assert.throws(() => publisher.buildReleasePayload({ tag: 'v2.0.9', target: 'a b c' }), /invalid ref/)
  assert.throws(() => publisher.buildReleasePayload({ tag: 'v2.0.9', target: 'x/y$' }), /invalid ref/)
})

test('buildReleasePayload: rejects non-object input', () => {
  assert.throws(() => publisher.buildReleasePayload(null), /expected object/)
  assert.throws(() => publisher.buildReleasePayload('v2.0.9'), /expected object/)
})

test('createRelease: 201 returns ok with url and tag', async () => {
  const net = fakeNet()
  const res = await publisher.createRelease(
    { tag: 'v2.0.9', name: 'Release v2.0.9', notes: 'notes', draft: true },
    { net, token: 't0k3n' }
  )
  assert.equal(res.ok, true)
  assert.equal(res.tag, 'v2.0.9')
  assert.match(res.url, /releases\/tag\/v2\.0\.9/)
  // POST went out with the auth header and the JSON payload.
  const req = net.recorded[0]
  assert.equal(req.method, 'POST')
  assert.equal(req.headers.Authorization, 'Bearer t0k3n')
  assert.equal(req.headers.Accept, 'application/vnd.github+json')
  assert.match(req.payload, /"tag_name":"v2\.0\.9"/)
  assert.match(req.payload, /"draft":true/)
})

test('createRelease: validation failure is a soft ok:false', async () => {
  const net = fakeNet()
  const res = await publisher.createRelease({ tag: ' nonsense ', draft: true }, { net, token: 't' })
  assert.equal(res.ok, false)
  // Nothing was sent over the wire.
  assert.equal(net.recorded.length, 0)
})

test('createRelease: 401 surfaces a token problem', async () => {
  const net = fakeNet({ statusCode: 401, body: '{"message":"Bad credentials"}' })
  const res = await publisher.createRelease({ tag: 'v2.0.9', draft: true }, { net, token: 'bad' })
  assert.equal(res.ok, false)
  assert.match(res.error, /401/)
})

test('createRelease: 422 surfaces GitHub validation details', async () => {
  const net = fakeNet({
    statusCode: 422,
    body: JSON.stringify({ message: 'Validation Failed', errors: [{ message: 'tag_name already exists' }] }),
  })
  const res = await publisher.createRelease({ tag: 'v2.0.9', draft: true }, { net, token: 't' })
  assert.equal(res.ok, false)
  assert.match(res.error, /tag_name already exists/)
})

test('createRelease: missing token is refused before any request', async () => {
  const net = fakeNet()
  const res = await publisher.createRelease({ tag: 'v2.0.9', draft: true }, { net, token: '' })
  assert.equal(res.ok, false)
  assert.match(res.error, /No GitHub token/)
  assert.equal(net.recorded.length, 0)
})

test('createRelease: network failure is a soft ok:false', async () => {
  const net = fakeNet({ streamError: new Error('ECONNREFUSED') })
  const res = await publisher.createRelease({ tag: 'v2.0.9', draft: true }, { net, token: 't' })
  assert.equal(res.ok, false)
  assert.match(res.error, /ECONNREFUSED/)
})

test('hasReleaseToken reads the environment only', () => {
  const saved = process.env.AURORA_GITHUB_TOKEN
  try {
    delete process.env.AURORA_GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    assert.equal(publisher.hasReleaseToken(), false)
    process.env.AURORA_GITHUB_TOKEN = 'x'
    assert.equal(publisher.hasReleaseToken(), true)
  } finally {
    if (saved === undefined) delete process.env.AURORA_GITHUB_TOKEN
    else process.env.AURORA_GITHUB_TOKEN = saved
  }
})
