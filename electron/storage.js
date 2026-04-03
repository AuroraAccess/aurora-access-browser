const { app } = require('electron')
const fs = require('fs')
const path = require('path')

class Storage {
  constructor(filename) {
    this.path = path.join(app.getPath('userData'), `${filename}.json`)
    this.data = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) {
        return JSON.parse(fs.readFileSync(this.path, 'utf8'))
      }
    } catch (e) {
      console.error(`[Storage] Failed to load ${this.path}:`, e)
    }
    return {}
  }

  save(data) {
    this.data = { ...this.data, ...data }
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2))
    } catch (e) {
      console.error(`[Storage] Failed to save ${this.path}:`, e)
    }
  }

  get(key) {
    return this.data[key]
  }

  all() {
    return this.data
  }
}

module.exports = { Storage }
