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
const net = require('net')

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

/** Reserve a TCP port: open, close, reuse the number right away. */
function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/** Poll `cond` until true or the timeout elapses. */
async function waitFor(cond, timeoutMs = 3000, step = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await Promise.resolve().then(cond)) return true
    await new Promise((r) => setTimeout(r, step))
  }
  return false
}

test('sticky auto-start: unreachable saved endpoint boots direct but stays enabled', async () => {
  process.env.AURORA_PROXY_WATCHDOG_INTERVAL = '120'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-control-test-'))
  try {
    const port = await reservePort()
    const savedState = {
      enabled: true,
      protocol: 'socks5',
      host: '127.0.0.1',
      port: String(port),
    }
    fs.writeFileSync(path.join(dir, 'proxy-state.json'), JSON.stringify(savedState))

    let applied = null
    const sessions = [fakeSession('default')]
    const applier = async (state, rules, bypass) => {
      applied = { rules, bypass, enabled: state.enabled }
      for (const ses of sessions) {
        if (rules) await ses.setProxy({ proxyRules: rules, proxyBypassRules: bypass })
        else await ses.setProxy({ mode: 'direct' })
      }
    }

    await proxyControl.init({ userDataPath: dir, apply: applier })

    // The dead endpoint did NOT flip the saved toggle off.
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'proxy-state.json'), 'utf8'))
    assert.equal(persisted.enabled, true, 'a transient outage must not persist enabled=false')
    // The sessions were pointed at a direct connection for this run.
    assert.equal(applied.rules, null)
    assert.equal(sessions[0].setProxyCalls[0].mode, 'direct')

    // Auto-reconnect: the endpoint comes up, the watchdog re-applies the proxy.
    const server = net.createServer().listen(port, '127.0.0.1', () => {})
    const reconnected = await waitFor(() => applied.rules === 'socks5://127.0.0.1:' + port)
    server.close()

    assert.ok(reconnected, 'watchdog must re-apply the proxy once the endpoint answers')
    assert.equal(sessions[0].setProxyCalls[1].proxyRules, 'socks5://127.0.0.1:' + port)

    // Cleanup: user turns it off — the watchdog must stop doing its job.
    const off = await proxyControl.disable()
    assert.equal(off.ok, true)
    const stopped = await waitFor(
      () => JSON.parse(fs.readFileSync(path.join(dir, 'proxy-state.json'), 'utf8')).enabled === false
    )
    assert.ok(stopped, 'disable() must persist enabled=false')

    // The endpoint stays unreachable-intentionally after the server closed;
    // a live watchdog would have flipped the sessions DIRECT → PROXY again.
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(applied.rules, null, 'after disable() the watchdog must not re-apply the proxy')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    delete process.env.AURORA_PROXY_WATCHDOG_INTERVAL
  }
})
