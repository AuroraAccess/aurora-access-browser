/**
 * download-manager.js — Download tracker & controller for Electron sessions
 *
 * Catches all `will-download` events on defaultSession and partitions, tracks
 * live progress (received, total, percentage, state), and provides controls
 * to open downloaded files, show them in file manager, or cancel active transfers.
 */

'use strict';

const { shell } = require('electron');
const fs = require('fs');

class DownloadManager {
  constructor() {
    // id -> download record
    this.downloads = new Map();
    // id -> active Electron DownloadItem
    this.activeItems = new Map();
    this.listeners = new Set();
    this.counter = 1;
  }

  /**
   * Attach listener to an Electron session.
   */
  attach(ses, broadcast) {
    if (!ses || typeof ses.on !== 'function') return;

    if (broadcast) {
      this.listeners.add(broadcast);
    }

    ses.on('will-download', (event, item, _webContents) => {
      const id = `dl_${Date.now()}_${this.counter++}`;
      const filename = item.getFilename() || 'download';
      const totalBytes = item.getTotalBytes() || 0;
      const mimeType = item.getMimeType() || '';
      const url = item.getURL() || '';
      const startTime = Date.now();

      const record = {
        id,
        filename,
        savePath: item.getSavePath() || '',
        totalBytes,
        receivedBytes: 0,
        percent: 0,
        speed: 0,
        state: 'progressing', // 'progressing' | 'completed' | 'cancelled' | 'interrupted'
        url,
        mimeType,
        startTime,
        endTime: null,
      };

      this.downloads.set(id, record);
      this.activeItems.set(id, item);
      this._notify(record);

      let lastBytes = 0;
      let lastTime = startTime;

      item.on('updated', (evt, state) => {
        const now = Date.now();
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const savePath = item.getSavePath();

        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5) {
          const bytesDiff = received - lastBytes;
          record.speed = Math.max(0, Math.round(bytesDiff / timeDiff));
          lastBytes = received;
          lastTime = now;
        }

        record.receivedBytes = received;
        record.totalBytes = total;
        record.savePath = savePath || record.savePath;
        record.percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        record.state = state === 'interrupted' ? 'interrupted' : 'progressing';

        this._notify(record);
      });

      item.once('done', (evt, state) => {
        this.activeItems.delete(id);
        record.endTime = Date.now();
        record.savePath = item.getSavePath() || record.savePath;
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.speed = 0;

        if (state === 'completed') {
          record.state = 'completed';
          record.percent = 100;
        } else if (state === 'cancelled') {
          record.state = 'cancelled';
        } else {
          record.state = 'interrupted';
        }

        this._notify(record);
      });
    });
  }

  _notify(record) {
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch (err) {
        console.warn('[DownloadManager] Listener error:', err.message);
      }
    }
  }

  getAll() {
    return Array.from(this.downloads.values()).sort((a, b) => b.startTime - a.startTime);
  }

  get(id) {
    return this.downloads.get(String(id)) || null;
  }

  async openFile(id) {
    const record = this.get(id);
    if (!record || !record.savePath) return { ok: false, error: 'File not found' };
    if (!fs.existsSync(record.savePath)) return { ok: false, error: 'File does not exist on disk' };
    try {
      const errMsg = await shell.openPath(record.savePath);
      if (errMsg) return { ok: false, error: errMsg };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  showInFolder(id) {
    const record = this.get(id);
    if (!record || !record.savePath) return { ok: false, error: 'File not found' };
    try {
      shell.showItemInFolder(record.savePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  cancel(id) {
    const item = this.activeItems.get(String(id));
    if (item && typeof item.cancel === 'function') {
      try {
        item.cancel();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: 'Download not active' };
  }

  clear() {
    for (const [id, rec] of this.downloads) {
      if (rec.state !== 'progressing') {
        this.downloads.delete(id);
      }
    }
    return { ok: true };
  }
}

const downloadManager = new DownloadManager();

module.exports = {
  DownloadManager,
  downloadManager,
};
