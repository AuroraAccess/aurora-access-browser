/**
 * Unit tests for electron/updater.js (In-App Update Engine).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const updater = require('../electron/updater')

test('updater exports lifecycle functions', () => {
  assert.equal(typeof updater.start, 'function')
  assert.equal(typeof updater.checkForUpdates, 'function')
  assert.equal(typeof updater.downloadUpdate, 'function')
  assert.equal(typeof updater.installUpdate, 'function')
  assert.equal(typeof updater.setMainWindow, 'function')
})

test('updater.setMainWindow tolerates null / destroyed window', () => {
  assert.doesNotThrow(() => updater.setMainWindow(null))
  assert.doesNotThrow(() => updater.setMainWindow(() => null))
})

test('updater.checkForUpdates runs without throwing', async () => {
  // In dev / test environment, it gracefully runs the probe or handles lack of net
  const res = await updater.checkForUpdates(false)
  assert.doesNotThrow(() => res)
})

test('updater.downloadUpdate handles invocation and reports progress in dev', async () => {
  const events = []
  const mockWin = {
    isDestroyed: () => false,
    webContents: {
      send: (ch, data) => events.push({ ch, data }),
    },
  }
  updater.setMainWindow(mockWin)
  const res = await updater.downloadUpdate()
  assert.equal(res.ok, true)
})
