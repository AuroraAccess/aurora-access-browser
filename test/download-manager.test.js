'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { DownloadManager } = require('../electron/download-manager');

class FakeDownloadItem extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.filename = opts.filename || 'archive.zip';
    this.totalBytes = opts.totalBytes || 1000;
    this.receivedBytes = 0;
    this.savePath = opts.savePath || '/tmp/archive.zip';
    this.mimeType = opts.mimeType || 'application/zip';
    this.url = opts.url || 'https://example.com/archive.zip';
    this.cancelled = false;
  }

  getFilename() { return this.filename; }
  getTotalBytes() { return this.totalBytes; }
  getReceivedBytes() { return this.receivedBytes; }
  getSavePath() { return this.savePath; }
  getMimeType() { return this.mimeType; }
  getURL() { return this.url; }
  cancel() {
    this.cancelled = true;
    this.emit('done', {}, 'cancelled');
  }
}

class FakeSession extends EventEmitter {}

test('DownloadManager: tracks live progress and completes transfer', () => {
  const dm = new DownloadManager();
  const ses = new FakeSession();
  const updates = [];

  dm.attach(ses, (rec) => updates.push({ ...rec }));

  const item = new FakeDownloadItem({ filename: 'test.zip', totalBytes: 200 });
  ses.emit('will-download', {}, item);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].filename, 'test.zip');
  assert.equal(updates[0].state, 'progressing');
  assert.equal(updates[0].percent, 0);

  // Progress update
  item.receivedBytes = 100;
  item.emit('updated', {}, 'progressing');

  assert.equal(updates.length, 2);
  assert.equal(updates[1].receivedBytes, 100);
  assert.equal(updates[1].percent, 50);

  // Complete
  item.receivedBytes = 200;
  item.emit('done', {}, 'completed');

  assert.equal(updates.length, 3);
  assert.equal(updates[2].state, 'completed');
  assert.equal(updates[2].percent, 100);

  const all = dm.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].state, 'completed');
});

test('DownloadManager: handles cancelled download and clear() removes non-active items', () => {
  const dm = new DownloadManager();
  const ses = new FakeSession();
  const updates = [];

  dm.attach(ses, (rec) => updates.push({ ...rec }));

  const item = new FakeDownloadItem({ filename: 'cancel_me.mp4' });
  ses.emit('will-download', {}, item);

  const id = updates[0].id;
  const res = dm.cancel(id);
  assert.equal(res.ok, true);
  assert.equal(item.cancelled, true);

  const latest = dm.get(id);
  assert.equal(latest.state, 'cancelled');

  // clear() removes completed/cancelled items
  dm.clear();
  assert.equal(dm.getAll().length, 0);
});
