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
  constructor(masterKey = 'aurora-master-secure-key-2026') {
    this.masterKey = masterKey
    this.storagePath = path.join(app.getPath('userData'), 'vault.enc')
    this._ensureStorage()
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

  _load() {
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
    let items = this._load()
    const normUrl = this._normalizeUrl(url);
    const existingIndex = items.findIndex(i => this._normalizeUrl(i.url) === normUrl && i.username === username);
    const newItem = { url, username, password, updated_at: new Date().toISOString() };
    
    if (existingIndex > -1) {
      console.log('[Vault] Updating existing entry for:', normUrl);
      items[existingIndex] = newItem;
    } else {
      console.log('[Vault] Saving NEW entry for:', normUrl);
      items.push(newItem);
    }
    
    this._save(items);
    return { ok: true };
  }

  updateEntry(oldUrl, oldUser, newUrl, newUser, newPass) {
    let items = this._load();
    const nOldUrl = this._normalizeUrl(oldUrl);
    const idx = items.findIndex(i => this._normalizeUrl(i.url) === nOldUrl && i.username === oldUser);
    
    if (idx === -1) {
      console.error('[Vault] Update failed: Entry not found for', nOldUrl, oldUser);
      return { ok: false, error: 'Entry not found' };
    }

    items[idx] = { 
      url: newUrl, 
      username: newUser, 
      password: newPass, 
      updated_at: new Date().toISOString() 
    };
    this._save(items);
    console.log('[Vault] Successful update for', nOldUrl);
    return { ok: true };
  }

  deleteEntry(url, username) {
    let items = this._load();
    const nUrl = this._normalizeUrl(url);
    const beforeLen = items.length;
    const filtered = items.filter(i => !(this._normalizeUrl(i.url) === nUrl && i.username === username));
    
    if (filtered.length === beforeLen) {
      console.warn('[Vault] Delete attempted but entry not found:', nUrl, username);
    } else {
      console.log('[Vault] Deleted entry:', nUrl, username);
    }

    this._save(filtered);
    return { ok: true };
  }

  getLogins() {
    return this._load().map(({ password, passwordEnc, ...rest }) => rest);
  }

  findForUrl(url) {
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
