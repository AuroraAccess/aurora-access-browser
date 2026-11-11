const test = require('node:test')
const assert = require('node:assert/strict')

const { isOAuthPopupRequest, popupDimensions } = require('../electron/auth-popup')

test('isOAuthPopupRequest: Google and OAuth provider logins get a real popup', () => {
  // Google Identity Services: window.open to accounts.google.com and the
  // result comes back through window.opener.postMessage().
  assert.equal(
    isOAuthPopupRequest('https://accounts.google.com/gsi/select?client_id=123', '', 'new-window'),
    true
  )
  assert.equal(
    isOAuthPopupRequest('https://accounts.google.com/signin/v2/identifier', '', 'foreground-tab'),
    true
  )
  assert.equal(
    isOAuthPopupRequest('https://appleid.apple.com/auth/authorize?client_id=x', '', 'new-window'),
    true
  )
  assert.equal(
    isOAuthPopupRequest('https://github.com/login/oauth/authorize?client_id=x', '', 'new-window'),
    true
  )
})

test('isOAuthPopupRequest: ordinary links keep becoming tabs', () => {
  assert.equal(isOAuthPopupRequest('https://example.com/article', '', 'foreground-tab'), false)
  assert.equal(isOAuthPopupRequest('https://www.youtube.com/watch?v=1', '', 'foreground-tab'), false)
  assert.equal(isOAuthPopupRequest('https://example.com/?q=authorize', '', 'foreground-tab'), false)
})

test('isOAuthPopupRequest: a sized window is a popup (opener expected)', () => {
  assert.equal(
    isOAuthPopupRequest('https://pay.example.com/checkout', 'width=480,height=640', 'new-window'),
    true
  )
  // Features without a disposition of new-window are not enough on their own.
  assert.equal(isOAuthPopupRequest('https://example.com/', 'width=480', 'foreground-tab'), false)
})

test('isOAuthPopupRequest: non-web schemes never open a window', () => {
  assert.equal(isOAuthPopupRequest('file:///etc/passwd', 'width=400,height=400', 'new-window'), false)
  assert.equal(isOAuthPopupRequest('', '', 'new-window'), false)
  assert.equal(isOAuthPopupRequest(null, null, 'new-window'), false)
})

test('popupDimensions: parses declared sizes and clamps them', () => {
  assert.deepEqual(popupDimensions('width=480,height=640'), { width: 480, height: 640 })
  assert.deepEqual(popupDimensions(''), { width: 520, height: 640 })
  assert.deepEqual(popupDimensions('width=10,height=99999'), { width: 360, height: 1000 })
  assert.deepEqual(popupDimensions('scrollbars=yes,width=400'), { width: 400, height: 640 })
})
