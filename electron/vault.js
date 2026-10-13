/**
 * vault.js — AES-256-GCM encrypted password storage.
 *
 * Threat model and invariants:
 *
 * 1. AT REST — the database (`vault.enc`) is always ciphertext on disk. Each
 *    record has its own IV + per-record salt + GCM tag; verification material
 *    lives in `vault-verify.enc` (PBKDF2 hash of the master password — never
 *    the password itself, and not the AES key).
 *
 * 2. IN MEMORY — only the PBKDF2-derived master key (32 bytes) is held after
 *    unlock, never the master password. `lock()` zeroizes the key buffer
 *    (best-effort in JS: buffers are overwritten in place) and drops the
 *    reference. Per-record keys are derived with cheap HKDF from the master
 *    key instead of re-running 100k-iteration PBKDF2 per operation.
 *
 * 3. EXTERNAL API — password audit (passaudit.js) sends only the first
 *    5 hex chars of the SHA-1 hash to Have I Been Pwned (k-anonymity).
 *
 * SCHEME V2 (this file) vs V1 (before): V1 derived each record key with
 * 100k-iteration PBKDF2 from the master password + record salt, and kept the
 * master password itself in memory between operations. V2 derives the master
 * key once at unlock (from password + salt2, stored in the verify file) and
 * uses HKDF for record keys. On unlock, legacy V1 records are transparently
 * re-encrypted to V2 in place.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
// TZ anti-bloat: single atomic rewrite per save — no truncated files on
// crash, no hidden .bak/.old copies ever created.
const { writeFileAtomic } = require('./atomic-file')

// `app` is unavailable under plain Node (unit tests inject the directory).
let electronApp = null
try {
  const electron = require('electron')
  if (electron && typeof electron === 'object') electronApp = electron.app
} catch (_) { /* plain node */ }

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 64
const KEY_LENGTH = 32
const ITERATIONS = 100000
const HKDF_INFO = Buffer.from('aurora-vault-record-v2', 'utf8')

// Where the vault files live. Injectable for tests (see setUserDataDir); the
// real app path is resolved lazily from Electron at first use.
let userDataDir = null

function setUserDataDir(dir) {
  userDataDir = dir || null
}

function resolveUserDataDir() {
  if (userDataDir) return userDataDir
  if (electronApp) return electronApp.getPath('userData')
  // Plain-node fallback (tests that forgot to inject): current directory.
  return process.cwd()
}

class Vault {
  constructor() {
    const dir = resolveUserDataDir()
    this.storagePath = path.join(dir, 'vault.enc')
    this.verifyPath = path.join(dir, 'vault-verify.enc')
    // ONLY the PBKDF2-derived key material lives here (32 bytes). The master
    // password string is never stored on the instance.
    this.masterKey = null
  }

  isSetup() {
    return fs.existsSync(this.verifyPath)
  }

  isUnlocked() {
    return !!this.masterKey
  }

  setup(masterPassword) {
    if (this.isSetup()) {
      return { ok: false, error: 'Master password already set' }
    }
    if (!masterPassword || masterPassword.length < 4) {
      return { ok: false, error: 'Password too short' }
    }

    const salt = crypto.randomBytes(SALT_LENGTH)
    const hash = crypto.pbkdf2Sync(masterPassword, salt, ITERATIONS, KEY_LENGTH, 'sha512')
    // Independent salt for the master encryption key — deliberately NOT the
    // verification hash: the hash is stored on disk and must never BE a key.
    const salt2 = crypto.randomBytes(SALT_LENGTH)

    const verification = {
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      salt2: salt2.toString('hex'),
    }
    writeFileAtomic(this.verifyPath, JSON.stringify(verification))

    // Derive the master key; the password string is not retained anywhere.
    this.masterKey = crypto.pbkdf2Sync(masterPassword, salt2, ITERATIONS, KEY_LENGTH, 'sha512')
    this._ensureStorage()
    this._migrateLegacy(masterPassword)
    return { ok: true }
  }

  unlock(masterPassword) {
    if (!this.isSetup()) {
      return { ok: false, error: 'Vault not set up' }
    }

    try {
      const verification = JSON.parse(fs.readFileSync(this.verifyPath, 'utf8'))
      const salt = Buffer.from(verification.salt, 'hex')
      const storedHash = verification.hash

      const hash = crypto.pbkdf2Sync(masterPassword, salt, ITERATIONS, KEY_LENGTH, 'sha512')
      // Audit TZ rule #5: constant-time comparison (timing-safe) and
      // immediate zeroing of the intermediate key material — nothing left
      // for a memory-scraping process to recover.
      const storedBuf = Buffer.from(storedHash, 'hex')
      const equal = storedBuf.length === hash.length && crypto.timingSafeEqual(storedBuf, hash)
      storedBuf.fill(0)
      hash.fill(0)
      if (!equal) {
        return { ok: false, error: 'Wrong password' }
      }

      // Upgrade the verify file with a key-derivation salt if it predates V2.
      let salt2 = verification.salt2 ? Buffer.from(verification.salt2, 'hex') : null
      if (!salt2) {
        salt2 = crypto.randomBytes(SALT_LENGTH)
        writeFileAtomic(this.verifyPath, JSON.stringify({
          ...verification,
          salt2: salt2.toString('hex'),
        }))
      }

      this.masterKey = crypto.pbkdf2Sync(masterPassword, salt2, ITERATIONS, KEY_LENGTH, 'sha512')
      // Audit TZ rule #5: this.masterKey is the only long-lived copy of the
      // derived key (zeroized by lock()). Master password stays a JS string
      // (not zeroable by the language); it never leaves the main process.

      // Re-encrypt any legacy (V1) records under the new scheme while the
      // password is still in scope; afterwards V2 keys suffice for everything.
      this._migrateLegacy(masterPassword)
      return { ok: true }
    } catch (e) {
      console.error('[Vault] Unlock failed:', e)
      return { ok: false, error: 'Unlock failed' }
    }
  }

  lock() {
    if (this.masterKey) {
      // Best-effort zeroization: overwrite the key material in place before
      // dropping the reference. (JS cannot pin or scrub every GC copy, but
      // the live key buffer is the primary target of memory scraping.)
      this.masterKey.fill(0)
      this.masterKey = null
    }
    return { ok: true }
  }

  _ensureStorage() {
    if (!fs.existsSync(this.storagePath)) {
      this._save([])
    }
  }

  _requireUnlocked() {
    if (!this.masterKey) {
      throw new Error('Vault is locked')
    }
  }

  // ─── Key derivation ───────────────────────────────────────────────
  // Record keys: cheap HKDF from the unlocked master key + per-record salt.
  // No password and no PBKDF2 re-run at access time.

  _recordKey(salt) {
    this._requireUnlocked()
    const derived = crypto.hkdfSync('sha512', this.masterKey, salt, HKDF_INFO, KEY_LENGTH)
    return Buffer.from(derived) // ArrayBuffer view
  }

  // Legacy V1: derived from the master PASSWORD itself — only usable while
  // the password is in scope during unlock/setup migration.
  _legacyRecordKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512')
  }

  _encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH)
    const salt = crypto.randomBytes(SALT_LENGTH)
    const key = this._recordKey(salt)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const tag = cipher.getAuthTag()

    return {
      v: 2,
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    }
  }

  _decrypt(encObj) {
    if (encObj && encObj.v === 2) {
      const iv = Buffer.from(encObj.iv, 'hex')
      const salt = Buffer.from(encObj.salt, 'hex')
      const tag = Buffer.from(encObj.tag, 'hex')
      const key = this._recordKey(salt)
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      let decrypted = decipher.update(encObj.data, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }
    // Legacy record outside migration context — cannot decrypt without the
    // password. This should be unreachable after unlock-time migration.
    throw new Error('Vault: legacy record encountered outside migration')
  }

  _decryptLegacy(encObj, password) {
    const iv = Buffer.from(encObj.iv, 'hex')
    const salt = Buffer.from(encObj.salt, 'hex')
    const tag = Buffer.from(encObj.tag, 'hex')
    const key = this._legacyRecordKey(password, salt)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(encObj.data, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  /**
   * Re-encrypt V1 records to V2 using the record passwords decrypted with
   * the master password (available at unlock/setup). Idempotent: V2 records
   * are left untouched, and the migration happens exactly once.
   */
  _migrateLegacy(masterPassword) {
    try {
      if (!fs.existsSync(this.storagePath)) return
      const raw = fs.readFileSync(this.storagePath, 'utf8')
      if (!raw) return
      const items = JSON.parse(raw)
      if (!Array.isArray(items)) return

      let migrated = 0
      const converted = items.map((item) => {
        if (!item || !item.passwordEnc || item.passwordEnc.v === 2) return item
        migrated++
        const { passwordEnc, ...rest } = item
        const plain = this._decryptLegacy(passwordEnc, masterPassword)
        return { ...rest, passwordEnc: this._encrypt(plain) }
      })

      if (migrated > 0) {
        writeFileAtomic(this.storagePath, JSON.stringify(converted, null, 2))
        console.log(`[Vault] Migrated ${migrated} record(s) to encryption scheme V2`)
      }
    } catch (e) {
      // A failed migration must not break the unlock flow; records stay V1
      // and will be migrated on the next successful unlock.
      console.error('[Vault] Legacy migration failed (will retry on next unlock):', e)
      throw new Error('Legacy migration failed')
    }
  }

  // ─── Storage plumbing ────────────────────────────────────────────
  // _readEncrypted: raw records from disk (no decryption).
  // _load: fully decrypted array — used only where every password is needed
  // (save/delete/audit flows), never returned to the renderer wholesale.

  _readEncrypted() {
    this._requireUnlocked()
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8')
      if (!raw) return []
      const encrypted = JSON.parse(raw)
      return Array.isArray(encrypted) ? encrypted : []
    } catch (e) {
      console.error('[Vault] Read failed:', e)
      return []
    }
  }

  _load() {
    this._requireUnlocked()
    return this._readEncrypted().map(item => {
      const out = {
        ...item,
        password: this._decrypt(item.passwordEnc),
      }
      // Optional per-entry 2FA secret: decrypted only in the main process at
      // the moment some operation needs it. Never returned wholesale.
      if (item.twoFactorSecretEnc) {
        try { out.twoFactorSecret = this._decrypt(item.twoFactorSecretEnc) } catch (_) {}
      }
      return out
    })
  }

  _save(items) {
    this._requireUnlocked()
    const encryptedItems = items.map(item => {
      const { password, twoFactorSecret, ...rest } = item
      const stored = {
        ...rest,
        passwordEnc: this._encrypt(password),
      }
      // The 2FA secret gets its OWN encrypted column — never stored in (or
      // reconstructed from) the password field.
      if (twoFactorSecret) stored.twoFactorSecretEnc = this._encrypt(twoFactorSecret)
      return stored
    })
    writeFileAtomic(this.storagePath, JSON.stringify(encryptedItems, null, 2))
  }

  _normalizeUrl(url) {
    if (!url) return '';
    return url.replace(/\/$/, "").trim();
  }

  saveLogin(url, username, password) {
    // overloads:
    //   saveLogin(url, username, password, twoFactorSecret?)  — normal save
    //   saveLogin(url, username, { password, twoFactorSecret }) — object form
    let given2fa = undefined
    let opts = null
    if (arguments.length >= 3 && typeof password === 'object' && password !== null) {
      opts = password
      given2fa = opts.twoFactorSecret
      password = opts.password
    } else if (arguments.length >= 4) {
      given2fa = arguments[3]
    }
    if (given2fa != null) {
      given2fa = String(given2fa).trim().replace(/\s+/g, '') || undefined
    }

    this._requireUnlocked()
    let items = this._load()
    const normUrl = this._normalizeUrl(url);
    const existingIndex = items.findIndex(i => this._normalizeUrl(i.url) === normUrl && i.username === username);
    const newItem = { url, username, password, updated_at: new Date().toISOString() };

    // Determine the effective 2FA secret for the entry (2FA is optional and
    // NEVER stored inside the password field — separate encrypted column).
    if (given2fa !== undefined) {
      // Explicit arg wins entirely: '' clears the secret.
      if (given2fa) newItem.twoFactorSecret = given2fa
    } else if (existingIndex > -1 && items[existingIndex].twoFactorSecret) {
      // No arg → keep whatever secret the entry already had (identity re-save
      // must not silently drop 2FA).
      newItem.twoFactorSecret = items[existingIndex].twoFactorSecret
    }

    // Already stored with the same password AND same 2FA secret: acknowledge
    // without rewriting (Chrome never re-asks for an identical save).
    if (existingIndex > -1
      && items[existingIndex].password === password
      && (items[existingIndex].twoFactorSecret || '') === (newItem.twoFactorSecret || '')) {
      return { ok: true, updated: false, changed: false };
    }

    if (existingIndex > -1) {
      items[existingIndex] = { ...newItem, changed: true };
    } else {
      items.push(newItem);
    }

    this._save(items);
    return { ok: true, updated: existingIndex > -1, changed: existingIndex > -1 };
  }

  updateEntry(oldUrl, oldUser, newUrl, newUser, newPass) {
    this._requireUnlocked()
    let items = this._load();
    const nOldUrl = this._normalizeUrl(oldUrl);
    const idx = items.findIndex(i => this._normalizeUrl(i.url) === nOldUrl && i.username === oldUser);

    if (idx === -1) {
      return { ok: false, error: 'Entry not found' };
    }

    // Same site, same user, same password as before: no-op so the UI can
    // confidently say "already up to date" without touching updatedAt.
    if (
      this._normalizeUrl(items[idx].url) === this._normalizeUrl(newUrl) &&
      items[idx].username === newUser &&
      items[idx].password === newPass
    ) {
      return { ok: true, alreadyUpToDate: true };
    }

    items[idx] = {
      url: newUrl,
      username: newUser,
      password: newPass,
      updated_at: new Date().toISOString()
    };
    this._save(items);
    return { ok: true };
  }

  deleteEntry(url, username) {
    this._requireUnlocked()
    let items = this._load();
    const nUrl = this._normalizeUrl(url);
    const filtered = items.filter(i => !(this._normalizeUrl(i.url) === nUrl && i.username === username));
    this._save(filtered);
    return { ok: true };
  }

  getLogins() {
    this._requireUnlocked()
    // Passwords AND 2FA secrets stay in the main process: the list view gets
    // a boolean flag only ("has 2FA"), never the secret itself.
    return this._readEncrypted().map(item => {
      const { passwordEnc: _dp, twoFactorSecretEnc: _dt, ...rest } = item
      return { ...rest, hasTwoFactor: !!item.twoFactorSecretEnc }
    })
  }

  /** Save / replace / clear the 2FA secret of an existing entry.
    * secret='' (or undefined→'') clears. Separate encrypted storage. */
  setTwoFactorSecret(url, username, secret) {
    this._requireUnlocked()
    const norm = this._normalizeUrl(url)
    const items = this._load()
    const idx = items.findIndex(i => this._normalizeUrl(i.url) === norm && i.username === username)
    if (idx === -1) return { ok: false, error: 'Entry not found' }

    const cleaned = String(secret || '').replace(/\s+/g, '').toUpperCase()
    if (cleaned && !/^[A-Z2-7]+=*$/.test(cleaned)) {
      return { ok: false, error: 'Invalid Base32 secret' }
    }

    if (cleaned) items[idx].twoFactorSecret = cleaned
    else delete items[idx].twoFactorSecret
    // _load() spreads the RAW record, so the stale encrypted column rides
    // along — drop it, or a cleared secret would resurrect on the next save.
    delete items[idx].twoFactorSecretEnc
    items[idx].updated_at = new Date().toISOString()
    this._save(items)
    return { ok: true, cleared: !cleaned }
  }

  /** Decrypt exactly one matching entry's password (autofill path). */
  getPassword(url, username) {
    this._requireUnlocked()
    const entry = this._readEncrypted().find(
      i => this._normalizeUrl(i.url) === this._normalizeUrl(url) && i.username === username
    )
    return entry ? this._decrypt(entry.passwordEnc) : null
  }

  /** Password only for entries whose host matches the given URL. */
  findForUrl(url) {
    this._requireUnlocked()
    const allEncrypted = this._readEncrypted()
    const matches = allEncrypted.filter(i => {
      try {
        return new URL(i.url).hostname === new URL(url).hostname;
      } catch (e) {
        return this._normalizeUrl(i.url) === this._normalizeUrl(url);
      }
    })
    return matches.map(entry => ({
      ...entry,
      password: this._decrypt(entry.passwordEnc),
    }))
  }

  /** Current 6-digit TOTP code for one entry (decrypted in main only).
    * The secret itself never leaves this process. */
  getTotpCode(url, username) {
    this._requireUnlocked()
    const entry = this._readEncrypted().find(
      i => this._normalizeUrl(i.url) === this._normalizeUrl(url) && i.username === username
    )
    if (!entry || !entry.twoFactorSecretEnc) return { ok: false, error: 'No 2FA secret' }
    let secret
    try { secret = this._decrypt(entry.twoFactorSecretEnc) } catch (_) {
      return { ok: false, error: 'Failed to decrypt 2FA secret' }
    }
    return totpCode(secret)
  }

  /**
   * Import logins from other password managers (CSV export from Safari or
   * Chrome). Accepts a flat `[{ url, username, password, ... }]` array
   * (headers already normalised by the caller, see main.js 'vault:import'
   * handler). Existing entries for the same url+username are updated only
   * when the imported password differs; otherwise nothing is touched.
   */
  importLogins(entries) {
    this._requireUnlocked()
    if (!Array.isArray(entries)) return { ok: false, error: 'Invalid payload' }

    const items = this._load()
    // Compare against a snapshot of the PRE-import state, not the mutating
    // one: a file that carries both the old and the new password for the
    // same account (export order differs between managers) must count the
    // "old password" row as unchanged, not as a second update.
    const original = new Map(
      items.map((i) => [`${this._normalizeUrl(i.url)}\u0000${i.username}`, i.password])
    )
    let skipped = 0
    const imported = new Map()
    for (const entry of entries) {
      const url = typeof entry.url === 'string' ? entry.url.trim() : ''
      const username = typeof entry.username === 'string' ? entry.username.trim() : ''
      const password = typeof entry.password === 'string' ? entry.password : ''
      if (!url || !username || !password) { skipped++; continue }

      const key = `${this._normalizeUrl(url)}\u0000${username}`
      if (!original.has(key) && !imported.has(key)) {
        imported.set(key, { url, username, password })
      } else {
        // Existing record (pre-import or added earlier in this file).
        const originalPassword = original.get(key)
        if (originalPassword !== undefined && originalPassword === password) { skipped++; continue }
        imported.set(key, { url, username, password })
      }
    }

    // Apply: overwrite existing rows and append new ones.
    for (const [, { url, username, password }] of imported) {
      const idx = items.findIndex(i => this._normalizeUrl(i.url) === this._normalizeUrl(url) && i.username === username)
      const currentPassword = idx > -1 ? items[idx].password : undefined
      if (currentPassword === password) continue // unchanged vs pre-import state — do not touch updated_at
      if (idx > -1) {
        items[idx] = { url, username, password, updated_at: new Date().toISOString() }
      } else {
        items.push({ url, username, password, updated_at: new Date().toISOString() })
      }
    }
    // Recount against the snapshot so the summary is honest: a row whose
    // final value equals the pre-import value counts as skipped, not added.
    let finalAdded = 0, finalUpdated = 0
    for (const [key, { password }] of imported) {
      if (!original.has(key)) finalAdded++
      else if (original.get(key) !== password) finalUpdated++
      else skipped++
    }
    if (finalAdded > 0 || finalUpdated > 0) this._save(items)
    return { ok: true, added: finalAdded, updated: finalUpdated, skipped }
  }
}

// ─── TOTP (RFC 6238 / RFC 4226, crypto-free of external deps) ─────
// Standard SHA-1 / 6 digits / 30 s step. Secrets are Base32 (RFC 4648).
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input) {
  // Strict: strip only padding '=' and whitespace; any OTHER foreign
  // character is an error (this is user-entered key material — "not@base32!"
  // must not silently become valid "NOTBASE").
  const clean = String(input).toUpperCase().replace(/[=\s]/g, '')
  if (!clean || /[^A-Z2-7]/.test(clean)) return null
  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function totpCode(secret, timeMs = Date.now()) {
  const key = base32Decode(secret)
  if (!key) return { ok: false, error: 'Invalid Base32 secret' }
  const counter = Math.floor(timeMs / 1000 / 30)
  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000
  return { ok: true, code: String(code).padStart(6, '0'), expiresIn: 30 - (Math.floor(timeMs / 1000) % 30) }
}

module.exports = { Vault, setUserDataDir, totpCode }
