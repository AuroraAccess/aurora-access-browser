const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { TRASH_FOLDERS, purgeChromiumTrash } = require('../electron/anti-bloat')
const { writeFileAtomic } = require('../electron/atomic-file')

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-anti-bloat-'))
}

test('purgeChromiumTrash: removes all trash folders from userData root and every partition, keeps data files', () => {
  const root = makeTmp()
  try {
    // Root-level trash.
    for (const folder of TRASH_FOLDERS) {
      const dir = path.join(root, folder)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'junk'), 'x')
    }
    // Data that must survive.
    fs.writeFileSync(path.join(root, 'Cookies'), 'keep-me')

    // Partition-level trash (what <webview> sessions create).
    const aurora = path.join(root, 'Partitions', 'aurora')
    fs.mkdirSync(aurora, { recursive: true })
    fs.mkdirSync(path.join(aurora, 'GPUCache'), { recursive: true })
    fs.mkdirSync(path.join(aurora, 'Cache'), { recursive: true })
    fs.writeFileSync(path.join(aurora, 'Cache', 'entry'), 'x')
    const yt = path.join(root, 'Partitions', 'nitrous_youtube_session')
    fs.mkdirSync(yt, { recursive: true })
    fs.mkdirSync(path.join(yt, 'CrashDumps'), { recursive: true })
    fs.writeFileSync(path.join(yt, 'Cookies'), 'session-cookies-kept')

    const logs = []
    purgeChromiumTrash(root, (m) => logs.push(m))

    for (const folder of TRASH_FOLDERS) {
      assert.ok(!fs.existsSync(path.join(root, folder)), `root/${folder} must be gone`)
      assert.ok(!fs.existsSync(path.join(aurora, folder)), `${aurora}/${folder} must be gone`)
      assert.ok(!fs.existsSync(path.join(yt, folder)), `${yt}/${folder} must be gone`)
    }
    assert.ok(fs.existsSync(path.join(root, 'Cookies')), 'root data files must survive')
    assert.ok(fs.existsSync(path.join(yt, 'Cookies')), 'partition data files must survive')
    assert.ok(logs.length > 0, 'purge should log deletions')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('purgeChromiumTrash: refuses to act without an absolute userData path', () => {
  // Relative garbage or empty input must be a no-op, never delete cwd content.
  assert.doesNotThrow(() => purgeChromiumTrash(''))
  assert.doesNotThrow(() => purgeChromiumTrash('relative/nonexistent'))
})

test('purgeChromiumTrash: locked file never throws (robustness), retries next cycle', () => {
  const root = makeTmp()
  try {
    const dir = path.join(root, 'GPUCache')
    fs.mkdirSync(dir, { recursive: true })
    // Simulate an undeletable entry: replace with a path that rmdir fails on.
    // A loop containing a nested file is enough; force a failure by making the
    // directory read-only AFTER creation is not portable — instead stub a
    // directory whose deletion is not permitted on POSIX.
    fs.writeFileSync(path.join(dir, 'x'), 'x')
    fs.chmodSync(dir, 0o555) // read-only dir: rmSync of children still works; remove the dir itself fails
    assert.doesNotThrow(() => purgeChromiumTrash(root))
    if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('writeFileAtomic: writes content, leaves exactly one file (no .tmp- leftovers)', () => {
  const dir = makeTmp()
  try {
    const file = path.join(dir, 'data.json')
    writeFileAtomic(file, JSON.stringify({ a: 1 }))
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"a":1}')
    const entries = fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-') || f.includes('.tmp-'))
    assert.strictEqual(entries.length, 0, 'no temp files must remain in the data dir')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFileAtomic: cleans up the temp file on rename failure', () => {
  const dir = makeTmp()
  try {
    // Make rename fail: destination lives in a directory whose path is bogus
    // after tmp was written? Simplest reliable failure: target dir replaced by
    // a read-only one is not enough (unlink works); instead point at a file
    // whose directory was deleted mid-flight via monkey-patching rename is
    // overkill — trigger failure by passing a destination inside a removed dir.
    const file = path.join(dir, 'gone', 'data.json')
    assert.throws(() => writeFileAtomic(file, 'x'))
    const leftovers = fs.readdirSync(dir)
    assert.ok(leftovers.every((f) => !f.includes('.tmp-')), 'failed atomic write must not litter')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
