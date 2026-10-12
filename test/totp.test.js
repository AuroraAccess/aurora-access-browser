/**
 * TOTP (RFC 6238) and 2FA-secret storage tests.
 *
 * The `totpCode` vectors use the RFC 6238 test secret
 *   "12345678901234567890" (ASCII) → Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
 * (RFC 4226 appendix D same secret, HOTP/TOTP 8-digit → we use 6-digit like
 * Google Authenticator; the reference 6-digit values are the published ones.)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { Vault, setUserDataDir, totpCode } = require('../electron/vault')

// RFC 6238 reference times (T = seconds since epoch, SHA-1, 8 digits in the
// RFC; the last 6 digits of the same HMAC match Google Authenticator).
const SECRET_ASCII = '12345678901234567890'
const SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

// Known 6-digit codes for SHA-1 (published in many TOTP libs' test suites).
const VECTORS = [
  { time: 59, code: '287082' },        // T=1
  { time: 1111111109, code: '081804' }, // T=37037036
  { time: 1111111111, code: '050471' }, // T=37037037
  { time: 1234567890, code: '005924' }, // T=41152263
  { time: 2000000000, code: '279037' }, // T=66666666
  { time: 20000000000, code: '353130' },// T=666666666
]

test('totpCode: RFC 6238 SHA-1 test vectors (6-digit)', () => {
  for (const { time, code } of VECTORS) {
    const res = totpCode(SECRET_B32, time * 1000)
    assert.equal(res.ok, true)
    assert.equal(res.code, code, `t=${time}`)
  }
})

test('totpCode: accepts lowercase / spaced Base32, rejects garbage', () => {
  const t = 59 * 1000
  assert.equal(
    totpCode(SECRET_B32.toLowerCase().replace(/(.{4})/g, '$1 ').toUpperCase(), t).code,
    '287082',
  )
  assert.equal(totpCode('!!!not-base32!!!', t).ok, false)
  assert.equal(totpCode('', t).ok, false)
})

test('2FA storage: secret is encrypted at rest as its own column', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-totp-'))
  setUserDataDir(dir)
  const vault = new Vault()
  try {
    const SECRET = 'JBSWY3DPEHPK3PXP' // classic example Base32 secret
    vault.setup('test-master-2fa')
    vault.saveLogin('https://example.com', 'alice', 'pw-1', SECRET)

    // Disk: the secret never appears plaintext, and never inside passwordEnc.
    const onDisk = fs.readFileSync(path.join(dir, 'vault.enc'), 'utf8')
    assert.ok(onDisk.includes('twoFactorSecretEnc'), 'secret stored as encrypted column')
    assert.ok(!onDisk.includes(SECRET), 'plaintext 2FA secret leaked to disk')
    assert.ok(!onDisk.includes('JBSW'), '2FA secret fragment leaked to disk')

    // List view: only a flag, never the secret.
    const listed = vault.getLogins()
    assert.equal(listed[0].hasTwoFactor, true)
    assert.equal(listed[0].twoFactorSecret, undefined)
    assert.equal(listed[0].twoFactorSecretEnc, undefined)

    // TOTP generation path works against the stored secret.
    const res = vault.getTotpCode('https://example.com', 'alice')
    assert.equal(res.ok, true)
    assert.match(res.code, /^\d{6}$/)

    // Identity re-save without the 2FA arg keeps the secret.
    vault.saveLogin('https://example.com', 'alice', 'pw-1')
    assert.equal(vault.getLogins()[0].hasTwoFactor, true)
    // ...but an explicit '' clears it.
    assert.equal(vault.setTwoFactorSecret('https://example.com', 'alice', '').ok, true)
    assert.equal(vault.getLogins()[0].hasTwoFactor, false)
  } finally {
    vault.lock()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('setTwoFactorSecret validates Base32 and requires an existing entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-totp-'))
  setUserDataDir(dir)
  const vault = new Vault()
  try {
    vault.setup('test-master-2fa-b')
    const bad = vault.setTwoFactorSecret('https://example.com', 'nobody', 'ABC')
    assert.equal(bad.ok, false, 'no such entry')

    vault.saveLogin('https://example.com', 'bob', 'pw')
    const invalid = vault.setTwoFactorSecret('https://example.com', 'bob', 'not@base32!')
    assert.equal(invalid.ok, false)
    assert.match(invalid.error, /Base32/)

    const ok = vault.setTwoFactorSecret('https://example.com', 'bob', 'jbsw y3dp ehpk 3pxp')
    assert.equal(ok.ok, true)
    assert.equal(vault.getLogins()[0].hasTwoFactor, true)
  } finally {
    vault.lock()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
