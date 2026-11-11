const test = require('node:test')
const assert = require('node:assert/strict')

const { seedAuthCookies } = require('../electron/cookie-bridge')

function fakeSession(cookies, { failSet = false } = {}) {
  const jar = cookies.map((c) => ({ ...c }))
  return {
    jar,
    cookies: {
      get: async () => jar.map((c) => ({ ...c })),
      set: async (details) => {
        if (failSet) throw new Error('set failed')
        const key = `${details.name}|${details.domain || new URL(details.url).hostname}|${details.path}`
        const idx = jar.findIndex(
          (c) => `${c.name}|${c.domain}|${c.path}` === key
        )
        const stored = {
          name: details.name,
          value: details.value,
          domain: details.domain || new URL(details.url).hostname,
          hostOnly: !details.domain,
          path: details.path,
          secure: details.secure,
          httpOnly: details.httpOnly,
          sameSite: details.sameSite,
          session: details.expirationDate === undefined,
          expirationDate: details.expirationDate,
        }
        if (idx === -1) jar.push(stored)
        else jar[idx] = stored
        return true
      },
    },
  }
}

const authCookie = (over = {}) => ({
  name: 'SID',
  value: 'abc',
  domain: '.google.com',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'no_restriction',
  session: false,
  expirationDate: 4102444800,
  ...over,
})

test('seedAuthCookies: copies provider auth cookies, never third-party ones', async () => {
  const from = fakeSession([
    authCookie(),
    authCookie({ name: 'HSID', domain: '.youtube.com', value: 'yt' }),
    authCookie({ name: 'tracker', domain: '.example.com' }),
  ])
  const to = fakeSession([])

  const res = await seedAuthCookies(from, to)

  assert.deepEqual(res, { copied: 2, unchanged: 0, failed: 0 })
  assert.deepEqual(
    to.jar.map((c) => `${c.name}:${c.domain}`).sort(),
    ['HSID:.youtube.com', 'SID:.google.com']
  )
  assert.equal(to.jar.find((c) => c.name === 'SID').expirationDate, 4102444800)
})

test('seedAuthCookies: host-only cookies stay host-only and keep session type', async () => {
  const from = fakeSession([
    authCookie({ name: '__Host-SID', domain: 'accounts.google.com', hostOnly: true, session: true, expirationDate: undefined }),
  ])
  const to = fakeSession([])

  const res = await seedAuthCookies(from, to)

  assert.equal(res.copied, 1)
  const copied = to.jar[0]
  assert.equal(copied.hostOnly, true)
  assert.equal(copied.domain, 'accounts.google.com')
  assert.equal(copied.session, true)
})

test('seedAuthCookies: identical cookies are skipped, changed values refreshed', async () => {
  const from = fakeSession([authCookie({ value: 'new' })])
  const to = fakeSession([authCookie({ value: 'old' })])

  const res = await seedAuthCookies(from, to)

  assert.deepEqual(res, { copied: 1, unchanged: 0, failed: 0 })
  assert.equal(to.jar[0].value, 'new')
  assert.equal(to.jar.length, 1, 'refresh must not duplicate the cookie')

  const again = await seedAuthCookies(from, to)
  assert.deepEqual(again, { copied: 0, unchanged: 1, failed: 0 })
})

test('seedAuthCookies: a login made only in the RAM jar is never removed', async () => {
  const from = fakeSession([authCookie()])
  const to = fakeSession([authCookie({ name: 'RAM_ONLY', value: 'keep' })])

  await seedAuthCookies(from, to)

  assert.ok(to.jar.some((c) => c.name === 'RAM_ONLY'), 'one-way bridge must not delete target cookies')
})

test('seedAuthCookies: same session or a failing jar never throws', async () => {
  const ses = fakeSession([authCookie()])
  assert.deepEqual(await seedAuthCookies(ses, ses), { copied: 0, unchanged: 0, failed: 0 })
  assert.deepEqual(await seedAuthCookies(null, ses), { copied: 0, unchanged: 0, failed: 0 })

  const from = fakeSession([authCookie()])
  const to = fakeSession([], { failSet: true })
  assert.deepEqual(await seedAuthCookies(from, to), { copied: 0, unchanged: 0, failed: 1 })
})
