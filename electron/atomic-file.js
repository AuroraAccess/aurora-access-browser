// TZ v2.0.9 Anti-Bloat: all persistent JSON (vault, history) must be
// overwritten ATOMICALLY — a crash mid-write must never truncate the only
// copy of the data, and no hidden backup litter (.bak/.old) is ever created.
// Mechanism: write to a temp file in the SAME directory, then fs.rename()
// onto the destination (rename within one filesystem is atomic on POSIX
// and effectively atomic on NTFS). The temp file is unlinked on failure so
// nothing accumulates in the data directory.
const fs = require('fs')
const path = require('path')

function writeFileAtomic(filePath, data, options = {}) {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmp, data, options) // sync single-threaded write, mode/encoding passed through
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch (_) { /* best effort */ }
    throw err
  }
}

module.exports = { writeFileAtomic }
