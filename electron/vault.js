const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 64
const KEY_LENGTH = 32
const ITERATIONS = 100000

class Vault {
  constructor() {
    this.masterKey = null
    this.storagePath = path.join(app.getPath('userData'), 'vault.enc')
    this.verifyPath = path.join(app.getPath('userData'), 'vault-verify.enc')
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

    const verification = {
      salt: salt.toString('hex'),
      hash: hash.toString('hex')
    }
    fs.writeFileSync(this.verifyPath, JSON.stringify(verification))

    this.masterKey = masterPassword
    this._ensureStorage()
    return { ok: true }
  }

  unlock(masterPassword) {
    if (!this.isSetup()) {
      return { ok: false, error: 'Vault not set up' }
    }

    try {
      const raw = fs.readFileSync(this.verifyPath, 'utf8')
      const verification = JSON.parse(raw)
      const salt = Buffer.from(verification.salt, 'hex')
      const storedHash = verification.hash

      const hash = crypto.pbkdf2Sync(masterPassword, salt, ITERATIONS, KEY_LENGTH, 'sha512')

      if (hash.toString('hex') !== storedHash) {
        return { ok: false, error: 'Wrong password' }
      }

      this.masterKey = masterPassword
      return { ok: true }
    } catch (e) {
      console.error('[Vault] Unlock failed:', e)
      return { ok: false, error: 'Unlock failed' }
    }
  }

  lock() {
    this.masterKey = null
    return { ok: true }
  }

  _ensureStorage() {
    if (!fs.existsSync(this.storagePath)) {
      this._save([])
    }
  }

  _deriveKey(salt) {
    return crypto.pbkdf2Sync(this.masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha512')
  }

  _encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH)
    const salt = crypto.randomBytes(SALT_LENGTH)
    const key = this._deriveKey(salt)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const tag = cipher.getAuthTag()

    return {
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted
    }
  }

  _decrypt(encObj) {
    const iv = Buffer.from(encObj.iv, 'hex')
    const salt = Buffer.from(encObj.salt, 'hex')
    const tag = Buffer.from(encObj.tag, 'hex')
    const key = this._deriveKey(salt)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)

    decipher.setAuthTag(tag)

    let decrypted = decipher.update(encObj.data, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  }

  _requireUnlocked() {
    if (!this.masterKey) {
      throw new Error('Vault is locked')
    }
  }

  _load() {
    this._requireUnlocked()
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8')
      if (!raw) return []
      const encrypted = JSON.parse(raw)
      return encrypted.map(item => ({
        ...item,
        password: this._decrypt(item.passwordEnc)
      }))
    } catch (e) {
      console.error('[Vault] Load failed:', e)
      return []
    }
  }

  _save(items) {
    this._requireUnlocked()
    const encryptedItems = items.map(item => {
      const { password, ...rest } = item
      return {
        ...rest,
        passwordEnc: this._encrypt(password)
      }
    })
    fs.writeFileSync(this.storagePath, JSON.stringify(encryptedItems, null, 2))
  }

  _normalizeUrl(url) {
    if (!url) return '';
    return url.replace(/\/$/, "").trim();
  }

  saveLogin(url, username, password) {
    this._requireUnlocked()
    let items = this._load()
    const normUrl = this._normalizeUrl(url);
    const existingIndex = items.findIndex(i => this._normalizeUrl(i.url) === normUrl && i.username === username);
    const newItem = { url, username, password, updated_at: new Date().toISOString() };

    if (existingIndex > -1) {
      items[existingIndex] = newItem;
    } else {
      items.push(newItem);
    }

    this._save(items);
    return { ok: true };
  }

  updateEntry(oldUrl, oldUser, newUrl, newUser, newPass) {
    this._requireUnlocked()
    let items = this._load();
    const nOldUrl = this._normalizeUrl(oldUrl);
    const idx = items.findIndex(i => this._normalizeUrl(i.url) === nOldUrl && i.username === oldUser);

    if (idx === -1) {
      return { ok: false, error: 'Entry not found' };
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
    return this._load().map(({ password, passwordEnc, ...rest }) => rest);
  }

  findForUrl(url) {
    this._requireUnlocked()
    try {
      const targetHost = new URL(url).hostname;
      return this._load().filter(i => {
        try {
          return new URL(i.url).hostname === targetHost;
        } catch (e) {
          return i.url.includes(targetHost);
        }
      });
    } catch (e) {
      const trimmed = this._normalizeUrl(url);
      return this._load().filter(i => this._normalizeUrl(i.url) === trimmed);
    }
  }
}

module.exports = { Vault }
