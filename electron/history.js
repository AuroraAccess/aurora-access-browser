const fs = require('fs')
const path = require('path')
const { app } = require('electron')

class History {
  constructor() {
    this.storagePath = path.join(app.getPath('userData'), 'history.json')
    this._ensureStorage()
  }

  _ensureStorage() {
    if (!fs.existsSync(this.storagePath)) {
      this._save([])
    }
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8')
      return JSON.parse(raw)
    } catch (e) {
      console.error('[History] Load failed:', e)
      return []
    }
  }

  _save(items) {
    fs.writeFileSync(this.storagePath, JSON.stringify(items, null, 2))
  }

  addEntry(url, title) {
    const items = this._load()
    const entry = { url, title, timestamp: new Date().toISOString() }
    items.unshift(entry)
    this._save(items.slice(0, 1000)) // Keep last 1000 items
  }

  getEntries() {
    return this._load()
  }

  clear() {
    this._save([])
  }
}

module.exports = { History }
