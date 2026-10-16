/**
 * Unit tests for electron/proxy-control.js — the runtime proxy controller.
 *
 * Runs under plain Node (node --test): this module deliberately has no
 * electron imports, so Electron sessions are replaced with fakes that record
 * every call.
 *
 * Focus: clearAuthCaches() — after a proxy switch (endpoint change or going
 * direct) the HTTP auth cache must be wiped on every session, so credentials
 * authenticated through the old route are never replayed against the new one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const os = require('os')
const fs = require('fs')

const proxyControl = require('../electron/proxy-control')

/** Fake Electron session: counts clearAuthCache()/setProxy() calls. */
function fakeSession(name, { failClear = false } = {}) {
  return {
    name,
    clearAuthCacheCalls: 0,
    setProxyCalls: [],
    async clearAuthCache() {
      this.clearAuthCacheCalls += 1
      if (failClear) throw new Error(`clearAuthCache failed on ${name}`)
      return undefined
    },
    async setProxy(options) {
      this.setProxyCalls.push(options)
      return undefined
    },
  }
}

test.describe = test.describe || ((name, fn) => fn())

test('clearAuthCaches clears every session provided', async () => {
  const a = fakeSession('a')
  const b = fakeSession('b')
  const c = fakeSession('c')

  const result = await proxyControl.clearAuthCaches([a, b, c])

  assert.equal(a.clearAuthCacheCalls, 1)
  assert.equal(b.clearAuthCacheCalls, 1)
  assert.equal(c.clearAuthCacheCalls, 1)
  assert.deepEqual(result, { cleared: 3, failed: 0 })
})

test('clearAuthCaches tolerates per-session failure and reports counts', async () => {
  const good = fakeSession('good')
  const bad = fakeSession('bad', { failClear: true })

  const result = await proxyControl.clearAuthCaches([good, bad])

  // The failing session is attempted once and must not abort the others.
  assert.equal(bad.clearAuthCacheCalls, 1)
  assert.equal(good.clearAuthCacheCalls, 1)
  assert.deepEqual(result, { cleared: 1, failed: 1 })
})

test('clearAuthCaches skips falsy entries', async () => {
  const a = fakeSession('a')
  const result = await proxyControl.clearAuthCaches([null, a, undefined])

  assert.equal(a.clearAuthCacheCalls, 1)
  assert.deepEqual(result, { cleared: 1, failed: 0 })
})

test('clearAuthCaches handles a single (non-array) session argument', async () => {
  const a = fakeSession('a')
  const result = await proxyControl.clearAuthCaches(a)
  assert.deepEqual(result, { cleared: 1, failed: 0 })
})

test('clearAuthCaches with an empty list is a no-op', async () => {
  const result = await proxyControl.clearAuthCaches([])
  assert.deepEqual(result, { cleared: 0, failed: 0 })
})

test('setProxy applies rules to sessions and state is restored afterwards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-control-test-'))
  try {
    const sessions = [fakeSession('default'), fakeSession('webview')]
    let applied = null
    const applier = async (_state, rules, bypass) => {
      applied = { rules, bypass }
      // Mirror what main.js applyProxyControl does with the sessions.
      for (const ses of sessions) {
        if (rules) {
          await ses.setProxy({ proxyRules: rules, proxyBypassRules: bypass })
        } else {
          await ses.setProxy({ mode: 'direct' })
        }
      }
      await proxyControl.clearAuthCaches(sessions)
    }

    await proxyControl.init({ userDataPath: dir, apply: applier })

    const result = await proxyControl.setProxy({
      enabled: true,
      protocol: 'socks5',
      host: '10.0.0.1',
      port: '1080',
      username: 'u',
      password: 'p',
    })

    assert.equal(result.ok, true)
    // socks5:// rules were built from the normalized state.
    assert.equal(applied.rules, 'socks5://10.0.0.1:1080')
    // Every session got exactly one setProxy call with the new rules + one auth-cache clear.
    for (const ses of sessions) {
      assert.equal(ses.setProxyCalls.length, 1)
      assert.equal(ses.setProxyCalls[0].proxyRules, 'socks5://10.0.0.1:1080')
      assert.equal(ses.clearAuthCacheCalls, 1, 'auth cache must be cleared on switch')
    }

    // Disabling goes back to direct and clears the auth cache again.
    const off = await proxyControl.disable()
    assert.equal(off.ok, true)
    assert.equal(applied.rules, null)
    for (const ses of sessions) {
      assert.equal(ses.setProxyCalls[1].mode, 'direct')
      assert.equal(ses.clearAuthCacheCalls, 2, 'auth cache must be cleared when going direct')
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed setProxy does NOT clear the auth cache (cache only wiped on success)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-control-test-'))
  try {
    const ses = fakeSession('default')
    const applier = async () => {
      throw new Error('boom')
    }
    await proxyControl.init({ userDataPath: dir, apply: applier })

    const result = await proxyControl.setProxy({
      enabled: true,
      protocol: 'socks5',
      host: '10.0.0.1',
      port: '1080',
    })

    assert.equal(result.ok, false)
    assert.equal(ses.clearAuthCacheCalls, 0, 'no cache clear when the apply failed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('setProxy validation: bad protocol is rejected before any session is touched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-control-test-'))
  try {
    const ses = fakeSession('default')
    const applier = async () => {
      await ses.setProxy({ proxyRules: 'x' })
    }
    await proxyControl.init({ userDataPath: dir, apply: applier })

    const result = await proxyControl.setProxy({ enabled: true, protocol: 'ftp', host: 'h', port: '1' })

    assert.equal(result.ok, false)
    assert.match(result.error, /Unsupported protocol/)
    assert.equal(ses.setProxyCalls.length, 0, 'sessions must not be touched on validation failure')
    assert.equal(ses.clearAuthCacheCalls, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildProxyRules mirrors the enabled state', () => {
  assert.equal(proxyControl.buildProxyRules({ enabled: false }), null)
  assert.equal(proxyControl.buildProxyRules({ enabled: true, protocol: 'socks5', host: 'h', port: '1080' }), 'socks5://h:1080')
})

test('vProxyConfig allows empty and valid bypassRules without error', () => {
  const { vProxyConfig } = require('../electron/ipc-guard')
  assert.doesNotThrow(() => vProxyConfig({ host: '127.0.0.1', port: 1080, bypassRules: '' }))
  assert.doesNotThrow(() => vProxyConfig({ host: '127.0.0.1', port: 1080, bypassRules: 'localhost, 127.0.0.1, <local>' }))
  assert.doesNotThrow(() => vProxyConfig({ host: '127.0.0.1', port: 1080, bypassRules: '192.168.1.0/24;*.example.com' }))
})
